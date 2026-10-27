/**
 * Montex Forge MIS — Consolidated Business Data Models (Phase 1)
 *
 * Centralizes TypeScript interfaces for all 22 operational, financial, and administrative
 * record types used across the application while maintaining 100% backward compatibility
 * with the existing Firebase Realtime Database (`rtdbService.ts`) and React UI components.
 *
 * Date Format Conventions Observed in Current Codebase:
 * - Calendar Date (`DateString`): `'YYYY-MM-DD'` (e.g., `'2026-10-22'`) or `'-'` when pending.
 * - Timestamp (`IsoTimestampString`): ISO-8601 `'YYYY-MM-DDTHH:mm:ss.sssZ'` or `'YYYY-MM-DD HH:mm(:ss)'`.
 */

import {
  UserRole,
  RbacRoleGroup,
  LegacyRtdbRoleValue,
  AccountStatus,
  MisModuleId,
  PermissionAction,
  UserPermission,
  CANONICAL_USER_ROLES,
  DESCRIPTIVE_RBAC_GROUPS,
  USER_ROLE_TO_RBAC_GROUP,
  USER_ROLE_METADATA,
  LEGACY_GROUP_DEFAULT_ROLE_MAP,
  ROLE_PERMISSION_DEFAULTS,
  isCanonicalUserRole,
  isDescriptiveRbacGroup,
  isAccountStatusActive,
  getOrganizationalGroupForRole,
  resolveGranularRoleFromGroupOrLegacy,
  hasGranularRolePermission,
} from './roles';

export type {
  UserRole,
  RbacRoleGroup,
  LegacyRtdbRoleValue,
  AccountStatus,
  MisModuleId,
  PermissionAction,
  UserPermission,
};

export {
  CANONICAL_USER_ROLES,
  DESCRIPTIVE_RBAC_GROUPS,
  USER_ROLE_TO_RBAC_GROUP,
  USER_ROLE_METADATA,
  LEGACY_GROUP_DEFAULT_ROLE_MAP,
  ROLE_PERMISSION_DEFAULTS,
  isCanonicalUserRole,
  isDescriptiveRbacGroup,
  isAccountStatusActive,
  getOrganizationalGroupForRole,
  resolveGranularRoleFromGroupOrLegacy,
  hasGranularRolePermission,
};

/**
 * Distinguishes live company records from offline/demo sandbox fixtures.
 */
export type DataRecordOrigin = 'production' | 'demo_sandbox' | 'bootstrap_seed';

export interface ApprovalHistoryEntry {
  action?: 'requested' | 'approved' | 'rejected' | 'reconsidered' | 'deactivated' | 'reactivated';
  statusAfter?: AccountStatus;
  status?: AccountStatus;
  roleAssigned?: UserRole;
  departmentAssigned?: string;
  actorUid: string;
  actorEmail: string;
  actorName?: string;
  reason?: string;
  notes?: string;
  timestamp: string;
}

/**
 * Employee User Profile stored at `/users/{uid}`.
 * - Primary Key (`id` / `uid`): Must match Firebase Auth `uid`.
 * - `role`: Canonical `UserRole` (`super_admin`, `ceo`, `sales`, `stores`, `purchase`, `quality`, `dispatch`, `finance`).
 */
export interface UserProfile {
  id: string; // Firebase Auth UID
  uid?: string; // Mirror of Firebase Auth UID for Firestore rules
  name: string;
  displayName?: string; // Mirror of employee full name for Firestore rules
  email: string;
  role: UserRole;
  requestedRole?: UserRole;
  requestedDepartment?: string;
  rbacGroup?: RbacRoleGroup;
  legacyRole?: UserRole;
  roleTitle: string;
  designation?: string;
  department: string;
  avatarInitials: string;
  status?: 'Active' | 'Inactive' | 'Pending' | 'Rejected';
  accountStatus: AccountStatus;
  mustChangePassword?: boolean;
  invitedBy?: string;
  provisionedBy?: string;
  provisionedAt?: string;
  approvedByUid?: string | null;
  approvedByEmail?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  rejectedByUid?: string | null;
  rejectedByEmail?: string | null;
  rejectedByName?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  approvalHistory?: ApprovalHistoryEntry[];
  createdAt: string; // ISO-8601 or YYYY-MM-DD
  updatedAt?: string; // ISO-8601 timestamp
  lastLoginAt?: string; // ISO-8601 or YYYY-MM-DD HH:mm
  lastLogin?: string;
  disabledAt?: string | null; // ISO-8601 or YYYY-MM-DD when deactivated
  deactivatedBy?: string | null;
  deactivationReason?: string | null;
  isDepartmentHead?: boolean;
  managedDepartment?: string;
  reportingManagerUid?: string;
  permissions?: UserPermission[] | Record<string, any>;
  dataOrigin?: DataRecordOrigin;
}


/**
 * 13-state Sales Order & Internal Job lifecycle progression.
 */
export type OrderStatus =
  | 'po_registered'
  | 'job_assigned'
  | 'material_pending'
  | 'material_allocated'
  | 'in_production'
  | 'quality_pending'
  | 'quality_cleared'
  | 'clearance_pending'
  | 'clearance_approved'
  | 'ready_for_dispatch'
  | 'partially_dispatched'
  | 'completed'
  | 'on_hold';

/**
 * Customer Master record stored at `/customers/$customerId`.
 * - Identifier format: `CUST-NNN` (e.g., `'CUST-001'`).
 * - Referenced by: `OrderJourney.customerId`, `QuotationRecord.customerId`, `OutstandingAgeingRecord.customerId`.
 */
