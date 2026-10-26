import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy as firestoreOrderBy,
  query,
  runTransaction,
  where as firestoreWhere,
  startAfter as firestoreStartAfter,
  Firestore,
  QueryConstraint,
} from 'firebase/firestore';
import {
  auth,
  firestore as defaultFirestore,
  firestoreDatabaseId,
  FIREBASE_CONFIG_METADATA,
  OperationType,
  FirestoreErrorInfo,
} from '../lib/firebase';
import {
  AccountStatus,
  DataRecordOrigin,
  UserRole,
  isAccountStatusActive,
  isCanonicalUserRole,
} from '../types/mis';

// ============================================================================
// 1. COLLECTION NAMES & CANONICAL FIRESTORE DOCUMENT SCHEMAS
// ============================================================================

export const FIRESTORE_COLLECTIONS = {
  USERS: 'users',
  SYSTEM_CONFIG: 'systemConfig',
  CUSTOMERS: 'customers',
  PRODUCTS: 'products',
  SALES_ORDERS: 'salesOrders',
  DISPATCHES: 'dispatches',
  RAW_MATERIALS: 'rawMaterials',
  STOCK_MOVEMENTS: 'stockMovements',
  QUALITY_INSPECTIONS: 'qualityInspections',
  OUTSTANDING_PAYMENTS: 'outstandingPayments',
  ACTION_QUEUE: 'actionQueue',
  AUDIT_LOGS: 'auditLogs',
  QUOTATIONS: 'quotations',
  TENDERS: 'tenders',
  SUPPLIERS: 'suppliers',
  PURCHASE_ORDERS: 'purchaseOrders',
  MACHINE_LOGS: 'machineLogs',
  FURNACE_LOGS: 'furnaceLogs',
  MAINTENANCE_TICKETS: 'maintenanceTickets',
  POWER_LOGS: 'powerLogs',
  DIMENSIONAL_REPORTS: 'dimensionalReports',
  JOB_COST_SHEETS: 'jobCostSheets',
  TASKS: 'tasks',
  HANDOVERS: 'handovers',
  PURCHASE_REQUISITIONS: 'purchaseRequisitions',
  NCR_CAPA_RECORDS: 'ncrCapaRecords',
  PAYMENT_FOLLOW_UPS: 'paymentFollowUps',
} as const;

export type FirestoreCollectionName =
  (typeof FIRESTORE_COLLECTIONS)[keyof typeof FIRESTORE_COLLECTIONS];

export const ALL_FIRESTORE_COLLECTIONS: readonly FirestoreCollectionName[] =
  Object.values(FIRESTORE_COLLECTIONS);

export const BUSINESS_DATA_COLLECTIONS: readonly FirestoreCollectionName[] =
  ALL_FIRESTORE_COLLECTIONS.filter(
    (c) => c !== 'users' && c !== 'systemConfig' && c !== 'auditLogs'
  );

/**
 * Primary key field name enforced by `firestore.rules` for each collection.
 */
export const COLLECTION_PRIMARY_KEY_FIELD: Readonly<
  Record<FirestoreCollectionName, string>
> = {
  users: 'uid',
  systemConfig: 'configId',
  customers: 'id',
  products: 'id',
  salesOrders: 'orderId',
  dispatches: 'id',
  rawMaterials: 'gradeId',
  stockMovements: 'id',
  qualityInspections: 'id',
  outstandingPayments: 'invoiceId',
  actionQueue: 'id',
  auditLogs: 'id',
  quotations: 'id',
  tenders: 'id',
  suppliers: 'id',
  purchaseOrders: 'id',
  machineLogs: 'id',
  furnaceLogs: 'id',
  maintenanceTickets: 'id',
  powerLogs: 'id',
  dimensionalReports: 'id',
  jobCostSheets: 'id',
  tasks: 'id',
  handovers: 'id',
  purchaseRequisitions: 'id',
  ncrCapaRecords: 'id',
  paymentFollowUps: 'id',
};

export interface FirestoreCallerContext {
  uid: string;
  email: string;
  displayName?: string;
  role: UserRole;
  accountStatus: AccountStatus;
}

export type FirestoreSalesOrderStage =
  | 'Inquiry'
  | 'Order Confirmed'
  | 'Raw Material Allocated'
  | 'Forging'
  | 'Heat Treatment'
  | 'Machining'
  | 'Quality Inspection'
  | 'Ready for Dispatch'
  | 'Dispatched'
  | 'Invoiced';

export type FirestoreSalesOrderOverallStatus =
  | 'On Track'
  | 'At Risk'
  | 'Delayed'
  | 'Completed'
  | 'Cancelled';

