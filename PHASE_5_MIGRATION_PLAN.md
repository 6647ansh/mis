# Montex Forge MIS — Phase 5 Controlled Firestore Cutover & Persistent Operational Registers Plan

## 1. Pre-Migration Data Flow Audit

### 1.1 Legacy Architecture (Phases 1–4 Baseline)
Prior to Phase 5, the Montex Forge MIS Dashboard operated with a hybrid data layer centered in `src/context/RtdbContext.tsx` and `src/services/rtdbService.ts`:

1. **Primary Context (`src/context/RtdbContext.tsx`)**:
   - Subscribed to `onAuthStateChanged(auth, ...)` and resolved `/users/{uid}` from Firebase Realtime Database (`rtdb`).
   - Loaded 10 RTDB paths (`dashboardKpis`, `productionSummary`, `alertThresholds`, `salesOrders`, `rawMaterials`, `stockMovements`, `quality/inspections`, `dispatches`, `outstandingPayments`, `actionQueue`, `customers`, `products`).
   - **Critical Vulnerability Identified in Audit**: Whenever an RTDB node returned `null` or empty (`Object.keys(val).length === 0`) for an authenticated user, `RtdbContext.tsx` fell back to `MOCK_ORDER_JOURNEYS`, `MOCK_RAW_MATERIALS`, `MOCK_CUSTOMERS`, and `INITIAL_*` demo fixtures instead of returning empty production collections (`[]`).
2. **Eight Operational Registers (Previously In-Memory Only)**:
   - `quotations` (`QuotationRecord[]`) — initialized from `INITIAL_QUOTATIONS` in React state only.
   - `tenders` (`TenderRecord[]`) — initialized from `INITIAL_TENDERS` in React state only.
   - `purchaseOrders` (`PurchaseOrderRecord[]`) — initialized from `INITIAL_PURCHASE_ORDERS` in React state only.
   - `machineLogs` (`ShopMachineLog[]`) — initialized from `INITIAL_SHOP_MACHINE_LOGS` in React state only.
   - `furnaceLogs` (`FurnaceBatchLog[]`) — initialized from `INITIAL_FURNACE_BATCHES` in React state only.
   - `maintenanceTickets` (`MachineMaintenanceTicket[]`) — initialized from `INITIAL_MAINTENANCE_TICKETS` in React state only.
   - `powerLogs` (`PowerConsumptionLog[]`) — initialized from `INITIAL_POWER_LOGS` in React state only.
   - `dimensionalReports` (`DimensionalInspectionReport[]`) — initialized from `INITIAL_DIMENSIONAL_REPORTS` in React state only.
   - Additionally, `suppliers` (`INITIAL_STEEL_MILLS`) and `jobCostSheets` (`INITIAL_JOB_COST_SHEETS`) were read directly from static arrays in `ProcurementView.tsx`, `FinanceView.tsx`, and `ReportsView.tsx`.

---

## 2. Pre-Cutover Safety Gates & Environment Verification

Before activating Firestore as the primary persistence layer for authenticated sessions, the following six safety gates are verified:

| Gate # | Safety Gate | Verification Method | Status & Operational Handling |
| :--- | :--- | :--- | :--- |
| **Gate 1** | Named Firestore Database Reachability | `initializeFirestore(app, {}, firestoreDatabaseId)` targeting `ai-studio-montexmis-80037e3b-fbab-4539-8464-b375213a9416` (`firebase-applet-config.json`) | SDK initialized cleanly (`isFirestoreConfigured = true`). Runtime connectivity verified via `probeFirestoreConnectivity()` and graceful error classification (`classifyFirestoreError`). |
| **Gate 2** | Deployed vs. Local `firestore.rules` Alignment | `firestore.rules` (1,173 lines) & `firebase-blueprint.json` (22 collections) | All 22 collections have strict `hasAll`/`hasOnly` schema validators and role-based access rules (`super_admin`, `ceo`, `sales`, `purchase`, `stores`, `quality`, `dispatch`, `finance`). |
| **Gate 3** | Server Firebase Admin SDK Credentials | `getAdminHealthStatus()` in `server/config/firebaseAdmin.ts` (`GET /api/admin/health`) | Fail-closed when `FIREBASE_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS` is not set in preview container (`adminReady: false`), returning HTTP `503 ADMIN_SDK_NOT_CONFIGURED` with actionable setup instructions. |
| **Gate 4** | Active `super_admin` Profile in `/users/{uid}` | Resolved via `firestoreService.getUserProfile(uid)` on sign-in | Never auto-created or auto-promoted on client sign-in. If `/users/{uid}` is missing in Firestore, `RtdbContext` checks RTDB fallback during transition or assigns `pending_approval` with zero business data access. |
| **Gate 5** | Admin Provisioning & System Init Endpoints | `/api/admin/employees` & `/api/admin/system/initialize` | Mounted in `server.ts`, protected by `requireSuperAdmin` middleware, idempotent, and zero-mock-data compliant. |
| **Gate 6** | Frontend / Backend Schema & Role Consistency | `src/types/roles.ts`, `firestore.rules`, `src/services/firestoreMappers.ts` | Bi-directional mappers translate rich UI domain models (`src/types/mis.ts`) to and from strict `firestore.rules`-validated documents without extra keys or enum mismatches. |

