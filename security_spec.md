# Montex Forge MIS — Cloud Firestore Security Specification & Data Blueprint (`security_spec.md`)

**Phase:** Phase 2 — Firestore Foundation & Security  
**Firebase Project ID:** `montex-mis`  
**Configured Firestore Database ID:** `ai-studio-montexmis-80037e3b-fbab-4539-8464-b375213a9416`  
**Canonical Role Taxonomy (`src/types/roles.ts`):** `super_admin`, `ceo`, `sales`, `stores`, `purchase`, `quality`, `dispatch`, `finance`

---

## 1. Core Security Architecture & Global Data Invariants

1. **Zero-Trust Default Deny (`match /{document=**}`):**
   - Every unmatched path in `/databases/{database}/documents` is unconditionally denied (`allow read, write: if false;`).
2. **Authoritative Server-Side Identity & Active Account Gate:**
   - Every operational rule requires an authenticated user (`request.auth != null`) whose authoritative profile document at `/databases/$(database)/documents/users/$(request.auth.uid)` exists and has `accountStatus == 'active'`.
   - Deactivated (`inactive`, `suspended`, `pending_setup`) accounts immediately lose all read and write access across all 22 collections, even if their client JWT has not yet expired.
   - Bootstrap Super Admin fallback (`anshyadav6647@gmail.com`) is permitted **only** when `request.auth.token.email == 'anshyadav6647@gmail.com' && request.auth.token.email_verified == true`.
3. **Granular 8-Role Database Enforcement (No Broad `Production` Group Bleed):**
   - Database security rules enforce the **8 canonical `UserRole` values** (`super_admin`, `ceo`, `sales`, `stores`, `purchase`, `quality`, `dispatch`, `finance`) directly from `/users/$(request.auth.uid).data.role` (with backward-compatible fallback to `legacyRole` if `role` is a legacy group label).
   - Operational roles inside the `Production` RBAC group (`stores`, `purchase`, `quality`, `dispatch`) are **strictly segregated at the database layer**:
     - `stores` can manage `/rawMaterials`, `/stockMovements`, `/machineLogs`, `/furnaceLogs`, `/maintenanceTickets`, `/powerLogs`, and manufacturing stage updates on `/salesOrders`, but **cannot** write `/purchaseOrders`, `/suppliers`, `/qualityInspections`, `/dimensionalReports`, or `/dispatches`.
     - `purchase` can manage `/purchaseOrders` and `/suppliers`, and read `/rawMaterials` & `/stockMovements`, but **cannot** mutate `/rawMaterials`, `/stockMovements`, `/machineLogs`, `/qualityInspections`, or `/dispatches`.
     - `quality` can manage `/qualityInspections`, `/dimensionalReports`, and quality/MTC fields on `/salesOrders`, but **cannot** write `/purchaseOrders`, `/rawMaterials`, `/stockMovements`, or `/dispatches`.
     - `dispatch` can manage `/dispatches` and dispatch/delivery fields on `/salesOrders`, but **cannot** write `/rawMaterials`, `/stockMovements`, `/purchaseOrders`, or `/qualityInspections`.
4. **Anti-Privilege-Escalation & PII Isolation on `/users/{userId}`:**
   - Public visitors and non-admin employees **cannot** create `/users/{userId}` documents with `super_admin`, `ceo`, or any operational role (`allow create: if isSuperAdmin()`).
   - Employees can read (`get`) their own `/users/{userId}` profile. Reading (`get` or `list`) all employee profiles is restricted to `super_admin` and `ceo`.
   - Employees updating their own profile may **only** update non-privileged presence fields (`lastLogin`, `updatedAt`, `displayName`, `mustChangePassword`) while `role`, `legacyRole`, `rbacGroup`, `permissions`, `accountStatus`, `email`, `uid`, and `department` are strictly immutable (`affectedKeys().hasOnly(...)`).
5. **Financial Data Isolation (`/outstandingPayments`, `/jobCostSheets`):**
   - Customer receivables ageing (`/outstandingPayments`) and order margin cost sheets (`/jobCostSheets`) are classified as `Confidential Financial`.
   - Read (`get`, `list`) access is restricted strictly to `super_admin`, `ceo`, and `finance`.
   - Write (`create`, `update`) access is restricted strictly to `super_admin` and `finance`. Delete is restricted to `super_admin`.
6. **Immutable Ledgers (`/auditLogs`, `/stockMovements`):**
   - `/auditLogs/{logId}` is strictly append-only (`allow update, delete: if false;`) — not even `super_admin` can alter or delete an audit log entry via client SDK.
   - During creation of `/auditLogs/{logId}`, `actorUid` must equal `request.auth.uid`.
   - `/stockMovements/{movementId}` is immutable after creation (`allow update: if false; allow delete: if isSuperAdmin();`).