export interface Customer {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  location: string;
  industry: string;
  creditLimit: number; // Non-negative INR
  creditDays: number;
  assignedSalesPerson: string;
  active: boolean;
  totalOrders: number;
  totalOutstanding: number; // Non-negative INR
  dataOrigin?: DataRecordOrigin;
}

export type ForgedProductCategory =
  | 'Flange'
  | 'Forged Ring'
  | 'Shaft'
  | 'Custom Forging'
  | 'Blind Flange';

export type ProductUom = 'PCS' | 'MT' | 'KG';

/**
 * Forged Product Master specification stored at `/products/$productId`.
 * - Identifier format: `PROD-NNN` (e.g., `'PROD-001'`).
 * - Referenced by: `OrderLineItem.productId`, `QuotationRecord.productId`.
 */
export interface Product {
  id: string;
  code: string;
  name: string;
  category: ForgedProductCategory;
  size: string;
  materialGrade: string;
  standard: string;
  uom: ProductUom;
  standardWeightKg: number; // Must be > 0
  hsnCode: string;
  standardSellingPrice: number; // Non-negative INR
  dataOrigin?: DataRecordOrigin;
}

/**
 * Line item attached to a `OrderJourney` (`salesOrders/$orderId/lineItems`).
 * Quantity invariants enforced by `validateSalesOrderQuantities`:
 * - `totalAmount === orderedQty * ratePerUnit`
 * - `inspectedOkQty + rejectedQty <= producedQty`
 * - `dispatchedQty <= inspectedOkQty` and `dispatchedQty <= orderedQty`
 * - `pendingQty === orderedQty - dispatchedQty`
 */
export interface OrderLineItem {
  id: string;
  salesOrderId: string; // Foreign key -> OrderJourney.id
  productId: string; // Foreign key -> Product.id
  productCode: string;
  productName: string;
  materialGrade: string;
  size: string;
  orderedQty: number;
  ratePerUnit: number;
  totalAmount: number;
  producedQty: number;
  inspectedOkQty: number;
  rejectedQty: number;
  dispatchedQty: number;
  pendingQty: number;
  uom: string;
}

/**
 * Sales Order & End-to-End Job Lifecycle record stored at `/salesOrders/$orderId`.
 * - Order ID format: `ORD-YYYY-NNN` (e.g., `'ORD-2026-001'`).
 * - Internal Job Number format: `JOB-MF-YYYY-NNNN` (e.g., `'JOB-MF-2026-0412'`).
 * - Links Customer PO -> Raw Material Allocation -> Production -> Quality/MTC -> TPI Clearance -> Dispatch -> Tax Invoice.
 */
export interface OrderJourney {
  id: string;
  poNumber: string;
  poDate: string; // YYYY-MM-DD
  customerName: string;
  customerId: string; // Foreign key -> Customer.id
  jobNumber: string; // Internal shop-floor tracking key
  status: OrderStatus;
  statusLabel: string;
  totalValue: number; // Non-negative INR, equals sum of lineItems.totalAmount
  currency: string;
  expectedDeliveryDate: string; // YYYY-MM-DD contractual delivery date
  targetDeliveryDate: string; // YYYY-MM-DD internal plant target date
  lineItems: OrderLineItem[];

  materialStatus: {
    state: 'shortage' | 'allocated' | 'verified';
    materialGrade: string;
    heatNumber: string;
    supplierName: string;
    requiredKg: number;
    allocatedKg: number;
    lastUpdated: string;
    notes?: string;
  };

  qualityStatus: {
    state: 'pending' | 'in_progress' | 'cleared' | 'rejected';
    testTypes: string[];
    inspectorName: string;
    inspectionDate: string;
    mtcNumber: string;
    mtcStatus: 'draft' | 'verified' | 'issued';
    mtcGenerated?: boolean;
    rejectionReason?: string;
  };

  clearanceStatus: {
    state: 'not_required' | 'pending' | 'approved' | 'query_raised';
    agency: string;
    inspectorName: string;
    clearanceRefNo: string;
    clearanceDate: string;
    remarks: string;
  };

  dispatchStatus: {
    state: 'pending' | 'partial' | 'completed';
    totalShippedQty: number;
    balanceQty: number;
    transporterName: string;
    vehicleNo: string;
    lrNumber: string;
    dispatchDate: string;
    destinationCity: string;
  };

  invoiceStatus: {
    state: 'pending' | 'partial' | 'invoiced' | 'settled';
    invoiceNumber: string;
    invoiceDate: string;
    invoiceAmount: number;
    paidAmount: number;
    outstandingAmount: number;
    paymentDueDate: string;
    tallySyncStatus: 'synced' | 'pending_import' | 'mismatch';
  };
  totalOrderValue?: number;
  docChecklistCompleted?: boolean;
  fprUid?: string;
  fprName?: string;
  fprDepartment?: string;
  handoverStage?: HandoverStageCode;
  documentChecklistStatus?:
    | 'incomplete'
    | 'complete'
    | 'ready_for_dispatch'
    | 'submitted_to_customer'
    | 'acknowledged'
    | 'Incomplete'
    | 'Ready'
    | 'Verified';
  creditHoldOverrideBy?: string;
  /** Dispatch needs both clearances: UID of the Quality / Finance approver and when. */
  /** True when the viewer's role may not see order value (totalValue is then 0, not real). */
  commercialRestricted?: boolean;
  qualityClearedBy?: string | null;
  qualityClearedAt?: string | null;
  financeClearedBy?: string | null;
  financeClearedAt?: string | null;
  creditHoldOverrideReason?: string;
  dataOrigin?: DataRecordOrigin;
}

