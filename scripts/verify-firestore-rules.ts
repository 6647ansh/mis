import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';
import {
  CANONICAL_USER_ROLES,
  UserRole,
} from '../src/types/roles';
import {
  app,
  auth,
  firestore,
  firestoreDatabaseId,
  FIREBASE_CONFIG_METADATA,
  firestoreConfigValidation,
  OperationType,
  handleFirestoreError,
  checkFirestoreConnectionHealth,
} from '../src/lib/firebase';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

export interface RuleAuthContext {
  uid: string;
  token: {
    email?: string;
    email_verified?: boolean;
  };
}

export type FirestoreOperation = 'get' | 'list' | 'create' | 'update' | 'delete';

export interface SimulatedFirestoreEvalInput {
  op: FirestoreOperation;
  collection: string;
  docId: string;
  auth: RuleAuthContext | null;
  existingData?: Record<string, any> | null;
  incomingData?: Record<string, any> | null;
  usersDb: Record<string, Record<string, any>>;
}

const VALID_ROLES: readonly string[] = CANONICAL_USER_ROLES;

function isValidId(id: unknown): boolean {
  return (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= 128 &&
    /^[a-zA-Z0-9_\-]+$/.test(id)
  );
}

function hasAllKeys(obj: Record<string, any>, requiredKeys: string[]): boolean {
  const keys = Object.keys(obj);
  return requiredKeys.every((k) => keys.includes(k));
}

function hasOnlyKeys(obj: Record<string, any>, allowedKeys: string[]): boolean {
  const keys = Object.keys(obj);
  return keys.every((k) => allowedKeys.includes(k));
}

function affectedKeys(
  incoming: Record<string, any>,
  existing: Record<string, any>
): string[] {
  const allKeys = new Set([...Object.keys(incoming), ...Object.keys(existing)]);
  const changed: string[] = [];
  for (const k of allKeys) {
    if (JSON.stringify(incoming[k]) !== JSON.stringify(existing[k])) {
      changed.push(k);
    }
  }
  return changed;
}

function isValidDataOrigin(data: Record<string, any>): boolean {
  return (
    !('dataOrigin' in data) ||
    (typeof data.dataOrigin === 'string' &&
      ['production', 'demo_sandbox', 'bootstrap_seed'].includes(data.dataOrigin))
  );
}

function isStringWithBounds(val: unknown, min: number, max: number): boolean {
  return typeof val === 'string' && val.length >= min && val.length <= max;
}

function isNonNegNumber(val: unknown): boolean {
  return typeof val === 'number' && !Number.isNaN(val) && val >= 0;
}

function isPosNumber(val: unknown): boolean {
  return typeof val === 'number' && !Number.isNaN(val) && val > 0;
}

/**
 * Deterministic evaluator matching /firestore.rules 1:1
 */