7. **Path Variable Hardening & Payload Schema Validation (`isValidId` + `isValid[Entity]`):**
   - Every single-document target rule (`get`, `create`, `update`, `delete`) validates the document ID with `isValidId(docId)` (`^[a-zA-Z0-9_\-]+$`, `size() >= 1 && size() <= 128`).
   - Every `create` and `update` rule invokes `isValid[Entity](incoming())`, enforcing required keys (`keys().hasAll(...)`), allowed key whitelists (`keys().hasOnly(...)` to block shadow/ghost fields), string `.size()` bounds, numeric non-negativity, and valid enum state values.

---

## 2. Complete 22-Collection Firestore Blueprint & Access Matrix

### Collection 1: `/users/{userId}` (`UserProfile`)
- **Purpose:** Authoritative employee identity, department, account status, and granular 8-role RBAC assignment.
- **Document ID Strategy:** Firebase Auth `uid` (`userId == request.auth.uid` for self-reads).
- **Sensitivity Classification:** `Admin-Only / PII Restricted`
- **Required Fields:** `uid` (string), `email` (string), `displayName` (string), `role` (canonical `UserRole`), `department` (string), `accountStatus` (`'active' | 'inactive' | 'suspended' | 'pending_setup'`), `createdAt` (string), `updatedAt` (string).
- **Optional Fields:** `legacyRole`, `rbacGroup`, `designation`, `mustChangePassword`, `provisionedBy`, `provisionedAt`, `permissions`, `lastLogin`, `dataOrigin`.
- **Owner/Actor Fields:** `uid`, `provisionedBy`.
- **Relationships:** Master identity document referenced by all 21 operational collections for RBAC evaluation.
- **Permitted Roles & Operations:**
  - `get`: `isOwner(userId)` OR `super_admin` OR `ceo`
  - `list`: `super_admin`, `ceo`
  - `create`: `super_admin` only (or bootstrap Super Admin initializing their own verified profile)
  - `update`: `super_admin` (full profile management) OR `isOwner(userId)` limited strictly to `['lastLogin', 'updatedAt', 'displayName', 'mustChangePassword']` with immutable `uid`, `email`, `role`, `legacyRole`, `rbacGroup`, `permissions`, `accountStatus`, `department`, `createdAt`
  - `delete`: `super_admin` only (cannot delete self)

### Collection 2: `/systemConfig/{configId}` (`SystemConfigDocument`)
- **Purpose:** Singleton plant configuration and executive aggregate documents (`dashboardKpis`, `productionSummary`, `alertThresholds`, `connection_probe`).
- **Document ID Strategy:** Fixed singleton keys (`dashboardKpis`, `productionSummary`, `alertThresholds`, `connection_probe`).
- **Sensitivity Classification:** `Public Internal (Active Employees)`
- **Required Fields:** `configId` (string), `configType` (string), `updatedAt` (string).
- **Optional Fields:** KPI counters (`totalOrderBookValue`, `activeOrdersCount`, `delayedOrdersCount`, `monthlyDispatchMT`, `monthlyDispatchTargetMT`, `rawMaterialStockMT`, `lowStockAlertsCount`, `rejectionRatePct`, `maxRejectionThresholdPct`, `totalOutstandingINR`, `overdueReceivablesINR`), production yield fields (`fpyPercentage`, `reworkTons`, `scrapPct`, `ncrCount`), threshold fields (`Low_Stock_Threshold_Tons`, `Delay_Threshold_Days`, `Rejection_Rate_Max_Pct`, `Payment_Overdue_Days`), `updatedBy`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: All 8 active roles (`super_admin`, `ceo`, `sales`, `stores`, `purchase`, `quality`, `dispatch`, `finance`)
  - `create`, `update`:
    - When `configId == 'alertThresholds'`: `super_admin` only
    - When `configId in ['dashboardKpis', 'productionSummary']`: `super_admin`, `ceo`, `sales`, `stores`, `purchase`, `quality`, `dispatch`, `finance` (updated atomically alongside operational writes)
  - `delete`: `false` (singleton system configs cannot be deleted)

### Collection 3: `/customers/{customerId}` (`Customer`)
- **Purpose:** Master directory of industrial B2B forging customers, GSTINs, and credit limits.
- **Document ID Strategy:** Deterministic customer code (e.g., `CUST-001`).
- **Sensitivity Classification:** `Role-Restricted Commercial`
- **Required Fields:** `id`, `name`, `contactPerson`, `email`, `creditLimit` (number >= 0), `status` (`'Active' | 'On Hold' | 'Inactive'`), `createdAt`.
- **Optional Fields:** `phone`, `gstin`, `paymentTermsDays`, `address`, `updatedAt`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `sales`, `dispatch`, `finance`
  - `create`, `update`: `super_admin`, `sales`, `finance`
  - `delete`: `super_admin`