export type RawMaterialSectionShape = 'Round Billet' | 'Square Billet' | 'Ingot';
export type RawMaterialStockStatus = 'adequate' | 'warning' | 'critical';

/**
 * Raw Material Billet/Ingot Yard Inventory record stored at `/inventory/rawMaterials/$materialId`.
 * - Identifier format: `RM-NNN` (e.g., `'RM-001'`).
 * - Stock invariants:
 *   - `availableStockMt === Math.max(0, currentStockMt - reservedStockMt)`
 *   - `status === 'critical'` when `availableStockMt < minimumStockMt`
 *   - `status === 'warning'` when `minimumStockMt <= availableStockMt < reorderLevelMt`
 *   - `status === 'adequate'` when `availableStockMt >= reorderLevelMt`
 */
export interface RawMaterialStock {
  id: string;
  code: string;
  name: string;
  grade: string;
  sectionShape: RawMaterialSectionShape;
  dimensionsMm: string;
  currentStockMt: number;
  reservedStockMt: number;
  availableStockMt: number;
  minimumStockMt: number;
  reorderLevelMt: number;
  standardRatePerMt: number;
  supplier: string;
  locationBay: string;
  status: RawMaterialStockStatus;
  dataOrigin?: DataRecordOrigin;
}

export type StockMovementType =
  | 'Receipt (GRN)'
  | 'Production Issue'
  | 'Scrap Return'
  | 'Adjustment';

/**
 * Immutable Stock Movement Ledger entry stored at `/inventory/stockMovements/$movementId`.
 * - Identifier format: `MOV-YYYY-NNN` or `MOV-NNNNNN`.
 */
export interface StockMovement {
  id: string;
  timestamp: string; // YYYY-MM-DD HH:mm
  materialCode: string; // Foreign key -> RawMaterialStock.code
  materialGrade: string;
  movementType: StockMovementType;
  heatNumber: string;
  quantityMt: number; // Non-zero (+ for receipt/return, - for issue)
  balanceAfterMt: number; // Non-negative physical balance after movement
  referenceDoc: string; // Linked Job Number or GRN/PO number
  performedBy: string;
  dataOrigin?: DataRecordOrigin;
}

export type QualityInspectionStatus = 'pending' | 'in_progress' | 'cleared' | 'rejected' | string;

/**
 * Quality Inspection & EN 10204 3.1 MTC Lot record stored at `/quality/inspections/$inspectionId`.
 * - Identifier format: `QC-YYYY-NNNN` (e.g., `'QC-2026-0894'`).
 * - Quantity invariant: `passedQty + rejectedQty <= inspectedQty` (all >= 0).
 */
export interface QualityInspectionRecord {
  id: string;
  jobNumber: string; // Foreign key -> OrderJourney.jobNumber
  customer: string;
  product: string;
  grade: string;
  heatNo: string;
  inspectedQty: number;
  passedQty: number;
  rejectedQty: number;
  status: QualityInspectionStatus;
  inspector: string;
  date: string; // YYYY-MM-DD
  mtcNumber: string;
  dataOrigin?: DataRecordOrigin;
}

export type DispatchConsignmentStatus =
  | 'ready_for_dispatch'
  | 'dispatched'
  | 'partially_dispatched'
  | 'completed'
  | string;

/**
 * Outward Dispatch Consignment & Gate Pass record stored at `/dispatch/$dispatchId`.
 * - Identifier format: `DSP-YYYY-NNNN` (e.g., `'DSP-2026-0091'`).
 * - Links to `OrderJourney.poNumber` (`orderNo`) and `OrderJourney.jobNumber` (`jobNumber`).
 */
export interface DispatchConsignmentRecord {
  id: string;
  date: string; // YYYY-MM-DD
  orderNo: string; // Foreign key -> OrderJourney.poNumber
  jobNumber: string; // Foreign key -> OrderJourney.jobNumber
  salesOrderId?: string; // Firestore id of the sales order (rules check its clearances)
  customer: string;
  product: string;
  quantity: number; // Non-negative shipped PCS
  plannedLotQty?: number; // Optional staged lot quantity when status === 'ready_for_dispatch'
  balanceQty: number; // Non-negative remaining PO balance PCS
  weightMt: number; // Non-negative consignment weight in metric tons
  transporter: string;
  vehicleNo: string;
  lrNumber: string;
  destination: string;
  invoiceRef: string;
  clearanceRef: string;
  status: DispatchConsignmentStatus;
  dataOrigin?: DataRecordOrigin;
}

export type AlertActionType =
  | 'material_shortage'
  | 'qc_rejection'
  | 'quality_hold'
  | 'overdue_order'
  | 'clearance_pending'
  | 'payment_ageing';

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Priority Action Queue Alert item stored at `/alerts/actionQueue/$actionId`.
 * - Identifier format: `ACT-NNN` (e.g., `'ACT-001'`).
 */
export interface ActionQueueItem {
  id: string;
  type: AlertActionType;
  severity: AlertSeverity;
  title: string;
  description: string;
  associatedRef: string;
  customerOrSupplier: string;
  daysPending: number;
  suggestedAction: string;
  assignedToDepartment: string;
  acknowledged?: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  dataOrigin?: DataRecordOrigin;
}

/**
 * Customer Receivables Ageing record stored at `/outstandingPayments/$customerId`.
 * - Primary Key: `customerId` (matches `Customer.id`, e.g., `'CUST-001'`).
 * - Invariant: `totalOutstanding === bucket0to30 + bucket31to60 + bucket61to90 + bucket90Plus`.
 */
