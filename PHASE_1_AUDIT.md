# Montex Forge MIS — Phase 1 Codebase Audit & Foundation Report

**Audit Date:** 2026-10-23  
**Phase Scope:** Phase 1 — Foundation & Data Hygiene (Strictly preserving existing UI/UX, RTDB services, and active Firebase configuration)

---

## 1. Current Application Architecture & Folder Structure

### 1.1 Runtime & Build Stack (Implemented)
- **Framework:** React 19 (`^19.0.1`) Single-Page Application (SPA) bundled with Vite 8 (`^8.3.0`) and TypeScript (`^7.0.2`).
- **Dev & Build Scripts (`package.json`):**
  - `"dev": "vite --port=3000 --host=0.0.0.0"` (pure client-side Vite server; no Express `server.ts` backend exists yet).
  - `"build": "vite build"`
  - `"lint": "tsc --noEmit"`
- **Active Database:** Firebase Realtime Database (`firebase/database`) connected to `https://montex-mis-default-rtdb.firebaseio.com/`.
- **Planned / Not Yet Active:** Cloud Firestore (`ai-studio-montexmis-80037e3b-fbab-4539-8464-b375213a9416` is present in `firebase-applet-config.json`, but `firebase/firestore` is not imported or initialized in Phase 1).

### 1.2 Verified Directory & File Structure
```text
/
├── .env.example                                   # Safe environment variable template
├── database.rules.json                            # Firebase Realtime Database security rules
├── firebase-applet-config.json                    # Provisioned Firebase project config (montex-mis)
├── index.html                                     # HTML entry point
├── metadata.json                                  # Applet metadata
├── package.json                                   # Dependencies & npm scripts
├── docs/
│   └── PHASE_1_AUDIT.md                           # This audit & Phase 1 foundation report
├── scripts/
│   ├── verify-rtdb-rules.ts                       # 45-assertion RTDB security & data integrity test runner
│   └── verify-phase1-foundation.ts                # Phase 1 role normalization & data hygiene test runner
└── src/
    ├── App.tsx                                    # Root workspace shell & tab router (15 tabs)
    ├── main.tsx                                   # React DOM mount
    ├── index.css                                  # Tailwind CSS v4 global stylesheet
    ├── lib/
    │   └── firebase.ts                            # Firebase App, Auth, and RTDB singleton initialization
    ├── types/
    │   ├── roles.ts                               # [Phase 1] Canonical 8 roles, 5 groups & granular permissions
    │   └── mis.ts                                 # [Phase 1] Consolidated TypeScript interfaces for all entities
    ├── context/
    │   └── RtdbContext.tsx                        # Auth session, RTDB listeners, and shared React state
    ├── services/
    │   ├── rtdbService.ts                         # RTDB CRUD, seeding, and live diagnostic suite
    │   ├── misDataValidator.ts                    # Quantity, stock status, role, and KPI validators
    │   ├── rtdbSecurityEvaluator.ts               # Local simulator for database.rules.json
    │   └── documentExportService.ts               # PDF (jsPDF), Excel (XLSX), and CSV export engine
    ├── utils/
    │   └── pdfBrandingUtility.ts                  # Shared Montex Forge navy/orange PDF header/footer utility
    ├── data/
    │   ├── mockData.ts                            # Demo/sandbox fixtures + clean production baselines
    │   ├── requirementsRegister.ts                # 8 operational register fixtures + A–O requirements catalog
    │   └── blueprintData.ts                       # Architecture reference metadata
    └── components/
        ├── auth/FirebaseAuthAndDiagnosticsModal.tsx
        ├── blueprint/BlueprintView.tsx
        ├── common/ (DemoBanner.tsx, DocumentPreviewModal.tsx, MontexLogo.tsx)
        ├── dashboard/CeoCommandCenter.tsx
        ├── layout/ (Header.tsx, Sidebar.tsx)
        ├── orders/OrderDetailJourney.tsx
        └── modules/ (SalesOrdersView, QuotationsView, ProcurementView, InventoryView,
                      ProductionShopFloorView, QualityView, DispatchView, FinanceView,
                      MasterDataView, NotificationsView, ReportsView, AdminView)
```

---

## 2. Existing Authentication & Authorization Implementation