### Collection 4: `/products/{productId}` (`Product`)
- **Purpose:** Master catalog of forged flanges, rolled rings, shafts, and gear blanks.
- **Document ID Strategy:** Deterministic product code (e.g., `PROD-001`).
- **Sensitivity Classification:** `Public Internal (Active Employees)`
- **Required Fields:** `id`, `name`, `category`, `steelGrade`, `standardWeightKg` (> 0), `unitPrice` (>= 0), `status` (`'Active' | 'Discontinued'`), `createdAt`.
- **Optional Fields:** `drawingNo`, `heatTreatmentReq`, `updatedAt`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: All 8 active roles
  - `create`, `update`: `super_admin`, `sales`, `quality`
  - `delete`: `super_admin`

### Collection 5: `/salesOrders/{orderId}` (`OrderJourney`)
- **Purpose:** End-to-end Sales Order lifecycle tracking across 10 manufacturing stages.
- **Document ID Strategy:** Sales Order number (e.g., `MF-2026-101`).
- **Sensitivity Classification:** `Role-Restricted Operational`
- **Required Fields:** `orderId`, `customerName`, `productName`, `steelGrade`, `quantityMT` (> 0), `totalValueINR` (>= 0), `orderDate`, `committedDeliveryDate`, `currentStage`, `overallStatus`, `createdAt`, `updatedAt`.
- **Optional Fields:** `customerId`, `productId`, `delayDays`, `delayReason`, `heatNo`, `mtcStatus`, `dispatchStatus`, `invoiceNo`, `paymentStatus`, `stages`, `createdBy`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: All 8 active roles (required for order traceability across plant departments)
  - `create`: `super_admin`, `sales`
  - `update` (Action-partitioned by role):
    - `super_admin`, `sales`: Full commercial & order lifecycle update (`createdAt` and `orderId` immutable)
    - `stores`: Stage & raw material/forging/heat-treatment progression only (`affectedKeys().hasOnly(['currentStage', 'overallStatus', 'delayDays', 'delayReason', 'heatNo', 'stages', 'updatedAt'])`)
    - `quality`: Quality inspection & MTC certification updates only (`affectedKeys().hasOnly(['currentStage', 'overallStatus', 'mtcStatus', 'stages', 'updatedAt'])`)
    - `dispatch`: Dispatch & delivery stage updates only (`affectedKeys().hasOnly(['currentStage', 'overallStatus', 'dispatchStatus', 'stages', 'updatedAt'])`)
    - `finance`: Invoicing & payment status updates only (`affectedKeys().hasOnly(['currentStage', 'overallStatus', 'invoiceNo', 'paymentStatus', 'stages', 'updatedAt'])`)
  - `delete`: `super_admin`

### Collection 6: `/dispatches/{dispatchId}` (`DispatchConsignmentRecord`)
- **Purpose:** Outbound dispatch consignments, transporter vehicles, LR/challan numbers, and delivery status.
- **Document ID Strategy:** Dispatch ID (e.g., `DSP-2026-001`).
- **Sensitivity Classification:** `Role-Restricted Operational`
- **Required Fields:** `id`, `orderId`, `customerName`, `quantityTons` (> 0), `dispatchDate`, `status` (`'Scheduled' | 'Loading' | 'In Transit' | 'Delivered' | 'Delayed'`), `createdAt`, `updatedAt`.
- **Optional Fields:** `productName`, `transporterName`, `vehicleNo`, `lrNo`, `invoiceNo`, `destination`, `createdBy`, `dataOrigin`.
- **Relationships:** References `/salesOrders/{orderId}`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `sales`, `dispatch`, `finance`, `stores`
  - `create`, `update`: `super_admin`, `dispatch`
  - `delete`: `super_admin`

### Collection 7: `/rawMaterials/{materialId}` (`RawMaterialStock`)
- **Purpose:** Steel grade billet/ingot inventory balances, yard locations, and reorder thresholds.
- **Document ID Strategy:** Grade ID (e.g., `RM-A105`, `RM-F316L`).
- **Sensitivity Classification:** `Role-Restricted Operational`
- **Required Fields:** `gradeId`, `steelGrade`, `availableMT` (>= 0), `reorderLevelMT` (>= 0), `status` (`'Healthy' | 'Low Stock' | 'Critical'`), `lastUpdated`.
- **Optional Fields:** `category`, `allocatedMT`, `unitCostPerMT`, `supplierName`, `heatBatchNo`, `locationYard`, `updatedBy`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `stores`, `purchase`, `quality`, `sales`, `finance`
  - `create`, `update`: `super_admin`, `stores`
  - `delete`: `super_admin`