export interface OutstandingAgeingRecord {
  customerId: string;
  customerName: string;
  totalOutstanding: number;
  bucket0to30: number;
  bucket31to60: number;
  bucket61to90: number;
  bucket90Plus: number;
  creditLimit: number;
  creditExceeded: boolean;
  creditLimitExceeded?: boolean;
  oldestInvoiceDate: string; // YYYY-MM-DD
  dataOrigin?: DataRecordOrigin;
}

/**
 * Append-only Security & Operational Audit Log entry stored at `/auditLogs/{logId}`.
 * - Rule invariant: `actorUid === auth.uid` (or trusted Admin SDK write) and append-only (`!data.exists()`).
 */
export interface AuditLogEntry {
  id: string;
  timestamp: string; // ISO-8601 or YYYY-MM-DD HH:mm:ss
  userId: string; // Firebase Auth UID of actor
  actorUid?: string; // Mirror of userId for Firestore rules
  userName: string;
  actorName?: string;
  actorEmail?: string;
  actorRole?: UserRole;
  targetUid?: string; // Target employee UID for admin lifecycle events
  action: string;
  collectionName: string;
  module?: string; // Mirror of collectionName / module for Firestore rules
  documentId: string;
  entityId?: string;
  oldValueSummary?: string;
  newValueSummary: string;
  details?: string | Record<string, any>; // Mirror of newValueSummary or sanitized metadata for Firestore rules
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  outcome?: 'SUCCESS' | 'PARTIAL_FAILURE' | 'DENIED' | 'REJECTED';
  ipAddress?: string;
  dataOrigin?: DataRecordOrigin;
}


/**
 * Executive KPI Snapshot stored at `/dashboardKpis`.
 */
export interface RtdbDashboardKpis {
  todaysDispatchValue: number;
  todaysDispatchQty: number;
  openOrdersValue: number;
  openOrdersCount: number;
  materialShortagesCount: number;
  qualityPendingCount: number;
  dispatchPendingQty: number;
  monthlySalesTarget: number;
  monthlySalesAchieved: number;
  totalOutstanding: number;
  overdueOrdersCount: number;
  lastUpdated: string; // ISO-8601 timestamp
}

/**
 * Shop-Floor Shift & Weekly Production Summary stored at `/production`.
 */
export interface RtdbProductionSummary {
  shifts: {
    shiftA: { name: string; tonnageMt: number; yieldPercent: number; rejectedPcs: number };
    shiftB: { name: string; tonnageMt: number; yieldPercent: number; rejectedPcs: number };
    shiftC: { name: string; tonnageMt: number; yieldPercent: number; rejectedPcs: number };
  };
  weeklyRunRate: {
    week1: { label: string; tonnageMt: number; valueLakhs: number };
    week2: { label: string; tonnageMt: number; valueLakhs: number };
    week3: { label: string; tonnageMt: number; valueLakhs: number };
    week4: { label: string; tonnageMt: number; valueLakhs: number };
  };
  totalRejectionPercent: number;
}

/**
 * Company-wide Operational Alert Thresholds stored at `/alerts/thresholds`.
 */
export interface RtdbAlertThresholds {
  rejectionPercent: number;
  furnaceTemp: number;
  machineDowntimeMinutes: number;
  criticalAgeingDays: number;
  deliveryDelayDays: number;
  lowStockDays: number;
}

export interface FirestoreCollectionSchema {
  collection: string;
  type: 'root_collection' | 'subcollection';
  parentPath?: string;
  purpose: string;
  documentIdFormat: string;
  sampleFields: {
    field: string;
    type: string;
    description: string;
    indexed: boolean;
  }[];
  accessPattern: string;
}

export type QuotationStatus =
  | 'draft'
  | 'submitted'
  | 'follow_up'
  | 'negotiation'
  | 'won'
  | 'lost';

/**
 * Pre-Sales RFQ & Forging Quotation record (Operational Register #1).
 * - Identifier format: `QTN-YYYY-NNNN` (e.g., `'QTN-2026-0118'`).
 * - When `status === 'won'` and converted to PO, links via `convertedOrderId` -> `OrderJourney.id`.
 */
export interface QuotationRecord {
  id: string;
  rfqReference: string;
  quoteDate: string; // YYYY-MM-DD
  validUntil: string; // YYYY-MM-DD
  customerId: string; // Foreign key -> Customer.id
  customerName: string;
  contactPerson: string;
  productId: string; // Foreign key -> Product.id
  productName: string;
  materialGrade: string;
  standard: string;
  unitWeightKg: number;
  inquiryQtyPcs: number;
  quotedRatePerKg: number;
  quotedRatePerPc: number;
  totalQuotedValue: number;
  estimatedMarginPercent: number;
  deliveryLeadWeeks: number;
  isRepeatOrder: boolean;
  status: QuotationStatus;
  nextFollowUpDate: string; // YYYY-MM-DD
  followUpNotes: string;
  convertedOrderId?: string;
  dataOrigin?: DataRecordOrigin;
}

export type TechnicalBidStatus =
  | 'under_preparation'
  | 'submitted'
  | 'qualified'
  | 'disqualified'
  | 'awarded';

/**
 * PSU / EPC Tender Pipeline record (Operational Register #2).
 * - Identifier format: `TND-YYYY-NNN` (e.g., `'TND-2026-019'`).
 */
export interface TenderRecord {
  id: string;
  tenderNumber: string;
  issuingAuthority: string;
  projectTitle: string;
  itemSummary: string;
  estimatedValueLakhs: number;
  emdAmount: number;
  bidSubmissionDate: string; // YYYY-MM-DD
  priceBidOpeningDate: string; // YYYY-MM-DD
  technicalBidStatus: TechnicalBidStatus;
  assignedOwner: string;
  dataOrigin?: DataRecordOrigin;
}