### 2.1 Implemented Authentication Flows (`src/context/RtdbContext.tsx` & `FirebaseAuthAndDiagnosticsModal.tsx`)
1. **Email/Password Sign-In:** `loginWithEmail()` calls `signInWithEmailAndPassword(auth, email, pass)`.
2. **Google Popup Sign-In:** `loginWithGoogle()` calls `signInWithPopup(auth, googleProvider)`.
3. **Password Reset Email:** `resetPassword()` calls `sendPasswordResetEmail(auth, email)`.
4. **Self-Registration / Bootstrap (`registerOrBootstrapUser`):**
   - Calls `createUserWithEmailAndPassword(auth, email, pass)` from the browser client.
   - If `cred.user.email === 'anshyadav6647@gmail.com'` AND `cred.user.emailVerified === true`, it writes `/users/${uid}` with `role: 'Admin'`, `legacyRole: 'super_admin'`, `accountStatus: 'active'`.
   - For all other self-registered users, it writes `/users/${uid}` with `role: 'Unassigned'`, `accountStatus: 'pending_approval'`, and `permissions: []`.
5. **Admin Employee Provisioning (`src/components/modules/AdminView.tsx` — `handleInviteEmployee`):**
   - Currently writes a profile record directly to `/users/${uid}` in RTDB (`adminUpdateEmployeeProfileInRtdb`).
   - **Verified Limitation (Deferred to Phase 3):** Does **not** create a corresponding Firebase Authentication account or send a password-setup link; if the admin leaves the UID blank, it generates a synthetic `uid-emp-XXXX` key that will not match a real Firebase Auth `uid`.

### 2.2 Unauthenticated Fallback Behavior
- When `firebaseUser === null` (or `currentUser.accountStatus !== 'active'`), `RtdbContext.tsx` sets `dataSource = 'fallback_seed'`, detaches protected RTDB `onValue` listeners, and renders the application in an interactive preview/demo mode initialized with `PROTOTYPE_USERS[0]` (`super_admin`) and `MOCK_*` fixtures.
- When `firebaseUser === null`, the top `Header.tsx` displays a preview Role Switcher dropdown (`Admin`, `Management`, `Finance`, `Sales`, `Production`). When signed in (`firebaseUser !== null`), the Role Switcher is hidden.

---

## 3. User Roles, Organizational Groups & Granular Permissions

### 3.1 Canonical 8 Granular Roles (`UserRole` in `src/types/roles.ts`)
Phase 1 establishes `src/types/roles.ts` as the single canonical source of truth for the 8 operational roles and their descriptive organizational classifications:

| Canonical `UserRole` | Descriptive `RbacRoleGroup` | Default Role Title | Primary Operational Scope |
| :--- | :--- | :--- | :--- |
| `super_admin` | `Admin` | Super Administrator & IT Head | Full system governance, user provisioning, RBAC, thresholds, audit logs |
| `ceo` | `Management` | Managing Director & CEO | Executive read/approve across all modules, KPI command center, exports |
| `sales` | `Sales` | VP - Sales & Marketing | Sales Orders, Quotations & Tenders, Customer & Product Master |
| `stores` | `Production` | Stores & Yard Superintendent | Raw Material Inventory, Stock Movements (GRN/Issue/Scrap), Shop Floor logs |
| `purchase` | `Production` | Head of Strategic Procurement | Purchase Orders to Steel Mills, Approved Mill Vendors, Mill GRN receipts |
| `quality` | `Production` | Quality Assurance Head (NDT Level III) | Quality Inspections, EN 10204 3.1 MTCs, Dimensional Reports, TPI Clearance |
| `dispatch` | `Production` | Dispatch & Logistics Officer | Outward Consignments, Gate Passes, Transporter/LR Details, Delivery Challans |
| `finance` | `Finance` | Chief Financial Officer | Tax Invoices, Payment Collections, Receivables Ageing, Job Costing, Tally Sync |

### 3.2 Legacy Role Value Mappings & Non-Promotion Safeguards
In the existing Firebase Realtime Database (`database.rules.json`), `/users/$uid/role` is validated against the 5 organizational group strings (`'Admin' | 'Management' | 'Finance' | 'Sales' | 'Production'`) plus `'Unassigned'`, while the specific 8-value role is stored in `/users/$uid/legacyRole`.