### Collection 8: `/stockMovements/{movementId}` (`StockMovement`)
- **Purpose:** Immutable raw material stock movement ledger (`INWARD`, `ISSUE`, `RETURN`, `ADJUSTMENT`).
- **Document ID Strategy:** Movement ledger ID (e.g., `MOV-2026-0001`).
- **Sensitivity Classification:** `Immutable Operational Ledger`
- **Required Fields:** `id`, `gradeId`, `steelGrade`, `type` (`'INWARD' | 'ISSUE' | 'RETURN' | 'ADJUSTMENT'`), `quantityTons` (> 0), `performedBy`, `timestamp`.
- **Optional Fields:** `heatNumber`, `referenceDocument`, `orderId`, `performedByUid`, `remarks`, `balanceAfterMT`, `dataOrigin`.
- **Relationships:** References `/rawMaterials/{gradeId}`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `stores`, `purchase`, `finance`, `quality`
  - `create`: `super_admin`, `stores`
  - `update`: `false` (strictly immutable after creation)
  - `delete`: `super_admin`

### Collection 9: `/qualityInspections/{inspectionId}` (`QualityInspectionRecord`)
- **Purpose:** Metallurgical, NDT (UT/MPI/LPI), hardness, and MTC quality inspection records.
- **Document ID Strategy:** Inspection ID (e.g., `QI-2026-001`).
- **Sensitivity Classification:** `Role-Restricted Operational`
- **Required Fields:** `id`, `batchId`, `orderId`, `inspectedQtyMT` (> 0), `acceptedQtyMT` (>= 0), `rejectedQtyMT` (>= 0), `status` (`'Approved' | 'Rejected' | 'Hold' | 'Rework'`), `inspectionDate`, `createdAt`.
- **Optional Fields:** `productName`, `steelGrade`, `heatNo`, `reworkQtyMT`, `rejectionReason`, `ndtStatus`, `hardnessHBW`, `mtcNumber`, `inspectorName`, `updatedAt`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `quality`, `stores`, `sales`, `dispatch`
  - `create`, `update`: `super_admin`, `quality`
  - `delete`: `super_admin`

### Collection 10: `/outstandingPayments/{paymentId}` (`OutstandingAgeingRecord`)
- **Purpose:** Sensitive customer invoice receivables and overdue ageing buckets (`0-30`, `31-60`, `61-90`, `90+ Days`).
- **Document ID Strategy:** Invoice ID (e.g., `INV-2026-001`).
- **Sensitivity Classification:** `Confidential Financial`
- **Required Fields:** `invoiceId`, `customerName`, `invoiceDate`, `dueDate`, `invoiceAmountINR` (>= 0), `receivedAmountINR` (>= 0), `balanceAmountINR` (>= 0), `ageingBucket`, `status`, `updatedAt`.
- **Optional Fields:** `orderId`, `customerId`, `daysOverdue`, `lastFollowUpDate`, `remarks`, `updatedBy`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `finance` ONLY (strictly denied to `sales`, `stores`, `purchase`, `quality`, `dispatch`)
  - `create`, `update`: `super_admin`, `finance` ONLY
  - `delete`: `super_admin`

### Collection 11: `/actionQueue/{actionId}` (`ActionQueueItem`)
- **Purpose:** Plant-wide exception alert and acknowledgement queue.
- **Document ID Strategy:** Alert ID (e.g., `ACT-2026-001`).
- **Sensitivity Classification:** `Public Internal (Active Employees)`
- **Required Fields:** `id`, `category`, `severity` (`'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'`), `title`, `status` (`'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'`), `createdAt`, `updatedAt`.
- **Optional Fields:** `description`, `entityRef`, `assignedRole`, `acknowledgedBy`, `acknowledgedAt`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: All 8 active roles
  - `create`: All 8 active roles (system alerts generated from operational events)
  - `update`: `super_admin`, `ceo`, or any active operational role updating acknowledgement status (`affectedKeys().hasOnly(['status', 'acknowledgedBy', 'acknowledgedAt', 'updatedAt'])`)
  - `delete`: `super_admin`