---

## 3. Complete 22-Collection Mapping & Schema Translation

Because `firestore.rules` enforces strict key whitelists (`data.keys().hasAll([...]) && data.keys().hasOnly([...])`) and strict enum values on every document write, `src/services/firestoreMappers.ts` provides lossless bi-directional conversion between UI domain types (`src/types/mis.ts`) and Firestore documents (`src/services/firestoreService.ts`):

| # | Firestore Collection | Document ID | UI Domain Type (`src/types/mis.ts`) | Primary UI Modules | Authorized Write Roles (`firestore.rules`) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `/users/{userId}` | Firebase Auth `uid` | `MisUser` | `AdminView`, `TopHeader` | `super_admin` (Admin SDK primary) |
| 2 | `/systemConfig/{configId}` | `dashboardKpis`, `productionSummary`, `alertThresholds` | `RtdbDashboardKpis`, `RtdbProductionSummary`, `RtdbAlertThresholds` | `CeoCommandCenter`, `NotificationsView` | `super_admin` |
| 3 | `/customers/{customerId}` | `CUST-xxx` | `Customer` | `MasterDataView`, `SalesOrdersView`, `QuotationsView`, `FinanceView` | `super_admin`, `sales` |
| 4 | `/products/{productId}` | `PROD-xxx` | `Product` | `MasterDataView`, `SalesOrdersView`, `QuotationsView`, `DispatchView` | `super_admin` (create/update), `sales`/`stores`/`quality` (update) |
| 5 | `/suppliers/{supplierId}` | `SUP-xxx` | `SteelMillSupplier` | `ProcurementView`, `FinanceView` | `super_admin`, `purchase` |
| 6 | `/salesOrders/{orderId}` | `ORD-2026-xxx` | `OrderJourney` | `SalesOrdersView`, `OrderDetailJourney`, `CeoCommandCenter`, `QualityView`, `DispatchView` | `super_admin`, `sales` (create); `super_admin`, `sales`, `purchase`, `stores`, `quality`, `dispatch`, `finance` (update) |
| 7 | `/quotations/{quoteId}` | `QT-2026-xxx` | `QuotationRecord` (**Register #1**) | `QuotationsView` | `super_admin`, `sales` |
| 8 | `/tenders/{tenderId}` | `TND-2026-xxx` | `TenderRecord` (**Register #2**) | `QuotationsView` | `super_admin`, `sales` |
| 9 | `/purchaseOrders/{poId}` | `PO-MILL-26-xxx` | `PurchaseOrderRecord` (**Register #3**) | `ProcurementView`, `InventoryView`, `FinanceView` | `super_admin`, `purchase` (create); `super_admin`, `purchase`, `stores` (update/GRN) |
| 10 | `/rawMaterials/{materialId}` | `MAT-xxx` | `RawMaterialStock` | `InventoryView`, `ProcurementView`, `CeoCommandCenter` | `super_admin`, `stores`, `purchase` |
| 11 | `/stockMovements/{movementId}` | `MOV-xxx` | `StockMovement` | `InventoryView`, `ProcurementView`, `ReportsView` | `super_admin`, `stores` (immutable ledger) |
| 12 | `/machineLogs/{logId}` | `MLOG-xxx` | `ShopMachineLog` (**Register #4**) | `ProductionShopFloorView`, `ReportsView` | `super_admin`, `stores` |
| 13 | `/furnaceLogs/{batchId}` | `HT-2026-xxx` | `FurnaceBatchLog` (**Register #5**) | `ProductionShopFloorView` | `super_admin`, `stores`, `quality` |
| 14 | `/maintenanceTickets/{ticketId}` | `MNT-2026-xxx` | `MachineMaintenanceTicket` (**Register #6**) | `ProductionShopFloorView` | `super_admin`, `stores` |
| 15 | `/powerLogs/{logId}` | `PWR-xxx` | `PowerConsumptionLog` (**Register #7**) | `ProductionShopFloorView` | `super_admin`, `stores` |
| 16 | `/qualityInspections/{inspId}` | `QC-2026-xxx` | `QualityInspectionRecord` | `QualityView`, `OrderDetailJourney`, `ReportsView` | `super_admin`, `quality` |
| 17 | `/dimensionalReports/{reportId}` | `DIR-2026-xxx` | `DimensionalInspectionReport` (**Register #8**) | `QualityView`, `OrderDetailJourney` | `super_admin`, `quality` |
| 18 | `/dispatches/{dispatchId}` | `DSP-2026-xxx` | `DispatchConsignmentRecord` | `DispatchView`, `CeoCommandCenter`, `ReportsView` | `super_admin`, `dispatch` |
| 19 | `/outstandingPayments/{invoiceId}` | `CUST-xxx` / `INV-xxx` | `OutstandingAgeingRecord` | `FinanceView`, `CeoCommandCenter`, `ReportsView` | `super_admin`, `finance` |
| 20 | `/jobCostSheets/{jobId}` | `JCS-2026-xxx` | `JobCostSheet` | `FinanceView`, `ReportsView` | `super_admin`, `finance` |
| 21 | `/actionQueue/{actionId}` | `ACT-xxx` | `ActionQueueItem` | `CeoCommandCenter`, `NotificationsView` | `super_admin`, `ceo`, `sales`, `purchase`, `stores`, `quality`, `dispatch`, `finance` |
| 22 | `/auditLogs/{logId}` | `AUD-xxx` | `AuditLogEntry` | `AdminView`, `firestoreService` | Append-only by active authenticated actor (`actorUid == request.auth.uid`) |

---

## 4. Clean-Production Isolation & Empty-State Guarantees

1. **Authenticated Production Mode (`firebaseUser !== null`)**:
   - When an authenticated user signs in with `accountStatus === 'active'`, `RtdbContext` loads only the collections permitted for `currentUser.role` from Cloud Firestore (`firestoreService`).
   - **Zero Demo Fallback**: If any Firestore collection is empty (`[]`), the context sets that collection state to `[]` and initializes KPIs to `ZERO_DASHBOARD_KPIS` and `ZERO_PRODUCTION_SUMMARY`. It **never** falls back to `MOCK_ORDER_JOURNEYS`, `INITIAL_QUOTATIONS`, `INITIAL_TENDERS`, `INITIAL_PURCHASE_ORDERS`, `INITIAL_SHOP_MACHINE_LOGS`, `INITIAL_FURNACE_BATCHES`, `INITIAL_MAINTENANCE_TICKETS`, `INITIAL_POWER_LOGS`, `INITIAL_DIMENSIONAL_REPORTS`, or `INITIAL_JOB_COST_SHEETS`.
2. **Inactive / Pending / Suspended Accounts (`currentUser.accountStatus !== 'active'`)**:
   - Receive empty arrays (`[]`) for all business collections and operational registers, and all write actions fail closed with a clear account-status error message.
3. **Unauthenticated Demo / Preview Sandbox Mode (`firebaseUser === null`)**:
   - Continues to work offline/in-memory using demo fixtures (`dataOrigin: 'demo'`) clearly labeled as Preview Session Only, with zero writes to production Firestore.

---

## 5. Rollback Plan

If a critical production issue requires reverting to Firebase Realtime Database:
1. `src/services/rtdbService.ts` and `database.rules.json` remain completely intact and unmodified in the repository.
2. `RtdbContext.tsx` supports a data-source toggle (`DATA_BACKEND_MODE = 'firestore' | 'rtdb'`) defaulting to `'firestore'`. Switching the constant or environment flag `VITE_DATA_BACKEND=rtdb` immediately restores RTDB reads/writes without any UI component changes.