export function evaluateFirestoreRule(input: SimulatedFirestoreEvalInput): boolean {
  const { op, collection, docId, auth: authCtx, existingData, incomingData, usersDb } = input;

  const isSignedIn = (): boolean => authCtx !== null && Boolean(authCtx.uid);
  const isVerifiedEmail = (): boolean =>
    isSignedIn() && authCtx!.token?.email_verified === true;
  const isBootstrapOwner = (): boolean =>
    isVerifiedEmail() &&
    authCtx!.token?.email === 'anshyadav6647@gmail.com' &&
    (!userProfileExists() || currentUserDoc().accountStatus === 'active');
  const isOwner = (userId: string): boolean =>
    isSignedIn() && authCtx!.uid === userId;
  const userProfileExists = (): boolean =>
    isSignedIn() && Boolean(usersDb[authCtx!.uid]);
  const currentUserDoc = (): Record<string, any> => usersDb[authCtx!.uid] || {};

  const isActiveUser = (): boolean =>
    isSignedIn() &&
    ((userProfileExists() && currentUserDoc().accountStatus === 'active') ||
      isBootstrapOwner());

  const hasRole = (targetRole: UserRole): boolean =>
    isSignedIn() &&
    userProfileExists() &&
    currentUserDoc().accountStatus === 'active' &&
    (currentUserDoc().role === targetRole ||
      ('legacyRole' in currentUserDoc() &&
        currentUserDoc().legacyRole === targetRole));

  const isSuperAdmin = (): boolean => hasRole('super_admin') || isBootstrapOwner();
  const isCeo = (): boolean => hasRole('ceo');
  const isSales = (): boolean => hasRole('sales');
  const isStores = (): boolean => hasRole('stores');
  const isPurchase = (): boolean => hasRole('purchase');
  const isQuality = (): boolean => hasRole('quality');
  const isDispatch = (): boolean => hasRole('dispatch');
  const isFinance = (): boolean => hasRole('finance');

  // Entity schema validators matching /firestore.rules
  const isValidUserProfile = (data: Record<string, any> | null | undefined, userId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'uid', 'email', 'displayName', 'role', 'department', 'accountStatus', 'createdAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'uid', 'name', 'email', 'displayName', 'role', 'requestedRole', 'requestedDepartment',
        'legacyRole', 'rbacGroup', 'roleTitle', 'department', 'designation', 'avatarInitials', 'accountStatus', 'status',
        'mustChangePassword', 'invitedBy', 'provisionedBy', 'provisionedAt',
        'approvedByUid', 'approvedByEmail', 'approvedByName', 'approvedAt',
        'rejectedByUid', 'rejectedByEmail', 'rejectedByName', 'rejectedAt', 'rejectionReason', 'approvalHistory',
        'permissions', 'isDepartmentHead', 'managedDepartment', 'reportingManagerUid',
        'createdAt', 'updatedAt', 'lastLogin', 'lastLoginAt',
        'disabledAt', 'deactivatedBy', 'deactivationReason', 'dataOrigin',
      ]) &&
      data.uid === userId &&
      isStringWithBounds(data.uid, 1, 128) &&
      isStringWithBounds(data.email, 3, 160) &&
      isStringWithBounds(data.displayName, 2, 120) &&
      VALID_ROLES.includes(data.role) &&
      (!('requestedRole' in data) || VALID_ROLES.includes(data.requestedRole)) &&
      (!('legacyRole' in data) ||
        (VALID_ROLES.includes(data.legacyRole) &&
          (data.legacyRole !== 'super_admin' || data.role === 'super_admin') &&
          (data.legacyRole !== 'ceo' || data.role === 'ceo' || data.role === 'super_admin'))) &&
      (!('rbacGroup' in data) ||
        (['Admin', 'Management', 'Sales', 'Production', 'Finance'].includes(data.rbacGroup) &&
          (data.rbacGroup !== 'Admin' || data.role === 'super_admin') &&
          (data.rbacGroup !== 'Management' || data.role === 'ceo' || data.role === 'super_admin'))) &&
      isStringWithBounds(data.department, 2, 80) &&
      (!('designation' in data) || isStringWithBounds(data.designation, 2, 100)) &&
      [
        'active', 'deactivated', 'inactive', 'suspended', 'rejected', 'pending_invitation', 'pending_approval', 'pending_setup',
      ].includes(data.accountStatus) &&
      (!('status' in data) || ['Active', 'Inactive', 'Pending', 'Rejected'].includes(data.status)) &&
      (!('mustChangePassword' in data) || typeof data.mustChangePassword === 'boolean') &&
      isStringWithBounds(data.createdAt, 4, 40) &&
      isStringWithBounds(data.updatedAt, 4, 40) &&
      isValidDataOrigin(data)
    );
  };

  const isValidSystemConfig = (data: Record<string, any> | null | undefined, configId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, ['configId', 'configType', 'updatedAt']) &&
      hasOnlyKeys(data, [
        'configId', 'configType', 'totalOrderBookValue', 'activeOrdersCount',
        'delayedOrdersCount', 'monthlyDispatchMT', 'monthlyDispatchTargetMT',
        'rawMaterialStockMT', 'lowStockAlertsCount', 'rejectionRatePct',
        'maxRejectionThresholdPct', 'totalOutstandingINR', 'overdueReceivablesINR',
        'fpyPercentage', 'reworkTons', 'scrapPct', 'ncrCount',
        'Low_Stock_Threshold_Tons', 'Delay_Threshold_Days', 'Rejection_Rate_Max_Pct',
        'Payment_Overdue_Days', 'updatedBy', 'updatedAt', 'dataOrigin',
      ]) &&
      data.configId === configId &&
      ['dashboardKpis', 'productionSummary', 'alertThresholds', 'connection_probe'].includes(data.configId) &&
      data.configType === configId &&
      isStringWithBounds(data.updatedAt, 4, 40) &&
      (!('Low_Stock_Threshold_Tons' in data) || isNonNegNumber(data.Low_Stock_Threshold_Tons)) &&
      isValidDataOrigin(data)
    );
  };

  const isValidCustomer = (data: Record<string, any> | null | undefined, customerId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, ['id', 'name', 'contactPerson', 'email', 'creditLimit', 'status', 'createdAt']) &&
      hasOnlyKeys(data, [
        'id', 'code', 'name', 'contactPerson', 'email', 'phone', 'gstin', 'creditLimit',
        'paymentTermsDays', 'address', 'location', 'industry', 'assignedSalesPerson',
        'totalOrders', 'totalOutstanding', 'status', 'createdAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === customerId &&
      isStringWithBounds(data.name, 2, 160) &&
      isStringWithBounds(data.contactPerson, 2, 120) &&
      isStringWithBounds(data.email, 3, 160) &&
      isNonNegNumber(data.creditLimit) &&
      ['Active', 'On Hold', 'Inactive'].includes(data.status) &&
      isStringWithBounds(data.createdAt, 4, 40) &&
      isValidDataOrigin(data)
    );
  };

  const isValidProduct = (data: Record<string, any> | null | undefined, productId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, ['id', 'name', 'category', 'steelGrade', 'standardWeightKg', 'unitPrice', 'status', 'createdAt']) &&
      hasOnlyKeys(data, [
        'id', 'code', 'name', 'category', 'steelGrade', 'size', 'standard',
        'standardWeightKg', 'unitPrice', 'hsnCode', 'uom', 'drawingNo',
        'heatTreatmentReq', 'status', 'createdAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === productId &&
      isStringWithBounds(data.name, 2, 160) &&
      ['Flanges', 'Rolled Rings', 'Forged Shafts', 'Gear Blanks', 'Custom Forgings'].includes(data.category) &&
      isStringWithBounds(data.steelGrade, 2, 64) &&
      isPosNumber(data.standardWeightKg) &&
      isNonNegNumber(data.unitPrice) &&
      ['Active', 'Discontinued'].includes(data.status) &&
      isStringWithBounds(data.createdAt, 4, 40) &&
      isValidDataOrigin(data)
    );
  };

  const isValidSalesOrder = (data: Record<string, any> | null | undefined, orderId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'orderId', 'customerName', 'productName', 'steelGrade', 'quantityMT',
        'totalValueINR', 'orderDate', 'committedDeliveryDate', 'currentStage',
        'overallStatus', 'createdAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'orderId', 'customerId', 'customerName', 'productId', 'productName',
        'steelGrade', 'quantityMT', 'totalValueINR', 'orderDate', 'committedDeliveryDate',
        'currentStage', 'overallStatus', 'delayDays', 'delayReason', 'heatNo',
        'mtcStatus', 'dispatchStatus', 'invoiceNo', 'paymentStatus', 'stages',
        'fprUid', 'fprName', 'fprDepartment', 'handoverStage', 'documentChecklistStatus',
        'creditHoldOverrideBy', 'creditHoldOverrideReason',
        'createdBy', 'createdAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.orderId === orderId &&
      isStringWithBounds(data.customerName, 2, 160) &&
      isStringWithBounds(data.productName, 2, 160) &&
      isStringWithBounds(data.steelGrade, 1, 64) &&
      isPosNumber(data.quantityMT) &&
      isNonNegNumber(data.totalValueINR) &&
      [
        'Inquiry', 'Order Confirmed', 'Raw Material Allocated', 'Forging',
        'Heat Treatment', 'Machining', 'Quality Inspection', 'Ready for Dispatch',
        'Dispatched', 'Invoiced',
      ].includes(data.currentStage) &&
      ['On Track', 'At Risk', 'Delayed', 'Completed', 'Cancelled'].includes(data.overallStatus) &&
      isStringWithBounds(data.createdAt, 4, 40) &&
      isStringWithBounds(data.updatedAt, 4, 40) &&
      isValidDataOrigin(data)
    );
  };

  const isValidDispatch = (data: Record<string, any> | null | undefined, dispatchId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, ['id', 'orderId', 'customerName', 'quantityTons', 'dispatchDate', 'status', 'createdAt', 'updatedAt']) &&
      hasOnlyKeys(data, [
        'id', 'orderId', 'customerName', 'productName', 'quantityTons', 'dispatchDate',
        'transporterName', 'vehicleNo', 'lrNo', 'invoiceNo', 'destination', 'status',
        'createdBy', 'createdAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === dispatchId &&
      isValidId(data.orderId) &&
      isStringWithBounds(data.customerName, 2, 160) &&
      isPosNumber(data.quantityTons) &&
      ['Scheduled', 'Loading', 'In Transit', 'Delivered', 'Delayed'].includes(data.status) &&
      isStringWithBounds(data.createdAt, 4, 40) &&
      isStringWithBounds(data.updatedAt, 4, 40) &&
      isValidDataOrigin(data)
    );
  };

  const isValidRawMaterial = (data: Record<string, any> | null | undefined, materialId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, ['gradeId', 'steelGrade', 'availableMT', 'reorderLevelMT', 'status', 'lastUpdated']) &&
      hasOnlyKeys(data, [
        'gradeId', 'steelGrade', 'category', 'availableMT', 'allocatedMT',
        'reorderLevelMT', 'unitCostPerMT', 'supplierName', 'heatBatchNo',
        'locationYard', 'status', 'lastUpdated', 'updatedBy', 'dataOrigin',
      ]) &&
      data.gradeId === materialId &&
      isStringWithBounds(data.steelGrade, 1, 64) &&
      isNonNegNumber(data.availableMT) &&
      isNonNegNumber(data.reorderLevelMT) &&
      ['Healthy', 'Low Stock', 'Critical'].includes(data.status) &&
      isStringWithBounds(data.lastUpdated, 4, 40) &&
      isValidDataOrigin(data)
    );
  };

  const isValidStockMovement = (data: Record<string, any> | null | undefined, movementId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, ['id', 'gradeId', 'steelGrade', 'type', 'quantityTons', 'performedBy', 'timestamp']) &&
      hasOnlyKeys(data, [
        'id', 'gradeId', 'steelGrade', 'type', 'quantityTons', 'heatNumber',
        'referenceDocument', 'orderId', 'performedBy', 'performedByUid',
        'timestamp', 'remarks', 'balanceAfterMT', 'dataOrigin',
      ]) &&
      data.id === movementId &&
      isValidId(data.gradeId) &&
      isStringWithBounds(data.steelGrade, 1, 64) &&
      ['INWARD', 'ISSUE', 'RETURN', 'ADJUSTMENT'].includes(data.type) &&
      isPosNumber(data.quantityTons) &&
      isStringWithBounds(data.performedBy, 2, 160) &&
      isStringWithBounds(data.timestamp, 4, 40) &&
      isValidDataOrigin(data)
    );
  };

  const isValidQualityInspection = (data: Record<string, any> | null | undefined, inspectionId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'batchId', 'orderId', 'inspectedQtyMT', 'acceptedQtyMT',
        'rejectedQtyMT', 'status', 'inspectionDate', 'createdAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'batchId', 'orderId', 'productName', 'steelGrade', 'heatNo',
        'inspectedQtyMT', 'acceptedQtyMT', 'rejectedQtyMT', 'reworkQtyMT',
        'rejectionReason', 'ndtStatus', 'hardnessHBW', 'mtcNumber',
        'inspectorName', 'inspectionDate', 'status', 'createdAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === inspectionId &&
      isStringWithBounds(data.batchId, 1, 80) &&
      isValidId(data.orderId) &&
      isPosNumber(data.inspectedQtyMT) &&
      isNonNegNumber(data.acceptedQtyMT) &&
      isNonNegNumber(data.rejectedQtyMT) &&
      ['Approved', 'Rejected', 'Hold', 'Rework'].includes(data.status) &&
      isStringWithBounds(data.inspectionDate, 4, 40) &&
      isStringWithBounds(data.createdAt, 4, 40) &&
      isValidDataOrigin(data)
    );
  };

  const isValidOutstandingPayment = (data: Record<string, any> | null | undefined, paymentId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'invoiceId', 'customerName', 'invoiceDate', 'dueDate', 'invoiceAmountINR',
        'receivedAmountINR', 'balanceAmountINR', 'ageingBucket', 'status', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'invoiceId', 'orderId', 'customerId', 'customerName', 'invoiceDate',
        'dueDate', 'invoiceAmountINR', 'receivedAmountINR', 'balanceAmountINR',
        'daysOverdue', 'ageingBucket', 'status', 'lastFollowUpDate', 'remarks',
        'updatedBy', 'updatedAt', 'dataOrigin',
      ]) &&
      data.invoiceId === paymentId &&
      isStringWithBounds(data.customerName, 2, 160) &&
      isNonNegNumber(data.invoiceAmountINR) &&
      isNonNegNumber(data.receivedAmountINR) &&
      isNonNegNumber(data.balanceAmountINR) &&
      ['0-30 Days', '31-60 Days', '61-90 Days', '90+ Days'].includes(data.ageingBucket) &&
      ['Current', 'Due Soon', 'Overdue', 'Critical Overdue', 'Paid'].includes(data.status) &&
      isStringWithBounds(data.updatedAt, 4, 40) &&
      isValidDataOrigin(data)
    );
  };

  const isValidActionQueueItem = (data: Record<string, any> | null | undefined, actionId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, ['id', 'category', 'severity', 'title', 'status', 'createdAt', 'updatedAt']) &&
      hasOnlyKeys(data, [
        'id', 'category', 'severity', 'title', 'description', 'entityRef',
        'assignedRole', 'status', 'acknowledgedBy', 'acknowledgedAt',
        'createdAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === actionId &&
      ['Inventory', 'Production', 'Quality', 'Finance', 'Dispatch', 'Maintenance'].includes(data.category) &&
      ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(data.severity) &&
      isStringWithBounds(data.title, 3, 200) &&
      ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(data.status) &&
      isStringWithBounds(data.createdAt, 4, 40) &&
      isStringWithBounds(data.updatedAt, 4, 40) &&
      isValidDataOrigin(data)
    );
  };

  const isValidAuditLog = (data: Record<string, any> | null | undefined, logId: string): boolean => {
    if (!data || !authCtx) return false;
    return (
      hasAllKeys(data, ['id', 'timestamp', 'actorUid', 'actorRole', 'action', 'module', 'details']) &&
      hasOnlyKeys(data, [
        'id', 'timestamp', 'actorUid', 'actorEmail', 'actorName', 'actorRole',
        'action', 'module', 'entityId', 'details', 'severity', 'dataOrigin',
      ]) &&
      data.id === logId &&
      data.actorUid === authCtx.uid &&
      VALID_ROLES.includes(data.actorRole) &&
      isStringWithBounds(data.action, 2, 120) &&
      isStringWithBounds(data.module, 2, 80) &&
      isStringWithBounds(data.details, 2, 1000) &&
      isValidDataOrigin(data)
    );
  };

  const isValidQuotation = (data: Record<string, any> | null | undefined, quotationId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'quoteNo', 'customerName', 'productName', 'steelGrade',
        'quantityMT', 'totalValueINR', 'status', 'createdAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'quoteNo', 'customerId', 'customerName', 'contactPerson',
        'productId', 'productName', 'steelGrade', 'quantityMT', 'quotedRatePerKg',
        'totalValueINR', 'validUntil', 'status', 'preparedBy', 'followUpNotes',
        'nextFollowUpDate', 'convertedOrderId', 'inquiryQtyPcs', 'unitWeightKg',
        'quotedRatePerPc', 'estimatedMarginPercent', 'deliveryLeadWeeks', 'isRepeatOrder',
        'createdAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === quotationId &&
      isStringWithBounds(data.quoteNo, 2, 64) &&
      isStringWithBounds(data.customerName, 2, 160) &&
      isStringWithBounds(data.productName, 2, 160) &&
      isPosNumber(data.quantityMT) &&
      isNonNegNumber(data.totalValueINR) &&
      ['Draft', 'Sent', 'Under Negotiation', 'Won', 'Lost', 'Expired'].includes(data.status) &&
      isValidDataOrigin(data)
    );
  };

  const isValidTender = (data: Record<string, any> | null | undefined, tenderId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'tenderNo', 'issuingAuthority', 'projectTitle', 'estimatedValueINR',
        'submissionDeadline', 'technicalBidStatus', 'createdAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'tenderNo', 'issuingAuthority', 'projectTitle', 'estimatedValueINR',
        'emdAmountINR', 'submissionDeadline', 'technicalBidStatus', 'ownerName',
        'createdAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === tenderId &&
      isNonNegNumber(data.estimatedValueINR) &&
      ['Preparing', 'Submitted', 'Qualified', 'Disqualified', 'Awarded', 'Lost'].includes(data.technicalBidStatus) &&
      isValidDataOrigin(data)
    );
  };

  const isValidSupplier = (data: Record<string, any> | null | undefined, supplierId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, ['id', 'name', 'leadTimeDays', 'approvalStatus', 'createdAt', 'updatedAt']) &&
      hasOnlyKeys(data, [
        'id', 'name', 'location', 'primaryGrades', 'leadTimeDays', 'qualityRating',
        'onTimeDeliveryPct', 'approvalStatus', 'contactEmail', 'createdAt',
        'updatedAt', 'dataOrigin',
      ]) &&
      data.id === supplierId &&
      isStringWithBounds(data.name, 2, 160) &&
      isNonNegNumber(data.leadTimeDays) &&
      ['Approved', 'Probation', 'Suspended'].includes(data.approvalStatus) &&
      isValidDataOrigin(data)
    );
  };

  const isValidPurchaseOrder = (data: Record<string, any> | null | undefined, poId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'poNumber', 'supplierName', 'steelGrade', 'orderedMT', 'ratePerMT',
        'totalAmountINR', 'expectedDeliveryDate', 'status', 'createdAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'poNumber', 'supplierId', 'supplierName', 'steelGrade', 'orderedMT',
        'receivedMT', 'ratePerMT', 'totalAmountINR', 'orderDate',
        'expectedDeliveryDate', 'status', 'createdBy', 'createdAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === poId &&
      isPosNumber(data.orderedMT) &&
      isNonNegNumber(data.ratePerMT) &&
      isNonNegNumber(data.totalAmountINR) &&
      ['Draft', 'Issued', 'In Transit', 'Partially Received', 'Received', 'Cancelled'].includes(data.status) &&
      isValidDataOrigin(data)
    );
  };

  const isValidMachineLog = (data: Record<string, any> | null | undefined, logId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'machineId', 'machineName', 'shift', 'operationType', 'outputTons',
        'status', 'loggedAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'machineId', 'machineName', 'shift', 'operatorName', 'orderId',
        'operationType', 'outputTons', 'utilizationPct', 'downtimeMinutes',
        'status', 'loggedAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === logId &&
      ['Shift A', 'Shift B', 'Shift C'].includes(data.shift) &&
      isNonNegNumber(data.outputTons) &&
      ['Running', 'Setup', 'Idle', 'Breakdown', 'Maintenance'].includes(data.status) &&
      isValidDataOrigin(data)
    );
  };

  const isValidFurnaceLog = (data: Record<string, any> | null | undefined, logId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'furnaceId', 'batchNo', 'cycleType', 'targetTempC', 'chargeWeightMT',
        'status', 'startedAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'furnaceId', 'batchNo', 'orderId', 'steelGrade', 'cycleType',
        'targetTempC', 'soakTimeHours', 'chargeWeightMT', 'fuelConsumedSCM',
        'status', 'startedAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === logId &&
      isPosNumber(data.targetTempC) &&
      isPosNumber(data.chargeWeightMT) &&
      ['Charging', 'Heating', 'Soaking', 'Cooling', 'Completed', 'Aborted'].includes(data.status) &&
      isValidDataOrigin(data)
    );
  };

  const isValidMaintenanceTicket = (data: Record<string, any> | null | undefined, ticketId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'ticketNo', 'machineId', 'machineName', 'maintenanceType',
        'priority', 'issueDescription', 'status', 'reportedAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'ticketNo', 'machineId', 'machineName', 'maintenanceType',
        'priority', 'issueDescription', 'assignedTechnician',
        'estimatedDowntimeHours', 'status', 'reportedAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === ticketId &&
      ['Preventive', 'Breakdown', 'Hydraulic Seal', 'Die Change', 'Calibration'].includes(data.maintenanceType) &&
      ['Critical', 'High', 'Medium', 'Low'].includes(data.priority) &&
      ['Open', 'In Progress', 'Awaiting Spares', 'Resolved', 'Closed'].includes(data.status) &&
      isValidDataOrigin(data)
    );
  };

  const isValidPowerLog = (data: Record<string, any> | null | undefined, logId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'logDate', 'shift', 'electricityKwh', 'productionOutputMT',
        'kwhPerMT', 'createdAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'logDate', 'shift', 'electricityKwh', 'pngGasSCM',
        'productionOutputMT', 'kwhPerMT', 'powerFactor', 'peakDemandKva',
        'loggedBy', 'createdAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === logId &&
      isNonNegNumber(data.electricityKwh) &&
      isNonNegNumber(data.productionOutputMT) &&
      isNonNegNumber(data.kwhPerMT) &&
      isValidDataOrigin(data)
    );
  };

  const isValidDimensionalReport = (data: Record<string, any> | null | undefined, reportId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'reportNo', 'orderId', 'outerDiaNominalMm', 'outerDiaObservedMm',
        'toleranceResult', 'inspectedAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'reportNo', 'orderId', 'batchId', 'drawingNo',
        'outerDiaNominalMm', 'outerDiaObservedMm', 'innerDiaNominalMm',
        'innerDiaObservedMm', 'heightNominalMm', 'heightObservedMm',
        'deviationMm', 'toleranceResult', 'inspectorName', 'inspectedAt',
        'updatedAt', 'dataOrigin',
      ]) &&
      data.id === reportId &&
      isValidId(data.orderId) &&
      isPosNumber(data.outerDiaNominalMm) &&
      isPosNumber(data.outerDiaObservedMm) &&
      ['Within Tolerance', 'Minor Deviation', 'Out of Tolerance'].includes(data.toleranceResult) &&
      isValidDataOrigin(data)
    );
  };

  const isValidJobCostSheet = (data: Record<string, any> | null | undefined, costSheetId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'orderId', 'customerName', 'rawMaterialCostINR',
        'forgingConversionCostINR', 'totalActualCostINR', 'salesRealizationINR',
        'grossMarginPct', 'costStatus', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'orderId', 'customerName', 'productName', 'rawMaterialCostINR',
        'forgingConversionCostINR', 'heatTreatmentCostINR', 'machiningCostINR',
        'testingAndMtcCostINR', 'totalActualCostINR', 'salesRealizationINR',
        'grossMarginINR', 'grossMarginPct', 'costStatus', 'updatedBy',
        'updatedAt', 'dataOrigin',
      ]) &&
      data.id === costSheetId &&
      isValidId(data.orderId) &&
      isNonNegNumber(data.rawMaterialCostINR) &&
      isNonNegNumber(data.forgingConversionCostINR) &&
      isNonNegNumber(data.totalActualCostINR) &&
      isNonNegNumber(data.salesRealizationINR) &&
      ['Draft', 'Provisional', 'Finalized'].includes(data.costStatus) &&
      isValidDataOrigin(data)
    );
  };

  const isValidTaskRecord = (data: Record<string, any> | null | undefined, taskId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'taskNo', 'title', 'department', 'assignedRole', 'assignedToUid',
        'assignedToName', 'priority', 'status', 'dueDate', 'createdAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'taskNo', 'title', 'description', 'department', 'assignedRole',
        'assignedToUid', 'assignedToName', 'assignedByUid', 'assignedByName',
        'orderId', 'customerName', 'priority', 'status', 'dueDate', 'slaHours',
        'submittedAt', 'submissionRemarks', 'verifiedByUid', 'verifiedByName',
        'verifiedAt', 'verificationRemarks', 'rejectionReason', 'escalationLevel',
        'escalatedAt', 'isSopDailyDuty', 'sopClauseRef', 'createdAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === taskId &&
      VALID_ROLES.includes(data.assignedRole) &&
      ['Critical', 'High', 'Medium', 'Low'].includes(data.priority) &&
      [
        'Pending', 'In Progress', 'Submitted for Verification',
        'Verified & Approved', 'Rejected / Rework', 'Escalated',
      ].includes(data.status) &&
      isValidDataOrigin(data)
    );
  };

  const isValidHandoverRecord = (data: Record<string, any> | null | undefined, handoverId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'handoverCode', 'orderId', 'customerName', 'productName',
        'fromDepartment', 'fromRole', 'fromUid', 'fromUserName',
        'toDepartment', 'toRole', 'status', 'initiatedAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'handoverCode', 'orderId', 'customerName', 'productName',
        'fromDepartment', 'fromRole', 'fromUid', 'fromUserName',
        'toDepartment', 'toRole', 'toUid', 'toUserName', 'quantityMT',
        'heatNo', 'checklistSummary', 'status', 'initiatedAt', 'respondedAt',
        'remarks', 'rejectionReason', 'slaDeadline', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === handoverId &&
      ['H-1', 'H-2', 'H-3', 'H-4', 'H-5'].includes(data.handoverCode) &&
      isValidId(data.orderId) &&
      VALID_ROLES.includes(data.fromRole) &&
      VALID_ROLES.includes(data.toRole) &&
      ['Pending Acceptance', 'Accepted', 'Rejected', 'Escalated'].includes(data.status) &&
      isValidDataOrigin(data)
    );
  };

  const isValidPurchaseRequisition = (data: Record<string, any> | null | undefined, requisitionId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'prNumber', 'steelGrade', 'requiredMT', 'requiredByDate',
        'requestedByUid', 'requestedByName', 'requestedByRole',
        'priority', 'status', 'createdAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'prNumber', 'orderId', 'steelGrade', 'requiredMT',
        'estimatedCostINR', 'requiredByDate', 'requestedByUid',
        'requestedByName', 'requestedByRole', 'justification', 'priority',
        'status', 'approvedByUid', 'approvedByName', 'approvedAt',
        'rejectionReason', 'convertedPoNumber', 'createdAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === requisitionId &&
      isPosNumber(data.requiredMT) &&
      VALID_ROLES.includes(data.requestedByRole) &&
      ['Urgent', 'High', 'Normal'].includes(data.priority) &&
      ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Converted to PO'].includes(data.status) &&
      isValidDataOrigin(data)
    );
  };

  const isValidNcrCapaRecord = (data: Record<string, any> | null | undefined, ncrId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'ncrNumber', 'orderId', 'batchId', 'defectCategory',
        'defectDescription', 'affectedQtyMT', 'disposition', 'status',
        'raisedByUid', 'raisedByName', 'createdAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'ncrNumber', 'orderId', 'batchId', 'productName', 'steelGrade',
        'heatNo', 'defectCategory', 'defectDescription', 'affectedQtyMT',
        'rootCause', 'correctiveAction', 'preventiveAction', 'disposition',
        'status', 'raisedByUid', 'raisedByName', 'verifiedByName', 'closedAt',
        'createdAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === ncrId &&
      isValidId(data.orderId) &&
      isPosNumber(data.affectedQtyMT) &&
      ['Dimensional', 'Surface Crack', 'UT Indication', 'Hardness Deviation', 'Chemistry Mix', 'Machining Error'].includes(data.defectCategory) &&
      ['Rework', 'Scrap', 'Use As Is (Concession)', 'Hold'].includes(data.disposition) &&
      ['Open', 'Root Cause Analysis', 'CAPA Implemented', 'Verified & Closed'].includes(data.status) &&
      isValidDataOrigin(data)
    );
  };

  const isValidPaymentFollowUp = (data: Record<string, any> | null | undefined, followUpId: string): boolean => {
    if (!data) return false;
    return (
      hasAllKeys(data, [
        'id', 'invoiceId', 'customerName', 'contactPerson', 'followUpDate',
        'nextFollowUpDate', 'followUpMode', 'outcome', 'loggedByUid',
        'loggedByName', 'loggedByRole', 'createdAt', 'updatedAt',
      ]) &&
      hasOnlyKeys(data, [
        'id', 'invoiceId', 'orderId', 'customerId', 'customerName',
        'contactPerson', 'followUpDate', 'nextFollowUpDate', 'promisedAmountINR',
        'promisedDate', 'followUpMode', 'outcome', 'notes', 'loggedByUid',
        'loggedByName', 'loggedByRole', 'createdAt', 'updatedAt', 'dataOrigin',
      ]) &&
      data.id === followUpId &&
      isValidId(data.invoiceId) &&
      ['Phone Call', 'Email', 'WhatsApp', 'Executive Visit', 'Legal Notice'].includes(data.followUpMode) &&
      ['Payment Promised', 'Part Payment Released', 'Dispute Raised', 'No Response', 'Cleared'].includes(data.outcome) &&
      VALID_ROLES.includes(data.loggedByRole) &&
      isValidDataOrigin(data)
    );
  };

  // Match evaluation per collection
  switch (collection) {
    case 'users': {
      if (op === 'get') {
        return (
          isSignedIn() &&
          isValidId(docId) &&
          ((isOwner(docId) &&
            (!existingData ||
              ['active', 'pending_approval', 'pending_invitation', 'pending_setup', 'rejected'].includes(
                existingData.accountStatus
              ))) ||
            isSuperAdmin() ||
            isCeo())
        );
      }
      if (op === 'list') {
        return isActiveUser() && (isSuperAdmin() || isCeo());
      }
      if (op === 'create') {
        if (
          !isSignedIn() ||
          !isValidId(docId) ||
          !isValidUserProfile(incomingData, docId) ||
          !incomingData
        ) {
          return false;
        }
        const validApprover =
          (!('approvedByUid' in incomingData) ||
            incomingData.approvedByUid === null ||
            incomingData.approvedByUid === authCtx!.uid) &&
          (!('rejectedByUid' in incomingData) ||
            incomingData.rejectedByUid === null ||
            incomingData.rejectedByUid === authCtx!.uid);

        return (
          (isSuperAdmin() && validApprover) ||
          (isCeo() &&
            !isOwner(docId) &&
            incomingData.role !== 'super_admin' &&
            incomingData.role !== 'ceo' &&
            (!('legacyRole' in incomingData) ||
              (incomingData.legacyRole !== 'super_admin' && incomingData.legacyRole !== 'ceo')) &&
            (!('requestedRole' in incomingData) ||
              (incomingData.requestedRole !== 'super_admin' && incomingData.requestedRole !== 'ceo')) &&
            (!('rbacGroup' in incomingData) ||
              (incomingData.rbacGroup !== 'Admin' && incomingData.rbacGroup !== 'Management')) &&
            validApprover) ||
          (isOwner(docId) && isBootstrapOwner() && !userProfileExists()) ||
          (isOwner(docId) &&
            incomingData.accountStatus === 'pending_approval' &&
            incomingData.role !== 'super_admin' &&
            incomingData.role !== 'ceo' &&
            (!('legacyRole' in incomingData) ||
              (incomingData.legacyRole !== 'super_admin' && incomingData.legacyRole !== 'ceo')) &&
            (!('requestedRole' in incomingData) ||
              (incomingData.requestedRole !== 'super_admin' && incomingData.requestedRole !== 'ceo')) &&
            (!('rbacGroup' in incomingData) ||
              (incomingData.rbacGroup !== 'Admin' && incomingData.rbacGroup !== 'Management')) &&
            (!('isDepartmentHead' in incomingData) || incomingData.isDepartmentHead === false) &&
            (!('approvedByUid' in incomingData) || incomingData.approvedByUid === null) &&
            (!('approvedByEmail' in incomingData) || incomingData.approvedByEmail === null) &&
            (!('approvedByName' in incomingData) || incomingData.approvedByName === null) &&
            (!('approvedAt' in incomingData) || incomingData.approvedAt === null) &&
            (!('rejectedByUid' in incomingData) || incomingData.rejectedByUid === null) &&
            (!('rejectedAt' in incomingData) || incomingData.rejectedAt === null))
        );
      }
      if (op === 'update') {
        if (
          !isSignedIn() ||
          !isValidId(docId) ||
          !isValidUserProfile(incomingData, docId) ||
          !existingData ||
          !incomingData
        ) {
          return false;
        }
        const validApproverUpdate =
          (!('approvedByUid' in incomingData) ||
            incomingData.approvedByUid === null ||
            ('approvedByUid' in existingData &&
              incomingData.approvedByUid === existingData.approvedByUid) ||
            incomingData.approvedByUid === authCtx!.uid) &&
          (!('rejectedByUid' in incomingData) ||
            incomingData.rejectedByUid === null ||
            ('rejectedByUid' in existingData &&
              incomingData.rejectedByUid === existingData.rejectedByUid) ||
            incomingData.rejectedByUid === authCtx!.uid);

        if (isSuperAdmin() && validApproverUpdate) return true;
        if (
          isCeo() &&
          !isOwner(docId) &&
          existingData.role !== 'super_admin' &&
          existingData.role !== 'ceo' &&
          (!('legacyRole' in existingData) ||
            (existingData.legacyRole !== 'super_admin' && existingData.legacyRole !== 'ceo')) &&
          (!('rbacGroup' in existingData) ||
            (existingData.rbacGroup !== 'Admin' && existingData.rbacGroup !== 'Management')) &&
          incomingData.role !== 'super_admin' &&
          incomingData.role !== 'ceo' &&
          (!('legacyRole' in incomingData) ||
            (incomingData.legacyRole !== 'super_admin' && incomingData.legacyRole !== 'ceo')) &&
          (!('requestedRole' in incomingData) ||
            (incomingData.requestedRole !== 'super_admin' && incomingData.requestedRole !== 'ceo')) &&
          (!('rbacGroup' in incomingData) ||
            (incomingData.rbacGroup !== 'Admin' && incomingData.rbacGroup !== 'Management')) &&
          validApproverUpdate
        ) {
          return true;
        }
        const diff = affectedKeys(incomingData, existingData);
        if (
          isOwner(docId) &&
          isActiveUser() &&
          incomingData.uid === existingData.uid &&
          incomingData.email === existingData.email &&
          incomingData.role === existingData.role &&
          incomingData.department === existingData.department &&
          incomingData.accountStatus === existingData.accountStatus &&
          incomingData.createdAt === existingData.createdAt &&
          diff.every((k) =>
            ['lastLogin', 'lastLoginAt', 'updatedAt', 'displayName', 'name', 'mustChangePassword'].includes(k)
          )
        ) {
          return true;
        }
        return (
          isOwner(docId) &&
          existingData.accountStatus === 'pending_approval' &&
          incomingData.accountStatus === 'pending_approval' &&
          incomingData.uid === existingData.uid &&
          incomingData.email === existingData.email &&
          incomingData.createdAt === existingData.createdAt &&
          incomingData.role !== 'super_admin' &&
          incomingData.role !== 'ceo' &&
          (!('legacyRole' in incomingData) ||
            (incomingData.legacyRole !== 'super_admin' && incomingData.legacyRole !== 'ceo')) &&
          (!('requestedRole' in incomingData) ||
            (incomingData.requestedRole !== 'super_admin' && incomingData.requestedRole !== 'ceo')) &&
          (!('rbacGroup' in incomingData) ||
            (incomingData.rbacGroup !== 'Admin' && incomingData.rbacGroup !== 'Management')) &&
          (!('isDepartmentHead' in incomingData) || incomingData.isDepartmentHead === false) &&
          diff.every((k) =>
            [
              'displayName',
              'name',
              'department',
              'requestedDepartment',
              'role',
              'legacyRole',
              'requestedRole',
              'rbacGroup',
              'designation',
              'roleTitle',
              'avatarInitials',
              'approvalHistory',
              'updatedAt',
            ].includes(k)
          )
        );
      }
      if (op === 'delete') {
        return isSignedIn() && isValidId(docId) && isSuperAdmin() && authCtx!.uid !== docId;
      }
      return false;
    }

    case 'systemConfig': {
      if (op === 'get') return isActiveUser() && isValidId(docId);
      if (op === 'list') return isActiveUser();
      if (op === 'create') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidSystemConfig(incomingData, docId) &&
          (isSuperAdmin() || isCeo() || ['dashboardKpis', 'productionSummary'].includes(docId))
        );
      }
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidSystemConfig(incomingData, docId) &&
          Boolean(existingData) &&
          (isSuperAdmin() ||
            isCeo() ||
            (['dashboardKpis', 'productionSummary'].includes(docId) &&
              incomingData!.configId === existingData!.configId &&
              incomingData!.configType === existingData!.configType))
        );
      }
      return false;
    }

    case 'customers': {
      const canRead =
        isSuperAdmin() ||
        isCeo() ||
        isSales() ||
        isStores() ||
        isPurchase() ||
        isQuality() ||
        isDispatch() ||
        isFinance();
      const canWrite = isSuperAdmin() || isCeo() || isSales() || isFinance();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidCustomer(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidCustomer(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.createdAt === existingData!.createdAt &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'products': {
      const canWrite = isSuperAdmin() || isCeo() || isSales() || isQuality();
      if (op === 'get') return isActiveUser() && isValidId(docId);
      if (op === 'list') return isActiveUser();
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidProduct(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidProduct(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.createdAt === existingData!.createdAt &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'salesOrders': {
      if (op === 'get') return isActiveUser() && isValidId(docId);
      if (op === 'list') return isActiveUser();
      if (op === 'create') {
        return isActiveUser() && isValidId(docId) && isValidSalesOrder(incomingData, docId) && (isSuperAdmin() || isCeo() || isSales());
      }
      if (op === 'update') {
        if (!isActiveUser() || !isValidId(docId) || !isValidSalesOrder(incomingData, docId) || !existingData || !incomingData) {
          return false;
        }
        if (incomingData.orderId !== existingData.orderId || incomingData.createdAt !== existingData.createdAt) {
          return false;
        }
        if (isSuperAdmin() || isCeo() || isSales()) return true;
        const diff = affectedKeys(incomingData, existingData);
        if (isStores() && diff.every((k) => ['currentStage', 'overallStatus', 'delayDays', 'delayReason', 'heatNo', 'stages', 'updatedAt'].includes(k))) {
          return true;
        }
        if (isQuality() && diff.every((k) => ['currentStage', 'overallStatus', 'mtcStatus', 'stages', 'updatedAt'].includes(k))) {
          return true;
        }
        if (isDispatch() && diff.every((k) => ['currentStage', 'overallStatus', 'dispatchStatus', 'stages', 'updatedAt'].includes(k))) {
          return true;
        }
        if (isFinance() && diff.every((k) => ['currentStage', 'overallStatus', 'invoiceNo', 'paymentStatus', 'stages', 'updatedAt'].includes(k))) {
          return true;
        }
        return false;
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'dispatches': {
      const canRead = isSuperAdmin() || isCeo() || isSales() || isDispatch() || isFinance() || isStores();
      const canWrite = isSuperAdmin() || isCeo() || isDispatch();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidDispatch(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidDispatch(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.orderId === existingData!.orderId &&
          incomingData!.createdAt === existingData!.createdAt &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'rawMaterials': {
      const canRead = isSuperAdmin() || isCeo() || isStores() || isPurchase() || isQuality() || isSales() || isFinance();
      const canWrite = isSuperAdmin() || isCeo() || isStores();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidRawMaterial(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidRawMaterial(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.gradeId === existingData!.gradeId &&
          incomingData!.steelGrade === existingData!.steelGrade &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'stockMovements': {
      const canRead = isSuperAdmin() || isCeo() || isStores() || isPurchase() || isFinance() || isQuality();
      const canCreate = isSuperAdmin() || isCeo() || isStores();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidStockMovement(incomingData, docId) && canCreate;
      if (op === 'update') return false;
      if (op === 'delete') return isActiveUser() && isValidId(docId) && isSuperAdmin();
      return false;
    }

    case 'qualityInspections': {
      const canRead = isSuperAdmin() || isCeo() || isQuality() || isStores() || isSales() || isDispatch();
      const canWrite = isSuperAdmin() || isCeo() || isQuality();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidQualityInspection(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidQualityInspection(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.orderId === existingData!.orderId &&
          incomingData!.createdAt === existingData!.createdAt &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'outstandingPayments': {
      const canRead = isSuperAdmin() || isCeo() || isFinance() || isSales();
      const canWrite = isSuperAdmin() || isCeo() || isFinance();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidOutstandingPayment(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidOutstandingPayment(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.invoiceId === existingData!.invoiceId &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'actionQueue': {
      if (op === 'get') return isActiveUser() && isValidId(docId);
      if (op === 'list') return isActiveUser();
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidActionQueueItem(incomingData, docId);
      if (op === 'update') {
        if (!isActiveUser() || !isValidId(docId) || !isValidActionQueueItem(incomingData, docId) || !existingData || !incomingData) {
          return false;
        }
        if (incomingData.id !== existingData.id || incomingData.createdAt !== existingData.createdAt) {
          return false;
        }
        if (isSuperAdmin() || isCeo()) return true;
        const diff = affectedKeys(incomingData, existingData);
        return diff.every((k) => ['status', 'acknowledgedBy', 'acknowledgedAt', 'updatedAt'].includes(k));
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'auditLogs': {
      const canRead = isSuperAdmin() || isCeo();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidAuditLog(incomingData, docId);
      if (op === 'update' || op === 'delete') return false;
      return false;
    }

    case 'quotations': {
      const canRead = isSuperAdmin() || isCeo() || isSales() || isFinance();
      const canWrite = isSuperAdmin() || isCeo() || isSales();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidQuotation(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidQuotation(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.createdAt === existingData!.createdAt &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'tenders': {
      const canRead = isSuperAdmin() || isCeo() || isSales() || isFinance();
      const canWrite = isSuperAdmin() || isCeo() || isSales();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidTender(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidTender(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.createdAt === existingData!.createdAt &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'suppliers': {
      const canRead = isSuperAdmin() || isCeo() || isPurchase() || isStores() || isQuality() || isFinance();
      const canWrite = isSuperAdmin() || isCeo() || isPurchase();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidSupplier(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidSupplier(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.createdAt === existingData!.createdAt &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'purchaseOrders': {
      const canRead = isSuperAdmin() || isCeo() || isPurchase() || isStores() || isFinance();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') {
        return isActiveUser() && isValidId(docId) && isValidPurchaseOrder(incomingData, docId) && (isSuperAdmin() || isCeo() || isPurchase());
      }
      if (op === 'update') {
        if (!isActiveUser() || !isValidId(docId) || !isValidPurchaseOrder(incomingData, docId) || !existingData || !incomingData) {
          return false;
        }
        if (incomingData.id !== existingData.id || incomingData.poNumber !== existingData.poNumber || incomingData.createdAt !== existingData.createdAt) {
          return false;
        }
        if (isSuperAdmin() || isCeo() || isPurchase()) return true;
        const diff = affectedKeys(incomingData, existingData);
        return isStores() && diff.every((k) => ['receivedMT', 'status', 'updatedAt'].includes(k));
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'machineLogs': {
      const canRead = isSuperAdmin() || isCeo() || isStores() || isQuality() || isSales();
      const canWrite = isSuperAdmin() || isCeo() || isStores();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidMachineLog(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidMachineLog(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.loggedAt === existingData!.loggedAt &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'furnaceLogs': {
      const canRead = isSuperAdmin() || isCeo() || isStores() || isQuality();
      const canWrite = isSuperAdmin() || isCeo() || isStores() || isQuality();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidFurnaceLog(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidFurnaceLog(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.startedAt === existingData!.startedAt &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'maintenanceTickets': {
      const canRead = isSuperAdmin() || isCeo() || isStores() || isQuality();
      const canWrite = isSuperAdmin() || isCeo() || isStores();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidMaintenanceTicket(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidMaintenanceTicket(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.reportedAt === existingData!.reportedAt &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'powerLogs': {
      const canRead = isSuperAdmin() || isCeo() || isStores() || isFinance();
      const canWrite = isSuperAdmin() || isCeo() || isStores();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidPowerLog(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidPowerLog(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.createdAt === existingData!.createdAt &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'dimensionalReports': {
      const canRead = isSuperAdmin() || isCeo() || isQuality() || isSales() || isStores() || isDispatch();
      const canWrite = isSuperAdmin() || isCeo() || isQuality();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidDimensionalReport(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidDimensionalReport(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.orderId === existingData!.orderId &&
          incomingData!.inspectedAt === existingData!.inspectedAt &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'jobCostSheets': {
      const canRead = isSuperAdmin() || isCeo() || isFinance();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') {
        return isActiveUser() && isValidId(docId) && isValidJobCostSheet(incomingData, docId) && (isSuperAdmin() || isCeo() || isFinance());
      }
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidJobCostSheet(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.orderId === existingData!.orderId &&
          (isSuperAdmin() || isCeo() || (isFinance() && existingData!.costStatus !== 'Finalized'))
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'tasks': {
      if (op === 'get') return isActiveUser() && isValidId(docId);
      if (op === 'list') return isActiveUser();
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidTaskRecord(incomingData, docId);
      if (op === 'update') {
        if (!isActiveUser() || !isValidId(docId) || !isValidTaskRecord(incomingData, docId) || !existingData || !incomingData) {
          return false;
        }
        if (incomingData.id !== existingData.id || incomingData.createdAt !== existingData.createdAt) {
          return false;
        }
        if (isSuperAdmin() || isCeo()) return true;
        if (incomingData.status !== 'Verified & Approved') return true;
        const userDoc = currentUserDoc();
        return incomingData.assignedToUid !== authCtx!.uid && Boolean(userDoc && userDoc.isDepartmentHead === true);
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'handovers': {
      if (op === 'get') return isActiveUser() && isValidId(docId);
      if (op === 'list') return isActiveUser();
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidHandoverRecord(incomingData, docId);
      if (op === 'update') {
        if (!isActiveUser() || !isValidId(docId) || !isValidHandoverRecord(incomingData, docId) || !existingData || !incomingData) {
          return false;
        }
        if (incomingData.id !== existingData.id || incomingData.orderId !== existingData.orderId) {
          return false;
        }
        if (isSuperAdmin() || isCeo()) return true;
        if (incomingData.fromUid !== authCtx!.uid && hasRole(existingData.toRole)) return true;
        if (incomingData.status === 'Pending Acceptance' && incomingData.fromUid === authCtx!.uid) return true;
        return false;
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'purchaseRequisitions': {
      const canRead = isSuperAdmin() || isCeo() || isPurchase() || isStores() || isSales() || isFinance();
      const canCreate = isSuperAdmin() || isCeo() || isPurchase() || isStores();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canRead;
      if (op === 'list') return isActiveUser() && canRead;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidPurchaseRequisition(incomingData, docId) && canCreate;
      if (op === 'update') {
        if (!isActiveUser() || !isValidId(docId) || !isValidPurchaseRequisition(incomingData, docId) || !existingData || !incomingData) {
          return false;
        }
        if (incomingData.id !== existingData.id || incomingData.createdAt !== existingData.createdAt) {
          return false;
        }
        if (isSuperAdmin() || isCeo()) return true;
        if (isPurchase() && incomingData.requestedByUid !== authCtx!.uid) return true;
        if (isStores() && ['Draft', 'Pending Approval'].includes(incomingData.status)) return true;
        return false;
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'ncrCapaRecords': {
      const canWrite = isSuperAdmin() || isCeo() || isQuality() || isStores();
      if (op === 'get') return isActiveUser() && isValidId(docId);
      if (op === 'list') return isActiveUser();
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidNcrCapaRecord(incomingData, docId) && canWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidNcrCapaRecord(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.orderId === existingData!.orderId &&
          incomingData!.createdAt === existingData!.createdAt &&
          canWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    case 'paymentFollowUps': {
      const canReadWrite = isSuperAdmin() || isCeo() || isFinance() || isSales();
      if (op === 'get') return isActiveUser() && isValidId(docId) && canReadWrite;
      if (op === 'list') return isActiveUser() && canReadWrite;
      if (op === 'create') return isActiveUser() && isValidId(docId) && isValidPaymentFollowUp(incomingData, docId) && canReadWrite;
      if (op === 'update') {
        return (
          isActiveUser() &&
          isValidId(docId) &&
          isValidPaymentFollowUp(incomingData, docId) &&
          Boolean(existingData) &&
          incomingData!.id === existingData!.id &&
          incomingData!.invoiceId === existingData!.invoiceId &&
          incomingData!.createdAt === existingData!.createdAt &&
          canReadWrite
        );
      }
      if (op === 'delete') return isActiveUser() && isValidId(docId) && (isSuperAdmin() || isCeo());
      return false;
    }

    default:
      // Catch-all default deny
      return false;
  }
}

export async function runPhase2FirestoreSecurityVerification(): Promise<{
  passed: number;
  failed: number;
}> {
  let passed = 0;
  let failed = 0;

  function assertCheck(name: string, condition: boolean, details?: string) {
    if (condition) {
      passed++;
      console.log(`  ✅ PASS: ${name}`);
    } else {
      failed++;
      console.error(`  ❌ FAIL: ${name}${details ? ` (${details})` : ''}`);
    }
  }

  console.log('================================================================');
  console.log('MONTEX FORGE MIS — PHASE 2 FIRESTORE SECURITY & BLUEPRINT SUITE');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // 1. Verify Firestore SDK Initialization & Non-Destructive Health Check Helper
  // ---------------------------------------------------------------------------
  console.log('1. Verifying Firestore SDK Initialization (`src/lib/firebase.ts`)...');
  assertCheck(
    'Singleton FirebaseApp, Auth, RTDB, and Firestore instances initialized',
    Boolean(app && auth && firestore)
  );
  assertCheck(
    'Configured Firestore database ID matches firebase-applet-config.json',
    firestoreDatabaseId === '(default)' &&
      FIREBASE_CONFIG_METADATA.firestoreDatabaseId === firestoreDatabaseId,
    `Got: ${firestoreDatabaseId}`
  );
  assertCheck(
    'Firestore configuration validation reports valid',
    firestoreConfigValidation.valid === true
  );

  // Verify structured handleFirestoreError throws sanitized JSON
  let caughtStructuredError = false;
  try {
    handleFirestoreError(
      new Error('Missing or insufficient permissions.'),
      OperationType.GET,
      'outstandingPayments/INV-2026-001'
    );
  } catch (err) {
    const parsed = JSON.parse((err as Error).message);
    caughtStructuredError =
      parsed.operationType === 'get' &&
      parsed.path === 'outstandingPayments/INV-2026-001' &&
      typeof parsed.authInfo === 'object' &&
      !JSON.stringify(parsed).includes('AIza');
  }
  assertCheck(
    'handleFirestoreError throws structured FirestoreErrorInfo JSON without exposing API keys',
    caughtStructuredError
  );
  assertCheck(
    'Non-destructive checkFirestoreConnectionHealth helper is exported as a function',
    typeof checkFirestoreConnectionHealth === 'function'
  );

  // ---------------------------------------------------------------------------
  // 2. Verify /firebase-blueprint.json Schema & 22-Collection Coverage
  // ---------------------------------------------------------------------------
  console.log('\n2. Verifying `/firebase-blueprint.json` & `/firestore.rules` Structural Parity...');
  const blueprintPath = path.join(ROOT_DIR, 'firebase-blueprint.json');
  const rulesPath = path.join(ROOT_DIR, 'firestore.rules');
  const specPath = path.join(ROOT_DIR, 'security_spec.md');

  const blueprintRaw = fs.readFileSync(blueprintPath, 'utf-8');
  const rulesRaw = fs.readFileSync(rulesPath, 'utf-8');
  const specRaw = fs.readFileSync(specPath, 'utf-8');
  const blueprint = JSON.parse(blueprintRaw);

  const expectedCollections = [
    'users',
    'systemConfig',
    'customers',
    'products',
    'salesOrders',
    'dispatches',
    'rawMaterials',
    'stockMovements',
    'qualityInspections',
    'outstandingPayments',
    'actionQueue',
    'auditLogs',
    'quotations',
    'tenders',
    'suppliers',
    'purchaseOrders',
    'machineLogs',
    'furnaceLogs',
    'maintenanceTickets',
    'powerLogs',
    'dimensionalReports',
    'jobCostSheets',
    'tasks',
    'handovers',
    'purchaseRequisitions',
    'ncrCapaRecords',
    'paymentFollowUps',
  ];

  const blueprintFirestoreKeys = Object.keys(blueprint.firestore || {});
  assertCheck(
    'firebase-blueprint.json defines all 27 Firestore collection paths',
    blueprintFirestoreKeys.length === 27 &&
      expectedCollections.every((col) =>
        blueprintFirestoreKeys.some((k) => k.startsWith(`/${col}/`))
      ),
    `Found ${blueprintFirestoreKeys.length} paths`
  );

  assertCheck(
    'Every collection in firebase-blueprint.json maps to a valid EntityDefinition with required fields',
    blueprintFirestoreKeys.every((pathKey) => {
      const schemaName = blueprint.firestore[pathKey].schema;
      const entity = blueprint.entities?.[schemaName];
      return (
        entity &&
        entity.type === 'object' &&
        Array.isArray(entity.required) &&
        entity.required.length > 0
      );
    })
  );

  assertCheck(
    'firestore.rules uses rules_version = \'2\', default deny catch-all, and match blocks for all 27 collections',
    rulesRaw.includes("rules_version = '2';") &&
      rulesRaw.includes('match /{document=**}') &&
      rulesRaw.includes('allow read, write: if false;') &&
      expectedCollections.every((col) => rulesRaw.includes(`match /${col}/{`))
  );

  assertCheck(
    'security_spec.md documents all 27 collections and the Dirty Dozen payloads',
    expectedCollections.every((col) => specRaw.includes(`/${col}`)) &&
      specRaw.includes('Dirty Dozen')
  );

  // ---------------------------------------------------------------------------
  // 3. ANTLR4 Parser & @firebase/eslint-plugin-security-rules Static Analysis
  // ---------------------------------------------------------------------------
  console.log('\n3. Running ANTLR4 Grammar Parser & `@firebase/eslint-plugin-security-rules`...');
  const parseResult = (firebaseRulesPlugin as any).parser.parseForESLint(rulesRaw);
  assertCheck(
    'ANTLR4 Security Rules Parser parses /firestore.rules with valid AST',
    Boolean(parseResult?.ast && parseResult?.services?.tree)
  );

  const eslint = new ESLint({
    overrideConfigFile: path.join(ROOT_DIR, 'eslint.config.js'),
  });
  const lintResults = await eslint.lintFiles(['firestore.rules']);
  const totalLintErrors = lintResults.reduce((acc, r) => acc + r.errorCount, 0);
  const totalLintWarnings = lintResults.reduce((acc, r) => acc + r.warningCount, 0);
  assertCheck(
    '`@firebase/eslint-plugin-security-rules` reports 0 errors and 0 warnings on /firestore.rules',
    totalLintErrors === 0 && totalLintWarnings === 0,
    `Errors: ${totalLintErrors}, Warnings: ${totalLintWarnings}`
  );

  // ---------------------------------------------------------------------------
  // 4. Setup Authoritative User Directory & Valid Sample Payloads for All 22 Collections
  // ---------------------------------------------------------------------------
  const usersDb: Record<string, Record<string, any>> = {};
  for (const role of CANONICAL_USER_ROLES) {
    const uid = `uid_${role}`;
    usersDb[uid] = {
      uid,
      email: `${role}@montexforge.com`,
      displayName: `Employee ${role.toUpperCase()}`,
      role,
      department: 'Operations',
      accountStatus: 'active',
      createdAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z',
      dataOrigin: 'production',
    };
  }
  usersDb['uid_suspended'] = {
    uid: 'uid_suspended',
    email: 'suspended@montexforge.com',
    displayName: 'Suspended User',
    role: 'sales',
    department: 'Sales',
    accountStatus: 'suspended',
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
  };

  const authForRole = (role: UserRole): RuleAuthContext => ({
    uid: `uid_${role}`,
    token: {
      email: `${role}@montexforge.com`,
      email_verified: true,
    },
  });

  const validDocs: Record<string, { id: string; data: Record<string, any> }> = {
    users: {
      id: 'uid_new_emp',
      data: {
        uid: 'uid_new_emp',
        email: 'new.emp@montexforge.com',
        displayName: 'New Employee',
        role: 'sales',
        department: 'Sales & Marketing',
        accountStatus: 'active',
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      },
    },
    systemConfig: {
      id: 'dashboardKpis',
      data: {
        configId: 'dashboardKpis',
        configType: 'dashboardKpis',
        totalOrderBookValue: 0,
        activeOrdersCount: 0,
        updatedAt: '2026-04-01T00:00:00Z',
      },
    },
    customers: {
      id: 'CUST-001',
      data: {
        id: 'CUST-001',
        name: 'Larsen & Toubro Heavy Engg',
        contactPerson: 'R. Deshmukh',
        email: 'procurement@lnt.com',
        creditLimit: 5000000,
        status: 'Active',
        createdAt: '2026-04-01T00:00:00Z',
      },
    },
    products: {
      id: 'PROD-001',
      data: {
        id: 'PROD-001',
        name: 'WNRF Flange 24 Inch Class 600',
        category: 'Flanges',
        steelGrade: 'ASTM A105',
        standardWeightKg: 420,
        unitPrice: 68000,
        status: 'Active',
        createdAt: '2026-04-01T00:00:00Z',
      },
    },
    salesOrders: {
      id: 'MF-2026-101',
      data: {
        orderId: 'MF-2026-101',
        customerName: 'Larsen & Toubro Heavy Engg',
        productName: 'WNRF Flange 24 Inch Class 600',
        steelGrade: 'ASTM A105',
        quantityMT: 25,
        totalValueINR: 3850000,
        orderDate: '2026-04-01',
        committedDeliveryDate: '2026-05-15',
        currentStage: 'Order Confirmed',
        overallStatus: 'On Track',
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      },
    },
    dispatches: {
      id: 'DSP-2026-001',
      data: {
        id: 'DSP-2026-001',
        orderId: 'MF-2026-101',
        customerName: 'Larsen & Toubro Heavy Engg',
        quantityTons: 12.5,
        dispatchDate: '2026-04-20',
        status: 'Scheduled',
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      },
    },
    rawMaterials: {
      id: 'RM-A105',
      data: {
        gradeId: 'RM-A105',
        steelGrade: 'ASTM A105',
        availableMT: 85,
        reorderLevelMT: 30,
        status: 'Healthy',
        lastUpdated: '2026-04-01T00:00:00Z',
      },
    },
    stockMovements: {
      id: 'MOV-2026-001',
      data: {
        id: 'MOV-2026-001',
        gradeId: 'RM-A105',
        steelGrade: 'ASTM A105',
        type: 'INWARD',
        quantityTons: 25,
        performedBy: 'Stores Manager',
        timestamp: '2026-04-01T00:00:00Z',
      },
    },
    qualityInspections: {
      id: 'QI-2026-001',
      data: {
        id: 'QI-2026-001',
        batchId: 'BATCH-A105-01',
        orderId: 'MF-2026-101',
        inspectedQtyMT: 12.5,
        acceptedQtyMT: 12.2,
        rejectedQtyMT: 0.3,
        status: 'Approved',
        inspectionDate: '2026-04-12',
        createdAt: '2026-04-12T00:00:00Z',
      },
    },
    outstandingPayments: {
      id: 'INV-2026-001',
      data: {
        invoiceId: 'INV-2026-001',
        customerName: 'Larsen & Toubro Heavy Engg',
        invoiceDate: '2026-03-01',
        dueDate: '2026-03-31',
        invoiceAmountINR: 1850000,
        receivedAmountINR: 850000,
        balanceAmountINR: 1000000,
        ageingBucket: '0-30 Days',
        status: 'Due Soon',
        updatedAt: '2026-04-01T00:00:00Z',
      },
    },
    actionQueue: {
      id: 'ACT-2026-001',
      data: {
        id: 'ACT-2026-001',
        category: 'Inventory',
        severity: 'HIGH',
        title: 'Low stock alert on F316L',
        status: 'OPEN',
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      },
    },
    auditLogs: {
      id: 'AUD-2026-001',
      data: {
        id: 'AUD-2026-001',
        timestamp: '2026-04-01T00:00:00Z',
        actorUid: 'uid_sales',
        actorRole: 'sales',
        action: 'ORDER_CREATED',
        module: 'sales_orders',
        details: 'Created Sales Order MF-2026-101',
      },
    },
    quotations: {
      id: 'QTN-2026-001',
      data: {
        id: 'QTN-2026-001',
        quoteNo: 'MF/QTN/26-27/001',
        customerName: 'BHEL Trichy',
        productName: 'Forged Alloy Shaft',
        steelGrade: '42CrMo4',
        quantityMT: 18,
        totalValueINR: 3240000,
        status: 'Sent',
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      },
    },
    tenders: {
      id: 'TND-2026-001',
      data: {
        id: 'TND-2026-001',
        tenderNo: 'IOCL/2026/FLG-88',
        issuingAuthority: 'Indian Oil Corporation Ltd',
        projectTitle: 'High Pressure Refinery Flanges Supply',
        estimatedValueINR: 14500000,
        submissionDeadline: '2026-05-01',
        technicalBidStatus: 'Submitted',
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      },
    },
    suppliers: {
      id: 'SUP-001',
      data: {
        id: 'SUP-001',
        name: 'Kalyani Carpenter Special Steels',
        leadTimeDays: 14,
        approvalStatus: 'Approved',
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      },
    },
    purchaseOrders: {
      id: 'PO-2026-001',
      data: {
        id: 'PO-2026-001',
        poNumber: 'MF/PO/26-27/001',
        supplierName: 'Kalyani Carpenter Special Steels',
        steelGrade: 'ASTM A105',
        orderedMT: 50,
        ratePerMT: 68500,
        totalAmountINR: 3425000,
        expectedDeliveryDate: '2026-04-18',
        status: 'Issued',
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      },
    },
    machineLogs: {
      id: 'MLG-2026-001',
      data: {
        id: 'MLG-2026-001',
        machineId: 'PRESS-2000T',
        machineName: '2000T Hydraulic Open Die Press',
        shift: 'Shift A',
        operationType: 'Open Die Forging',
        outputTons: 14.2,
        status: 'Running',
        loggedAt: '2026-04-01T08:00:00Z',
        updatedAt: '2026-04-01T08:00:00Z',
      },
    },
    furnaceLogs: {
      id: 'FLG-2026-001',
      data: {
        id: 'FLG-2026-001',
        furnaceId: 'HT-FURNACE-02',
        batchNo: 'HT-2026-044',
        cycleType: 'Normalizing',
        targetTempC: 910,
        chargeWeightMT: 16.5,
        status: 'Soaking',
        startedAt: '2026-04-01T06:00:00Z',
        updatedAt: '2026-04-01T09:00:00Z',
      },
    },
    maintenanceTickets: {
      id: 'MNT-2026-001',
      data: {
        id: 'MNT-2026-001',
        ticketNo: 'MNT/26/019',
        machineId: 'RING-MILL-01',
        machineName: 'Radial Axial Ring Rolling Mill',
        maintenanceType: 'Hydraulic Seal',
        priority: 'High',
        issueDescription: 'Main mandrel pressure drop observed during rolling.',
        status: 'Open',
        reportedAt: '2026-04-01T07:30:00Z',
        updatedAt: '2026-04-01T07:30:00Z',
      },
    },
    powerLogs: {
      id: 'PWR-2026-001',
      data: {
        id: 'PWR-2026-001',
        logDate: '2026-04-01',
        shift: 'Shift A',
        electricityKwh: 8420,
        productionOutputMT: 18.5,
        kwhPerMT: 455.1,
        createdAt: '2026-04-01T14:00:00Z',
        updatedAt: '2026-04-01T14:00:00Z',
      },
    },
    dimensionalReports: {
      id: 'DIM-2026-001',
      data: {
        id: 'DIM-2026-001',
        reportNo: 'DIM/26/101',
        orderId: 'MF-2026-101',
        outerDiaNominalMm: 815,
        outerDiaObservedMm: 815.4,
        toleranceResult: 'Within Tolerance',
        inspectedAt: '2026-04-12T11:00:00Z',
        updatedAt: '2026-04-12T11:00:00Z',
      },
    },
    jobCostSheets: {
      id: 'JCS-2026-001',
      data: {
        id: 'JCS-2026-001',
        orderId: 'MF-2026-101',
        customerName: 'Larsen & Toubro Heavy Engg',
        rawMaterialCostINR: 1712500,
        forgingConversionCostINR: 620000,
        totalActualCostINR: 2890000,
        salesRealizationINR: 3850000,
        grossMarginPct: 24.93,
        costStatus: 'Provisional',
        updatedAt: '2026-04-15T00:00:00Z',
      },
    },
    tasks: {
      id: 'TSK-2026-001',
      data: {
        id: 'TSK-2026-001',
        taskNo: 'TSK-2026-001',
        title: 'Verify MTC 3.1 chemical & UT results for MF-2026-101',
        department: 'Quality',
        assignedRole: 'quality',
        assignedToUid: 'uid_quality',
        assignedToName: 'Employee QUALITY',
        priority: 'High',
        status: 'Submitted for Verification',
        dueDate: '2026-04-15',
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      },
    },
    handovers: {
      id: 'HND-2026-001',
      data: {
        id: 'HND-2026-001',
        handoverCode: 'H-1',
        orderId: 'MF-2026-101',
        customerName: 'Larsen & Toubro Heavy Engg',
        productName: 'WNRF Flange 24 Inch Class 600',
        fromDepartment: 'Sales & Marketing',
        fromRole: 'sales',
        fromUid: 'uid_sales',
        fromUserName: 'Employee SALES',
        toDepartment: 'Stores & PPC',
        toRole: 'stores',
        status: 'Pending Acceptance',
        initiatedAt: '2026-04-01T09:00:00Z',
        updatedAt: '2026-04-01T09:00:00Z',
      },
    },
    purchaseRequisitions: {
      id: 'PR-2026-001',
      data: {
        id: 'PR-2026-001',
        prNumber: 'MF/PR/26-27/001',
        steelGrade: 'ASTM A105',
        requiredMT: 30,
        requiredByDate: '2026-04-20',
        requestedByUid: 'uid_stores',
        requestedByName: 'Employee STORES',
        requestedByRole: 'stores',
        priority: 'High',
        status: 'Pending Approval',
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      },
    },
    ncrCapaRecords: {
      id: 'NCR-2026-001',
      data: {
        id: 'NCR-2026-001',
        ncrNumber: 'MF/NCR/26-27/001',
        orderId: 'MF-2026-101',
        batchId: 'BATCH-A105-01',
        defectCategory: 'Dimensional',
        defectDescription: 'OD +1.2mm oversize on rough turned ring',
        affectedQtyMT: 1.4,
        disposition: 'Rework',
        status: 'Open',
        raisedByUid: 'uid_quality',
        raisedByName: 'Employee QUALITY',
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      },
    },
    paymentFollowUps: {
      id: 'PFU-2026-001',
      data: {
        id: 'PFU-2026-001',
        invoiceId: 'INV-2026-001',
        customerName: 'Larsen & Toubro Heavy Engg',
        contactPerson: 'R. Deshmukh',
        followUpDate: '2026-04-01',
        nextFollowUpDate: '2026-04-05',
        followUpMode: 'Phone Call',
        outcome: 'Payment Promised',
        loggedByUid: 'uid_sales',
        loggedByName: 'Employee SALES',
        loggedByRole: 'sales',
        createdAt: '2026-04-01T00:00:00Z',
        updatedAt: '2026-04-01T00:00:00Z',
      },
    },
  };

  // ---------------------------------------------------------------------------
  // 5. Unauthenticated Access Denied Across All 22 Collections
  // ---------------------------------------------------------------------------
  console.log('\n4. Testing Unauthenticated Access Denial Across All 22 Collections...');
  let unauthAllowedCount = 0;
  for (const col of expectedCollections) {
    const sample = validDocs[col];
    for (const op of ['get', 'list', 'create', 'update', 'delete'] as FirestoreOperation[]) {
      const allowed = evaluateFirestoreRule({
        op,
        collection: col,
        docId: sample.id,
        auth: null,
        existingData: sample.data,
        incomingData: sample.data,
        usersDb,
      });
      if (allowed) unauthAllowedCount++;
    }
  }
  assertCheck(
    'Unauthenticated requests are denied across all 22 collections and all 5 operations (110/110 denied)',
    unauthAllowedCount === 0,
    `Allowed count: ${unauthAllowedCount}`
  );

  // ---------------------------------------------------------------------------
  // 6. Granular 8-Role Access Matrix & Cross-Role Production Isolation
  // ---------------------------------------------------------------------------
  console.log('\n5. Testing 8 Canonical Roles Allowed & Denied Operations...');

  // 6.1 Super Admin permissions
  assertCheck(
    'super_admin can provision employee profiles and update alertThresholds',
    evaluateFirestoreRule({
      op: 'create',
      collection: 'users',
      docId: validDocs.users.id,
      auth: authForRole('super_admin'),
      incomingData: validDocs.users.data,
      usersDb,
    }) &&
      evaluateFirestoreRule({
        op: 'update',
        collection: 'systemConfig',
        docId: 'alertThresholds',
        auth: authForRole('super_admin'),
        existingData: {
          configId: 'alertThresholds',
          configType: 'alertThresholds',
          Low_Stock_Threshold_Tons: 25,
          updatedAt: '2026-04-01T00:00:00Z',
        },
        incomingData: {
          configId: 'alertThresholds',
          configType: 'alertThresholds',
          Low_Stock_Threshold_Tons: 30,
          updatedAt: '2026-04-02T00:00:00Z',
        },
        usersDb,
      })
  );

  // 6.2 CEO (Higher Authority) full operational access + operational employee approval vs Super Admin & CEO privilege escalation protection
  assertCheck(
    'ceo (Higher Authority) can read/write operational collections and approve operational roles (e.g. stores/sales), but CANNOT assign ceo or super_admin, modify existing ceo/super_admin accounts, or spoof approvedByUid',
    evaluateFirestoreRule({
      op: 'get',
      collection: 'outstandingPayments',
      docId: validDocs.outstandingPayments.id,
      auth: authForRole('ceo'),
      existingData: validDocs.outstandingPayments.data,
      usersDb,
    }) &&
      evaluateFirestoreRule({
        op: 'get',
        collection: 'jobCostSheets',
        docId: validDocs.jobCostSheets.id,
        auth: authForRole('ceo'),
        existingData: validDocs.jobCostSheets.data,
        usersDb,
      }) &&
      evaluateFirestoreRule({
        op: 'get',
        collection: 'auditLogs',
        docId: validDocs.auditLogs.id,
        auth: authForRole('ceo'),
        existingData: validDocs.auditLogs.data,
        usersDb,
      }) &&
      evaluateFirestoreRule({
        op: 'create',
        collection: 'salesOrders',
        docId: validDocs.salesOrders.id,
        auth: authForRole('ceo'),
        incomingData: validDocs.salesOrders.data,
        usersDb,
      }) &&
      evaluateFirestoreRule({
        op: 'create',
        collection: 'rawMaterials',
        docId: validDocs.rawMaterials.id,
        auth: authForRole('ceo'),
        incomingData: validDocs.rawMaterials.data,
        usersDb,
      }) &&
      // CEO CAN approve/update an operational employee (e.g. stores) with matching approvedByUid
      evaluateFirestoreRule({
        op: 'update',
        collection: 'users',
        docId: validDocs.users.id,
        auth: authForRole('ceo'),
        existingData: validDocs.users.data,
        incomingData: {
          ...validDocs.users.data,
          role: 'stores',
          legacyRole: 'stores',
          rbacGroup: 'Production',
          approvedByUid: 'uid_ceo',
        },
        usersDb,
      }) &&
      // CEO CANNOT promote anyone to ceo
      !evaluateFirestoreRule({
        op: 'update',
        collection: 'users',
        docId: validDocs.users.id,
        auth: authForRole('ceo'),
        existingData: validDocs.users.data,
        incomingData: { ...validDocs.users.data, role: 'ceo' },
        usersDb,
      }) &&
      // CEO CANNOT promote anyone to super_admin or legacyRole='super_admin'
      !evaluateFirestoreRule({
        op: 'update',
        collection: 'users',
        docId: validDocs.users.id,
        auth: authForRole('ceo'),
        existingData: validDocs.users.data,
        incomingData: { ...validDocs.users.data, role: 'super_admin' },
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'update',
        collection: 'users',
        docId: validDocs.users.id,
        auth: authForRole('ceo'),
        existingData: validDocs.users.data,
        incomingData: { ...validDocs.users.data, role: 'sales', legacyRole: 'super_admin' },
        usersDb,
      }) &&
      // CEO CANNOT modify an existing super_admin account
      !evaluateFirestoreRule({
        op: 'update',
        collection: 'users',
        docId: 'uid_super_admin',
        auth: authForRole('ceo'),
        existingData: usersDb['uid_super_admin'],
        incomingData: { ...usersDb['uid_super_admin'], role: 'sales' },
        usersDb,
      }) &&
      // CEO CANNOT spoof another admin's UID in approvedByUid
      !evaluateFirestoreRule({
        op: 'update',
        collection: 'users',
        docId: validDocs.users.id,
        auth: authForRole('ceo'),
        existingData: validDocs.users.data,
        incomingData: {
          ...validDocs.users.data,
          role: 'stores',
          approvedByUid: 'uid_super_admin',
        },
        usersDb,
      }) &&
      // Active non-admin (sales) CANNOT tamper with legacyRole or approvedByUid on own profile
      !evaluateFirestoreRule({
        op: 'update',
        collection: 'users',
        docId: 'uid_sales',
        auth: authForRole('sales'),
        existingData: usersDb['uid_sales'],
        incomingData: {
          ...usersDb['uid_sales'],
          legacyRole: 'super_admin',
          updatedAt: '2026-04-02T00:00:00Z',
        },
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'update',
        collection: 'users',
        docId: 'uid_sales',
        auth: authForRole('sales'),
        existingData: usersDb['uid_sales'],
        incomingData: {
          ...usersDb['uid_sales'],
          approvedByUid: 'uid_sales',
          updatedAt: '2026-04-02T00:00:00Z',
        },
        usersDb,
      })
  );

  // 6.3 Sales permissions
  assertCheck(
    'sales can create/update salesOrders, quotations, tenders, customers, and products, but cannot write dispatches or read jobCostSheets',
    evaluateFirestoreRule({
      op: 'create',
      collection: 'salesOrders',
      docId: validDocs.salesOrders.id,
      auth: authForRole('sales'),
      incomingData: validDocs.salesOrders.data,
      usersDb,
    }) &&
      evaluateFirestoreRule({
        op: 'create',
        collection: 'quotations',
        docId: validDocs.quotations.id,
        auth: authForRole('sales'),
        incomingData: validDocs.quotations.data,
        usersDb,
      }) &&
      evaluateFirestoreRule({
        op: 'create',
        collection: 'tenders',
        docId: validDocs.tenders.id,
        auth: authForRole('sales'),
        incomingData: validDocs.tenders.data,
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'create',
        collection: 'dispatches',
        docId: validDocs.dispatches.id,
        auth: authForRole('sales'),
        incomingData: validDocs.dispatches.data,
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'get',
        collection: 'jobCostSheets',
        docId: validDocs.jobCostSheets.id,
        auth: authForRole('sales'),
        existingData: validDocs.jobCostSheets.data,
        usersDb,
      })
  );

  // 6.3b Customer Master read/write boundaries & null-safe /users/{uid} owner get
  assertCheck(
    'All 8 active roles can read /customers, only super_admin/ceo/sales/finance can write /customers, and owner GET on missing /users/{uid} is null-safe',
    CANONICAL_USER_ROLES.every((r) =>
      evaluateFirestoreRule({
        op: 'list',
        collection: 'customers',
        docId: validDocs.customers.id,
        auth: authForRole(r),
        existingData: validDocs.customers.data,
        usersDb,
      })
    ) &&
      (['super_admin', 'ceo', 'sales', 'finance'] as UserRole[]).every((r) =>
        evaluateFirestoreRule({
          op: 'create',
          collection: 'customers',
          docId: validDocs.customers.id,
          auth: authForRole(r),
          incomingData: validDocs.customers.data,
          usersDb,
        })
      ) &&
      (['stores', 'purchase', 'quality', 'dispatch'] as UserRole[]).every(
        (r) =>
          !evaluateFirestoreRule({
            op: 'create',
            collection: 'customers',
            docId: validDocs.customers.id,
            auth: authForRole(r),
            incomingData: validDocs.customers.data,
            usersDb,
          })
      ) &&
      evaluateFirestoreRule({
        op: 'get',
        collection: 'users',
        docId: 'uid_missing_profile',
        auth: {
          uid: 'uid_missing_profile',
          token: { email: 'emp@montexforge.com', email_verified: true },
        },
        existingData: null,
        usersDb,
      })
  );

  // 6.4 Stores permissions & intra-Production isolation
  assertCheck(
    'stores can create rawMaterials, stockMovements, machineLogs, furnaceLogs, maintenanceTickets, and powerLogs, and update GRN fields on purchaseOrders',
    evaluateFirestoreRule({
      op: 'create',
      collection: 'rawMaterials',
      docId: validDocs.rawMaterials.id,
      auth: authForRole('stores'),
      incomingData: validDocs.rawMaterials.data,
      usersDb,
    }) &&
      evaluateFirestoreRule({
        op: 'create',
        collection: 'stockMovements',
        docId: validDocs.stockMovements.id,
        auth: authForRole('stores'),
        incomingData: validDocs.stockMovements.data,
        usersDb,
      }) &&
      evaluateFirestoreRule({
        op: 'create',
        collection: 'machineLogs',
        docId: validDocs.machineLogs.id,
        auth: authForRole('stores'),
        incomingData: validDocs.machineLogs.data,
        usersDb,
      }) &&
      evaluateFirestoreRule({
        op: 'create',
        collection: 'maintenanceTickets',
        docId: validDocs.maintenanceTickets.id,
        auth: authForRole('stores'),
        incomingData: validDocs.maintenanceTickets.data,
        usersDb,
      }) &&
      evaluateFirestoreRule({
        op: 'create',
        collection: 'powerLogs',
        docId: validDocs.powerLogs.id,
        auth: authForRole('stores'),
        incomingData: validDocs.powerLogs.data,
        usersDb,
      }) &&
      evaluateFirestoreRule({
        op: 'update',
        collection: 'purchaseOrders',
        docId: validDocs.purchaseOrders.id,
        auth: authForRole('stores'),
        existingData: validDocs.purchaseOrders.data,
        incomingData: {
          ...validDocs.purchaseOrders.data,
          receivedMT: 50,
          status: 'Received',
          updatedAt: '2026-04-18T10:00:00Z',
        },
        usersDb,
      })
  );

  assertCheck(
    'Intra-Production isolation: stores CANNOT create purchaseOrders, suppliers, qualityInspections, dimensionalReports, or dispatches',
    !evaluateFirestoreRule({
      op: 'create',
      collection: 'purchaseOrders',
      docId: validDocs.purchaseOrders.id,
      auth: authForRole('stores'),
      incomingData: validDocs.purchaseOrders.data,
      usersDb,
    }) &&
      !evaluateFirestoreRule({
        op: 'create',
        collection: 'suppliers',
        docId: validDocs.suppliers.id,
        auth: authForRole('stores'),
        incomingData: validDocs.suppliers.data,
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'create',
        collection: 'qualityInspections',
        docId: validDocs.qualityInspections.id,
        auth: authForRole('stores'),
        incomingData: validDocs.qualityInspections.data,
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'create',
        collection: 'dimensionalReports',
        docId: validDocs.dimensionalReports.id,
        auth: authForRole('stores'),
        incomingData: validDocs.dimensionalReports.data,
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'create',
        collection: 'dispatches',
        docId: validDocs.dispatches.id,
        auth: authForRole('stores'),
        incomingData: validDocs.dispatches.data,
        usersDb,
      })
  );

  // 6.5 Purchase permissions & intra-Production isolation
  assertCheck(
    'purchase can create/update suppliers and purchaseOrders and read rawMaterials, but CANNOT write rawMaterials, stockMovements, machineLogs, or qualityInspections',
    evaluateFirestoreRule({
      op: 'create',
      collection: 'suppliers',
      docId: validDocs.suppliers.id,
      auth: authForRole('purchase'),
      incomingData: validDocs.suppliers.data,
      usersDb,
    }) &&
      evaluateFirestoreRule({
        op: 'create',
        collection: 'purchaseOrders',
        docId: validDocs.purchaseOrders.id,
        auth: authForRole('purchase'),
        incomingData: validDocs.purchaseOrders.data,
        usersDb,
      }) &&
      evaluateFirestoreRule({
        op: 'get',
        collection: 'rawMaterials',
        docId: validDocs.rawMaterials.id,
        auth: authForRole('purchase'),
        existingData: validDocs.rawMaterials.data,
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'update',
        collection: 'rawMaterials',
        docId: validDocs.rawMaterials.id,
        auth: authForRole('purchase'),
        existingData: validDocs.rawMaterials.data,
        incomingData: { ...validDocs.rawMaterials.data, availableMT: 500 },
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'create',
        collection: 'stockMovements',
        docId: validDocs.stockMovements.id,
        auth: authForRole('purchase'),
        incomingData: validDocs.stockMovements.data,
        usersDb,
      })
  );

  // 6.6 Quality permissions & intra-Production isolation
  assertCheck(
    'quality can create/update qualityInspections, dimensionalReports, furnaceLogs, and MTC status on salesOrders, but CANNOT write dispatches or rawMaterials',
    evaluateFirestoreRule({
      op: 'create',
      collection: 'qualityInspections',
      docId: validDocs.qualityInspections.id,
      auth: authForRole('quality'),
      incomingData: validDocs.qualityInspections.data,
      usersDb,
    }) &&
      evaluateFirestoreRule({
        op: 'create',
        collection: 'dimensionalReports',
        docId: validDocs.dimensionalReports.id,
        auth: authForRole('quality'),
        incomingData: validDocs.dimensionalReports.data,
        usersDb,
      }) &&
      evaluateFirestoreRule({
        op: 'update',
        collection: 'salesOrders',
        docId: validDocs.salesOrders.id,
        auth: authForRole('quality'),
        existingData: validDocs.salesOrders.data,
        incomingData: {
          ...validDocs.salesOrders.data,
          currentStage: 'Quality Inspection',
          mtcStatus: 'Verified',
          updatedAt: '2026-04-12T12:00:00Z',
        },
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'update',
        collection: 'salesOrders',
        docId: validDocs.salesOrders.id,
        auth: authForRole('quality'),
        existingData: validDocs.salesOrders.data,
        incomingData: {
          ...validDocs.salesOrders.data,
          totalValueINR: 9999999, // Commercial field tampering denied to quality
          updatedAt: '2026-04-12T12:00:00Z',
        },
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'create',
        collection: 'dispatches',
        docId: validDocs.dispatches.id,
        auth: authForRole('quality'),
        incomingData: validDocs.dispatches.data,
        usersDb,
      })
  );

  // 6.7 Dispatch permissions & intra-Production isolation
  assertCheck(
    'dispatch can create/update dispatches and dispatchStatus on salesOrders, but CANNOT write qualityInspections, rawMaterials, or purchaseOrders',
    evaluateFirestoreRule({
      op: 'create',
      collection: 'dispatches',
      docId: validDocs.dispatches.id,
      auth: authForRole('dispatch'),
      incomingData: validDocs.dispatches.data,
      usersDb,
    }) &&
      evaluateFirestoreRule({
        op: 'update',
        collection: 'salesOrders',
        docId: validDocs.salesOrders.id,
        auth: authForRole('dispatch'),
        existingData: validDocs.salesOrders.data,
        incomingData: {
          ...validDocs.salesOrders.data,
          currentStage: 'Dispatched',
          dispatchStatus: 'Dispatched',
          updatedAt: '2026-04-20T15:00:00Z',
        },
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'create',
        collection: 'qualityInspections',
        docId: validDocs.qualityInspections.id,
        auth: authForRole('dispatch'),
        incomingData: validDocs.qualityInspections.data,
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'create',
        collection: 'rawMaterials',
        docId: validDocs.rawMaterials.id,
        auth: authForRole('dispatch'),
        incomingData: validDocs.rawMaterials.data,
        usersDb,
      })
  );

  // 6.8 Finance permissions, R-4 Sales read access to outstandingPayments, & confidential financial data isolation
  assertCheck(
    'finance can read/write outstandingPayments and jobCostSheets; sales has read-only access to outstandingPayments (R-4) but cannot write outstandingPayments or read jobCostSheets; stores, purchase, quality, and dispatch are strictly denied both',
    evaluateFirestoreRule({
      op: 'create',
      collection: 'outstandingPayments',
      docId: validDocs.outstandingPayments.id,
      auth: authForRole('finance'),
      incomingData: validDocs.outstandingPayments.data,
      usersDb,
    }) &&
      evaluateFirestoreRule({
        op: 'create',
        collection: 'jobCostSheets',
        docId: validDocs.jobCostSheets.id,
        auth: authForRole('finance'),
        incomingData: validDocs.jobCostSheets.data,
        usersDb,
      }) &&
      // Sales can GET and LIST outstandingPayments (R-4)
      evaluateFirestoreRule({
        op: 'get',
        collection: 'outstandingPayments',
        docId: validDocs.outstandingPayments.id,
        auth: authForRole('sales'),
        existingData: validDocs.outstandingPayments.data,
        usersDb,
      }) &&
      evaluateFirestoreRule({
        op: 'list',
        collection: 'outstandingPayments',
        docId: validDocs.outstandingPayments.id,
        auth: authForRole('sales'),
        existingData: validDocs.outstandingPayments.data,
        usersDb,
      }) &&
      // Sales CANNOT create/update outstandingPayments or read jobCostSheets
      !evaluateFirestoreRule({
        op: 'create',
        collection: 'outstandingPayments',
        docId: validDocs.outstandingPayments.id,
        auth: authForRole('sales'),
        incomingData: validDocs.outstandingPayments.data,
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'get',
        collection: 'jobCostSheets',
        docId: validDocs.jobCostSheets.id,
        auth: authForRole('sales'),
        existingData: validDocs.jobCostSheets.data,
        usersDb,
      }) &&
      (['stores', 'purchase', 'quality', 'dispatch'] as UserRole[]).every(
        (nonFinanceRole) =>
          !evaluateFirestoreRule({
            op: 'get',
            collection: 'outstandingPayments',
            docId: validDocs.outstandingPayments.id,
            auth: authForRole(nonFinanceRole),
            existingData: validDocs.outstandingPayments.data,
            usersDb,
          }) &&
          !evaluateFirestoreRule({
            op: 'list',
            collection: 'outstandingPayments',
            docId: validDocs.outstandingPayments.id,
            auth: authForRole(nonFinanceRole),
            existingData: validDocs.outstandingPayments.data,
            usersDb,
          }) &&
          !evaluateFirestoreRule({
            op: 'get',
            collection: 'jobCostSheets',
            docId: validDocs.jobCostSheets.id,
            auth: authForRole(nonFinanceRole),
            existingData: validDocs.jobCostSheets.data,
            usersDb,
          }) &&
          !evaluateFirestoreRule({
            op: 'list',
            collection: 'jobCostSheets',
            docId: validDocs.jobCostSheets.id,
            auth: authForRole(nonFinanceRole),
            existingData: validDocs.jobCostSheets.data,
            usersDb,
          })
      )
  );

  // 6.9 Maker != Checker Separation of Duties on /tasks, /handovers, and /purchaseRequisitions
  assertCheck(
    'Maker != Checker SoD: Employees cannot self-verify their own /tasks, self-accept their own /handovers, or self-approve their own /purchaseRequisitions',
    !evaluateFirestoreRule({
      op: 'update',
      collection: 'tasks',
      docId: validDocs.tasks.id,
      auth: authForRole('quality'),
      existingData: validDocs.tasks.data,
      incomingData: {
        ...validDocs.tasks.data,
        status: 'Verified & Approved',
        updatedAt: '2026-04-02T00:00:00Z',
      },
      usersDb,
    }) &&
      evaluateFirestoreRule({
        op: 'update',
        collection: 'tasks',
        docId: validDocs.tasks.id,
        auth: authForRole('ceo'),
        existingData: validDocs.tasks.data,
        incomingData: {
          ...validDocs.tasks.data,
          status: 'Verified & Approved',
          updatedAt: '2026-04-02T00:00:00Z',
        },
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'update',
        collection: 'handovers',
        docId: validDocs.handovers.id,
        auth: authForRole('sales'),
        existingData: validDocs.handovers.data,
        incomingData: {
          ...validDocs.handovers.data,
          status: 'Accepted',
          updatedAt: '2026-04-02T00:00:00Z',
        },
        usersDb,
      }) &&
      evaluateFirestoreRule({
        op: 'update',
        collection: 'handovers',
        docId: validDocs.handovers.id,
        auth: authForRole('stores'),
        existingData: validDocs.handovers.data,
        incomingData: {
          ...validDocs.handovers.data,
          status: 'Accepted',
          updatedAt: '2026-04-02T00:00:00Z',
        },
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'update',
        collection: 'purchaseRequisitions',
        docId: validDocs.purchaseRequisitions.id,
        auth: authForRole('purchase'),
        existingData: {
          ...validDocs.purchaseRequisitions.data,
          requestedByUid: 'uid_purchase',
          requestedByRole: 'purchase',
        },
        incomingData: {
          ...validDocs.purchaseRequisitions.data,
          requestedByUid: 'uid_purchase',
          requestedByRole: 'purchase',
          status: 'Approved',
          updatedAt: '2026-04-02T00:00:00Z',
        },
        usersDb,
      })
  );

  // ---------------------------------------------------------------------------
  // 7. Phase 0: The "Dirty Dozen" Adversarial Payloads Verification
  // ---------------------------------------------------------------------------
  console.log('\n6. Executing Phase 0 "Dirty Dozen" Adversarial Attack Payloads...');

  // Payload #1: Self-promotion on user profile creation
  assertCheck(
    'Dirty Dozen #1 Blocked: Self-promotion to super_admin on /users/{uid} creation is denied',
    !evaluateFirestoreRule({
      op: 'create',
      collection: 'users',
      docId: 'attacker_01',
      auth: { uid: 'attacker_01', token: { email: 'attacker@example.com', email_verified: true } },
      incomingData: {
        ...validDocs.users.data,
        uid: 'attacker_01',
        email: 'attacker@example.com',
        role: 'super_admin',
      },
      usersDb,
    })
  );

  // Payload #2: Self-promotion on own user profile update
  assertCheck(
    'Dirty Dozen #2 Blocked: Employee updating own /users/{uid} role to super_admin is denied',
    !evaluateFirestoreRule({
      op: 'update',
      collection: 'users',
      docId: 'uid_sales',
      auth: authForRole('sales'),
      existingData: usersDb['uid_sales'],
      incomingData: {
        ...usersDb['uid_sales'],
        role: 'super_admin',
        updatedAt: '2026-04-02T00:00:00Z',
      },
      usersDb,
    })
  );

  // Payload #3: Bootstrap admin email spoofing with email_verified: false
  assertCheck(
    'Dirty Dozen #3 Blocked: Spoofed bootstrap admin email with email_verified == false is denied',
    !evaluateFirestoreRule({
      op: 'create',
      collection: 'users',
      docId: validDocs.users.id,
      auth: {
        uid: 'spoof_uid',
        token: { email: 'anshyadav6647@gmail.com', email_verified: false },
      },
      incomingData: validDocs.users.data,
      usersDb,
    })
  );

  // Payload #4: Suspended / deactivated employee token reuse
  assertCheck(
    'Dirty Dozen #4 Blocked: Suspended employee account (accountStatus == "suspended") is denied read/write access',
    !evaluateFirestoreRule({
      op: 'get',
      collection: 'salesOrders',
      docId: validDocs.salesOrders.id,
      auth: {
        uid: 'uid_suspended',
        token: { email: 'suspended@montexforge.com', email_verified: true },
      },
      existingData: validDocs.salesOrders.data,
      usersDb,
    })
  );

  // Payload #5: Stores role attempting to create a Purchase Order
  assertCheck(
    'Dirty Dozen #5 Blocked: stores user attempting to create /purchaseOrders is denied',
    !evaluateFirestoreRule({
      op: 'create',
      collection: 'purchaseOrders',
      docId: validDocs.purchaseOrders.id,
      auth: authForRole('stores'),
      incomingData: validDocs.purchaseOrders.data,
      usersDb,
    })
  );

  // Payload #6: Purchase role attempting to mutate Raw Material stock balance
  assertCheck(
    'Dirty Dozen #6 Blocked: purchase user attempting to update /rawMaterials stock balance is denied',
    !evaluateFirestoreRule({
      op: 'update',
      collection: 'rawMaterials',
      docId: validDocs.rawMaterials.id,
      auth: authForRole('purchase'),
      existingData: validDocs.rawMaterials.data,
      incomingData: { ...validDocs.rawMaterials.data, availableMT: 999 },
      usersDb,
    })
  );

  // Payload #7: Dispatch role attempting to forge a Quality Inspection record
  assertCheck(
    'Dirty Dozen #7 Blocked: dispatch user attempting to create /qualityInspections is denied',
    !evaluateFirestoreRule({
      op: 'create',
      collection: 'qualityInspections',
      docId: validDocs.qualityInspections.id,
      auth: authForRole('dispatch'),
      incomingData: validDocs.qualityInspections.data,
      usersDb,
    })
  );

  // Payload #8: Non-owner employee attempting to read another employee's PII profile
  assertCheck(
    'Dirty Dozen #8 Blocked: Non-admin employee attempting to read another employee profile (/users/uid_finance) is denied',
    !evaluateFirestoreRule({
      op: 'get',
      collection: 'users',
      docId: 'uid_finance',
      auth: authForRole('sales'),
      existingData: usersDb['uid_finance'],
      usersDb,
    })
  );

  // Payload #9: Audit log tampering / deletion & actorUid spoofing
  assertCheck(
    'Dirty Dozen #9 Blocked: /auditLogs update and delete are denied even for super_admin, and actorUid spoofing on create is denied',
    !evaluateFirestoreRule({
      op: 'update',
      collection: 'auditLogs',
      docId: validDocs.auditLogs.id,
      auth: authForRole('super_admin'),
      existingData: validDocs.auditLogs.data,
      incomingData: { ...validDocs.auditLogs.data, details: 'Tampered log' },
      usersDb,
    }) &&
      !evaluateFirestoreRule({
        op: 'delete',
        collection: 'auditLogs',
        docId: validDocs.auditLogs.id,
        auth: authForRole('super_admin'),
        existingData: validDocs.auditLogs.data,
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'create',
        collection: 'auditLogs',
        docId: validDocs.auditLogs.id,
        auth: authForRole('sales'),
        incomingData: { ...validDocs.auditLogs.data, actorUid: 'uid_ceo' },
        usersDb,
      })
  );

  // Payload #10: Stock Movement ledger history rewriting
  assertCheck(
    'Dirty Dozen #10 Blocked: /stockMovements update after creation is denied for all roles',
    !evaluateFirestoreRule({
      op: 'update',
      collection: 'stockMovements',
      docId: validDocs.stockMovements.id,
      auth: authForRole('stores'),
      existingData: validDocs.stockMovements.data,
      incomingData: { ...validDocs.stockMovements.data, quantityTons: 999 },
      usersDb,
    })
  );

  // Payload #11: Shadow / Ghost Field injection
  assertCheck(
    'Dirty Dozen #11 Blocked: Shadow/ghost field injection (isApprovedByCeo: true) is rejected by strict hasOnly() schema gate',
    !evaluateFirestoreRule({
      op: 'create',
      collection: 'quotations',
      docId: validDocs.quotations.id,
      auth: authForRole('sales'),
      incomingData: {
        ...validDocs.quotations.data,
        isApprovedByCeo: true,
      },
      usersDb,
    })
  );

  // Payload #12: Path ID poisoning, negative quantities, invalid enum status, & terminal state lock
  assertCheck(
    'Dirty Dozen #12 Blocked: Invalid path IDs, negative quantities, invalid status enums, and Finalized JobCostSheet edits by non-super_admin are rejected',
    !evaluateFirestoreRule({
      op: 'create',
      collection: 'rawMaterials',
      docId: 'bad$id!@#',
      auth: authForRole('stores'),
      incomingData: { ...validDocs.rawMaterials.data, gradeId: 'bad$id!@#' },
      usersDb,
    }) &&
      !evaluateFirestoreRule({
        op: 'create',
        collection: 'rawMaterials',
        docId: validDocs.rawMaterials.id,
        auth: authForRole('stores'),
        incomingData: { ...validDocs.rawMaterials.data, availableMT: -50 },
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'create',
        collection: 'salesOrders',
        docId: validDocs.salesOrders.id,
        auth: authForRole('sales'),
        incomingData: { ...validDocs.salesOrders.data, overallStatus: 'InvalidState' },
        usersDb,
      }) &&
      !evaluateFirestoreRule({
        op: 'update',
        collection: 'jobCostSheets',
        docId: validDocs.jobCostSheets.id,
        auth: authForRole('finance'),
        existingData: { ...validDocs.jobCostSheets.data, costStatus: 'Finalized' },
        incomingData: { ...validDocs.jobCostSheets.data, costStatus: 'Finalized', grossMarginPct: 99 },
        usersDb,
      })
  );

  console.log('\n================================================================');
  console.log(
    `PHASE 2 FIRESTORE SECURITY SUMMARY: ${passed} passed, ${failed} failed`
  );
  console.log('================================================================');

  return { passed, failed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runPhase2FirestoreSecurityVerification()
    .then(({ failed }) => {
      if (failed > 0) process.exit(1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