| Legacy `/users/$uid` State | Resolved `granularRole` | Resolved `rbacGroup` | Active Permissions Granted |
| :--- | :--- | :--- | :--- |
| `role: 'Admin'`, `legacyRole: 'super_admin'`, `accountStatus: 'active'` | `super_admin` | `Admin` | `ROLE_PERMISSION_DEFAULTS.super_admin` |
| `role: 'Management'`, `legacyRole: 'ceo'`, `accountStatus: 'active'` | `ceo` | `Management` | `ROLE_PERMISSION_DEFAULTS.ceo` |
| `role: 'Sales'`, `accountStatus: 'active'` | `sales` | `Sales` | `ROLE_PERMISSION_DEFAULTS.sales` |
| `role: 'Production'`, `legacyRole: 'stores' \| 'purchase' \| 'quality' \| 'dispatch'` | Preserves `legacyRole` | `Production` | Granular permissions for that specific role |
| `role: 'Production'` (no `legacyRole` present) | `quality` (conservative default) | `Production` | `ROLE_PERMISSION_DEFAULTS.quality` (never promoted to `Admin`/`Finance`) |
| `role: 'Finance'`, `accountStatus: 'active'` | `finance` | `Finance` | `ROLE_PERMISSION_DEFAULTS.finance` |
| `role: 'Unassigned'` or `accountStatus !== 'active'` | Conservative fallback (`quality`) | `Production` | **`[]` (Zero permissions; `isActive: false`)** |

### 3.3 Frontend vs. Database Permission Enforcement Gap
- **Enforced in `database.rules.json` (Database Level):**
  - Default-deny at root (`/`).
  - All reads/writes require `auth != null` and `/users/$(auth.uid)/accountStatus === 'active'`.
  - `/users` list read and `/auditLogs` list read restricted to `Admin` and `Management`.
  - `/outstandingPayments` read restricted to `Admin`, `Management`, `Finance`, `Sales`; write restricted to `Admin`, `Finance`.
  - However, `/inventory/*`, `/quality/*`, `/dispatch/*`, and `/production` in `database.rules.json` check `role === 'Production'`, which groups `stores`, `purchase`, `quality`, and `dispatch` together at the RTDB rule level.
- **Enforced in `src/types/roles.ts` (Application Level — Phase 1):**
  - `ROLE_PERMISSION_DEFAULTS` and `hasGranularRolePermission()` strictly separate `stores`, `purchase`, `quality`, and `dispatch` (e.g., `dispatch` cannot create/edit `Inventory / Stores` or `Quality & MTC`; `stores` cannot create/edit `Dispatch` or `Quality & MTC`; `quality` cannot create/edit `Purchase & Steel Mills` or `Inventory / Stores`).
  - Database-level enforcement of the 8 individual roles will be implemented in `/firestore.rules` during Phase 2.

---

## 4. Existing RTDB Collections/Paths & Service Functions

### 4.1 Persisted RTDB Paths (14 Paths in `src/services/rtdbService.ts` & `database.rules.json`)
| RTDB Path | Type | Primary Service Functions (`src/services/rtdbService.ts`) |
| :--- | :--- | :--- |
| `/users/$uid` | Collection | `adminUpdateEmployeeProfileInRtdb`, `seedMontexRealtimeDatabase` |
| `/dashboardKpis` | Singleton | `seedMontexRealtimeDatabase`, `runRtdbVerificationSuite` |
| `/production` | Singleton | `updateProductionSummaryInRtdb`, `seedMontexRealtimeDatabase` |
| `/salesOrders/$orderId` | Collection | `createSalesOrderInRtdb`, `updateSalesOrderInRtdb`, `recordDispatchInRtdb` |
| `/dispatch/$dispatchId` | Collection | `recordDispatchInRtdb`, `seedMontexRealtimeDatabase` |
| `/inventory/rawMaterials/$materialId` | Collection | `recordStockMovementInRtdb`, `seedMontexRealtimeDatabase` |
| `/inventory/stockMovements/$movementId` | Collection | `recordStockMovementInRtdb`, `seedMontexRealtimeDatabase` |
| `/quality/inspections/$inspectionId` | Collection | `recordQualityInspectionInRtdb`, `seedMontexRealtimeDatabase` |
| `/outstandingPayments/$customerId` | Collection | `recordCustomerPaymentInRtdb`, `seedMontexRealtimeDatabase` |
| `/alerts/actionQueue/$actionId` | Collection | `acknowledgeAlertInRtdb`, `seedMontexRealtimeDatabase` |
| `/alerts/thresholds` | Singleton | `saveAlertThresholdsInRtdb`, `seedMontexRealtimeDatabase` |
| `/customers/$customerId` | Collection | `upsertCustomerInRtdb`, `seedMontexRealtimeDatabase` |
| `/products/$productId` | Collection | `upsertProductInRtdb`, `seedMontexRealtimeDatabase` |
| `/auditLogs/$logId` | Collection (Append-Only) | `logAuditToRtdb` |