### Collection 12: `/auditLogs/{logId}` (`AuditLogEntry`)
- **Purpose:** Immutable append-only compliance and security audit trail.
- **Document ID Strategy:** Audit log ID (e.g., `AUD-2026-0001`).
- **Sensitivity Classification:** `Audit-Only (Append-Only Immutable)`
- **Required Fields:** `id`, `timestamp`, `actorUid` (must match `request.auth.uid`), `actorRole`, `action`, `module`, `details`.
- **Optional Fields:** `actorEmail`, `actorName`, `entityId`, `severity`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo` ONLY
  - `create`: All 8 active roles, strictly requiring `incoming().actorUid == request.auth.uid`
  - `update`: `false` (strictly forbidden for all users including `super_admin`)
  - `delete`: `false` (strictly forbidden for all users including `super_admin`)

### Collection 13: `/quotations/{quotationId}` (`QuotationRecord` — Register #1)
- **Purpose:** Commercial RFQ and customer quotation register.
- **Document ID Strategy:** Quotation ID (e.g., `QTN-2026-001`).
- **Sensitivity Classification:** `Role-Restricted Commercial`
- **Required Fields:** `id`, `quoteNo`, `customerName`, `productName`, `steelGrade`, `quantityMT` (> 0), `totalValueINR` (>= 0), `status` (`'Draft' | 'Sent' | 'Under Negotiation' | 'Won' | 'Lost' | 'Expired'`), `createdAt`, `updatedAt`.
- **Optional Fields:** `quotedRatePerKg`, `validUntil`, `preparedBy`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `sales`, `finance`
  - `create`, `update`: `super_admin`, `sales`
  - `delete`: `super_admin`

### Collection 14: `/tenders/{tenderId}` (`TenderRecord` — Register #2)
- **Purpose:** PSU, railway, defense, and EPC contract tender bid register.
- **Document ID Strategy:** Tender ID (e.g., `TND-2026-001`).
- **Sensitivity Classification:** `Role-Restricted Commercial`
- **Required Fields:** `id`, `tenderNo`, `issuingAuthority`, `projectTitle`, `estimatedValueINR` (>= 0), `submissionDeadline`, `technicalBidStatus` (`'Preparing' | 'Submitted' | 'Qualified' | 'Disqualified' | 'Awarded' | 'Lost'`), `createdAt`, `updatedAt`.
- **Optional Fields:** `emdAmountINR`, `ownerName`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `sales`, `finance`
  - `create`, `update`: `super_admin`, `sales`
  - `delete`: `super_admin`

### Collection 15: `/suppliers/{supplierId}` (`SteelMillSupplier`)
- **Purpose:** Approved steel mill vendor master and delivery/quality rating registry.
- **Document ID Strategy:** Supplier ID (e.g., `SUP-001`).
- **Sensitivity Classification:** `Role-Restricted Procurement`
- **Required Fields:** `id`, `name`, `leadTimeDays` (>= 0), `approvalStatus` (`'Approved' | 'Probation' | 'Suspended'`), `createdAt`, `updatedAt`.
- **Optional Fields:** `location`, `primaryGrades`, `qualityRating`, `onTimeDeliveryPct`, `contactEmail`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `purchase`, `stores`, `quality`, `finance`
  - `create`, `update`: `super_admin`, `purchase`
  - `delete`: `super_admin`

### Collection 16: `/purchaseOrders/{poId}` (`PurchaseOrderRecord` — Register #3)
- **Purpose:** Steel mill billet/ingot procurement Purchase Order register.
- **Document ID Strategy:** PO ID (e.g., `PO-2026-001`).
- **Sensitivity Classification:** `Role-Restricted Procurement`
- **Required Fields:** `id`, `poNumber`, `supplierName`, `steelGrade`, `orderedMT` (> 0), `ratePerMT` (>= 0), `totalAmountINR` (>= 0), `expectedDeliveryDate`, `status` (`'Draft' | 'Issued' | 'In Transit' | 'Partially Received' | 'Received' | 'Cancelled'`), `createdAt`, `updatedAt`.
- **Optional Fields:** `supplierId`, `receivedMT`, `orderDate`, `createdBy`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `purchase`, `stores`, `finance`
  - `create`, `update`: `super_admin`, `purchase` (plus `stores` allowed only to update `['receivedMT', 'status', 'updatedAt']` on GRN receipt)
  - `delete`: `super_admin`

### Collection 17: `/machineLogs/{logId}` (`ShopMachineLog` — Register #4)
- **Purpose:** Shop floor hydraulic press, ring rolling mill, hammer, and CNC machine shift utilization log.
- **Document ID Strategy:** Machine log ID (e.g., `MLG-2026-001`).
- **Sensitivity Classification:** `Role-Restricted Shop Floor`
- **Required Fields:** `id`, `machineId`, `machineName`, `shift` (`'Shift A' | 'Shift B' | 'Shift C'`), `operationType`, `outputTons` (>= 0), `status` (`'Running' | 'Setup' | 'Idle' | 'Breakdown' | 'Maintenance'`), `loggedAt`, `updatedAt`.
- **Optional Fields:** `operatorName`, `orderId`, `utilizationPct`, `downtimeMinutes`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `stores`, `quality`, `sales`
  - `create`, `update`: `super_admin`, `stores`
  - `delete`: `super_admin`

### Collection 18: `/furnaceLogs/{logId}` (`FurnaceBatchLog` — Register #5)
- **Purpose:** Reheating and heat treatment furnace batch thermal cycle log.
- **Document ID Strategy:** Furnace batch log ID (e.g., `FLG-2026-001`).
- **Sensitivity Classification:** `Role-Restricted Shop Floor`
- **Required Fields:** `id`, `furnaceId`, `batchNo`, `cycleType`, `targetTempC` (> 0), `chargeWeightMT` (> 0), `status` (`'Charging' | 'Heating' | 'Soaking' | 'Cooling' | 'Completed' | 'Aborted'`), `startedAt`, `updatedAt`.
- **Optional Fields:** `orderId`, `steelGrade`, `soakTimeHours`, `fuelConsumedSCM`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `stores`, `quality`
  - `create`, `update`: `super_admin`, `stores`, `quality`
  - `delete`: `super_admin`

### Collection 19: `/maintenanceTickets/{ticketId}` (`MachineMaintenanceTicket` — Register #6)
- **Purpose:** Preventive and breakdown plant equipment maintenance ticket register.
- **Document ID Strategy:** Ticket ID (e.g., `MNT-2026-001`).
- **Sensitivity Classification:** `Role-Restricted Shop Floor`
- **Required Fields:** `id`, `ticketNo`, `machineId`, `machineName`, `maintenanceType`, `priority` (`'Critical' | 'High' | 'Medium' | 'Low'`), `issueDescription`, `status` (`'Open' | 'In Progress' | 'Awaiting Spares' | 'Resolved' | 'Closed'`), `reportedAt`, `updatedAt`.
- **Optional Fields:** `assignedTechnician`, `estimatedDowntimeHours`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `stores`, `quality`
  - `create`, `update`: `super_admin`, `stores`
  - `delete`: `super_admin`

### Collection 20: `/powerLogs/{logId}` (`PowerConsumptionLog` — Register #7)
- **Purpose:** Plant electrical kWh, PNG gas SCM, and energy intensity per forged MT log.
- **Document ID Strategy:** Power log ID (e.g., `PWR-2026-001`).
- **Sensitivity Classification:** `Role-Restricted Shop Floor / Costing`
- **Required Fields:** `id`, `logDate`, `shift`, `electricityKwh` (>= 0), `productionOutputMT` (>= 0), `kwhPerMT` (>= 0), `createdAt`, `updatedAt`.
- **Optional Fields:** `pngGasSCM`, `powerFactor`, `peakDemandKva`, `loggedBy`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `stores`, `finance`
  - `create`, `update`: `super_admin`, `stores`
  - `delete`: `super_admin`

### Collection 21: `/dimensionalReports/{reportId}` (`DimensionalInspectionReport` — Register #8)
- **Purpose:** CMM and dimensional tolerance inspection report (OD, ID, height, deviation).
- **Document ID Strategy:** Report ID (e.g., `DIM-2026-001`).
- **Sensitivity Classification:** `Role-Restricted Quality`
- **Required Fields:** `id`, `reportNo`, `orderId`, `outerDiaNominalMm` (> 0), `outerDiaObservedMm` (> 0), `toleranceResult` (`'Within Tolerance' | 'Minor Deviation' | 'Out of Tolerance'`), `inspectedAt`, `updatedAt`.
- **Optional Fields:** `batchId`, `drawingNo`, `innerDiaNominalMm`, `innerDiaObservedMm`, `heightNominalMm`, `heightObservedMm`, `deviationMm`, `inspectorName`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `quality`, `sales`, `stores`, `dispatch`
  - `create`, `update`: `super_admin`, `quality`
  - `delete`: `super_admin`

### Collection 22: `/jobCostSheets/{costSheetId}` (`JobCostSheet`)
- **Purpose:** Sensitive order-level manufacturing cost breakdown and gross margin analysis sheet.
- **Document ID Strategy:** Cost sheet ID (e.g., `JCS-2026-001`).
- **Sensitivity Classification:** `Confidential Financial`
- **Required Fields:** `id`, `orderId`, `customerName`, `rawMaterialCostINR` (>= 0), `forgingConversionCostINR` (>= 0), `totalActualCostINR` (>= 0), `salesRealizationINR` (>= 0), `grossMarginPct` (number), `costStatus` (`'Draft' | 'Provisional' | 'Finalized'`), `updatedAt`.
- **Optional Fields:** `productName`, `heatTreatmentCostINR`, `machiningCostINR`, `testingAndMtcCostINR`, `grossMarginINR`, `updatedBy`, `dataOrigin`.
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `finance` ONLY (strictly denied to `sales`, `stores`, `purchase`, `quality`, `dispatch`)
  - `create`, `update`: `super_admin`, `finance` ONLY (plus terminal state lock: once `existing().costStatus == 'Finalized'`, only `super_admin` can modify)
  - `delete`: `super_admin`

### Collection 23: `/tasks/{taskId}` (`TaskRecord`)
- **Purpose:** Central Task, Duty & Supervisor Verification Engine with Maker≠Checker enforcement.
- **Document ID Strategy:** Task ID (e.g., `TSK-2026-001`).
- **Permitted Roles & Operations:**
  - `get`, `list`: All 8 active roles
  - `create`: All 8 active roles
  - `update`: Active roles; transitioning to `'Verified & Approved'` requires `super_admin`, `ceo`, or a Department Head (`isDepartmentHead == true` and `assignedToUid != request.auth.uid`)
  - `delete`: `super_admin`, `ceo`

### Collection 24: `/handovers/{handoverId}` (`HandoverRecord`)
- **Purpose:** Inter-department `H-1` to `H-5` dual-custody stage handover ledger.
- **Document ID Strategy:** Handover ID (e.g., `HND-2026-001`).
- **Permitted Roles & Operations:**
  - `get`, `list`: All 8 active roles
  - `create`: All 8 active roles
  - `update`: Receiving role (`hasRole(existing().toRole)` and `fromUid != request.auth.uid`), `super_admin`, or `ceo`
  - `delete`: `super_admin`, `ceo`

### Collection 25: `/purchaseRequisitions/{requisitionId}` (`PurchaseRequisitionRecord`)
- **Purpose:** Raw material Purchase Requisition (PR) to Maker≠Checker Approval to Mill PO workflow.
- **Document ID Strategy:** Requisition ID (e.g., `PR-2026-001`).
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `purchase`, `stores`, `sales`, `finance`
  - `create`: `super_admin`, `ceo`, `purchase`, `stores`
  - `update`: `super_admin`, `ceo`, `purchase` (`requestedByUid != request.auth.uid` for approval), `stores` (draft/pending updates)
  - `delete`: `super_admin`, `ceo`

### Collection 26: `/ncrCapaRecords/{ncrId}` (`NcrCapaRecord`)
- **Purpose:** Non-Conformance Report (NCR), Root Cause Analysis, and CAPA verification register.
- **Document ID Strategy:** NCR ID (e.g., `NCR-2026-001`).
- **Permitted Roles & Operations:**
  - `get`, `list`: All 8 active roles
  - `create`, `update`: `super_admin`, `ceo`, `quality`, `stores`
  - `delete`: `super_admin`, `ceo`

### Collection 27: `/paymentFollowUps/{followUpId}` (`PaymentFollowUpRecord`)
- **Purpose:** Customer invoice collection follow-up, promised payment dates, and receivables escalation log.
- **Document ID Strategy:** Follow-up ID (e.g., `PFU-2026-001`).
- **Permitted Roles & Operations:**
  - `get`, `list`: `super_admin`, `ceo`, `finance`, `sales`
  - `create`, `update`: `super_admin`, `ceo`, `finance`, `sales`
  - `delete`: `super_admin`, `ceo`

---

## 3. Phase 0: The "Dirty Dozen" Adversarial Payloads

All 12 adversarial payloads below are codified and executed in `/scripts/verify-firestore-rules.ts` and `/tests/firestore.rules.test.ts`, and **must** return `PERMISSION_DENIED`:

1. **Payload #1 — Self-Promotion on User Profile Creation (`Identity Escalation`):**
   - Authenticated visitor (`uid: "attacker_01"`) attempts `create` on `/users/attacker_01` with `{ role: "super_admin", accountStatus: "active" }`.
2. **Payload #2 — Self-Promotion on Own User Profile Update (`Privilege Escalation`):**
   - Active `sales` user (`uid: "emp_sales"`) attempts `update` on `/users/emp_sales` changing `{ role: "super_admin", updatedAt: "2026-04-01T00:00:00Z" }`.
3. **Payload #3 — Unverified Bootstrap Admin Email Spoofing (`Email Spoofing`):**
   - Attacker with `email: "anshyadav6647@gmail.com"` and `email_verified: false` attempts `create` on `/users/spoof_admin` or `update` on `/systemConfig/alertThresholds`.
4. **Payload #4 — Deactivated Employee Token Reuse (`Revoked Membership Bypass`):**
   - Authenticated user (`uid: "emp_suspended"`) whose `/users/emp_suspended` profile has `accountStatus: "suspended"` attempts `get` on `/salesOrders/MF-2026-101`.
5. **Payload #5 — Intra-Production Cross-Role Write (`Stores -> Purchase Orders`):**
   - Active `stores` user (`uid: "emp_stores"`) attempts `create` on `/purchaseOrders/PO-2026-999` (must be restricted to `purchase` and `super_admin`).
6. **Payload #6 — Intra-Production Cross-Role Write (`Purchase -> Raw Material Stock Balance`):**
   - Active `purchase` user (`uid: "emp_purchase"`) attempts `update` on `/rawMaterials/RM-A105` to alter `availableMT` (must be restricted to `stores` and `super_admin`).
7. **Payload #7 — Intra-Production Cross-Role Write (`Dispatch -> Quality Inspection`):**
   - Active `dispatch` user (`uid: "emp_dispatch"`) attempts `create` on `/qualityInspections/QI-2026-999` to forge an MTC approval.
8. **Payload #8 — Unauthorized Financial Data Scrape (`Sales/Stores -> Job Cost Sheets & Receivables`):**
   - Active `sales` or `stores` user attempts `get` or `list` on `/jobCostSheets` or `/outstandingPayments`.
9. **Payload #9 — Audit Log Tampering / Deletion (`Immutable Ledger Attack`):**
   - Active `super_admin` user attempts `update` or `delete` on `/auditLogs/AUD-2026-0001`, or `sales` user attempts `create` on `/auditLogs/AUD-2026-0002` with `actorUid: "someone_else"`.
10. **Payload #10 — Stock Movement History Rewriting (`Ledger Mutation Attack`):**
    - Active `stores` user attempts `update` on `/stockMovements/MOV-2026-0001` to change `quantityTons` after creation.
11. **Payload #11 — Shadow / Ghost Field Injection (`Anti-Update-Gap Attack`):**
    - Active `sales` user attempts `create` on `/quotations/QTN-2026-001` with all required fields plus an undeclared ghost field `{ isApprovedByCeo: true }`.
12. **Payload #12 — Path ID Poisoning & Negative Quantity Injection (`Value Poisoning`):**
    - Active `stores` user attempts `create` on `/rawMaterials/bad$id/with/slashes` or `/rawMaterials/RM-A105` with `{ availableMT: -500 }` or invalid enum `{ status: "Hacked" }`.

---

## 4. Red Team Conflict & Vulnerability Report

| Check Category | Target Collections | Attack Vector Tested | Security Rule Defense | Result |
| :--- | :--- | :--- | :--- | :--- |
| **Shadow Update Test** | All 22 collections | Injecting undeclared field `ghostField: true` on `create`/`update` | Blocked by `data.keys().hasOnly(...)` inside every `isValid[Entity]()` helper and `affectedKeys().hasOnly(...)` on updates | **PASS (Blocked)** |
| **Email Spoofing Test** | `/users`, `/systemConfig`, all admin paths | Token with `email == 'anshyadav6647@gmail.com'` and `email_verified == false` | `isBootstrapSuperAdmin()` explicitly enforces `request.auth.token.email_verified == true` | **PASS (Blocked)** |
| **PII Blanket Read Test** | `/users/{userId}` | Non-owner `sales`/`stores` user attempting `get` on another employee's `/users/{otherUid}` | `allow get: if isValidId(userId) && (isOwner(userId) || isSuperAdmin() || isCeo());` | **PASS (Blocked)** |
| **Cross-Department Isolation** | `Production` roles (`stores`, `purchase`, `quality`, `dispatch`) | `stores` writing POs; `purchase` writing stock; `dispatch` writing QC | Rules evaluate granular `hasRole('stores')`, `hasRole('purchase')`, `hasRole('quality')`, `hasRole('dispatch')` on `/users/$(request.auth.uid)` | **PASS (Blocked)** |
| **Financial Confidentiality** | `/outstandingPayments`, `/jobCostSheets` | Non-finance operational roles querying receivables or cost sheets | `allow get, list: if isFinanceReadAllowed();` (`super_admin`, `ceo`, `finance` only) | **PASS (Blocked)** |
| **Immutable Audit & Stock Ledger** | `/auditLogs`, `/stockMovements` | Updating or deleting existing audit logs or modifying stock movements | `/auditLogs` sets `allow update, delete: if false;`; `/stockMovements` sets `allow update: if false;` | **PASS (Blocked)** |
| **Value & Enum Poisoning** | All 22 collections | Updating whitelisted field with wrong type, negative number, or invalid status | Every `allow update` wraps all branches in `isValid[Entity](incoming())` | **PASS (Blocked)** |

---

## 5. Required Firebase Console Setup & Local Emulator Verification

### A. Firebase Console Steps (Before Phase 4 Live Cutover)
1. **Verify Named Firestore Database:**
   - Open Firebase Console -> Project `montex-mis` -> **Firestore Database**.
   - Confirm that the named database `ai-studio-montexmis-80037e3b-fbab-4539-8464-b375213a9416` exists in Standard/Enterprise mode (or create it if not yet provisioned).
2. **Enable Email/Password Sign-In Provider (for Phase 3 Employee Auth):**
   - Open Firebase Console -> **Authentication** -> **Sign-in method**.
   - Ensure **Email/Password** and **Google** providers are enabled.
3. **Deploy Firestore Security Rules (When Ready):**
   - Deploy `/firestore.rules` to database `ai-studio-montexmis-80037e3b-fbab-4539-8464-b375213a9416` via Firebase CLI:
     ```bash
     firebase deploy --only firestore:rules --project montex-mis
     ```

### B. Running Security Verification Tests Locally
1. **Deterministic Offline Rule Evaluator & Blueprint Verifier (No Java/Emulator Required):**
   ```bash
   npx tsx scripts/verify-firestore-rules.ts
   ```
2. **Firebase Local Emulator Suite (Optional — When Java 17+ & `firebase-tools` Are Installed Locally):**
   ```bash
   npx firebase emulators:exec --only firestore "npx tsx tests/firestore.rules.test.ts"
   ```