export interface FirestoreSalesOrderDoc {
  orderId: string;
  customerId?: string;
  customerName: string;
  productId?: string;
  productName: string;
  steelGrade: string;
  quantityMT: number;
  totalValueINR: number;
  orderDate: string;
  committedDeliveryDate: string;
  currentStage: FirestoreSalesOrderStage;
  overallStatus: FirestoreSalesOrderOverallStatus;
  delayDays?: number;
  delayReason?: string;
  heatNo?: string;
  mtcStatus?: 'Pending' | 'Generated' | 'Verified';
  dispatchStatus?: 'Not Started' | 'Partial' | 'Dispatched' | 'Delivered';
  invoiceNo?: string;
  paymentStatus?: 'Unbilled' | 'Pending' | 'Partially Paid' | 'Paid' | 'Overdue';
  stages?: Record<string, any>[];
  fprUid?: string;
  fprName?: string;
  fprDepartment?: string;
  handoverStage?: 'H-1' | 'H-2' | 'H-3' | 'H-4' | 'H-5';
  documentChecklistStatus?: 'Incomplete' | 'Ready' | 'Verified';
  creditHoldOverrideBy?: string;
  creditHoldOverrideReason?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreRawMaterialDoc {
  gradeId: string;
  steelGrade: string;
  category?:
    | 'Carbon Steel'
    | 'Alloy Steel'
    | 'Stainless Steel'
    | 'Tool Steel'
    | 'Duplex Steel';
  availableMT: number;
  allocatedMT?: number;
  reorderLevelMT: number;
  unitCostPerMT?: number;
  supplierName?: string;
  heatBatchNo?: string;
  locationYard?: string;
  status: 'Healthy' | 'Low Stock' | 'Critical';
  lastUpdated: string;
  updatedBy?: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreStockMovementDoc {
  id: string;
  gradeId: string;
  steelGrade: string;
  type: 'INWARD' | 'ISSUE' | 'RETURN' | 'ADJUSTMENT';
  quantityTons: number;
  heatNumber?: string;
  referenceDocument?: string;
  orderId?: string;
  performedBy: string;
  performedByUid?: string;
  timestamp: string;
  remarks?: string;
  balanceAfterMT?: number;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestorePurchaseOrderDoc {
  id: string;
  poNumber: string;
  supplierId?: string;
  supplierName: string;
  steelGrade: string;
  orderedMT: number;
  receivedMT?: number;
  ratePerMT: number;
  totalAmountINR: number;
  orderDate?: string;
  expectedDeliveryDate: string;
  status:
    | 'Draft'
    | 'Issued'
    | 'In Transit'
    | 'Partially Received'
    | 'Received'
    | 'Cancelled';
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreDispatchDoc {
  id: string;
  orderId: string;
  customerName: string;
  productName?: string;
  quantityTons: number;
  dispatchDate: string;
  transporterName?: string;
  vehicleNo?: string;
  lrNo?: string;
  invoiceNo?: string;
  destination?: string;
  status: 'Scheduled' | 'Loading' | 'In Transit' | 'Delivered' | 'Delayed';
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreAuditLogDoc {
  id: string;
  timestamp: string;
  actorUid: string;
  actorEmail?: string;
  actorName?: string;
  actorRole: UserRole;
  targetUid?: string;
  userId?: string;
  userName?: string;
  action: string;
  module: string;
  collectionName?: string;
  entityId?: string;
  documentId?: string;
  oldValueSummary?: string;
  newValueSummary?: string;
  details: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  outcome?: 'SUCCESS' | 'PARTIAL_FAILURE' | 'DENIED';
  ipAddress?: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreCustomerDoc {
  id: string;
  code?: string;
  name: string;
  contactPerson: string;
  email: string;
  phone?: string;
  gstin?: string;
  gstNumber?: string;
  creditLimit: number;
  paymentTermsDays?: number;
  address?: string;
  location?: string;
  industry?: string;
  assignedSalesPerson?: string;
  totalOrders?: number;
  totalOutstanding?: number;
  status: 'Active' | 'On Hold' | 'Inactive';
  createdAt: string;
  updatedAt?: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreProductDoc {
  id: string;
  code?: string;
  name: string;
  category:
    | 'Flanges'
    | 'Rolled Rings'
    | 'Forged Shafts'
    | 'Gear Blanks'
    | 'Custom Forgings';
  steelGrade: string;
  size?: string;
  standard?: string;
  standardWeightKg: number;
  unitPrice: number;
  hsnCode?: string;
  uom?: string;
  drawingNo?: string;
  heatTreatmentReq?: string;
  status: 'Active' | 'Discontinued';
  createdAt: string;
  updatedAt?: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreQualityInspectionDoc {
  id: string;
  batchId: string;
  orderId: string;
  productName?: string;
  steelGrade?: string;
  heatNo?: string;
  inspectedQtyMT: number;
  acceptedQtyMT: number;
  rejectedQtyMT: number;
  hardnessHB?: string;
  ndtStatus?: 'Passed' | 'Failed' | 'Pending' | 'N/A';
  mtcNumber?: string;
  inspectorName?: string;
  inspectionDate: string;
  status: 'Approved' | 'Hold' | 'Rework' | 'Rejected';
  createdAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreOutstandingPaymentDoc {
  invoiceId: string;
  orderId?: string;
  customerId?: string;
  customerName: string;
  invoiceDate: string;
  dueDate: string;
  invoiceAmountINR: number;
  receivedAmountINR: number;
  balanceAmountINR: number;
  ageingBucket: '0-30 Days' | '31-60 Days' | '61-90 Days' | '90+ Days';
  status: 'Current' | 'Overdue' | 'Critical Overdue' | 'Paid';
  lastFollowUpDate?: string;
  remarks?: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreActionQueueDoc {
  id: string;
  category:
    | 'Inventory'
    | 'Production'
    | 'Quality'
    | 'Finance'
    | 'Dispatch'
    | 'Maintenance';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  description?: string;
  entityRef?: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  createdAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreQuotationDoc {
  id: string;
  quoteNo: string;
  customerId?: string;
  customerName: string;
  contactPerson?: string;
  productId?: string;
  productName: string;
  steelGrade: string;
  quantityMT: number;
  quotedRatePerKg?: number;
  totalValueINR: number;
  validUntil?: string;
  status:
    | 'Draft'
    | 'Sent'
    | 'Under Negotiation'
    | 'Won'
    | 'Lost'
    | 'Expired';
  preparedBy?: string;
  followUpNotes?: string;
  nextFollowUpDate?: string;
  convertedOrderId?: string;
  inquiryQtyPcs?: number;
  unitWeightKg?: number;
  quotedRatePerPc?: number;
  estimatedMarginPercent?: number;
  deliveryLeadWeeks?: number;
  isRepeatOrder?: boolean;
  createdAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreTenderDoc {
  id: string;
  tenderNo: string;
  issuingAuthority: string;
  projectTitle: string;
  estimatedValueINR: number;
  emdAmountINR?: number;
  submissionDeadline: string;
  technicalBidStatus:
    | 'Preparing'
    | 'Submitted'
    | 'Qualified'
    | 'Disqualified'
    | 'Awarded'
    | 'Lost';
  ownerName?: string;
  createdAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreSupplierDoc {
  id: string;
  name: string;
  location?: string;
  primaryGrades?: string[];
  leadTimeDays: number;
  qualityRating?: number;
  onTimeDeliveryPct?: number;
  approvalStatus: 'Approved' | 'Probation' | 'Blacklisted';
  contactEmail?: string;
  createdAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreMachineLogDoc {
  id: string;
  machineId: string;
  machineName: string;
  shift: 'Shift A' | 'Shift B' | 'Shift C';
  operatorName?: string;
  orderId?: string;
  operationType:
    | 'Open Die Forging'
    | 'Closed Die Hammer'
    | 'Ring Rolling'
    | 'CNC Turning'
    | 'Band Saw Cutting';
  outputTons: number;
  utilizationPct?: number;
  downtimeMinutes?: number;
  status: 'Running' | 'Idle' | 'Changeover' | 'Breakdown' | 'Maintenance';
  loggedAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreFurnaceLogDoc {
  id: string;
  furnaceId: string;
  batchNo: string;
  orderId?: string;
  steelGrade?: string;
  cycleType:
    | 'Normalizing'
    | 'Quenching & Tempering'
    | 'Annealing'
    | 'Solution Annealing'
    | 'Stress Relieving';
  targetTempC: number;
  soakTimeHours?: number;
  chargeWeightMT: number;
  fuelConsumedSCM?: number;
  status:
    | 'Charging'
    | 'Heating'
    | 'Soaking'
    | 'Cooling'
    | 'Completed'
    | 'Aborted';
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreMaintenanceTicketDoc {
  id: string;
  ticketNo: string;
  machineId: string;
  machineName: string;
  maintenanceType:
    | 'Breakdown'
    | 'Preventive'
    | 'Hydraulic Seal'
    | 'Die Change'
    | 'Calibration';
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
  issueDescription: string;
  assignedTechnician?: string;
  estimatedDowntimeHours?: number;
  status:
    | 'Open'
    | 'In Progress'
    | 'Awaiting Spares'
    | 'Resolved'
    | 'Closed';
  reportedAt: string;
  resolvedAt?: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestorePowerLogDoc {
  id: string;
  logDate: string;
  shift: 'Shift A' | 'Shift B' | 'Shift C' | 'Full Day';
  electricityKwh: number;
  pngGasSCM?: number;
  productionOutputMT: number;
  kwhPerMT: number;
  powerFactor?: number;
  peakDemandKva?: number;
  loggedBy?: string;
  createdAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreDimensionalReportDoc {
  id: string;
  reportNo: string;
  orderId: string;
  batchId?: string;
  drawingNo?: string;
  outerDiaNominalMm: number;
  outerDiaObservedMm: number;
  innerDiaNominalMm?: number;
  innerDiaObservedMm?: number;
  heightNominalMm?: number;
  heightObservedMm?: number;
  deviationMm?: number;
  toleranceResult:
    | 'Within Tolerance'
    | 'Minor Deviation'
    | 'Out of Tolerance';
  inspectorName?: string;
  inspectedAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreJobCostSheetDoc {
  id: string;
  orderId: string;
  customerName: string;
  productName?: string;
  rawMaterialCostINR: number;
  forgingConversionCostINR: number;
  heatTreatmentCostINR?: number;
  machiningCostINR?: number;
  testingAndMtcCostINR?: number;
  totalActualCostINR: number;
  salesRealizationINR: number;
  grossMarginINR: number;
  grossMarginPct: number;
  costStatus: 'Draft' | 'Provisional' | 'Finalized';
  updatedBy?: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreSystemConfigDoc {
  configId: 'dashboardKpis' | 'productionSummary' | 'alertThresholds' | 'connection_probe';
  configType: 'dashboardKpis' | 'productionSummary' | 'alertThresholds' | 'connection_probe';
  totalOrderBookValue?: number;
  activeOrdersCount?: number;
  delayedOrdersCount?: number;
  monthlyDispatchMT?: number;
  monthlyDispatchTargetMT?: number;
  rawMaterialStockMT?: number;
  lowStockAlertsCount?: number;
  rejectionRatePct?: number;
  maxRejectionThresholdPct?: number;
  totalOutstandingINR?: number;
  overdueReceivablesINR?: number;
  fpyPercentage?: number;
  reworkTons?: number;
  scrapPct?: number;
  ncrCount?: number;
  Low_Stock_Threshold_Tons?: number;
  Delay_Threshold_Days?: number;
  Rejection_Rate_Max_Pct?: number;
  Payment_Overdue_Days?: number;
  /** Monthly sales target in INR, set by the CEO or Super Admin (dashboardKpis only). */
  monthlySalesTarget?: number;
  updatedBy?: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreTaskDoc {
  id: string;
  taskNo: string;
  title: string;
  description?: string;
  department: string;
  assignedRole: UserRole;
  assignedToUid: string;
  assignedToName: string;
  assignedByUid?: string;
  assignedByName?: string;
  orderId?: string;
  customerName?: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  status:
    | 'Pending'
    | 'In Progress'
    | 'Submitted for Verification'
    | 'Verified & Approved'
    | 'Rejected / Rework'
    | 'Escalated';
  dueDate: string;
  slaHours?: number;
  submittedAt?: string;
  submissionRemarks?: string;
  verifiedByUid?: string;
  verifiedByName?: string;
  verifiedAt?: string;
  verificationRemarks?: string;
  rejectionReason?: string;
  escalationLevel?: 'None' | 'L1_DeptHead' | 'L2_CEO';
  escalatedAt?: string;
  isSopDailyDuty?: boolean;
  sopClauseRef?: string;
  createdAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreHandoverDoc {
  id: string;
  handoverCode: 'H-1' | 'H-2' | 'H-3' | 'H-4' | 'H-5';
  orderId: string;
  customerName: string;
  productName: string;
  fromDepartment: string;
  fromRole: UserRole;
  fromUid: string;
  fromUserName: string;
  toDepartment: string;
  toRole: UserRole;
  toUid?: string;
  toUserName?: string;
  quantityMT?: number;
  heatNo?: string;
  checklistSummary?: string;
  status: 'Pending Acceptance' | 'Accepted' | 'Rejected' | 'Escalated';
  initiatedAt: string;
  respondedAt?: string;
  remarks?: string;
  rejectionReason?: string;
  slaDeadline?: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestorePurchaseRequisitionDoc {
  id: string;
  prNumber: string;
  orderId?: string;
  steelGrade: string;
  requiredMT: number;
  estimatedCostINR?: number;
  requiredByDate: string;
  requestedByUid: string;
  requestedByName: string;
  requestedByRole: UserRole;
  justification?: string;
  priority: 'Urgent' | 'High' | 'Normal';
  status:
    | 'Draft'
    | 'Pending Approval'
    | 'Approved'
    | 'Rejected'
    | 'Converted to PO';
  approvedByUid?: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectionReason?: string;
  convertedPoNumber?: string;
  createdAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestoreNcrCapaDoc {
  id: string;
  ncrNumber: string;
  orderId: string;
  batchId: string;
  productName?: string;
  steelGrade?: string;
  heatNo?: string;
  defectCategory:
    | 'Dimensional'
    | 'Surface Crack'
    | 'UT Indication'
    | 'Hardness Deviation'
    | 'Chemistry Mix'
    | 'Machining Error';
  defectDescription: string;
  affectedQtyMT: number;
  rootCause?: string;
  correctiveAction?: string;
  preventiveAction?: string;
  disposition: 'Rework' | 'Scrap' | 'Use As Is (Concession)' | 'Hold';
  status:
    | 'Open'
    | 'Root Cause Analysis'
    | 'CAPA Implemented'
    | 'Verified & Closed';
  raisedByUid: string;
  raisedByName: string;
  verifiedByName?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

export interface FirestorePaymentFollowUpDoc {
  id: string;
  invoiceId: string;
  orderId?: string;
  customerId?: string;
  customerName: string;
  contactPerson: string;
  followUpDate: string;
  nextFollowUpDate: string;
  promisedAmountINR?: number;
  promisedDate?: string;
  followUpMode:
    | 'Phone Call'
    | 'Email'
    | 'WhatsApp'
    | 'Executive Visit'
    | 'Legal Notice';
  outcome:
    | 'Payment Promised'
    | 'Part Payment Released'
    | 'Dispute Raised'
    | 'No Response'
    | 'Cleared';
  notes?: string;
  loggedByUid: string;
  loggedByName: string;
  loggedByRole: UserRole;
  createdAt: string;
  updatedAt: string;
  dataOrigin?: DataRecordOrigin;
}

// ============================================================================
// 2. RESULT ENVELOPES, QUERY FILTERS & PAGINATION TYPES
// ============================================================================

export type FirestoreServiceErrorCode =
  | 'VALIDATION_ERROR'
  | 'DEMO_DATA_REJECTED'
  | 'SECRET_DETECTED'
  | 'UNAUTHENTICATED'
  | 'ACCOUNT_INACTIVE'
  | 'PERMISSION_DENIED'
  | 'ALREADY_EXISTS'
  | 'NOT_FOUND'
  | 'IMMUTABLE_DOCUMENT'
  | 'DELETION_FORBIDDEN_IMMUTABLE_COLLECTION'
  | 'DELETION_REQUIRES_SUPER_ADMIN'
  | 'INSUFFICIENT_RAW_MATERIAL_STOCK'
  | 'INVALID_QUANTITY'
  | 'DISPATCH_EXCEEDS_ORDER_BALANCE'
  | 'PO_RECEIPT_EXCEEDS_ORDERED_QTY'
  | 'TRANSACTION_CONFLICT_EXHAUSTED'
  | 'FIRESTORE_OPERATION_FAILED';

export interface FirestoreOperationResult<T> {
  success: boolean;
  status: 'ok' | 'empty' | 'not_found' | 'error';
  code: string;
  message: string;
  data: T | null;
  errorInfo?: FirestoreErrorInfo;
}

export interface FirestoreListResult<T> {
  success: boolean;
  status: 'ok' | 'empty' | 'error';
  code: string;
  message: string;
  items: T[];
  data?: T[];
  count: number;
  nextPageCursor: string | null;
  hasMore: boolean;
  errorInfo?: FirestoreErrorInfo;
}

export type FirestoreFilterOperator =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'array-contains';

export interface FirestoreQueryFilter {
  field: string;
  op: FirestoreFilterOperator;
  value: unknown;
}

export interface FirestoreListOptions {
  filters?: FirestoreQueryFilter[];
  orderByField?: string;
  orderDirection?: 'asc' | 'desc';
  pageSize?: number;
  cursorDocId?: string;
}

// ============================================================================
// 3. SECRET REDACTION, DEMO ISOLATION & SCHEMA VALIDATION HELPERS
// ============================================================================

const FORBIDDEN_SECRET_KEY_REGEX =
  /^(password|plaintextpassword|pass|token|idtoken|refreshtoken|accesstoken|secret|privatekey|private_key|client_secret|apikey|api_key|oobcode|resetlink)$/i;

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidFirestoreDocId(id: unknown): id is string {
  return typeof id === 'string' && VALID_ID_REGEX.test(id);
}

/**
 * Ensures no plaintext passwords, tokens, private keys, or reset links are stored in business or audit documents.
 */
export function assertNoSecretsInPayload(payload: unknown): {
  valid: boolean;
  reason?: string;
} {
  if (!payload || typeof payload !== 'object') {
    return { valid: true };
  }
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const curr = stack.pop();
    if (!curr || typeof curr !== 'object') continue;
    for (const [k, v] of Object.entries(curr as Record<string, unknown>)) {
      if (FORBIDDEN_SECRET_KEY_REGEX.test(k)) {
        return {
          valid: false,
          reason: `Security policy violation: forbidden secret/credential field "${k}" cannot be stored in Firestore documents.`,
        };
      }
      if (typeof v === 'string') {
        if (
          /^Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/i.test(v) ||
          /-----BEGIN (RSA )?PRIVATE KEY-----/.test(v)
        ) {
          return {
            valid: false,
            reason: `Security policy violation: field "${k}" contains a raw token or private key.`,
          };
        }
      } else if (v && typeof v === 'object') {
        stack.push(v);
      }
    }
  }
  return { valid: true };
}

/**
 * Recursively strips any sensitive keys from an audit or diagnostic object.
 */
export function sanitizeAuditMetadata<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (/^Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/i.test(value)) {
      return '[REDACTED_TOKEN]' as unknown as T;
    }
    if (/-----BEGIN (RSA )?PRIVATE KEY-----/.test(value)) {
      return '[REDACTED_PRIVATE_KEY]' as unknown as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditMetadata(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_SECRET_KEY_REGEX.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeAuditMetadata(v);
      }
    }
    return out as T;
  }
  return value;
}

/**
 * Prevents `CONSISTENT_DEMO_SANDBOX_FIXTURES` or any record tagged `dataOrigin: 'demo_sandbox'`
 * from being written into production Firestore collections.
 */
export function assertNotDemoSandboxData(payload: Record<string, any>): {
  valid: boolean;
  reason?: string;
} {
  if (payload?.dataOrigin === 'demo_sandbox') {
    return {
      valid: false,
      reason:
        'Clean-production isolation policy: records tagged with dataOrigin="demo_sandbox" cannot be written to production Firestore collections.',
    };
  }
  return { valid: true };
}

/**
 * Computes raw material status in accordance with `firestore.rules` (`'Healthy' | 'Low Stock' | 'Critical'`).
 */
export function computeFirestoreRawMaterialStatus(
  availableMT: number,
  reorderLevelMT: number
): 'Healthy' | 'Low Stock' | 'Critical' {
  const avail = Number(availableMT.toFixed(3));
  const reorder = Number(reorderLevelMT.toFixed(3));
  if (avail <= 0 || avail < reorder * 0.5) {
    return 'Critical';
  }
  if (avail < reorder) {
    return 'Low Stock';
  }
  return 'Healthy';
}

// ============================================================================
// 4. ROLE-BASED COLLECTION & FIELD AUTHORIZATION MATRIX (MIRRORS firestore.rules)
// ============================================================================

const COLLECTION_READ_ROLES: Readonly<
  Record<FirestoreCollectionName, readonly UserRole[]>
> = {
  users: ['super_admin', 'ceo'],
  systemConfig: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  customers: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  products: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  salesOrders: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  dispatches: ['super_admin', 'ceo', 'sales', 'dispatch', 'finance', 'stores'],
  rawMaterials: [
    'super_admin',
    'ceo',
    'stores',
    'purchase',
    'quality',
    'sales',
    'finance',
  ],
  stockMovements: [
    'super_admin',
    'ceo',
    'stores',
    'purchase',
    'finance',
    'quality',
  ],
  qualityInspections: [
    'super_admin',
    'ceo',
    'quality',
    'stores',
    'sales',
    'dispatch',
  ],
  outstandingPayments: ['super_admin', 'ceo', 'finance', 'sales'],
  actionQueue: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  auditLogs: ['super_admin', 'ceo'],
  quotations: ['super_admin', 'ceo', 'sales', 'finance'],
  tenders: ['super_admin', 'ceo', 'sales', 'finance'],
  suppliers: [
    'super_admin',
    'ceo',
    'purchase',
    'stores',
    'quality',
    'finance',
  ],
  purchaseOrders: ['super_admin', 'ceo', 'purchase', 'stores', 'finance'],
  machineLogs: ['super_admin', 'ceo', 'stores', 'quality', 'sales'],
  furnaceLogs: ['super_admin', 'ceo', 'stores', 'quality'],
  maintenanceTickets: ['super_admin', 'ceo', 'stores', 'quality'],
  powerLogs: ['super_admin', 'ceo', 'stores', 'finance'],
  dimensionalReports: [
    'super_admin',
    'ceo',
    'quality',
    'sales',
    'stores',
    'dispatch',
  ],
  jobCostSheets: ['super_admin', 'ceo', 'finance'],
  tasks: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  handovers: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  purchaseRequisitions: [
    'super_admin',
    'ceo',
    'purchase',
    'stores',
    'sales',
    'finance',
  ],
  ncrCapaRecords: [
    'super_admin',
    'ceo',
    'quality',
    'stores',
    'sales',
    'purchase',
    'dispatch',
    'finance',
  ],
  paymentFollowUps: ['super_admin', 'ceo', 'finance', 'sales'],
};

const COLLECTION_CREATE_ROLES: Readonly<
  Record<FirestoreCollectionName, readonly UserRole[]>
> = {
  users: ['super_admin', 'ceo'],
  systemConfig: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  customers: ['super_admin', 'ceo', 'sales', 'finance'],
  products: ['super_admin', 'ceo', 'sales', 'quality'],
  salesOrders: ['super_admin', 'ceo', 'sales'],
  dispatches: ['super_admin', 'ceo', 'dispatch'],
  rawMaterials: ['super_admin', 'ceo', 'stores'],
  stockMovements: ['super_admin', 'ceo', 'stores'],
  qualityInspections: ['super_admin', 'ceo', 'quality'],
  outstandingPayments: ['super_admin', 'ceo', 'finance'],
  actionQueue: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  auditLogs: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  quotations: ['super_admin', 'ceo', 'sales'],
  tenders: ['super_admin', 'ceo', 'sales'],
  suppliers: ['super_admin', 'ceo', 'purchase'],
  purchaseOrders: ['super_admin', 'ceo', 'purchase'],
  machineLogs: ['super_admin', 'ceo', 'stores'],
  furnaceLogs: ['super_admin', 'ceo', 'stores', 'quality'],
  maintenanceTickets: ['super_admin', 'ceo', 'stores'],
  powerLogs: ['super_admin', 'ceo', 'stores'],
  dimensionalReports: ['super_admin', 'ceo', 'quality'],
  jobCostSheets: ['super_admin', 'ceo', 'finance'],
  tasks: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  handovers: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  purchaseRequisitions: ['super_admin', 'ceo', 'purchase', 'stores'],
  ncrCapaRecords: ['super_admin', 'ceo', 'quality', 'stores'],
  paymentFollowUps: ['super_admin', 'ceo', 'finance', 'sales'],
};

const COLLECTION_UPDATE_ROLES: Readonly<
  Record<FirestoreCollectionName, readonly UserRole[]>
> = {
  users: ['super_admin', 'ceo'],
  systemConfig: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  customers: ['super_admin', 'ceo', 'sales', 'finance'],
  products: ['super_admin', 'ceo', 'sales', 'quality'],
  salesOrders: ['super_admin', 'ceo', 'sales', 'purchase', 'stores', 'quality', 'dispatch', 'finance'],
  dispatches: ['super_admin', 'ceo', 'dispatch'],
  rawMaterials: ['super_admin', 'ceo', 'stores'],
  stockMovements: [], // Immutable ledger
  qualityInspections: ['super_admin', 'ceo', 'quality'],
  outstandingPayments: ['super_admin', 'ceo', 'finance'],
  actionQueue: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  auditLogs: [], // Immutable append-only audit log
  quotations: ['super_admin', 'ceo', 'sales'],
  tenders: ['super_admin', 'ceo', 'sales'],
  suppliers: ['super_admin', 'ceo', 'purchase'],
  purchaseOrders: ['super_admin', 'ceo', 'purchase', 'stores'],
  machineLogs: ['super_admin', 'ceo', 'stores'],
  furnaceLogs: ['super_admin', 'ceo', 'stores', 'quality'],
  maintenanceTickets: ['super_admin', 'ceo', 'stores'],
  powerLogs: ['super_admin', 'ceo', 'stores'],
  dimensionalReports: ['super_admin', 'ceo', 'quality'],
  jobCostSheets: ['super_admin', 'ceo', 'finance'],
  tasks: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  handovers: [
    'super_admin',
    'ceo',
    'sales',
    'stores',
    'purchase',
    'quality',
    'dispatch',
    'finance',
  ],
  purchaseRequisitions: ['super_admin', 'ceo', 'purchase', 'stores'],
  ncrCapaRecords: ['super_admin', 'ceo', 'quality', 'stores'],
  paymentFollowUps: ['super_admin', 'ceo', 'finance', 'sales'],
};

/**
 * Role-specific allowed update fields on `/salesOrders/{orderId}` per `firestore.rules` (lines 851-866).
 */
export const SALES_ORDER_ROLE_ALLOWED_UPDATE_FIELDS: Readonly<
   Partial<Record<UserRole, readonly string[]>>
> = {
  stores: [
    'currentStage',
    'overallStatus',
    'delayDays',
    'delayReason',
    'heatNo',
    'stages',
    'updatedAt',
  ],
  quality: ['currentStage', 'overallStatus', 'mtcStatus', 'stages', 'updatedAt'],
  dispatch: [
    'currentStage',
    'overallStatus',
    'dispatchStatus',
    'stages',
    'updatedAt',
  ],
  finance: [
    'currentStage',
    'overallStatus',
    'invoiceNo',
    'paymentStatus',
    'stages',
    'updatedAt',
  ],
};

/**
 * Validates required fields and value invariants before writing a document to Firestore.
 * Note: This pre-flight validation complements (and never replaces) `firestore.rules`.
 */
export function validateFirestoreDocumentPayload(
  collectionName: FirestoreCollectionName,
  docId: string,
  payload: Record<string, any>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isValidFirestoreDocId(docId)) {
    errors.push(
      `Invalid document ID "${String(docId)}". Must be 1-128 alphanumeric, underscore, or hyphen characters.`
    );
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['Payload must be a non-null JSON object.'] };
  }

  const secretCheck = assertNoSecretsInPayload(payload);
  if (!secretCheck.valid && secretCheck.reason) {
    errors.push(secretCheck.reason);
  }

  const demoCheck = assertNotDemoSandboxData(payload);
  if (!demoCheck.valid && demoCheck.reason) {
    errors.push(demoCheck.reason);
  }

  const pkField = COLLECTION_PRIMARY_KEY_FIELD[collectionName];
  if (pkField && payload[pkField] !== undefined && payload[pkField] !== docId) {
    errors.push(
      `Primary key mismatch on ${collectionName}/${docId}: field "${pkField}" (${payload[pkField]}) must equal document ID "${docId}".`
    );
  }

  switch (collectionName) {
    case 'users': {
      if (!isCanonicalUserRole(payload.role)) {
        errors.push(`Invalid user role "${payload.role}".`);
      }
      if (!payload.email || typeof payload.email !== 'string') {
        errors.push('User email is required.');
      }
      if (!payload.displayName || typeof payload.displayName !== 'string') {
        errors.push('User displayName is required.');
      }
      break;
    }
    case 'systemConfig': {
      const validIds = [
        'dashboardKpis',
        'productionSummary',
        'alertThresholds',
        'connection_probe',
      ];
      if (!validIds.includes(docId)) {
        errors.push(`Invalid systemConfig ID "${docId}".`);
      }
      if (payload.configType !== docId) {
        errors.push(`systemConfig.configType must equal "${docId}".`);
      }
      break;
    }
    case 'customers': {
      if (!payload.name || typeof payload.name !== 'string') {
        errors.push('Customer name is required.');
      }
      if (typeof payload.creditLimit !== 'number' || payload.creditLimit < 0) {
        errors.push('Customer creditLimit must be a non-negative number.');
      }
      break;
    }
    case 'products': {
      if (!payload.name || typeof payload.name !== 'string') {
        errors.push('Product name is required.');
      }
      if (
        typeof payload.standardWeightKg !== 'number' ||
        payload.standardWeightKg <= 0
      ) {
        errors.push('Product standardWeightKg must be > 0.');
      }
      if (typeof payload.unitPrice !== 'number' || payload.unitPrice < 0) {
        errors.push('Product unitPrice must be >= 0.');
      }
      break;
    }
    case 'salesOrders': {
      if (!payload.customerName || !payload.productName || !payload.steelGrade) {
        errors.push(
          'salesOrders requires customerName, productName, and steelGrade.'
        );
      }
      if (typeof payload.quantityMT !== 'number' || payload.quantityMT <= 0) {
        errors.push('salesOrders.quantityMT must be > 0.');
      }
      if (
        typeof payload.totalValueINR !== 'number' ||
        payload.totalValueINR < 0
      ) {
        errors.push('salesOrders.totalValueINR must be >= 0.');
      }
      break;
    }
    case 'rawMaterials': {
      if (!payload.steelGrade || typeof payload.steelGrade !== 'string') {
        errors.push('rawMaterials.steelGrade is required.');
      }
      if (typeof payload.availableMT !== 'number' || payload.availableMT < 0) {
        errors.push('rawMaterials.availableMT must be >= 0.');
      }
      if (
        payload.allocatedMT !== undefined &&
        (typeof payload.allocatedMT !== 'number' || payload.allocatedMT < 0)
      ) {
        errors.push('rawMaterials.allocatedMT must be >= 0.');
      }
      if (
        typeof payload.reorderLevelMT !== 'number' ||
        payload.reorderLevelMT < 0
      ) {
        errors.push('rawMaterials.reorderLevelMT must be >= 0.');
      }
      break;
    }
    case 'stockMovements': {
      if (!payload.gradeId || !payload.steelGrade) {
        errors.push('stockMovements requires gradeId and steelGrade.');
      }
      if (
        !['INWARD', 'ISSUE', 'RETURN', 'ADJUSTMENT'].includes(payload.type)
      ) {
        errors.push(`Invalid stockMovement type "${payload.type}".`);
      }
      if (
        typeof payload.quantityTons !== 'number' ||
        payload.quantityTons <= 0
      ) {
        errors.push('stockMovements.quantityTons must be > 0.');
      }
      if (
        payload.balanceAfterMT !== undefined &&
        (typeof payload.balanceAfterMT !== 'number' ||
          payload.balanceAfterMT < 0)
      ) {
        errors.push('stockMovements.balanceAfterMT cannot be negative.');
      }
      break;
    }
    case 'purchaseOrders': {
      if (!payload.poNumber || !payload.supplierName || !payload.steelGrade) {
        errors.push(
          'purchaseOrders requires poNumber, supplierName, and steelGrade.'
        );
      }
      if (typeof payload.orderedMT !== 'number' || payload.orderedMT <= 0) {
        errors.push('purchaseOrders.orderedMT must be > 0.');
      }
      if (
        payload.receivedMT !== undefined &&
        (typeof payload.receivedMT !== 'number' || payload.receivedMT < 0)
      ) {
        errors.push('purchaseOrders.receivedMT must be >= 0.');
      }
      break;
    }
    case 'dispatches': {
      if (!payload.orderId || !payload.customerName) {
        errors.push('dispatches requires orderId and customerName.');
      }
      if (
        typeof payload.quantityTons !== 'number' ||
        payload.quantityTons <= 0
      ) {
        errors.push('dispatches.quantityTons must be > 0.');
      }
      break;
    }
    case 'qualityInspections': {
      if (
        typeof payload.inspectedQtyMT !== 'number' ||
        payload.inspectedQtyMT <= 0
      ) {
        errors.push('qualityInspections.inspectedQtyMT must be > 0.');
      }
      if (
        typeof payload.acceptedQtyMT !== 'number' ||
        payload.acceptedQtyMT < 0 ||
        typeof payload.rejectedQtyMT !== 'number' ||
        payload.rejectedQtyMT < 0
      ) {
        errors.push(
          'qualityInspections acceptedQtyMT and rejectedQtyMT must be >= 0.'
        );
      }
      if (
        Number((payload.acceptedQtyMT + payload.rejectedQtyMT).toFixed(3)) >
        Number(payload.inspectedQtyMT.toFixed(3))
      ) {
        errors.push(
          `acceptedQtyMT (${payload.acceptedQtyMT}) + rejectedQtyMT (${payload.rejectedQtyMT}) cannot exceed inspectedQtyMT (${payload.inspectedQtyMT}).`
        );
      }
      break;
    }
    case 'outstandingPayments': {
      if (
        typeof payload.invoiceAmountINR !== 'number' ||
        payload.invoiceAmountINR < 0 ||
        typeof payload.receivedAmountINR !== 'number' ||
        payload.receivedAmountINR < 0 ||
        typeof payload.balanceAmountINR !== 'number' ||
        payload.balanceAmountINR < 0
      ) {
        errors.push('Financial amounts in outstandingPayments must be >= 0.');
      }
      break;
    }
    case 'auditLogs': {
      if (!payload.actorUid || !payload.action || !payload.module || !payload.details) {
        errors.push(
          'auditLogs requires actorUid, actorRole, action, module, and details.'
        );
      }
      if (!isCanonicalUserRole(payload.actorRole)) {
        errors.push(`Invalid auditLogs.actorRole "${payload.actorRole}".`);
      }
      break;
    }
    case 'tasks': {
      if (!payload.title || !payload.department || !payload.assignedToUid) {
        errors.push('tasks requires title, department, and assignedToUid.');
      }
      break;
    }
    case 'handovers': {
      if (!payload.handoverCode || !payload.orderId || !payload.fromUid) {
        errors.push('handovers requires handoverCode, orderId, and fromUid.');
      }
      break;
    }
    case 'purchaseRequisitions': {
      if (!payload.prNumber || !payload.steelGrade || typeof payload.requiredMT !== 'number' || payload.requiredMT <= 0) {
        errors.push('purchaseRequisitions requires prNumber, steelGrade, and requiredMT > 0.');
      }
      break;
    }
    case 'ncrCapaRecords': {
      if (!payload.ncrNumber || !payload.orderId || typeof payload.affectedQtyMT !== 'number' || payload.affectedQtyMT <= 0) {
        errors.push('ncrCapaRecords requires ncrNumber, orderId, and affectedQtyMT > 0.');
      }
      break;
    }
    case 'paymentFollowUps': {
      if (!payload.invoiceId || !payload.customerName || !payload.followUpDate) {
        errors.push('paymentFollowUps requires invoiceId, customerName, and followUpDate.');
      }
      break;
    }
    default:
      break;
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// 5. PLUGGABLE STORAGE DRIVER INTERFACE (LIVE WEB SDK + TEST/EMULATOR HARNESS)
// ============================================================================

export interface FirestoreTransactionContext {
  getDoc<T = Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string
  ): Promise<T | null>;
  setDoc<T extends Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string,
    data: T
  ): Promise<void>;
  updateDoc<T extends Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string,
    data: Partial<T>
  ): Promise<void>;
}

export interface FirestorePersistenceDriver {
  getDoc<T = Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string
  ): Promise<T | null>;
  listDocs<T = Record<string, any>>(
    collectionName: FirestoreCollectionName,
    options?: FirestoreListOptions
  ): Promise<{ items: T[]; nextPageCursor: string | null; hasMore: boolean }>;
  createDoc<T extends Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string,
    data: T
  ): Promise<void>;
  updateDoc<T extends Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string,
    data: Partial<T>
  ): Promise<void>;
  deleteDoc(
    collectionName: FirestoreCollectionName,
    docId: string
  ): Promise<void>;
  runTransaction<R>(
    updateFunction: (tx: FirestoreTransactionContext) => Promise<R>,
    maxAttempts?: number
  ): Promise<R>;
}

export function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

export const ALLOWED_FIRESTORE_USER_PROFILE_KEYS: ReadonlySet<string> = new Set([
  'id',
  'uid',
  'name',
  'email',
  'displayName',
  'role',
  'requestedRole',
  'requestedDepartment',
  'legacyRole',
  'rbacGroup',
  'roleTitle',
  'department',
  'designation',
  'avatarInitials',
  'accountStatus',
  'status',
  'mustChangePassword',
  'invitedBy',
  'provisionedBy',
  'provisionedAt',
  'approvedByUid',
  'approvedByEmail',
  'approvedByName',
  'approvedAt',
  'rejectedByUid',
  'rejectedByEmail',
  'rejectedByName',
  'rejectedAt',
  'rejectionReason',
  'approvalHistory',
  'permissions',
  'isDepartmentHead',
  'managedDepartment',
  'reportingManagerUid',
  'createdAt',
  'updatedAt',
  'lastLogin',
  'lastLoginAt',
  'disabledAt',
  'deactivatedBy',
  'deactivationReason',
  'dataOrigin',
]);

/**
 * Default live driver wrapping the initialized Firebase Web SDK `Firestore` instance
 * (`ai-studio-montexmis-80037e3b-fbab-4539-8464-b375213a9416`).
 */
export class FirebaseWebSdkFirestoreDriver implements FirestorePersistenceDriver {
  constructor(private readonly dbInstance: Firestore = defaultFirestore) {}

  async getDoc<T = Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string
  ): Promise<T | null> {
    const snap = await getDoc(doc(this.dbInstance, collectionName, docId));
    if (!snap.exists()) return null;
    return snap.data() as T;
  }

  async listDocs<T = Record<string, any>>(
    collectionName: FirestoreCollectionName,
    options: FirestoreListOptions = {}
  ): Promise<{ items: T[]; nextPageCursor: string | null; hasMore: boolean }> {
    const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
    const constraints: QueryConstraint[] = [];

    if (options.filters) {
      for (const f of options.filters) {
        constraints.push(firestoreWhere(f.field, f.op as any, f.value));
      }
    }

    if (options.orderByField) {
      constraints.push(
        firestoreOrderBy(options.orderByField, options.orderDirection || 'asc')
      );
    }

    if (options.cursorDocId) {
      const cursorSnap = await getDoc(
        doc(this.dbInstance, collectionName, options.cursorDocId)
      );
      if (cursorSnap.exists()) {
        constraints.push(firestoreStartAfter(cursorSnap));
      }
    }

    // Request pageSize + 1 to detect whether additional pages exist without unbounded reads
    constraints.push(firestoreLimit(pageSize + 1));

    const q = query(collection(this.dbInstance, collectionName), ...constraints);
    const snap = await getDocs(q);

    const docs = snap.docs;
    const hasMore = docs.length > pageSize;
    const sliced = hasMore ? docs.slice(0, pageSize) : docs;
    const items = sliced.map((d) => d.data() as T);
    const nextPageCursor =
      hasMore && sliced.length > 0 ? sliced[sliced.length - 1].id : null;

    return { items, nextPageCursor, hasMore };
  }

  async createDoc<T extends Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string,
    data: T
  ): Promise<void> {
    const cleanData = stripUndefinedDeep(data);
    // Use a transaction to guarantee create-only semantics (never silently overwrite existing docs!)
    await runTransaction(this.dbInstance, async (tx) => {
      const docRef = doc(this.dbInstance, collectionName, docId);
      const existing = await tx.get(docRef);
      if (existing.exists()) {
        const err: any = new Error(
          `Document "${collectionName}/${docId}" already exists.`
        );
        err.code = 'already-exists';
        throw err;
      }
      tx.set(docRef, cleanData);
    });
  }

  async updateDoc<T extends Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string,
    data: Partial<T>
  ): Promise<void> {
    const cleanData = stripUndefinedDeep(data);
    await runTransaction(this.dbInstance, async (tx) => {
      const docRef = doc(this.dbInstance, collectionName, docId);
      const existing = await tx.get(docRef);
      if (!existing.exists()) {
        const err: any = new Error(
          `Document "${collectionName}/${docId}" does not exist.`
        );
        err.code = 'not-found';
        throw err;
      }
      tx.update(docRef, cleanData as Record<string, any>);
    });
  }

  async deleteDoc(
    collectionName: FirestoreCollectionName,
    docId: string
  ): Promise<void> {
    await deleteDoc(doc(this.dbInstance, collectionName, docId));
  }

  async runTransaction<R>(
    updateFunction: (tx: FirestoreTransactionContext) => Promise<R>,
    maxAttempts = 5
  ): Promise<R> {
    return runTransaction(
      this.dbInstance,
      async (firebaseTx) => {
        const txAdapter: FirestoreTransactionContext = {
          getDoc: async <T = Record<string, any>>(
            col: FirestoreCollectionName,
            id: string
          ): Promise<T | null> => {
            const snap = await firebaseTx.get(doc(this.dbInstance, col, id));
            return snap.exists() ? (snap.data() as T) : null;
          },
          setDoc: async <T extends Record<string, any>>(
            col: FirestoreCollectionName,
            id: string,
            payload: T
          ): Promise<void> => {
            firebaseTx.set(doc(this.dbInstance, col, id), stripUndefinedDeep(payload));
          },
          updateDoc: async <T extends Record<string, any>>(
            col: FirestoreCollectionName,
            id: string,
            payload: Partial<T>
          ): Promise<void> => {
            firebaseTx.update(
              doc(this.dbInstance, col, id),
              stripUndefinedDeep(payload) as Record<string, any>
            );
          },
        };
        return updateFunction(txAdapter);
      },
      { maxAttempts }
    );
  }
}

// ============================================================================
// 6. REUSABLE FIRESTORE SERVICE (`MontexFirestoreService`)
// ============================================================================

export class MontexFirestoreService {
  constructor(
    private readonly driver: FirestorePersistenceDriver = new FirebaseWebSdkFirestoreDriver(),
    private callerProvider: () => FirestoreCallerContext | null = () => {
      const current = auth.currentUser;
      if (!current) return null;
      return {
        uid: current.uid,
        email: current.email || '',
        displayName: current.displayName || undefined,
        role: 'sales',
        accountStatus: 'active',
      };
    }
  ) {}

  public setCallerContextProvider(
    provider: () => FirestoreCallerContext | null
  ): void {
    this.callerProvider = provider;
  }

  public getDatabaseMetadata() {
    return {
      projectId: FIREBASE_CONFIG_METADATA.projectId,
      firestoreDatabaseId,
      isFirestoreConfigured: FIREBASE_CONFIG_METADATA.isFirestoreConfigured,
    };
  }

  private buildErrorInfo(
    error: unknown,
    operationType: OperationType,
    path: string | null
  ): FirestoreErrorInfo {
    const caller = this.callerProvider();
    return {
      error: error instanceof Error ? error.message : String(error),
      operationType,
      path,
      authInfo: {
        userId: caller?.uid ?? auth.currentUser?.uid ?? null,
        email: caller?.email ?? auth.currentUser?.email ?? null,
        emailVerified: auth.currentUser?.emailVerified ?? true,
        isAnonymous: auth.currentUser?.isAnonymous ?? false,
        tenantId: auth.currentUser?.tenantId ?? null,
        providerInfo:
          auth.currentUser?.providerData?.map((p) => ({
            providerId: p.providerId,
            email: p.email,
          })) || [],
      },
    };
  }

  private verifyCallerAuthorization(
    collectionName: FirestoreCollectionName,
    operation: OperationType,
    docId?: string
  ): {
    allowed: boolean;
    caller?: FirestoreCallerContext;
    code?: FirestoreServiceErrorCode;
    reason?: string;
  } {
    const caller = this.callerProvider();
    if (!caller || !caller.uid) {
      return {
        allowed: false,
        code: 'UNAUTHENTICATED',
        reason: 'Authentication required to access Cloud Firestore.',
      };
    }

    if (!isAccountStatusActive(caller.accountStatus)) {
      return {
        allowed: false,
        code: 'ACCOUNT_INACTIVE',
        reason: `Access denied: caller accountStatus is "${caller.accountStatus}". Only active employee accounts can read or write Firestore documents.`,
      };
    }

    if (!isCanonicalUserRole(caller.role)) {
      return {
        allowed: false,
        code: 'PERMISSION_DENIED',
        reason: `Access denied: invalid caller role "${caller.role}".`,
      };
    }

    // Special owner read/update rule for `/users/{uid}`
    if (
      collectionName === 'users' &&
      docId &&
      (caller.uid === docId || (auth?.currentUser && auth.currentUser.uid === docId))
    ) {
      if (operation === OperationType.GET || operation === OperationType.UPDATE) {
        return { allowed: true, caller };
      }
      if (operation === OperationType.DELETE) {
        return {
          allowed: false,
          code: 'PERMISSION_DENIED',
          reason: 'Self-deletion of /users/{uid} is forbidden by Firestore Security Rules.',
        };
      }
    }

    if (operation === OperationType.GET || operation === OperationType.LIST) {
      const allowedRoles = COLLECTION_READ_ROLES[collectionName];
      if (!allowedRoles.includes(caller.role)) {
        return {
          allowed: false,
          code: 'PERMISSION_DENIED',
          reason: `Role "${caller.role}" is not permitted to read from "/${collectionName}".`,
        };
      }
      return { allowed: true, caller };
    }

    if (operation === OperationType.CREATE) {
      if (
        collectionName === 'systemConfig' &&
        docId === 'alertThresholds' &&
        caller.role !== 'super_admin' &&
        caller.role !== 'ceo'
      ) {
        return {
          allowed: false,
          code: 'PERMISSION_DENIED',
          reason: 'Only super_admin or Higher Authority (ceo) can create or modify /systemConfig/alertThresholds.',
        };
      }
      const allowedRoles = COLLECTION_CREATE_ROLES[collectionName];
      if (!allowedRoles.includes(caller.role)) {
        return {
          allowed: false,
          code: 'PERMISSION_DENIED',
          reason: `Role "${caller.role}" is not permitted to create documents in "/${collectionName}".`,
        };
      }
      return { allowed: true, caller };
    }

    if (operation === OperationType.UPDATE) {
      if (collectionName === 'stockMovements' || collectionName === 'auditLogs') {
        return {
          allowed: false,
          code: 'IMMUTABLE_DOCUMENT',
          reason: `Collection "/${collectionName}" is an immutable append-only ledger; updates are forbidden.`,
        };
      }
      if (
        collectionName === 'systemConfig' &&
        docId === 'alertThresholds' &&
        caller.role !== 'super_admin' &&
        caller.role !== 'ceo'
      ) {
        return {
          allowed: false,
          code: 'PERMISSION_DENIED',
          reason: 'Only super_admin or Higher Authority (ceo) can update /systemConfig/alertThresholds.',
        };
      }
      const allowedRoles = COLLECTION_UPDATE_ROLES[collectionName];
      if (!allowedRoles.includes(caller.role)) {
        return {
          allowed: false,
          code: 'PERMISSION_DENIED',
          reason: `Role "${caller.role}" is not permitted to update documents in "/${collectionName}".`,
        };
      }
      return { allowed: true, caller };
    }

    if (operation === OperationType.DELETE) {
      if (collectionName === 'systemConfig' || collectionName === 'auditLogs') {
        return {
          allowed: false,
          code: 'DELETION_FORBIDDEN_IMMUTABLE_COLLECTION',
          reason: `Deletion from "/${collectionName}" is strictly forbidden by Firestore Security Rules.`,
        };
      }
      if (collectionName === 'users' && caller.role !== 'super_admin') {
        return {
          allowed: false,
          code: 'DELETION_REQUIRES_SUPER_ADMIN',
          reason: 'Only super_admin is permitted to delete user profile documents from "/users".',
        };
      }
      if (caller.role !== 'super_admin' && caller.role !== 'ceo') {
        return {
          allowed: false,
          code: 'DELETION_REQUIRES_SUPER_ADMIN',
          reason: `Only super_admin or Higher Authority (ceo) is permitted to delete documents from "/${collectionName}".`,
        };
      }
      return { allowed: true, caller };
    }

    return { allowed: true, caller };
  }

  // --------------------------------------------------------------------------
  // 6.1 Core Validated CRUD & Paginated Query Operations
  // --------------------------------------------------------------------------

  async getUserProfile<T = Record<string, any>>(
    uid: string
  ): Promise<FirestoreOperationResult<T>> {
    // If the currently signed-in Firebase Auth user is querying their own /users/{uid}
    // before callerProvider has synced, query the driver directly with full validation.
    if (auth?.currentUser && auth.currentUser.uid === uid && isValidFirestoreDocId(uid)) {
      const path = `users/${uid}`;
      try {
        const docData = await this.driver.getDoc<T>('users', uid);
        if (!docData) {
          return {
            success: true,
            status: 'not_found',
            code: 'NOT_FOUND',
            message: `No document found at ${path}.`,
            data: null,
          };
        }
        return {
          success: true,
          status: 'ok',
          code: 'OK',
          message: `Fetched ${path}.`,
          data: docData,
        };
      } catch (error: any) {
        const errCode = String(error?.code || '');
        const isPermDenied =
          errCode.includes('permission-denied') ||
          String(error?.message || '').includes('Missing or insufficient permissions');
        const errInfo = this.buildErrorInfo(error, OperationType.GET, path);
        return {
          success: false,
          status: 'error',
          code: isPermDenied ? 'PERMISSION_DENIED' : 'FIRESTORE_OPERATION_FAILED',
          message: errInfo.error,
          data: null,
          errorInfo: errInfo,
        };
      }
    }
    return this.getDocumentById<T>('users', uid);
  }

  /**
   * Bridges an existing authenticated RTDB employee profile into `/users/{uid}` in Cloud Firestore
   * if `/users/{uid}` is missing (e.g., for the verified bootstrap owner or previously provisioned RTDB user).
   * Never promotes an account or modifies its role/status; strictly mirrors the verified RTDB profile.
   */
  async syncOwnActiveProfileToFirestore(profile: {
    id?: string;
    uid?: string;
    name?: string;
    displayName?: string;
    email: string;
    role: UserRole;
    rbacGroup?: string;
    roleTitle?: string;
    department: string;
    avatarInitials?: string;
    accountStatus: AccountStatus;
    createdAt?: string;
  }): Promise<boolean> {
    const uid = profile.uid || profile.id || auth?.currentUser?.uid || '';
    if (!uid || !isValidFirestoreDocId(uid) || !isAccountStatusActive(profile.accountStatus)) {
      return false;
    }
    try {
      const existing = await this.driver.getDoc('users', uid).catch(() => null);
      if (
        existing &&
        (existing as any).accountStatus === 'active' &&
        (existing as any).role === profile.role
      ) {
        return true;
      }
      const nowIso = new Date().toISOString();
      const rawName = String(profile.displayName || profile.name || 'Employee').trim();
      const safeName = (rawName.length >= 2 ? rawName : 'Employee').slice(0, 120);
      const rawDept = String(profile.department || 'Operations').trim();
      const safeDept = (rawDept.length >= 2 ? rawDept : 'Operations').slice(0, 80);
      const docPayload: Record<string, any> = {
        uid,
        id: uid,
        email: String(profile.email || auth?.currentUser?.email || 'employee@montexforge.com')
          .trim()
          .toLowerCase()
          .slice(0, 160),
        displayName: safeName,
        name: safeName,
        role: profile.role,
        legacyRole: profile.role,
        department: safeDept,
        accountStatus: 'active',
        status: 'Active',
        createdAt:
          (existing as any)?.createdAt && String((existing as any).createdAt).length >= 4
            ? (existing as any).createdAt
            : profile.createdAt && String(profile.createdAt).length >= 4
            ? profile.createdAt
            : nowIso,
        updatedAt: nowIso,
        dataOrigin: 'production',
      };
      if (profile.rbacGroup) docPayload.rbacGroup = profile.rbacGroup;
      if (profile.roleTitle && profile.roleTitle.trim().length >= 2) {
        docPayload.roleTitle = profile.roleTitle.trim().slice(0, 100);
      }
      if (profile.avatarInitials) {
        docPayload.avatarInitials = profile.avatarInitials.slice(0, 8);
      }
      if (existing) {
        await this.driver.updateDoc('users', uid, docPayload);
      } else {
        await this.driver.createDoc('users', uid, docPayload);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Persists a self-registered or updated pending access request to `/users/{uid}` in Cloud Firestore.
   * Strictly enforces `accountStatus: 'pending_approval'` and prevents self-assigning `super_admin` or `ceo`.
   */
  async upsertSelfPendingAccessRequestToFirestore(
    docPayload: Record<string, any>
  ): Promise<FirestoreOperationResult<Record<string, any>>> {
    const uid = String(docPayload.uid || docPayload.id || auth?.currentUser?.uid || '').trim();
    if (!uid || !isValidFirestoreDocId(uid)) {
      return {
        success: false,
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: 'Valid authenticated Firebase UID is required.',
        data: null,
      };
    }

    if (auth?.currentUser && auth.currentUser.uid !== uid) {
      return {
        success: false,
        status: 'error',
        code: 'PERMISSION_DENIED',
        message: 'You can only submit or update an access request for your own authenticated UID.',
        data: null,
      };
    }

    const requestedRole = isCanonicalUserRole(docPayload.requestedRole)
      ? docPayload.requestedRole
      : isCanonicalUserRole(docPayload.role)
      ? docPayload.role
      : 'sales';

    if (requestedRole === 'super_admin' || requestedRole === 'ceo') {
      return {
        success: false,
        status: 'error',
        code: 'PERMISSION_DENIED',
        message: 'Self-service access requests cannot request super_admin or ceo roles.',
        data: null,
      };
    }

    const nowIso = new Date().toISOString();
    const rawSafePayload: Record<string, any> = stripUndefinedDeep({
      ...docPayload,
      uid,
      id: uid,
      email: String(docPayload.email || auth?.currentUser?.email || '').trim().toLowerCase(),
      displayName: String(docPayload.displayName || docPayload.name || 'Employee').trim(),
      name: String(docPayload.name || docPayload.displayName || 'Employee').trim(),
      role: requestedRole,
      requestedRole,
      department: String(docPayload.department || docPayload.requestedDepartment || 'Sales').trim(),
      requestedDepartment: String(docPayload.requestedDepartment || docPayload.department || 'Sales').trim(),
      accountStatus: 'pending_approval',
      permissions: [],
      isDepartmentHead: false,
      createdAt: docPayload.createdAt || nowIso,
      updatedAt: nowIso,
      dataOrigin: 'production',
    });

    const safePayload: Record<string, any> = {};
    for (const [k, v] of Object.entries(rawSafePayload)) {
      if (ALLOWED_FIRESTORE_USER_PROFILE_KEYS.has(k) && v !== undefined) {
        safePayload[k] = v;
      }
    }

    const validation = validateFirestoreDocumentPayload('users', uid, safePayload);
    if (!validation.valid) {
      return {
        success: false,
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: validation.errors.join(' '),
        data: null,
      };
    }

    try {
      const existing = await this.driver.getDoc('users', uid).catch(() => null);
      if (existing) {
        const existingStatus = String((existing as any).accountStatus || '');
        if (
          existingStatus === 'rejected' ||
          existingStatus === 'deactivated' ||
          existingStatus === 'active'
        ) {
          return {
            success: false,
            status: 'error',
            code: 'PERMISSION_DENIED',
            message: `Cannot self-update access request when accountStatus is "${existingStatus}". Only an active administrator can reconsider or modify this account.`,
            data: null,
          };
        }
        const rawMerged = stripUndefinedDeep({
          ...existing,
          ...safePayload,
          uid,
          id: uid,
          email: (existing as any).email || safePayload.email,
          createdAt: (existing as any).createdAt || safePayload.createdAt,
          accountStatus: 'pending_approval',
          updatedAt: nowIso,
        });
        const merged: Record<string, any> = {};
        for (const [k, v] of Object.entries(rawMerged)) {
          if (ALLOWED_FIRESTORE_USER_PROFILE_KEYS.has(k) && v !== undefined) {
            merged[k] = v;
          }
        }
        await this.driver.updateDoc('users', uid, merged);
      } else {
        await this.driver.createDoc('users', uid, safePayload);
      }

      const verifiedDoc = await this.driver.getDoc('users', uid).catch(() => null);
      if (!verifiedDoc) {
        return {
          success: false,
          status: 'error',
          code: 'FIRESTORE_OPERATION_FAILED',
          message: `Write verification failed: /users/${uid} could not be read back after write.`,
          data: null,
        };
      }

      return {
        success: true,
        status: 'ok',
        code: existing ? 'UPDATED' : 'CREATED',
        message: `Persisted pending access request for ${safePayload.email} in /users/${uid}.`,
        data: verifiedDoc,
      };
    } catch (error: any) {
      const errInfo = this.buildErrorInfo(error, OperationType.WRITE, `users/${uid}`);
      return {
        success: false,
        status: 'error',
        code: 'FIRESTORE_OPERATION_FAILED',
        message: errInfo.error,
        data: null,
        errorInfo: errInfo,
      };
    }
  }

  /**
   * Admin / Higher Authority Employee Profile Upsert in `/users/{uid}`:
   * - Requires active `super_admin` or `ceo` caller.
   * - Prevents self-approval, prevents `ceo` from modifying or assigning `super_admin` or `ceo`.
   * - Validates schema, guards against duplicate audit events on retry, and verifies read-back.
   */
  async adminUpsertEmployeeProfileToFirestore(
    targetUid: string,
    docPayload: Record<string, any>,
    options?: {
      auditAction?: string;
      auditDetails?: string;
    }
  ): Promise<FirestoreOperationResult<Record<string, any>>> {
    const caller = this.callerProvider();
    if (!caller || !caller.uid) {
      return {
        success: false,
        status: 'error',
        code: 'UNAUTHENTICATED',
        message: 'Authentication required to manage employee profiles.',
        data: null,
      };
    }
    if (!isAccountStatusActive(caller.accountStatus)) {
      return {
        success: false,
        status: 'error',
        code: 'ACCOUNT_INACTIVE',
        message: `Caller account status "${caller.accountStatus}" is not active.`,
        data: null,
      };
    }
    if (caller.role !== 'super_admin' && caller.role !== 'ceo') {
      return {
        success: false,
        status: 'error',
        code: 'PERMISSION_DENIED',
        message: `Role "${caller.role}" is not authorized to approve, reject, or modify employee accounts.`,
        data: null,
      };
    }
    if (
      caller.role === 'ceo' &&
      (docPayload.role === 'super_admin' || docPayload.role === 'ceo')
    ) {
      return {
        success: false,
        status: 'error',
        code: 'PERMISSION_DENIED',
        message: 'Higher Authority (ceo) cannot assign or modify super_admin or ceo accounts.',
        data: null,
      };
    }

    const nowIso = new Date().toISOString();
    const rawNormalized: Record<string, any> = stripUndefinedDeep({
      ...docPayload,
      uid: targetUid,
      id: targetUid,
      createdAt:
        typeof docPayload.createdAt === 'string' && docPayload.createdAt.length >= 4
          ? docPayload.createdAt
          : nowIso,
      updatedAt: nowIso,
      dataOrigin: 'production',
    });
    const normalizedPayload: Record<string, any> = {};
    for (const [k, v] of Object.entries(rawNormalized)) {
      if (ALLOWED_FIRESTORE_USER_PROFILE_KEYS.has(k) && v !== undefined) {
        normalizedPayload[k] = v;
      }
    }

    const validation = validateFirestoreDocumentPayload('users', targetUid, normalizedPayload);
    if (!validation.valid) {
      return {
        success: false,
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: validation.errors.join(' '),
        data: null,
      };
    }

    try {
      const existing = await this.driver.getDoc('users', targetUid).catch(() => null);
      if (
        existing &&
        caller.role === 'ceo' &&
        ((existing as any).role === 'super_admin' ||
          (existing as any).role === 'ceo' ||
          (existing as any).legacyRole === 'super_admin' ||
          (existing as any).legacyRole === 'ceo')
      ) {
        return {
          success: false,
          status: 'error',
          code: 'PERMISSION_DENIED',
          message: 'Higher Authority (ceo) cannot modify a super_admin or ceo profile.',
          data: null,
        };
      }
      if (
        caller.uid === targetUid &&
        existing &&
        (existing as any).accountStatus !== 'active' &&
        normalizedPayload.accountStatus === 'active'
      ) {
        return {
          success: false,
          status: 'error',
          code: 'PERMISSION_DENIED',
          message: 'Security policy violation: Self-approval of a non-active account is forbidden.',
          data: null,
        };
      }

      const alreadyInTargetState = Boolean(
        existing &&
          (existing as any).accountStatus === normalizedPayload.accountStatus &&
          (existing as any).role === normalizedPayload.role &&
          (existing as any).department === normalizedPayload.department
      );

      if (existing) {
        const rawMerged = stripUndefinedDeep({
          ...existing,
          ...normalizedPayload,
          uid: targetUid,
          id: targetUid,
          createdAt:
            typeof (existing as any).createdAt === 'string' &&
            (existing as any).createdAt.length >= 4
              ? (existing as any).createdAt
              : normalizedPayload.createdAt,
          updatedAt: nowIso,
        });
        const merged: Record<string, any> = {};
        for (const [k, v] of Object.entries(rawMerged)) {
          if (ALLOWED_FIRESTORE_USER_PROFILE_KEYS.has(k) && v !== undefined) {
            merged[k] = v;
          }
        }
        // Sanitize any legacy fields inherited from `existing` so `isValidUserProfile` in firestore.rules always succeeds
        if (merged.requestedRole !== undefined && !isCanonicalUserRole(merged.requestedRole)) {
          merged.requestedRole = merged.role;
        }
        if (merged.legacyRole !== undefined && !isCanonicalUserRole(merged.legacyRole)) {
          merged.legacyRole = merged.role;
        }
        if (
          merged.designation !== undefined &&
          (typeof merged.designation !== 'string' || merged.designation.trim().length < 2)
        ) {
          merged.designation = String(merged.roleTitle || merged.role).slice(0, 100);
        }
        if (
          merged.roleTitle !== undefined &&
          (typeof merged.roleTitle !== 'string' || merged.roleTitle.trim().length < 2)
        ) {
          merged.roleTitle = String(merged.designation || merged.role).slice(0, 100);
        }
        if (
          merged.managedDepartment !== undefined &&
          (typeof merged.managedDepartment !== 'string' ||
            merged.managedDepartment.trim().length === 0 ||
            !merged.isDepartmentHead)
        ) {
          delete merged.managedDepartment;
        }
        if (
          merged.reportingManagerUid !== undefined &&
          (typeof merged.reportingManagerUid !== 'string' ||
            merged.reportingManagerUid.trim().length === 0)
        ) {
          delete merged.reportingManagerUid;
        }
        if (
          merged.status !== undefined &&
          !['Active', 'Inactive', 'Pending', 'Rejected'].includes(merged.status)
        ) {
          merged.status =
            merged.accountStatus === 'active'
              ? 'Active'
              : merged.accountStatus === 'rejected'
              ? 'Rejected'
              : merged.accountStatus === 'pending_approval' ||
                merged.accountStatus === 'pending_invitation'
              ? 'Pending'
              : 'Inactive';
        }
        if (Array.isArray(merged.approvalHistory)) {
          merged.approvalHistory = merged.approvalHistory.slice(-50);
        }
        await this.driver.updateDoc('users', targetUid, merged);
      } else {
        await this.driver.createDoc('users', targetUid, normalizedPayload);
      }

      if (options?.auditAction && !alreadyInTargetState) {
        await this.appendAuditLogEntry({
          action: options.auditAction,
          module: 'users',
          documentId: targetUid,
          details: options.auditDetails || `Updated employee profile /users/${targetUid}`,
        }).catch(() => {});
      }

      const verifiedDoc = await this.driver.getDoc('users', targetUid).catch(() => null);
      if (
        !verifiedDoc ||
        (verifiedDoc as any).accountStatus !== normalizedPayload.accountStatus ||
        (verifiedDoc as any).role !== normalizedPayload.role
      ) {
        return {
          success: false,
          status: 'error',
          code: 'FIRESTORE_OPERATION_FAILED',
          message: `Read-back verification failed for /users/${targetUid}: expected status="${normalizedPayload.accountStatus}" and role="${normalizedPayload.role}".`,
          data: null,
        };
      }

      return {
        success: true,
        status: 'ok',
        code: existing ? 'UPDATED' : 'CREATED',
        message: `Persisted employee profile /users/${targetUid}.`,
        data: verifiedDoc,
      };
    } catch (error: any) {
      const errCode = String(error?.code || '');
      const isPermDenied =
        errCode.includes('permission-denied') ||
        String(error?.message || '').includes('Missing or insufficient permissions');
      const errInfo = this.buildErrorInfo(error, OperationType.WRITE, `users/${targetUid}`);
      return {
        success: false,
        status: 'error',
        code: isPermDenied ? 'PERMISSION_DENIED' : 'FIRESTORE_OPERATION_FAILED',
        message: errInfo.error,
        data: null,
        errorInfo: errInfo,
      };
    }
  }

  async getDocumentById<T = Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string
  ): Promise<FirestoreOperationResult<T>> {
    const path = `${collectionName}/${docId}`;
    if (!isValidFirestoreDocId(docId)) {
      return {
        success: false,
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: `Invalid document ID "${docId}".`,
        data: null,
      };
    }

    const authCheck = this.verifyCallerAuthorization(
      collectionName,
      OperationType.GET,
      docId
    );
    if (!authCheck.allowed) {
      const errInfo = this.buildErrorInfo(
        new Error(authCheck.reason),
        OperationType.GET,
        path
      );
      return {
        success: false,
        status: 'error',
        code: authCheck.code || 'PERMISSION_DENIED',
        message: authCheck.reason || 'Permission denied.',
        data: null,
        errorInfo: errInfo,
      };
    }

    try {
      const docData = await this.driver.getDoc<T>(collectionName, docId);
      if (!docData) {
        return {
          success: true,
          status: 'not_found',
          code: 'NOT_FOUND',
          message: `No document found at ${path}.`,
          data: null,
        };
      }
      return {
        success: true,
        status: 'ok',
        code: 'OK',
        message: `Fetched ${path}.`,
        data: docData,
      };
    } catch (error: any) {
      const errCode = String(error?.code || '');
      const isPermDenied =
        errCode.includes('permission-denied') ||
        String(error?.message || '').includes('Missing or insufficient permissions');
      const errInfo = this.buildErrorInfo(error, OperationType.GET, path);
      return {
        success: false,
        status: 'error',
        code: isPermDenied ? 'PERMISSION_DENIED' : 'FIRESTORE_OPERATION_FAILED',
        message: errInfo.error,
        data: null,
        errorInfo: errInfo,
      };
    }
  }

  async listDocuments<T = Record<string, any>>(
    collectionName: FirestoreCollectionName,
    options: FirestoreListOptions = {}
  ): Promise<FirestoreListResult<T>> {
    const authCheck = this.verifyCallerAuthorization(
      collectionName,
      OperationType.LIST
    );
    if (!authCheck.allowed) {
      const errInfo = this.buildErrorInfo(
        new Error(authCheck.reason),
        OperationType.LIST,
        collectionName
      );
      return {
        success: false,
        status: 'error',
        code: authCheck.code || 'PERMISSION_DENIED',
        message: authCheck.reason || 'Permission denied.',
        items: [],
        count: 0,
        nextPageCursor: null,
        hasMore: false,
        errorInfo: errInfo,
      };
    }

    try {
      const res = await this.driver.listDocs<T>(collectionName, options);
      if (res.items.length === 0) {
        return {
          success: true,
          status: 'empty',
          code: 'EMPTY_COLLECTION',
          message: `No documents matched in /${collectionName}.`,
          items: [],
          data: [],
          count: 0,
          nextPageCursor: null,
          hasMore: false,
        };
      }

      return {
        success: true,
        status: 'ok',
        code: 'OK',
        message: `Listed ${res.items.length} document(s) from /${collectionName}.`,
        items: res.items,
        data: res.items,
        count: res.items.length,
        nextPageCursor: res.nextPageCursor,
        hasMore: res.hasMore,
      };
    } catch (error: any) {
      const errCode = String(error?.code || '');
      const isPermDenied =
        errCode.includes('permission-denied') ||
        String(error?.message || '').includes('Missing or insufficient permissions');
      const errInfo = this.buildErrorInfo(
        error,
        OperationType.LIST,
        collectionName
      );
      return {
        success: false,
        status: 'error',
        code: isPermDenied ? 'PERMISSION_DENIED' : 'FIRESTORE_OPERATION_FAILED',
        message: errInfo.error,
        items: [],
        data: [],
        count: 0,
        nextPageCursor: null,
        hasMore: false,
        errorInfo: errInfo,
      };
    }
  }

  async createDocument<T extends Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string,
    payload: T,
    options?: {
      auditAction?: string;
      auditDetails?: string;
    }
  ): Promise<FirestoreOperationResult<T>> {
    const path = `${collectionName}/${docId}`;

    // Client code cannot directly create or self-promote user profiles
    if (collectionName === 'users') {
      return {
        success: false,
        status: 'error',
        code: 'PERMISSION_DENIED',
        message:
          'Employee profiles in /users/{uid} must be provisioned exclusively via the trusted /api/admin/employees backend.',
        data: null,
      };
    }

    const authCheck = this.verifyCallerAuthorization(
      collectionName,
      OperationType.CREATE,
      docId
    );
    if (!authCheck.allowed || !authCheck.caller) {
      const errInfo = this.buildErrorInfo(
        new Error(authCheck.reason),
        OperationType.CREATE,
        path
      );
      return {
        success: false,
        status: 'error',
        code: authCheck.code || 'PERMISSION_DENIED',
        message: authCheck.reason || 'Permission denied.',
        data: null,
        errorInfo: errInfo,
      };
    }

    const nowIso = new Date().toISOString();
    const pkField = COLLECTION_PRIMARY_KEY_FIELD[collectionName];

    const normalizedPayload: Record<string, any> = {
      ...payload,
      [pkField]: payload[pkField] !== undefined ? payload[pkField] : docId,
      dataOrigin: payload.dataOrigin || 'production',
    };

    // Stamp authoritative ISO-8601 timestamps matching firestore.rules requirements
    if (collectionName === 'rawMaterials') {
      normalizedPayload.lastUpdated = normalizedPayload.lastUpdated || nowIso;
    } else if (collectionName === 'stockMovements') {
      normalizedPayload.timestamp = normalizedPayload.timestamp || nowIso;
      normalizedPayload.performedByUid = authCheck.caller.uid;
    } else if (collectionName === 'auditLogs') {
      normalizedPayload.timestamp = normalizedPayload.timestamp || nowIso;
      normalizedPayload.actorUid = authCheck.caller.uid;
      normalizedPayload.actorRole = authCheck.caller.role;
    } else if (collectionName === 'systemConfig') {
      normalizedPayload.configType = docId;
      normalizedPayload.updatedAt = nowIso;
    } else if (collectionName === 'machineLogs') {
      normalizedPayload.loggedAt = normalizedPayload.loggedAt || nowIso;
      normalizedPayload.updatedAt = nowIso;
    } else if (collectionName === 'furnaceLogs') {
      normalizedPayload.startedAt = normalizedPayload.startedAt || nowIso;
      normalizedPayload.updatedAt = nowIso;
    } else if (collectionName === 'maintenanceTickets') {
      normalizedPayload.reportedAt = normalizedPayload.reportedAt || nowIso;
      normalizedPayload.updatedAt = nowIso;
    } else if (collectionName === 'dimensionalReports') {
      normalizedPayload.inspectedAt = normalizedPayload.inspectedAt || nowIso;
      normalizedPayload.updatedAt = nowIso;
    } else if (
      collectionName === 'outstandingPayments' ||
      collectionName === 'jobCostSheets'
    ) {
      normalizedPayload.updatedAt = nowIso;
    } else {
      normalizedPayload.createdAt = normalizedPayload.createdAt || nowIso;
      normalizedPayload.updatedAt = nowIso;
    }

    const validation = validateFirestoreDocumentPayload(
      collectionName,
      docId,
      normalizedPayload
    );
    if (!validation.valid) {
      const isDemo = validation.errors.some((e) =>
        e.includes('dataOrigin="demo_sandbox"')
      );
      const isSecret = validation.errors.some((e) =>
        e.includes('Security policy violation:')
      );
      return {
        success: false,
        status: 'error',
        code: isDemo
          ? 'DEMO_DATA_REJECTED'
          : isSecret
          ? 'SECRET_DETECTED'
          : 'VALIDATION_ERROR',
        message: validation.errors.join(' '),
        data: null,
      };
    }

    try {
      await this.driver.createDoc(
        collectionName,
        docId,
        normalizedPayload as T
      );
      if (options?.auditAction && collectionName !== 'auditLogs') {
        await this.appendAuditLogEntry({
          action: options.auditAction,
          module: collectionName,
          documentId: docId,
          details: options.auditDetails || `Created /${collectionName}/${docId}`,
        }).catch(() => {});
      }
      return {
        success: true,
        status: 'ok',
        code: 'CREATED',
        message: `Created ${path}.`,
        data: normalizedPayload as T,
      };
    } catch (error: any) {
      const errCode = String(error?.code || '');
      const isAlreadyExists =
        errCode === 'already-exists' ||
        String(error?.message || '').includes('already exists');
      const isPermDenied =
        errCode.includes('permission-denied') ||
        String(error?.message || '').includes('Missing or insufficient permissions');
      const errInfo = this.buildErrorInfo(error, OperationType.CREATE, path);
      return {
        success: false,
        status: 'error',
        code: isAlreadyExists
          ? 'ALREADY_EXISTS'
          : isPermDenied
          ? 'PERMISSION_DENIED'
          : 'FIRESTORE_OPERATION_FAILED',
        message: errInfo.error,
        data: null,
        errorInfo: errInfo,
      };
    }
  }

  async setDocument<T extends Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string,
    payload: T,
    options?: {
      merge?: boolean;
      auditAction?: string;
      auditDetails?: string;
    }
  ): Promise<FirestoreOperationResult<T>> {
    const existing = await this.driver.getDoc<T>(collectionName, docId).catch(() => null);
    if (!existing) {
      return this.createDocument<T>(collectionName, docId, payload, options);
    }
    const updRes = await this.updateDocument<T>(collectionName, docId, payload);
    if (updRes.success && options?.auditAction && collectionName !== 'auditLogs') {
      await this.appendAuditLogEntry({
        action: options.auditAction,
        module: collectionName,
        documentId: docId,
        details: options.auditDetails || `Updated /${collectionName}/${docId}`,
      }).catch(() => {});
    }
    return updRes;
  }

  async updateDocument<T extends Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string,
    updates: Partial<T>
  ): Promise<FirestoreOperationResult<T>> {
    const path = `${collectionName}/${docId}`;

    const authCheck = this.verifyCallerAuthorization(
      collectionName,
      OperationType.UPDATE,
      docId
    );
    if (!authCheck.allowed || !authCheck.caller) {
      const errInfo = this.buildErrorInfo(
        new Error(authCheck.reason),
        OperationType.UPDATE,
        path
      );
      return {
        success: false,
        status: 'error',
        code: authCheck.code || 'PERMISSION_DENIED',
        message: authCheck.reason || 'Permission denied.',
        data: null,
        errorInfo: errInfo,
      };
    }

    const secretCheck = assertNoSecretsInPayload(updates);
    if (!secretCheck.valid) {
      return {
        success: false,
        status: 'error',
        code: 'SECRET_DETECTED',
        message: secretCheck.reason || 'Secret detected in update payload.',
        data: null,
      };
    }

    const demoCheck = assertNotDemoSandboxData(updates as Record<string, any>);
    if (!demoCheck.valid) {
      return {
        success: false,
        status: 'error',
        code: 'DEMO_DATA_REJECTED',
        message: demoCheck.reason || 'Demo data rejected.',
        data: null,
      };
    }

    // Never allow client updates to change role or accountStatus on /users/{uid}
    if (
      collectionName === 'users' &&
      authCheck.caller.role !== 'super_admin' &&
      ('role' in updates || 'accountStatus' in updates || 'uid' in updates || 'email' in updates)
    ) {
      return {
        success: false,
        status: 'error',
        code: 'PERMISSION_DENIED',
        message:
          'Security violation: Non-admin users cannot modify role, email, uid, or accountStatus on /users/{uid}.',
        data: null,
      };
    }

    try {
      const existing = await this.driver.getDoc<T>(collectionName, docId);
      if (!existing) {
        return {
          success: false,
          status: 'not_found',
          code: 'NOT_FOUND',
          message: `Cannot update non-existent document ${path}.`,
          data: null,
        };
      }

      // Enforce JobCostSheet Finalized lock for non-super_admin
      if (
        collectionName === 'jobCostSheets' &&
        (existing as any).costStatus === 'Finalized' &&
        authCheck.caller.role !== 'super_admin'
      ) {
        return {
          success: false,
          status: 'error',
          code: 'PERMISSION_DENIED',
          message:
            'Finalized jobCostSheets are locked and can only be modified by super_admin.',
          data: null,
        };
      }

      const nowIso = new Date().toISOString();
      const timestampPatch: Record<string, any> =
        collectionName === 'rawMaterials'
          ? { lastUpdated: nowIso }
          : { updatedAt: nowIso };

      // Preserve immutable creation timestamps & primary keys required by firestore.rules
      const immutableFields: Record<string, any> = {};
      const existingAny = existing as Record<string, any>;
      for (const field of [
        'createdAt',
        'loggedAt',
        'startedAt',
        'reportedAt',
        'inspectedAt',
        'id',
        'uid',
        'orderId',
        'gradeId',
        'invoiceId',
        'configId',
      ]) {
        if (existingAny[field] !== undefined && field in (updates as Record<string, any>)) {
          immutableFields[field] = existingAny[field];
        }
      }

      const safeUpdates = {
        ...updates,
        ...immutableFields,
        ...timestampPatch,
      } as Partial<T>;

      const merged = {
        ...existing,
        ...safeUpdates,
      } as T;

      const validation = validateFirestoreDocumentPayload(
        collectionName,
        docId,
        merged
      );
      if (!validation.valid) {
        return {
          success: false,
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: validation.errors.join(' '),
          data: null,
        };
      }

      await this.driver.updateDoc<T>(collectionName, docId, safeUpdates);

      return {
        success: true,
        status: 'ok',
        code: 'UPDATED',
        message: `Updated ${path}.`,
        data: merged,
      };
    } catch (error: any) {
      const errCode = String(error?.code || '');
      const isNotFound = errCode === 'not-found';
      const isPermDenied =
        errCode.includes('permission-denied') ||
        String(error?.message || '').includes('Missing or insufficient permissions');
      const errInfo = this.buildErrorInfo(error, OperationType.UPDATE, path);
      return {
        success: false,
        status: isNotFound ? 'not_found' : 'error',
        code: isNotFound
          ? 'NOT_FOUND'
          : isPermDenied
          ? 'PERMISSION_DENIED'
          : 'FIRESTORE_OPERATION_FAILED',
        message: errInfo.error,
        data: null,
        errorInfo: errInfo,
      };
    }
  }

  async deleteDocument(
    collectionName: FirestoreCollectionName,
    docId: string
  ): Promise<FirestoreOperationResult<{ deletedId: string }>> {
    const path = `${collectionName}/${docId}`;
    const authCheck = this.verifyCallerAuthorization(
      collectionName,
      OperationType.DELETE,
      docId
    );
    if (!authCheck.allowed) {
      const errInfo = this.buildErrorInfo(
        new Error(authCheck.reason),
        OperationType.DELETE,
        path
      );
      return {
        success: false,
        status: 'error',
        code: authCheck.code || 'PERMISSION_DENIED',
        message: authCheck.reason || 'Delete denied.',
        data: null,
        errorInfo: errInfo,
      };
    }

    try {
      await this.driver.deleteDoc(collectionName, docId);
      return {
        success: true,
        status: 'ok',
        code: 'DELETED',
        message: `Deleted ${path}.`,
        data: { deletedId: docId },
      };
    } catch (error: any) {
      const errInfo = this.buildErrorInfo(error, OperationType.DELETE, path);
      return {
        success: false,
        status: 'error',
        code: 'FIRESTORE_OPERATION_FAILED',
        message: errInfo.error,
        data: null,
        errorInfo: errInfo,
      };
    }
  }

  // --------------------------------------------------------------------------
  // 6.2 Atomic Business Transactions
  // --------------------------------------------------------------------------

  /**
   * ATOMIC TRANSACTION 1: Update Sales Order Stage & Related Fields
   * - Respects role-specific field whitelists in `firestore.rules` (`stores`, `quality`, `dispatch`, `finance`, `sales`, `super_admin`).
   * - Prevents modifying cancelled orders unless caller is `super_admin` or `sales`.
   * - Atomically appends a sanitized `/auditLogs/{logId}` entry with verified caller identity.
   */
  async updateSalesOrderStageAtomically(params: {
    orderId: string;
    currentStage: FirestoreSalesOrderStage;
    overallStatus?: FirestoreSalesOrderOverallStatus;
    delayDays?: number;
    delayReason?: string;
    heatNo?: string;
    mtcStatus?: FirestoreSalesOrderDoc['mtcStatus'];
    dispatchStatus?: FirestoreSalesOrderDoc['dispatchStatus'];
    invoiceNo?: string;
    paymentStatus?: FirestoreSalesOrderDoc['paymentStatus'];
    stages?: Record<string, any>[];
    auditDetails?: string;
  }): Promise<
    FirestoreOperationResult<{
      order: FirestoreSalesOrderDoc;
      auditLogId: string;
    }>
  > {
    const authCheck = this.verifyCallerAuthorization(
      'salesOrders',
      OperationType.UPDATE,
      params.orderId
    );
    if (!authCheck.allowed || !authCheck.caller) {
      return {
        success: false,
        status: 'error',
        code: authCheck.code || 'PERMISSION_DENIED',
        message: authCheck.reason || 'Permission denied.',
        data: null,
      };
    }

    const caller = authCheck.caller;
    const roleWhitelist = SALES_ORDER_ROLE_ALLOWED_UPDATE_FIELDS[caller.role];

    const candidatePatch: Record<string, any> = {
      currentStage: params.currentStage,
    };
    if (params.overallStatus !== undefined)
      candidatePatch.overallStatus = params.overallStatus;
    if (params.delayDays !== undefined) candidatePatch.delayDays = params.delayDays;
    if (params.delayReason !== undefined)
      candidatePatch.delayReason = params.delayReason;
    if (params.heatNo !== undefined) candidatePatch.heatNo = params.heatNo;
    if (params.mtcStatus !== undefined) candidatePatch.mtcStatus = params.mtcStatus;
    if (params.dispatchStatus !== undefined)
      candidatePatch.dispatchStatus = params.dispatchStatus;
    if (params.invoiceNo !== undefined) candidatePatch.invoiceNo = params.invoiceNo;
    if (params.paymentStatus !== undefined)
      candidatePatch.paymentStatus = params.paymentStatus;
    if (params.stages !== undefined) candidatePatch.stages = params.stages;

    // Enforce exact field-level RBAC restrictions from `firestore.rules`
    if (roleWhitelist) {
      const attemptedFields = Object.keys(candidatePatch);
      const unauthorizedFields = attemptedFields.filter(
        (k) => !roleWhitelist.includes(k)
      );
      if (unauthorizedFields.length > 0) {
        return {
          success: false,
          status: 'error',
          code: 'PERMISSION_DENIED',
          message: `Role "${caller.role}" cannot modify field(s) [${unauthorizedFields.join(
            ', '
          )}] on /salesOrders/${params.orderId}. Allowed fields: [${roleWhitelist.join(
            ', '
          )}].`,
          data: null,
        };
      }
    }

    try {
      const result = await this.driver.runTransaction(async (tx) => {
        const existingOrder = await tx.getDoc<FirestoreSalesOrderDoc>(
          'salesOrders',
          params.orderId
        );
        if (!existingOrder) {
          const err: any = new Error(
            `Sales order "/salesOrders/${params.orderId}" not found.`
          );
          err.code = 'NOT_FOUND';
          throw err;
        }

        if (
          existingOrder.overallStatus === 'Cancelled' &&
          caller.role !== 'super_admin' &&
          caller.role !== 'ceo' &&
          caller.role !== 'sales'
        ) {
          const err: any = new Error(
            `Cannot advance stage on Cancelled order "${params.orderId}".`
          );
          err.code = 'VALIDATION_ERROR';
          throw err;
        }

        const nowIso = new Date().toISOString();
        const patchWithTimestamp = {
          ...candidatePatch,
          updatedAt: nowIso,
        };

        const updatedOrder: FirestoreSalesOrderDoc = {
          ...existingOrder,
          ...patchWithTimestamp,
        };

        const check = validateFirestoreDocumentPayload(
          'salesOrders',
          params.orderId,
          updatedOrder
        );
        if (!check.valid) {
          const err: any = new Error(check.errors.join(' '));
          err.code = 'VALIDATION_ERROR';
          throw err;
        }

        const auditLogId = `AUD-ORD-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)
          .toUpperCase()}`;
        const auditEntry: FirestoreAuditLogDoc = {
          id: auditLogId,
          timestamp: nowIso,
          actorUid: caller.uid,
          actorEmail: caller.email,
          actorRole: caller.role,
          action: 'SALES_ORDER_STAGE_UPDATED',
          module: 'salesOrders',
          collectionName: 'salesOrders',
          documentId: params.orderId,
          details:
            params.auditDetails ||
            `Updated order ${params.orderId} stage from "${existingOrder.currentStage}" to "${updatedOrder.currentStage}" (status="${updatedOrder.overallStatus}").`,
          outcome: 'SUCCESS',
          dataOrigin: 'production',
        };

        await tx.updateDoc('salesOrders', params.orderId, patchWithTimestamp);
        await tx.setDoc('auditLogs', auditLogId, auditEntry);

        return { order: updatedOrder, auditLogId };
      });

      return {
        success: true,
        status: 'ok',
        code: 'ORDER_STAGE_UPDATED',
        message: `Atomically updated /salesOrders/${params.orderId} to stage "${result.order.currentStage}".`,
        data: result,
      };
    } catch (error: any) {
      const code = (error?.code as FirestoreServiceErrorCode) || 'FIRESTORE_OPERATION_FAILED';
      return {
        success: false,
        status: code === 'NOT_FOUND' ? 'not_found' : 'error',
        code,
        message: error instanceof Error ? error.message : String(error),
        data: null,
      };
    }
  }

  /**
   * ATOMIC TRANSACTION 2: Record Stock Movement Alongside Raw Material Inventory Balance Update
   * - Permitted for `stores` and `super_admin` (matching `firestore.rules` for `/rawMaterials` and `/stockMovements`).
   * - Prevents negative stock balances (`availableMT < 0`) and zero/negative movement quantities.
   * - Prevents duplicate movement creation if `movementId` already exists.
   * - Recomputes `status` (`Healthy` | `Low Stock` | `Critical`) from `availableMT` vs `reorderLevelMT`.
   */
  async recordStockMovementAtomically(params: {
    movementId: string;
    gradeId: string;
    type: 'INWARD' | 'ISSUE' | 'RETURN' | 'ADJUSTMENT';
    quantityTons: number;
    heatNumber?: string;
    referenceDocument?: string;
    orderId?: string;
    remarks?: string;
  }): Promise<
    FirestoreOperationResult<{
      material: FirestoreRawMaterialDoc;
      movement: FirestoreStockMovementDoc;
      auditLogId: string;
    }>
  > {
    const authCheck = this.verifyCallerAuthorization(
      'rawMaterials',
      OperationType.UPDATE,
      params.gradeId
    );
    if (!authCheck.allowed || !authCheck.caller) {
      return {
        success: false,
        status: 'error',
        code: authCheck.code || 'PERMISSION_DENIED',
        message: authCheck.reason || 'Permission denied.',
        data: null,
      };
    }

    if (
      typeof params.quantityTons !== 'number' ||
      !Number.isFinite(params.quantityTons) ||
      params.quantityTons <= 0
    ) {
      return {
        success: false,
        status: 'error',
        code: 'INVALID_QUANTITY',
        message: `Stock movement quantityTons (${params.quantityTons}) must be a positive number > 0.`,
        data: null,
      };
    }

    const caller = authCheck.caller;

    try {
      const result = await this.driver.runTransaction(async (tx) => {
        const [materialSnap, existingMovement] = await Promise.all([
          tx.getDoc<FirestoreRawMaterialDoc>('rawMaterials', params.gradeId),
          tx.getDoc<FirestoreStockMovementDoc>(
            'stockMovements',
            params.movementId
          ),
        ]);

        if (!materialSnap) {
          const err: any = new Error(
            `Raw material grade "/rawMaterials/${params.gradeId}" does not exist.`
          );
          err.code = 'NOT_FOUND';
          throw err;
        }

        if (existingMovement) {
          const err: any = new Error(
            `Duplicate stock movement ID: "/stockMovements/${params.movementId}" already exists.`
          );
          err.code = 'ALREADY_EXISTS';
          throw err;
        }

        const currentAvail = Number(materialSnap.availableMT.toFixed(3));
        const currentAlloc = Number((materialSnap.allocatedMT ?? 0).toFixed(3));
        const qty = Number(params.quantityTons.toFixed(3));

        let newAvail = currentAvail;
        let newAlloc = currentAlloc;

        if (params.type === 'INWARD' || params.type === 'RETURN') {
          newAvail = Number((currentAvail + qty).toFixed(3));
        } else if (params.type === 'ISSUE') {
          if (currentAvail < qty) {
            const err: any = new Error(
              `Insufficient available stock for ${materialSnap.steelGrade} (${params.gradeId}): requested ${qty} MT, available ${currentAvail} MT.`
            );
            err.code = 'INSUFFICIENT_RAW_MATERIAL_STOCK';
            throw err;
          }
          newAvail = Number((currentAvail - qty).toFixed(3));
          if (params.orderId) {
            newAlloc = Number((currentAlloc + qty).toFixed(3));
          }
        } else if (params.type === 'ADJUSTMENT') {
          newAvail = Number(qty.toFixed(3));
        }

        if (newAvail < 0) {
          const err: any = new Error(
            `Resulting availableMT (${newAvail}) cannot be negative.`
          );
          err.code = 'INSUFFICIENT_RAW_MATERIAL_STOCK';
          throw err;
        }

        const newStatus = computeFirestoreRawMaterialStatus(
          newAvail,
          materialSnap.reorderLevelMT
        );
        const nowIso = new Date().toISOString();

        const materialPatch: Partial<FirestoreRawMaterialDoc> = {
          availableMT: newAvail,
          allocatedMT: newAlloc,
          status: newStatus,
          lastUpdated: nowIso,
          updatedBy: caller.uid,
        };

        const updatedMaterial: FirestoreRawMaterialDoc = {
          ...materialSnap,
          ...materialPatch,
        };

        const movementDoc: FirestoreStockMovementDoc = {
          id: params.movementId,
          gradeId: params.gradeId,
          steelGrade: materialSnap.steelGrade,
          type: params.type,
          quantityTons: qty,
          ...(params.heatNumber ? { heatNumber: params.heatNumber } : {}),
          ...(params.referenceDocument
            ? { referenceDocument: params.referenceDocument }
            : {}),
          ...(params.orderId ? { orderId: params.orderId } : {}),
          performedBy: caller.displayName || caller.email || caller.uid,
          performedByUid: caller.uid,
          timestamp: nowIso,
          ...(params.remarks ? { remarks: params.remarks } : {}),
          balanceAfterMT: newAvail,
          dataOrigin: 'production',
        };

        const auditLogId = `AUD-STK-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)
          .toUpperCase()}`;
        const auditEntry: FirestoreAuditLogDoc = {
          id: auditLogId,
          timestamp: nowIso,
          actorUid: caller.uid,
          actorEmail: caller.email,
          actorRole: caller.role,
          action: `STOCK_${params.type}`,
          module: 'rawMaterials',
          collectionName: 'stockMovements',
          documentId: params.movementId,
          details: `Recorded ${params.type} of ${qty} MT for ${materialSnap.steelGrade} (${params.gradeId}). Available balance: ${currentAvail} MT -> ${newAvail} MT (${newStatus}).`,
          outcome: 'SUCCESS',
          dataOrigin: 'production',
        };

        await tx.updateDoc('rawMaterials', params.gradeId, materialPatch);
        await tx.setDoc('stockMovements', params.movementId, movementDoc);
        await tx.setDoc('auditLogs', auditLogId, auditEntry);

        return {
          material: updatedMaterial,
          movement: movementDoc,
          auditLogId,
        };
      });

      return {
        success: true,
        status: 'ok',
        code: 'STOCK_MOVEMENT_RECORDED',
        message: `Atomically recorded ${params.type} (${params.quantityTons} MT) on ${params.gradeId}; new available balance is ${result.material.availableMT} MT.`,
        data: result,
      };
    } catch (error: any) {
      const code =
        (error?.code as FirestoreServiceErrorCode) || 'FIRESTORE_OPERATION_FAILED';
      return {
        success: false,
        status: code === 'NOT_FOUND' ? 'not_found' : 'error',
        code,
        message: error instanceof Error ? error.message : String(error),
        data: null,
      };
    }
  }

  /**
   * ATOMIC TRANSACTION 3: Record Purchase Order GRN Receipt & Optional Inventory Inward
   * - Updates `/purchaseOrders/{poId}` (`receivedMT`, `status`, `updatedAt`) in strict compliance with
   *   `firestore.rules` (where `stores` is restricted to `hasOnly(['receivedMT', 'status', 'updatedAt'])`).
   * - When `inventoryInward` is provided (permitted for `stores` or `super_admin`), atomically increments
   *   `/rawMaterials/{gradeId}.availableMT` and creates `/stockMovements/{movementId}` in the same transaction.
   */
  async recordPurchaseOrderReceiptAtomically(params: {
    poId: string;
    receiptQuantityMT: number;
    allowOverReceipt?: boolean;
    inventoryInward?: {
      gradeId: string;
      movementId: string;
      heatNumber?: string;
    };
  }): Promise<
    FirestoreOperationResult<{
      purchaseOrder: FirestorePurchaseOrderDoc;
      material?: FirestoreRawMaterialDoc;
      movement?: FirestoreStockMovementDoc;
      auditLogId: string;
    }>
  > {
    const authCheck = this.verifyCallerAuthorization(
      'purchaseOrders',
      OperationType.UPDATE,
      params.poId
    );
    if (!authCheck.allowed || !authCheck.caller) {
      return {
        success: false,
        status: 'error',
        code: authCheck.code || 'PERMISSION_DENIED',
        message: authCheck.reason || 'Permission denied.',
        data: null,
      };
    }

    if (
      typeof params.receiptQuantityMT !== 'number' ||
      !Number.isFinite(params.receiptQuantityMT) ||
      params.receiptQuantityMT <= 0
    ) {
      return {
        success: false,
        status: 'error',
        code: 'INVALID_QUANTITY',
        message: `GRN receiptQuantityMT (${params.receiptQuantityMT}) must be > 0.`,
        data: null,
      };
    }

    const caller = authCheck.caller;

    // Respect `firestore.rules` boundary: only `stores`, `ceo`, and `super_admin` have write access to `/rawMaterials` & `/stockMovements`
    if (
      params.inventoryInward &&
      caller.role !== 'stores' &&
      caller.role !== 'ceo' &&
      caller.role !== 'super_admin'
    ) {
      return {
        success: false,
        status: 'error',
        code: 'PERMISSION_DENIED',
        message: `Role "${caller.role}" can update /purchaseOrders, but Firestore Security Rules restrict /rawMaterials and /stockMovements GRN writes to "stores", "ceo", or "super_admin".`,
        data: null,
      };
    }

    try {
      const result = await this.driver.runTransaction(async (tx) => {
        const poSnap = await tx.getDoc<FirestorePurchaseOrderDoc>(
          'purchaseOrders',
          params.poId
        );
        if (!poSnap) {
          const err: any = new Error(
            `Purchase order "/purchaseOrders/${params.poId}" not found.`
          );
          err.code = 'NOT_FOUND';
          throw err;
        }

        if (poSnap.status === 'Cancelled') {
          const err: any = new Error(
            `Cannot record GRN receipt against Cancelled PO "${poSnap.poNumber}".`
          );
          err.code = 'VALIDATION_ERROR';
          throw err;
        }

        const prevReceived = Number((poSnap.receivedMT ?? 0).toFixed(3));
        const receiptQty = Number(params.receiptQuantityMT.toFixed(3));
        const newReceived = Number((prevReceived + receiptQty).toFixed(3));

        if (!params.allowOverReceipt && newReceived > poSnap.orderedMT) {
          const err: any = new Error(
            `GRN receipt of ${receiptQty} MT would bring total receivedMT (${newReceived} MT) above orderedMT (${poSnap.orderedMT} MT) on PO ${poSnap.poNumber}.`
          );
          err.code = 'PO_RECEIPT_EXCEEDS_ORDERED_QTY';
          throw err;
        }

        const newPoStatus: FirestorePurchaseOrderDoc['status'] =
          newReceived >= poSnap.orderedMT ? 'Received' : 'Partially Received';
        const nowIso = new Date().toISOString();

        // Strictly touch ONLY ['receivedMT', 'status', 'updatedAt'] so `stores` role satisfies firestore.rules
        const poPatch: Partial<FirestorePurchaseOrderDoc> = {
          receivedMT: newReceived,
          status: newPoStatus,
          updatedAt: nowIso,
        };

        let updatedMaterial: FirestoreRawMaterialDoc | undefined;
        let createdMovement: FirestoreStockMovementDoc | undefined;

        if (params.inventoryInward) {
          const { gradeId, movementId, heatNumber } = params.inventoryInward;
          const [matSnap, existingMov] = await Promise.all([
            tx.getDoc<FirestoreRawMaterialDoc>('rawMaterials', gradeId),
            tx.getDoc<FirestoreStockMovementDoc>('stockMovements', movementId),
          ]);

          if (!matSnap) {
            const err: any = new Error(
              `Raw material "/rawMaterials/${gradeId}" not found for GRN inward.`
            );
            err.code = 'NOT_FOUND';
            throw err;
          }
          if (existingMov) {
            const err: any = new Error(
              `Stock movement "/stockMovements/${movementId}" already exists.`
            );
            err.code = 'ALREADY_EXISTS';
            throw err;
          }

          const newAvail = Number(
            (matSnap.availableMT + receiptQty).toFixed(3)
          );
          const newMatStatus = computeFirestoreRawMaterialStatus(
            newAvail,
            matSnap.reorderLevelMT
          );

          const matPatch: Partial<FirestoreRawMaterialDoc> = {
            availableMT: newAvail,
            status: newMatStatus,
            lastUpdated: nowIso,
            updatedBy: caller.uid,
          };

          updatedMaterial = {
            ...matSnap,
            ...matPatch,
          };

          createdMovement = {
            id: movementId,
            gradeId,
            steelGrade: matSnap.steelGrade,
            type: 'INWARD',
            quantityTons: receiptQty,
            ...(heatNumber ? { heatNumber } : {}),
            referenceDocument: poSnap.poNumber,
            performedBy: caller.displayName || caller.email || caller.uid,
            performedByUid: caller.uid,
            timestamp: nowIso,
            remarks: `GRN Receipt against PO ${poSnap.poNumber} (${poSnap.supplierName})`,
            balanceAfterMT: newAvail,
            dataOrigin: 'production',
          };

          await tx.updateDoc('rawMaterials', gradeId, matPatch);
          await tx.setDoc('stockMovements', movementId, createdMovement);
        }

        await tx.updateDoc('purchaseOrders', params.poId, poPatch);

        const auditLogId = `AUD-PO-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)
          .toUpperCase()}`;
        const auditEntry: FirestoreAuditLogDoc = {
          id: auditLogId,
          timestamp: nowIso,
          actorUid: caller.uid,
          actorEmail: caller.email,
          actorRole: caller.role,
          action: 'PURCHASE_ORDER_GRN_RECORDED',
          module: 'purchaseOrders',
          collectionName: 'purchaseOrders',
          documentId: params.poId,
          details: `Recorded GRN receipt of ${receiptQty} MT on PO ${poSnap.poNumber}. Received: ${prevReceived} -> ${newReceived} / ${poSnap.orderedMT} MT (${newPoStatus}).`,
          outcome: 'SUCCESS',
          dataOrigin: 'production',
        };

        await tx.setDoc('auditLogs', auditLogId, auditEntry);

        return {
          purchaseOrder: {
            ...poSnap,
            ...poPatch,
          },
          material: updatedMaterial,
          movement: createdMovement,
          auditLogId,
        };
      });

      return {
        success: true,
        status: 'ok',
        code: 'PO_RECEIPT_RECORDED',
        message: `Atomically updated PO ${result.purchaseOrder.poNumber} receivedMT to ${result.purchaseOrder.receivedMT} MT (${result.purchaseOrder.status}).`,
        data: result,
      };
    } catch (error: any) {
      const code =
        (error?.code as FirestoreServiceErrorCode) || 'FIRESTORE_OPERATION_FAILED';
      return {
        success: false,
        status: code === 'NOT_FOUND' ? 'not_found' : 'error',
        code,
        message: error instanceof Error ? error.message : String(error),
        data: null,
      };
    }
  }

  /**
   * ATOMIC TRANSACTION 4: Record Dispatch Consignment & Synchronize Sales Order Dispatch Balance
   * - Permitted for `dispatch` and `super_admin` (matching `firestore.rules` for `/dispatches` and `/salesOrders`).
   * - Prevents zero/negative dispatch quantities and prevents cumulative dispatched tonnage from exceeding `order.quantityMT`.
   * - Updates `/salesOrders/{orderId}` touching ONLY `['currentStage', 'overallStatus', 'dispatchStatus', 'updatedAt']`
   *   so `dispatch` role strictly satisfies `firestore.rules`.
   */
  async recordDispatchConsignmentAtomically(params: {
    dispatchId: string;
    orderId: string;
    quantityTons: number;
    dispatchDate: string;
    transporterName?: string;
    vehicleNo?: string;
    lrNo?: string;
    invoiceNo?: string;
    destination?: string;
    status?: FirestoreDispatchDoc['status'];
    previouslyDispatchedTons?: number;
  }): Promise<
    FirestoreOperationResult<{
      dispatch: FirestoreDispatchDoc;
      order: FirestoreSalesOrderDoc;
      remainingOrderBalanceMT: number;
      auditLogId: string;
    }>
  > {
    const authCheck = this.verifyCallerAuthorization(
      'dispatches',
      OperationType.CREATE,
      params.dispatchId
    );
    if (!authCheck.allowed || !authCheck.caller) {
      return {
        success: false,
        status: 'error',
        code: authCheck.code || 'PERMISSION_DENIED',
        message: authCheck.reason || 'Permission denied.',
        data: null,
      };
    }

    if (
      typeof params.quantityTons !== 'number' ||
      !Number.isFinite(params.quantityTons) ||
      params.quantityTons <= 0
    ) {
      return {
        success: false,
        status: 'error',
        code: 'INVALID_QUANTITY',
        message: `Dispatch quantityTons (${params.quantityTons}) must be > 0.`,
        data: null,
      };
    }

    const caller = authCheck.caller;

    try {
      const result = await this.driver.runTransaction(async (tx) => {
        const [orderSnap, existingDispatch] = await Promise.all([
          tx.getDoc<FirestoreSalesOrderDoc>('salesOrders', params.orderId),
          tx.getDoc<FirestoreDispatchDoc>('dispatches', params.dispatchId),
        ]);

        if (!orderSnap) {
          const err: any = new Error(
            `Sales order "/salesOrders/${params.orderId}" not found.`
          );
          err.code = 'NOT_FOUND';
          throw err;
        }

        if (existingDispatch) {
          const err: any = new Error(
            `Duplicate dispatch ID: "/dispatches/${params.dispatchId}" already exists.`
          );
          err.code = 'ALREADY_EXISTS';
          throw err;
        }

        if (orderSnap.overallStatus === 'Cancelled') {
          const err: any = new Error(
            `Cannot create dispatch consignment for Cancelled order "${params.orderId}".`
          );
          err.code = 'VALIDATION_ERROR';
          throw err;
        }

        const priorDispatched = Number(
          (params.previouslyDispatchedTons ?? 0).toFixed(3)
        );
        const dispatchQty = Number(params.quantityTons.toFixed(3));
        const totalDispatched = Number(
          (priorDispatched + dispatchQty).toFixed(3)
        );

        if (totalDispatched > Number(orderSnap.quantityMT.toFixed(3))) {
          const err: any = new Error(
            `Dispatch quantity (${dispatchQty} MT) plus prior dispatched (${priorDispatched} MT) = ${totalDispatched} MT exceeds ordered tonnage (${orderSnap.quantityMT} MT) on order ${params.orderId}.`
          );
          err.code = 'DISPATCH_EXCEEDS_ORDER_BALANCE';
          throw err;
        }

        const remainingBalanceMT = Math.max(
          0,
          Number((orderSnap.quantityMT - totalDispatched).toFixed(3))
        );
        const isFullyDispatched = remainingBalanceMT === 0;
        const nowIso = new Date().toISOString();

        const dispatchDoc: FirestoreDispatchDoc = {
          id: params.dispatchId,
          orderId: params.orderId,
          customerName: orderSnap.customerName,
          productName: orderSnap.productName,
          quantityTons: dispatchQty,
          dispatchDate: params.dispatchDate,
          ...(params.transporterName
            ? { transporterName: params.transporterName }
            : {}),
          ...(params.vehicleNo ? { vehicleNo: params.vehicleNo } : {}),
          ...(params.lrNo ? { lrNo: params.lrNo } : {}),
          ...(params.invoiceNo ? { invoiceNo: params.invoiceNo } : {}),
          ...(params.destination ? { destination: params.destination } : {}),
          status: params.status || 'In Transit',
          createdBy: caller.uid,
          createdAt: nowIso,
          updatedAt: nowIso,
          dataOrigin: 'production',
        };

        // Touch ONLY ['currentStage', 'overallStatus', 'dispatchStatus', 'updatedAt'] per firestore.rules
        const orderPatch: Partial<FirestoreSalesOrderDoc> = {
          currentStage: isFullyDispatched
            ? 'Dispatched'
            : orderSnap.currentStage,
          overallStatus: isFullyDispatched
            ? 'Completed'
            : orderSnap.overallStatus,
          dispatchStatus: isFullyDispatched ? 'Dispatched' : 'Partial',
          updatedAt: nowIso,
        };

        const updatedOrder: FirestoreSalesOrderDoc = {
          ...orderSnap,
          ...orderPatch,
        };

        const auditLogId = `AUD-DSP-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)
          .toUpperCase()}`;
        const auditEntry: FirestoreAuditLogDoc = {
          id: auditLogId,
          timestamp: nowIso,
          actorUid: caller.uid,
          actorEmail: caller.email,
          actorRole: caller.role,
          action: 'DISPATCH_CONSIGNMENT_RECORDED',
          module: 'dispatches',
          collectionName: 'dispatches',
          documentId: params.dispatchId,
          details: `Recorded dispatch ${params.dispatchId} (${dispatchQty} MT) for order ${params.orderId}. Remaining order balance: ${remainingBalanceMT} MT (${orderPatch.dispatchStatus}).`,
          outcome: 'SUCCESS',
          dataOrigin: 'production',
        };

        await tx.setDoc('dispatches', params.dispatchId, dispatchDoc);
        await tx.updateDoc('salesOrders', params.orderId, orderPatch);
        await tx.setDoc('auditLogs', auditLogId, auditEntry);

        return {
          dispatch: dispatchDoc,
          order: updatedOrder,
          remainingOrderBalanceMT: remainingBalanceMT,
          auditLogId,
        };
      });

      return {
        success: true,
        status: 'ok',
        code: 'DISPATCH_RECORDED',
        message: `Atomically recorded dispatch ${params.dispatchId} (${params.quantityTons} MT) and updated order ${params.orderId} (remaining balance: ${result.remainingOrderBalanceMT} MT).`,
        data: result,
      };
    } catch (error: any) {
      const code =
        (error?.code as FirestoreServiceErrorCode) || 'FIRESTORE_OPERATION_FAILED';
      return {
        success: false,
        status: code === 'NOT_FOUND' ? 'not_found' : 'error',
        code,
        message: error instanceof Error ? error.message : String(error),
        data: null,
      };
    }
  }

  /**
   * ATOMIC OPERATION 5: Append Immutable Audit Log Entry
   * - Enforces `actorUid === caller.uid` and `actorRole === caller.role`.
   * - Sanitizes any sensitive fields before writing.
   */
  async appendAuditLogEntry(params: {
    logId?: string;
    action: string;
    module: string;
    documentId?: string;
    targetUid?: string;
    details: string;
    severity?: FirestoreAuditLogDoc['severity'];
    outcome?: FirestoreAuditLogDoc['outcome'];
  }): Promise<FirestoreOperationResult<FirestoreAuditLogDoc>> {
    const logId =
      params.logId ||
      `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const authCheck = this.verifyCallerAuthorization(
      'auditLogs',
      OperationType.CREATE,
      logId
    );
    if (!authCheck.allowed || !authCheck.caller) {
      return {
        success: false,
        status: 'error',
        code: authCheck.code || 'PERMISSION_DENIED',
        message: authCheck.reason || 'Permission denied.',
        data: null,
      };
    }

    const caller = authCheck.caller;
    const nowIso = new Date().toISOString();
    const sanitizedDetails = String(sanitizeAuditMetadata(params.details)).slice(
      0,
      1000
    );

    const entry: FirestoreAuditLogDoc = {
      id: logId,
      timestamp: nowIso,
      actorUid: caller.uid,
      actorEmail: caller.email,
      actorRole: caller.role,
      ...(params.targetUid ? { targetUid: params.targetUid } : {}),
      action: params.action,
      module: params.module,
      collectionName: params.module,
      ...(params.documentId ? { documentId: params.documentId } : {}),
      details: sanitizedDetails,
      severity: params.severity || 'INFO',
      outcome: params.outcome || 'SUCCESS',
      dataOrigin: 'production',
    };

    return this.createDocument('auditLogs', logId, entry);
  }
}

// ============================================================================
// 7. CLEAN-PRODUCTION INITIALIZATION SERVICE
// ============================================================================

export interface CleanProductionInitResult {
  success: boolean;
  code: string;
  message: string;
  createdConfigs: string[];
  skippedExistingConfigs: string[];
  businessCollectionsSeededCount: number;
  superAdminAutoCreated: boolean;
}

/**
 * Generates the three clean-production `/systemConfig/{configId}` singleton documents:
 * - Zeroed dashboard KPIs (`dashboardKpis`)
 * - Zeroed production summary (`productionSummary`)
 * - Standard plant alert thresholds (`alertThresholds`)
 * Never includes mock/demo business records and never creates or promotes a `super_admin`.
 */
export function buildCleanProductionSystemConfigs(
  actorUid: string,
  nowIso = new Date().toISOString()
): Record<'dashboardKpis' | 'productionSummary' | 'alertThresholds', FirestoreSystemConfigDoc> {
  return {
    dashboardKpis: {
      configId: 'dashboardKpis',
      configType: 'dashboardKpis',
      totalOrderBookValue: 0,
      activeOrdersCount: 0,
      delayedOrdersCount: 0,
      monthlyDispatchMT: 0,
      monthlyDispatchTargetMT: 0,
      rawMaterialStockMT: 0,
      lowStockAlertsCount: 0,
      rejectionRatePct: 0,
      maxRejectionThresholdPct: 2.0,
      totalOutstandingINR: 0,
      overdueReceivablesINR: 0,
      updatedBy: actorUid,
      updatedAt: nowIso,
      dataOrigin: 'production',
    },
    productionSummary: {
      configId: 'productionSummary',
      configType: 'productionSummary',
      fpyPercentage: 100,
      reworkTons: 0,
      scrapPct: 0,
      ncrCount: 0,
      updatedBy: actorUid,
      updatedAt: nowIso,
      dataOrigin: 'production',
    },
    alertThresholds: {
      configId: 'alertThresholds',
      configType: 'alertThresholds',
      Low_Stock_Threshold_Tons: 25,
      Delay_Threshold_Days: 3,
      Rejection_Rate_Max_Pct: 2.0,
      Payment_Overdue_Days: 45,
      updatedBy: actorUid,
      updatedAt: nowIso,
      dataOrigin: 'production',
    },
  };
}

/**
 * Safely initializes a clean production Cloud Firestore workspace:
 * - Strictly restricted to active `super_admin` callers (since `/systemConfig/alertThresholds` requires `isSuperAdmin()`).
 * - Creates ONLY missing `/systemConfig/{dashboardKpis, productionSummary, alertThresholds}` documents.
 * - Never overwrites existing configuration documents (100% idempotent on retry).
 * - Never populates any business collection with mock or demo records (`businessCollectionsSeededCount: 0`).
 * - Never auto-creates a `super_admin` user profile (`superAdminAutoCreated: false`).
 */
export async function initializeCleanProductionFirestore(
  service: MontexFirestoreService,
  caller: FirestoreCallerContext
): Promise<CleanProductionInitResult> {
  if (!caller || !caller.uid) {
    return {
      success: false,
      code: 'UNAUTHENTICATED',
      message: 'Authentication required for clean production initialization.',
      createdConfigs: [],
      skippedExistingConfigs: [],
      businessCollectionsSeededCount: 0,
      superAdminAutoCreated: false,
    };
  }

  if (!isAccountStatusActive(caller.accountStatus) || caller.role !== 'super_admin') {
    return {
      success: false,
      code: 'PERMISSION_DENIED',
      message:
        'Only an active Super Administrator (super_admin) can initialize production systemConfig documents.',
      createdConfigs: [],
      skippedExistingConfigs: [],
      businessCollectionsSeededCount: 0,
      superAdminAutoCreated: false,
    };
  }

  const configs = buildCleanProductionSystemConfigs(caller.uid);
  const createdConfigs: string[] = [];
  const skippedExistingConfigs: string[] = [];

  for (const configId of [
    'dashboardKpis',
    'productionSummary',
    'alertThresholds',
  ] as const) {
    const existingRes = await service.getDocumentById<FirestoreSystemConfigDoc>(
      'systemConfig',
      configId
    );
    if (!existingRes.success) {
      return {
        success: false,
        code: existingRes.code,
        message: `Failed checking /systemConfig/${configId}: ${existingRes.message}`,
        createdConfigs,
        skippedExistingConfigs,
        businessCollectionsSeededCount: 0,
        superAdminAutoCreated: false,
      };
    }

    if (existingRes.status === 'ok' && existingRes.data) {
      skippedExistingConfigs.push(configId);
      continue;
    }

    const createRes = await service.createDocument(
      'systemConfig',
      configId,
      configs[configId]
    );
    if (!createRes.success) {
      if (createRes.code === 'ALREADY_EXISTS') {
        skippedExistingConfigs.push(configId);
        continue;
      }
      return {
        success: false,
        code: createRes.code,
        message: `Failed creating /systemConfig/${configId}: ${createRes.message}`,
        createdConfigs,
        skippedExistingConfigs,
        businessCollectionsSeededCount: 0,
        superAdminAutoCreated: false,
      };
    }

    createdConfigs.push(configId);
  }

  // Record append-only audit event when new config docs were initialized
  if (createdConfigs.length > 0) {
    await service.appendAuditLogEntry({
      action: 'CLEAN_PRODUCTION_SYSTEM_CONFIG_INITIALIZED',
      module: 'systemConfig',
      documentId: createdConfigs.join(','),
      details: `Initialized clean-production /systemConfig documents [${createdConfigs.join(
        ', '
      )}] with zeroed KPIs and zero demo business records.`,
      severity: 'INFO',
      outcome: 'SUCCESS',
    });
  }

  return {
    success: true,
    code: 'CLEAN_PRODUCTION_INITIALIZED',
    message:
      createdConfigs.length > 0
        ? `Initialized ${createdConfigs.length} clean systemConfig document(s) (${createdConfigs.join(
            ', '
          )}); skipped ${skippedExistingConfigs.length} existing. Zero mock/demo business records created.`
        : `All 3 systemConfig documents (${skippedExistingConfigs.join(
            ', '
          )}) already exist. No documents were overwritten.`,
    createdConfigs,
    skippedExistingConfigs,
    businessCollectionsSeededCount: 0,
    superAdminAutoCreated: false,
  };
}

export const firestoreService = new MontexFirestoreService();