---

## 5. Operational Registers & Current Persistence Status

The following **8 operational registers** (plus 2 reference catalogs) are initialized from `src/data/requirementsRegister.ts` into React state in `src/context/RtdbContext.tsx` (lines 188–195) or module state:

| # | Register / Catalog | TypeScript Interface (`src/types/mis.ts`) | Current Persistence Status (Verified) |
| :--- | :--- | :--- | :--- |
| 1 | **Quotations Register** | `QuotationRecord` | **In-Memory React State (`RtdbContext`)** — Creating/updating quotes mutates memory and logs to `/auditLogs`. Converting a won quote to a PO persists the new order to `/salesOrders/$orderId`, but the quotation status change is lost on page refresh. |
| 2 | **PSU/EPC Tenders Register** | `TenderRecord` | **In-Memory React State (`RtdbContext`)** — Mutations update memory + `/auditLogs` only; lost on browser refresh. |
| 3 | **Purchase Orders (Steel Mills)** | `PurchaseOrderRecord` | **In-Memory React State (`RtdbContext`)** — Recording a Mill GRN persists stock changes to `/inventory/rawMaterials` and `/inventory/stockMovements`, but the PO record itself is in-memory only. |
| 4 | **Shop Machine Production Logs** | `ShopMachineLog` | **In-Memory React State (`RtdbContext`)** — Updates `/production` shift summary in RTDB, but individual machine logs are in-memory only. |
| 5 | **Furnace Batch / Heat Logs** | `FurnaceBatchLog` | **In-Memory React State (`RtdbContext`)** — Mutations update memory + `/auditLogs` only; lost on browser refresh. |
| 6 | **Machine Maintenance Tickets** | `MachineMaintenanceTicket` | **In-Memory React State (`RtdbContext`)** — Mutations update memory + `/auditLogs` only; lost on browser refresh. |
| 7 | **Daily Power Consumption Logs** | `PowerConsumptionLog` | **In-Memory React State (`RtdbContext`)** — Mutations update memory + `/auditLogs` only; lost on browser refresh. |
| 8 | **Dimensional Inspection Reports** | `DimensionalInspectionReport` | **In-Memory React State (`RtdbContext`)** — Mutations update memory + `/auditLogs` only; lost on browser refresh. |
| 9 | **Approved Steel Mill Suppliers** | `SteelMillSupplier` | **Static / In-Memory (`ProcurementView.tsx`)** — Loaded from `INITIAL_STEEL_MILLS`. |
| 10 | **Job Costing Sheets** | `JobCostSheet` | **Static / In-Memory (`FinanceView.tsx`)** — Loaded from `INITIAL_JOB_COST_SHEETS`. |

---

## 6. Mock Data, Demo Data & Discrepancies Audit

### 6.1 Verified Discrepancies in Legacy Mock Fixtures (`src/data/mockData.ts` & `src/services/rtdbService.ts`)
1. **Order & QC Quantity Overflow (`ORD-2026-001` & `QC-2026-0894`):**
   - `ORD-2026-001` (`JOB-MF-2026-0412`) has `producedQty: 500`, `inspectedOkQty: 500`, `rejectedQty: 8` (`500 + 8 = 508 > 500`).
   - `QC-2026-0894` has `inspectedQty: 500`, `passedQty: 500`, `rejectedQty: 8` (`500 + 8 = 508 > 500`).
2. **Staged Dispatch vs. Order Balance Mismatch (`DSP-2026-0092` vs. `ORD-2026-004`):**
   - `DSP-2026-0092` (`JOB-MF-2026-0398`, `status: 'ready_for_dispatch'`) sets `quantity: 100` and `balanceQty: 0`, whereas `ORD-2026-004` has `totalShippedQty: 0` and `balanceQty: 100`.
3. **Raw Material Stored Status vs. Available Stock Thresholds (`RM-001`, `RM-003`, `RM-004`, `RM-005`):**
   - `RM-001` has `availableStockMt: 11.5` and `minimumStockMt: 25.0` (which is `'critical'`), but stored `status` in `MOCK_RAW_MATERIALS` is `'adequate'`. Similarly `RM-003` (`3.4 < 10.0`), `RM-004` (`19.5 < 20.0`), and `RM-005` (`5.7 < 12.0`) have stored statuses that do not match `computeRawMaterialStockStatus()`.