/**
 * Approved Steel Mill Supplier Master record.
 * - Identifier format: `SUP-NNN` (e.g., `'SUP-001'`).
 */
export interface SteelMillSupplier {
  id: string;
  code: string;
  name: string;
  location: string;
  approvedGrades: string[];
  certification: string;
  leadTimeDays: number;
  creditTermsDays: number;
  qualityRatingPercent: number;
  contactPerson: string;
  phone: string;
  dataOrigin?: DataRecordOrigin;
}

export type PurchaseOrderStatus =
  | 'issued'
  | 'in_rolling'
  | 'partially_received'
  | 'completed';

/**
 * Steel Mill Purchase Order & GRN Tracker record (Operational Register #3).
 * - Identifier format: `PO-MILL-YYYY-NNN` (e.g., `'PO-MILL-2026-081'`).
 * - Quantity invariant: `pendingMt === Math.max(0, orderedMt - receivedMt)`.
 */
export interface PurchaseOrderRecord {
  id: string;
  poNumber: string;
  poDate: string; // YYYY-MM-DD
  supplierId: string; // Foreign key -> SteelMillSupplier.id
  supplierName: string;
  materialId: string; // Foreign key -> RawMaterialStock.id
  materialCode: string;
  materialGrade: string;
  sectionMm: string;
  linkedJobNumber: string; // Foreign key -> OrderJourney.jobNumber or 'STOCK-REPLENISHMENT'
  orderedMt: number;
  receivedMt: number;
  pendingMt: number;
  ratePerMt: number;
  totalValue: number;
  expectedDeliveryDate: string; // YYYY-MM-DD
  millHeatNumber: string;
  status: PurchaseOrderStatus;
  dataOrigin?: DataRecordOrigin;
}

export type ShopShiftLabel =
  | 'Shift A (06:00-14:00)'
  | 'Shift B (14:00-22:00)'
  | 'Shift C (22:00-06:00)';

/**
 * Shop-Floor Hammer / Press / Ring-Mill Production Log (Operational Register #4).
 * - Identifier format: `MLOG-YYYY-NNN` (e.g., `'MLOG-2026-101'`).
 * - Quantity invariant: `okPcs + rejectedPcs + reworkPcs <= forgedOutputPcs`.
 */
export interface ShopMachineLog {
  id: string;
  date: string; // YYYY-MM-DD
  shift: ShopShiftLabel;
  machineId: string;
  machineName: string;
  operatorName: string;
  jobNumber: string; // Foreign key -> OrderJourney.jobNumber
  productName: string;
  inputBilletsPcs: number;
  forgedOutputPcs: number;
  okPcs: number;
  rejectedPcs: number;
  reworkPcs: number;
  downtimeMinutes: number;
  capacityUtilizationPercent: number;
  dataOrigin?: DataRecordOrigin;
}

export type FurnaceFuelType =
  | 'LDO (Light Diesel Oil)'
  | 'PNG (Natural Gas)'
  | 'Electric Induction';

export type FurnaceFuelUnit = 'Liters' | 'SCM' | 'kWh';
export type FurnaceBatchStatus = 'within_spec' | 'temp_deviation' | 'completed';

/**
 * Reheating & Heat-Treatment Furnace Charge Log (Operational Register #5).
 * - Identifier format: `FURN-YYYY-NNN` (e.g., `'FURN-2026-401'`).
 */
export interface FurnaceBatchLog {
  id: string;
  batchNumber: string;
  date: string; // YYYY-MM-DD
  shift: string;
  furnaceId: string;
  furnaceName: string;
  fuelType: FurnaceFuelType;
  jobNumber: string; // Foreign key -> OrderJourney.jobNumber
  heatNumber: string;
  chargeWeightMt: number;
  targetTempC: number;
  peakRecordedTempC: number;
  soakingTimeMinutes: number;
  fuelConsumedQty: number;
  fuelUnit: FurnaceFuelUnit;
  specificFuelPerMt: number;
  status: FurnaceBatchStatus;
  dataOrigin?: DataRecordOrigin;
}

export type MaintenanceType =
  | 'Preventive (PM)'
  | 'Breakdown'
  | 'Die Changeover'
  | 'Calibration';

export type MaintenanceTicketStatus = 'resolved' | 'in_repair' | 'awaiting_spares';

/**
 * Machine Maintenance & Breakdown Ticket record (Operational Register #6).
 * - Identifier format: `MNT-YYYY-NNN` (e.g., `'MNT-2026-044'`).
 */
export interface MachineMaintenanceTicket {
  id: string;
  ticketDate: string; // YYYY-MM-DD
  machineId: string;
  machineName: string;
  maintenanceType: MaintenanceType;
  issueDescription: string;
  rootCause: string;
  replacementParts: string;
  downtimeMinutes: number;
  maintenanceCostInr: number;
  technicianName: string;
  status: MaintenanceTicketStatus;
  dataOrigin?: DataRecordOrigin;
}

/**
 * Daily High-Tension Power & Specific Energy Consumption Log (Operational Register #7).
 * - Identifier format: `PWR-YYYY-NNNN` (e.g., `'PWR-2026-1021'`).
 */
export interface PowerConsumptionLog {
  id: string;
  date: string; // YYYY-MM-DD
  totalKwh: number;
  // Optional readings are left undefined when not recorded, never estimated.
  totalKvah?: number;
  powerFactor?: number;
  peakDemandKva?: number;
  forgedOutputMt: number;
  specificEnergyKwhPerMt: number;
  targetKwhPerMt?: number;
  electricityCostInr?: number;
  furnaceSharePercent?: number;
  pressHammerSharePercent?: number;
  dataOrigin?: DataRecordOrigin;
}

/**
 * 8-Head Job Costing & Profitability Sheet keyed by `jobNumber`.
 */
export interface JobCostSheet {
  jobNumber: string; // Primary key -> OrderJourney.jobNumber
  orderId: string; // Foreign key -> OrderJourney.id
  poNumber: string;
  customerName: string;
  productName: string;
  materialGrade: string;
  orderedQty: number;
  finishedWeightKgPerPc: number;
  cutWeightKgPerPc: number;
  totalRevenueInr: number;
  materialCostInr: number;
  scrapRecoveryCreditInr: number;
  labourCostInr: number;
  powerCostInr: number;
  fuelHeatTreatmentCostInr: number;
  machiningProcessingCostInr: number;
  testingTpiCostInr: number;
  packingCostInr: number;
  transportFreightCostInr: number;
  overheadCostInr: number;
  quotedMarginPercent: number;
  dataOrigin?: DataRecordOrigin;
}

export interface DimensionalParameterMeasurement {
  dimensionName: string;
  nominalMm: string;
  toleranceMm: string;
  measuredMinMm: string;
  measuredMaxMm: string;
  instrumentUsed: string;
  result: 'OK' | 'DEVIATION';
}

export type DimensionalOfferingStatus =
  | 'offered_to_tpi'
  | 'witnessed_cleared'
  | 'rework_advised';

/**
 * Dimensional Inspection Report (DIR) & TPI Offering record (Operational Register #8).
 * - Identifier format: `DIR-YYYY-NNNN` (e.g., `'DIR-2026-0894'`).
 */
export interface DimensionalInspectionReport {
  id: string;
  jobNumber: string; // Foreign key -> OrderJourney.jobNumber
  orderNo: string; // Foreign key -> OrderJourney.poNumber
  customerName: string;
  drawingNo: string;
  productName: string;
  sampleSizePcs: number;
  inspectorName: string;
  tpiAgency: string;
  inspectionDate: string; // YYYY-MM-DD
  parameters: DimensionalParameterMeasurement[];
  offeringStatus: DimensionalOfferingStatus;
  dataOrigin?: DataRecordOrigin;
}

export interface ClientRequirementEntry {
  id: string;
  sectionCode: string;
  areaTitle: string;
  requirementSummary: string;
  businessPurpose: string;
  moduleTabId: string;
  moduleName: string;
  keyDataFields: string[];
  sourceFiles: string[];
  rtdbPath: string;
  status: 'Implemented' | 'Partially Implemented' | 'Requires Client Input';
  implementationNotes: string;
  clientActionOrDependency?: string;
}

// ============================================================================
// ENTERPRISE WORKFLOW, ACCOUNTABILITY, HANDOVER, PR, CAPA & FOLLOW-UP MODELS
// ============================================================================

export type HandoverStageCode =
  | 'H-1'
  | 'H-2'
  | 'H-3'
  | 'H-4'
  | 'H-5'
  | 'H-1_SALES_TO_PPC'
  | 'H-2_STORES_TO_PRODUCTION'
  | 'H-3_PRODUCTION_TO_QUALITY'
  | 'H-4_QUALITY_TO_DISPATCH'
  | 'H-5_DISPATCH_TO_FINANCE';

export type TaskStatus =
  | 'pending'
  | 'not_started'
  | 'in_progress'
  | 'waiting_dependency'
  | 'blocked'
  | 'submitted_for_verification'
  | 'verified_approved'
  | 'approved'
  | 'rejected_reopened'
  | 'rejected_rework'
  | 'escalated'
  | 'cancelled'
  | 'Pending'
  | 'In Progress'
  | 'Submitted for Verification'
  | 'Verified & Approved'
  | 'Rejected / Rework'
  | 'Escalated';

export type TaskVerificationStatus = 'pending' | 'approved' | 'rejected';

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low' | 'Critical' | 'High' | 'Medium' | 'Low';

export type TaskCategory =
  | 'order_milestone'
  | 'rfq_followup'
  | 'procurement_pr'
  | 'qc_inspection'
  | 'dispatch_clearance'
  | 'billing_collection'
  | 'maintenance_capa'
  | 'daily_sop_checklist';

export interface TaskEvidenceItem {
  id: string;
  type: 'document_ref' | 'record_id' | 'measurement_note' | 'certificate_ref';
  referenceCode: string;
  summary: string;
  uploadedAt: string;
  uploadedByUid: string;
  uploadedByName: string;
}

export interface TaskEscalationEvent {
  level: 1 | 2 | 3;
  triggeredAt: string;
  reason: string;
  notifiedRole: UserRole;
  notifiedDepartment: string;
}

/**
 * Central Task, Accountability, Evidence & Verification Record stored at `/tasks/{taskId}`.
 * Enforces strict separation between Employee Execution (`submitted_for_verification`)
 * and Supervisor/Authority Approval (`verified_approved` / `approved`).
 */