4. **Stored Executive KPI Snapshot (`DEFAULT_DASHBOARD_KPIS`):**
   - `materialShortagesCount` is hardcoded to `2`, whereas 5 materials have `availableStockMt < minimumStockMt` and 1 order (`ORD-2026-003`) is in `material_pending`.

### 6.2 How Phase 1 Handles Demo vs. Production Data Hygiene
- **Preservation of Regression Test Fixtures:** Existing `scripts/verify-rtdb-rules.ts` assertions (`BIZ-02`, `BIZ-03`, `BIZ-04`, `BIZ-07`, `BIZ-08`, `BIZ-16`) explicitly test that `misDataValidator.ts` *detects* the anomalies in `MOCK_RAW_MATERIALS`, `MOCK_ORDER_JOURNEYS`, `INITIAL_QUALITY_INSPECTIONS`, and `INITIAL_DISPATCHES`. Therefore, those raw exports are preserved for validator regression testing.
- **Reconciled Demo Sandbox Fixtures (`CONSISTENT_DEMO_SANDBOX_FIXTURES`):** Added in `src/data/mockData.ts` with all 4 mathematical discrepancies resolved and every record tagged with `dataOrigin: 'demo_sandbox'`.
- **Clean Production Baselines (`CLEAN_PRODUCTION_DASHBOARD_KPIS` & `CLEAN_PRODUCTION_SUMMARY`):** Added in `src/data/mockData.ts` with all counters zeroed (`0`) for fresh production workspace initialization.
- **Remaining Isolation Steps Required in Phases 2–5:**
  1. In `RtdbContext.tsx`, initial state currently defaults to `MOCK_*` arrays before auth resolves, and `recordToArray(snap.val(), MOCK_*)` falls back to mock arrays if an RTDB collection node is empty. In Phase 4/5, authenticated production sessions must initialize with empty arrays (`[]`) and `CLEAN_PRODUCTION_DASHBOARD_KPIS` so an empty database displays clean empty states instead of fallback sample data.
  2. `seedMontexRealtimeDatabase()` in `rtdbService.ts` currently seeds `PROTOTYPE_USERS` and `MOCK_*` records when manually invoked by an Admin. In Phase 4, production initialization will write only `/systemConfig/*` baselines and the authenticated Admin's `/users/{uid}` profile.

---

## 7. Security Rules, Environment Configuration & Firebase Initialization

- **`src/lib/firebase.ts`:** Initializes `app`, `auth`, `googleProvider`, and `rtdb` (`getDatabase(app, databaseURL)`). Reads `VITE_FIREBASE_*` environment variables with fallback to `firebase-applet-config.json`.
- **`firebase-applet-config.json`:** Contains project `montex-mis` web SDK configuration and `firestoreDatabaseId: "ai-studio-montexmis-80037e3b-fbab-4539-8464-b375213a9416"`.
- **`.env.example`:** Updated in Phase 1 to use safe placeholders only (`YOUR_FIREBASE_WEB_API_KEY_PLACEHOLDER`, etc.) and to document future Phase 2/3 server-only environment variables without exposing any secrets to `VITE_*`.

---

## 8. Duplicated Types & Conflicting Definitions Resolved in Phase 1

1. **Deduplicated `ROLE_PERMISSION_DEFAULTS`:** Previously defined only in `src/data/mockData.ts` with 7 broad module names. Now canonically defined in `src/types/roles.ts` covering all 13 granular modules and re-exported by `src/types/mis.ts` and `src/data/mockData.ts`.
2. **Centralized `QualityInspectionRecord` & `DispatchConsignmentRecord`:** `QualityInspectionRecord` was previously defined inside `src/services/misDataValidator.ts` while `INITIAL_DISPATCHES` and `recordDispatchInRtdb` in `src/services/rtdbService.ts` used inline anonymous object types. Both are now canonically defined in `src/types/mis.ts` and re-exported in `src/services/misDataValidator.ts`.
3. **Centralized Role Normalization Logic:** `mapGranularRoleToRbacGroup` and `mapRbacGroupToDefaultGranularRole` in `src/services/misDataValidator.ts` now delegate to `getOrganizationalGroupForRole` and `resolveGranularRoleFromGroupOrLegacy` in `src/types/roles.ts`.