export interface TaskRecord {
  id: string;
  taskNumber?: string;
  taskNo?: string;
  title: string;
  description: string;
  category?: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  completionPercent?: number;
  department: string;
  departmentRole?: UserRole;
  assignedRole?: UserRole;
  assignedToUid?: string;
  assignedToName?: string;
  assignedByUid?: string;
  assignedByName?: string;
  primaryOwnerUid?: string;
  primaryOwnerName?: string;
  supportingUids?: string[];
  supportingNames?: string[];
  supervisorUid?: string;
  supervisorName?: string;
  supervisorRole?: UserRole;
  startDate?: string;
  dueDate: string;
  nextActionDate?: string;
  slaHours?: number;
  orderId?: string;
  customerName?: string;
  linkedOrderId?: string;
  linkedJobNumber?: string;
  linkedEntityId?: string;
  predecessorTaskIds?: string[];
  blockerReason?: string;
  evidenceItems?: TaskEvidenceItem[];
  submittedAt?: string;
  submittedByUid?: string;
  submissionNotes?: string;
  submissionRemarks?: string;
  submittedRemarks?: string;
  verifiedByUid?: string;
  verifiedByName?: string;
  verifiedAt?: string;
  verificationStatus?: TaskVerificationStatus;
  verificationRemarks?: string;
  rejectionReason?: string;
  escalationLevel: number | 'None' | 'L1_DeptHead' | 'L2_CEO' | 'L3_Board';
  escalatedAt?: string;
  escalationHistory?: TaskEscalationEvent[];
  isSopDailyDuty?: boolean;
  sopClauseRef?: string;
  createdAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export type HandoverStatus =
  | 'initiated'
  | 'pending_acceptance'
  | 'accepted'
  | 'rejected'
  | 'Pending Acceptance'
  | 'Accepted'
  | 'Rejected'
  | 'Rejected / Returned'
  | 'Escalated';

/**
 * Inter-Department Stage Handover Record (`H-1` through `H-5`) stored at `/handovers/{handoverId}`.
 */
export interface HandoverRecord {
  id: string;
  handoverCode?: HandoverStageCode;
  stageCode?: HandoverStageCode;
  stageLabel: string;
  orderId: string;
  poNumber?: string;
  jobNumber: string;
  customerName?: string;
  productName?: string;
  fromDepartment: string;
  fromRole?: UserRole;
  fromUid?: string;
  fromUserName?: string;
  initiatedByUid: string;
  initiatedByName: string;
  initiatedAt: string;
  toDepartment: string;
  toRole?: UserRole;
  toUid?: string;
  toUserName?: string;
  receivedByUid?: string;
  receivedByName?: string;
  quantityPcs?: number;
  weightMt?: number;
  quantityMT?: number;
  heatNumber?: string;
  heatNo?: string;
  checklistConfirmed?: boolean;
  checklistSummary?: string;
  documentRefs?: string[];
  handoverNotes?: string;
  remarks?: string;
  rejectionReason?: string;
  slaDeadline?: string;
  status: HandoverStatus;
  respondedByUid?: string;
  respondedByName?: string;
  respondedAt?: string;
  resolvedAt?: string;
  responseRemarks?: string;
  createdAt?: string;
  updatedAt?: string;
  dataOrigin?: DataRecordOrigin;
}

export type PurchaseRequisitionStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'converted_to_po'
  | 'po_issued'
  | 'Draft'
  | 'Pending Approval'
  | 'Approved'
  | 'Rejected'
  | 'Converted to PO';

/**
 * Formal Stores-to-Purchase Requisition (PR) Record stored at `/purchaseRequisitions/{prId}`.
 */
export interface PurchaseRequisitionRecord {
  id: string;
  prNumber: string;
  prDate?: string;
  requestDate?: string;
  requisitionDate?: string;
  orderId?: string;
  steelGrade?: string;
  requiredMT?: number;
  requiredMt?: number;
  requiredQtyMt?: number;
  estimatedCostINR?: number;
  requiredByDate?: string;
  requestedByUid: string;
  requestedByName: string;
  requestedByRole?: UserRole;
  department?: string;
  materialId?: string;
  materialCode?: string;
  materialGrade: string;
  sectionMm: string;
  estimatedRatePerMt: number;
  estimatedTotalInr: number;
  suggestedSupplierId?: string;
  suggestedSupplierName?: string;
  linkedJobNumber: string;
  urgency: 'critical' | 'high' | 'standard' | 'urgent';
  priority?: 'Low' | 'Normal' | 'High' | 'Urgent';
  justification: string;
  status: PurchaseRequisitionStatus;
  approvedByUid?: string;
  approvedByName?: string;
  approvedAt?: string;
  approvalRemarks?: string;
  rejectionReason?: string;
  convertedPoId?: string;
  convertedPoNumber?: string;
  createdAt?: string;
  updatedAt?: string;
  dataOrigin?: DataRecordOrigin;
}

export type NcrDisposition =
  | 'rework_forging'
  | 're_heat_treat'
  | 'scrap_and_reforge'
  | 'concession_tpi'
  | 'Rework'
  | 'Scrap'
  | 'Use As Is (Concession)'
  | 'Hold';

export type NcrCapaStatus =
  | 'open'
  | 'root_cause_identified'
  | 'capa_in_progress'
  | 'capa_implemented'
  | 'verified_closed'
  | 'Open'
  | 'Root Cause Analysis'
  | 'CAPA Implemented'
  | 'Verified & Closed';

/**
 * Quality Non-Conformance Report (NCR) & CAPA Record stored at `/ncrCapaRecords/{ncrId}`.
 */
export interface NcrCapaRecord {
  id: string;
  ncrNumber: string;
  dateRaised?: string;
  inspectionId?: string;
  orderId?: string;
  batchId?: string;
  jobNumber: string;
  orderNo?: string;
  customerName: string;
  productName: string;
  materialGrade?: string;
  steelGrade?: string;
  heatNumber: string;
  heatNo?: string;
  rejectedQty?: number;
  rejectedQtyPcs: number;
  affectedQtyMT?: number;
  defectCategory: string;
  defectDescription: string;
  rootCause?: string;
  rootCause5Why?: string;
  rootCauseAnalysis: string;
  containmentAction?: string;
  disposition?: NcrDisposition;
  correctiveAction: string;
  preventiveAction: string;
  responsibleOwnerName?: string;
  responsibleRole?: UserRole;
  targetClosureDate?: string;
  raisedByUid?: string;
  raisedByName?: string;
  status: NcrCapaStatus;
  costOfPoorQualityInr: number;
  verifiedByUid?: string;
  verifiedByName?: string;
  verifiedAt?: string;
  closedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  dataOrigin?: DataRecordOrigin;
}

export type PaymentFollowUpRecordType = 'customer_receivable' | 'supplier_payable';

/**
 * Invoice Payment Collection Follow-Up & Supplier Payable Record stored at `/paymentFollowUps/{followUpId}`.
 */
export interface PaymentFollowUpRecord {
  id: string;
  recordType?: PaymentFollowUpRecordType;
  invoiceId?: string;
  orderId?: string;
  customerId: string;
  customerName: string;
  partyId?: string;
  partyName?: string;
  invoiceNumber: string;
  invoiceOrBillNo?: string;
  jobNumber?: string;
  linkedJobOrPoNo?: string;
  invoiceAmountInr: number;
  outstandingAmountInr: number;
  amountDueInr?: number;
  dueDate: string;
  overdueDays: number;
  contactPerson?: string;
  contactPhone?: string;
  contactedPerson: string;
  followUpDate: string;
  nextFollowUpDate: string;
  promisedPaymentDate: string;
  promisedDate?: string;
  promisedAmountInr: number;
  promisedAmountINR?: number;
  creditHoldActive?: boolean;
  modeOfCommunication?: string;
  followUpMode?: string;
  outcome?: string;
  followUpNotes?: string;
  outcomeNotes?: string;
  notes?: string;
  remarks: string;
  assignedOwnerName?: string;
  loggedByUid: string;
  loggedByName: string;
  loggedByRole?: UserRole;
  status:
    | 'scheduled'
    | 'contacted'
    | 'promised'
    | 'part_received'
    | 'received'
    | 'settled'
    | 'escalated_credit_hold';
  createdAt?: string;
  updatedAt?: string;
  dataOrigin?: DataRecordOrigin;
}

/**
 * Pre-RFQ Commercial Lead & Customer Enquiry Record (Module B).
 */
export type LeadStage = 'new' | 'contacted' | 'qualified' | 'rfq_received' | 'quoted' | 'won' | 'lost';

/**
 * Sales enquiry before (or until) it becomes a quotation, stored at `/leads/{leadId}`.
 * Only facts the salesperson enters are kept; nothing is estimated.
 */
export interface LeadRecord {
  id: string;
  companyName: string;
  contactPerson: string;
  phone?: string;
  email?: string;
  city?: string;
  industry?: string;
  source: string;
  productInterest: string;
  materialGrade?: string;
  estimatedValueInr?: number;
  stage: LeadStage;
  ownerUid: string;
  ownerName: string;
  nextFollowUpDate?: string;
  lastContactDate?: string;
  /** Dated follow-up notes, newest first. */
  notes?: string;
  lostReason?: string;
  customerId?: string;
  quotationId?: string;
  createdByUid: string;
  createdAt: string;
  updatedAt?: string;
  dataOrigin?: DataRecordOrigin;
}

export interface PreRfqLeadRecord {
  id: string;
  leadDate: string;
  enquiryDate?: string;
  companyName: string;
  contactPerson: string;
  phone: string;
  email: string;
  industry?: string;
  industrySegment: string;
  source: string;
  productInterest?: string;
  materialGrade?: string;
  requirementSummary: string;
  estimatedMonthlyMt?: number;
  estimatedTonnageMt?: number;
  estimatedValueLakhs?: number;
  estimatedAnnualPotentialLakhs: number;
  feasibilityStatus?: 'feasible' | 'tooling_required' | 'under_review';
  assignedSalesPerson: string;
  assignedSalesRep?: string;
  nextActionDate: string;
  nextInteractionDate?: string;
  status: string;
  stage?: string;
  notes?: string;
  remarks: string;
  interactionNotes?: string;
  convertedQuoteId?: string;
}

/**
 * PPC Master Production Schedule & Billet Cutting Release Entry (Module D).
 */
export interface PpcScheduleEntry {
  id: string;
  jobNumber: string;
  orderId: string;
  customerName: string;
  productName: string;
  materialGrade: string;
  heatNumber: string;
  machineId: string;
  machineName: string;
  assignedMachineId?: string;
  assignedMachineName?: string;
  plannedStartDate: string;
  plannedEndDate: string;
  plannedQtyPcs: number;
  actualForgedPcs: number;
  orderedPcs?: number;
  cutWeightKgPerPc: number;
  totalAllocatedMt: number;
  totalBilletInputMt?: number;
  billetCuttingStatus: string;
  forgingStatus: string;
  heatTreatmentStatus: string;
  machiningStatus: string;
  status?: string;
  delayReason?: string;
  releasedBy?: string;
}

/**
 * Department Duty Manual & Mandatory Daily/Weekly SOP Checklist Definition (Module M).
 */
export interface RoleDutySopChecklist {
  id?: string;
  role: UserRole;
  department: string;
  designationTitle: string;
  roleTitle?: string;
  manualSectionRef?: string;
  primaryAccountability: string;
  primaryAccountabilitySummary?: string;
  dailyDuties: string[];
  weeklyDuties: string[];
  mandatoryKpis: string[];
  mandatoryDailyTasks?: string[];
  mandatoryWeeklyTasks?: string[];
  handoverGatesOwned?: HandoverStageCode[];
  escalationSlaHours?: {
    level1DeptHeadHours: number;
    level2CeoHours: number;
  };
  kpiMetricsTracked?: string[];
}


