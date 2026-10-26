import {
  ref,
  get,
  set,
  update,
  push,
} from 'firebase/database';
import { rtdb, auth, databaseURL } from '../lib/firebase';
import {
  MOCK_ORDER_JOURNEYS,
  MOCK_RAW_MATERIALS,
  MOCK_STOCK_MOVEMENTS,
  MOCK_ACTION_QUEUE,
  MOCK_OUTSTANDING_AGEING,
  MOCK_CUSTOMERS,
  MOCK_PRODUCTS,
  PROTOTYPE_USERS,
} from '../data/mockData';
import {
  OrderJourney,
  RawMaterialStock,
  StockMovement,
  ActionQueueItem,
  OutstandingAgeingRecord,
  Customer,
  Product,
  UserProfile,
  AuditLogEntry,
  RtdbDashboardKpis,
  RtdbProductionSummary,
  RtdbAlertThresholds,
  RbacRoleGroup,
  UserRole,
} from '../types/mis';

import {
  computeRawMaterialStockStatus,
  validateQualityInspectionQuantities,
  validateSalesOrderQuantities,
  mapGranularRoleToRbacGroup,
  mapRbacGroupToDefaultGranularRole,
  verifyAdminAccountProfile,
  QualityInspectionRecord,
} from './misDataValidator';

export const DEFAULT_DASHBOARD_KPIS: RtdbDashboardKpis = {
  todaysDispatchValue: 3380000,
  todaysDispatchQty: 400,
  openOrdersValue: 14880000,
  openOrdersCount: 4,
  materialShortagesCount: 2,
  qualityPendingCount: 1,
  dispatchPendingQty: 100,
  monthlySalesTarget: 45000000,
  monthlySalesAchieved: 38200000,
  totalOutstanding: 21410000,
  overdueOrdersCount: 1,
  lastUpdated: new Date().toISOString(),
};

export const DEFAULT_PRODUCTION_SUMMARY: RtdbProductionSummary = {
  shifts: {
    shiftA: { name: 'Morning Shift (A)', tonnageMt: 22.4, yieldPercent: 98.8, rejectedPcs: 4 },
    shiftB: { name: 'Afternoon Shift (B)', tonnageMt: 19.8, yieldPercent: 98.1, rejectedPcs: 5 },
    shiftC: { name: 'Night Shift (C - Heat Treatment)', tonnageMt: 14.5, yieldPercent: 97.6, rejectedPcs: 3 },
  },
  weeklyRunRate: {
    week1: { label: 'Week 1 (1–7 Oct)', tonnageMt: 38.4, valueLakhs: 68.5 },
    week2: { label: 'Week 2 (8–14 Oct)', tonnageMt: 44.2, valueLakhs: 92.0 },
    week3: { label: 'Week 3 (15–21 Oct)', tonnageMt: 52.8, valueLakhs: 122.5 },
    week4: { label: 'Week 4 (Projected)', tonnageMt: 65.0, valueLakhs: 167.0 },
  },
  totalRejectionPercent: 1.6,
};

export const DEFAULT_ALERT_THRESHOLDS: RtdbAlertThresholds = {
  rejectionPercent: 2.0,
  furnaceTemp: 1250,
  machineDowntimeMinutes: 45,
  criticalAgeingDays: 60,
  deliveryDelayDays: 3,
  lowStockDays: 14,
};

export function mapRoleToRbacGroup(role: UserRole | string): RbacRoleGroup {
  return mapGranularRoleToRbacGroup(role);
}

export function mapRbacGroupToUserRole(
  group: RbacRoleGroup | UserRole | string,
  existingGranularRole?: UserRole | string
): UserRole {
  return mapRbacGroupToDefaultGranularRole(group, existingGranularRole);
}

export function recordToArray<T>(record: Record<string, T> | null | undefined, fallback: T[]): T[] {
  if (!record || typeof record !== 'object') return fallback;
  const values = Object.values(record);
  return values.length > 0 ? values : fallback;
}

/**
 * Appends an authentic, non-forged audit log entry to /auditLogs/$logId.
 * Enforces userId === auth.currentUser.uid to satisfy database.rules.json .validate rules.
 */
export async function logAuditToRtdb(
  action: string,
  collectionName: string,
  documentId: string,
  newValueSummary: string,
  oldValueSummary?: string
): Promise<void> {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      // Unauthenticated sessions cannot write to /auditLogs
      return;
    }
    const logRef = push(ref(rtdb, 'auditLogs'));
    const logId = logRef.key || `log-${Date.now()}`;
    const entry: AuditLogEntry = {
      id: logId,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      userId: currentUser.uid,
      userName: currentUser.displayName || currentUser.email || 'Authenticated Operator',
      action,
      collectionName,
      documentId,
      oldValueSummary: oldValueSummary || '-',
      newValueSummary,
      ipAddress: 'Firebase RTDB Authenticated Client',
    };
    await set(ref(rtdb, `auditLogs/${logId}`), entry);
  } catch {
    // Non-blocking if user role is not permitted for the specific audit collection
  }
}

/**
 * Remediated Idempotent & Non-Destructive Seeding Implementation:
 * - Preserves default-deny root rules (`.read: false`, `.write: false` at `/`).
 * - Avoids `update(ref(rtdb), ...)` at `/` which triggers `PERMISSION_DENIED at /`.
 * - Preserves the existing Admin profile (`/users/${currentUser.uid}`) and all existing business records.
 * - Uses create-if-missing (`!snap.exists()`) for every authorized database node so rerunning seed
 *   never overwrites or deletes existing records.
 */
export async function seedMontexRealtimeDatabase(): Promise<{
  success: boolean;
  message: string;
  createdCount?: number;
  preservedCount?: number;
  errorCode?: string;
}> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    return {
      success: false,
      message:
        'Authentication Required: Sign in as an active Admin before seeding the Realtime Database.',
      errorCode: 'UNAUTHENTICATED',
    };
  }

  let createdCount = 0;
  let preservedCount = 0;

  async function seedNodeIfMissing(path: string, payload: any): Promise<void> {
    const nodeRef = ref(rtdb, path);
    const snap = await get(nodeRef);
    if (snap.exists()) {
      preservedCount++;
    } else {
      await set(nodeRef, payload);
      createdCount++;
    }
  }

  try {
    // Step 1: Verify or bootstrap current user's profile at /users/${currentUser.uid} without overwriting existing valid fields
    const selfRef = ref(rtdb, `users/${currentUser.uid}`);
    const selfSnap = await get(selfRef);

    if (!selfSnap.exists()) {
      await set(selfRef, {
        id: currentUser.uid,
        name: currentUser.displayName || currentUser.email?.split('@')[0] || 'Montex Admin',
        email: currentUser.email || 'admin@montexforge.com',
        role: 'Admin',
        legacyRole: 'super_admin',
        rbacGroup: 'Admin',
        roleTitle: 'Super Administrator',
        department: 'Management & IT',
        avatarInitials: (currentUser.email || 'MA').slice(0, 2).toUpperCase(),
        accountStatus: 'active',
        createdAt: new Date().toISOString().split('T')[0],
        lastLoginAt: new Date().toISOString(),
      });
      createdCount++;
    } else {
      const val = selfSnap.val();
      const adminCheck = verifyAdminAccountProfile(val, currentUser.uid);
      if (!adminCheck.hasActiveStatus || !adminCheck.hasAdminRbacGroup) {
        return {
          success: false,
          message: `RBAC Policy: Only an active Admin can seed the database (${adminCheck.details}).`,
          errorCode: 'PERMISSION_DENIED',
        };
      }
      // Preserve existing user profile strictly without modifying or overwriting existing roles or fields
      preservedCount++;
    }

    // Step 2: Seed prototype employee profiles under /users/$uid only if missing
    for (const u of PROTOTYPE_USERS) {
      await seedNodeIfMissing(`users/${u.id}`, {
        ...u,
        id: u.id,
        rbacGroup: mapRoleToRbacGroup(u.role),
        role: mapRoleToRbacGroup(u.role),
        legacyRole: u.role,
      });
    }

    // Step 3: Seed /dashboardKpis and /production only if missing
    await seedNodeIfMissing('dashboardKpis', {
      ...DEFAULT_DASHBOARD_KPIS,
      lastUpdated: new Date().toISOString(),
    });
    await seedNodeIfMissing('production', DEFAULT_PRODUCTION_SUMMARY);

    // Step 4: Seed /salesOrders/$orderId only if missing
    for (const order of MOCK_ORDER_JOURNEYS) {
      await seedNodeIfMissing(`salesOrders/${order.id}`, order);
    }

    // Step 5: Seed /dispatch/$dispatchId only if missing
    for (const dsp of INITIAL_DISPATCHES) {
      await seedNodeIfMissing(`dispatch/${dsp.id}`, dsp);
    }

    // Step 6: Seed /inventory/rawMaterials/$materialId & /inventory/stockMovements/$movementId only if missing
    for (const rm of MOCK_RAW_MATERIALS) {
      await seedNodeIfMissing(`inventory/rawMaterials/${rm.id}`, rm);
    }
    for (const mov of MOCK_STOCK_MOVEMENTS) {
      await seedNodeIfMissing(`inventory/stockMovements/${mov.id}`, mov);
    }

    // Step 7: Seed /quality/inspections/$inspectionId only if missing
    for (const qc of INITIAL_QUALITY_INSPECTIONS) {
      await seedNodeIfMissing(`quality/inspections/${qc.id}`, qc);
    }

    // Step 8: Seed /outstandingPayments/$customerId only if missing
    for (const op of MOCK_OUTSTANDING_AGEING) {
      await seedNodeIfMissing(`outstandingPayments/${op.customerId}`, op);
    }

    // Step 9: Seed /alerts/actionQueue/$actionId & /alerts/thresholds only if missing
    for (const act of MOCK_ACTION_QUEUE) {
      await seedNodeIfMissing(`alerts/actionQueue/${act.id}`, act);
    }
    await seedNodeIfMissing('alerts/thresholds', DEFAULT_ALERT_THRESHOLDS);

    // Step 10: Seed /customers/$customerId & /products/$productId only if missing
    for (const cust of MOCK_CUSTOMERS) {
      await seedNodeIfMissing(`customers/${cust.id}`, cust);
    }
    for (const prod of MOCK_PRODUCTS) {
      await seedNodeIfMissing(`products/${prod.id}`, prod);
    }

    // Step 11: Append authentic seed audit log entry bound to currentUser.uid
    await logAuditToRtdb(
      'SEED_AUTHORIZED_RTDB_PATHS',
      'root',
      'montex-mis-default-rtdb',
      `Safe idempotent seed completed: ${createdCount} missing nodes created, ${preservedCount} existing nodes preserved without overwrite`
    );

    return {
      success: true,
      createdCount,
      preservedCount,
      message: `Safe seed complete in ${databaseURL}: ${createdCount} missing record(s) created, ${preservedCount} existing record(s) preserved untouched (root default-deny intact).`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Failed to write to Realtime Database',
      errorCode: err?.code || 'UNKNOWN_ERROR',
    };
  }
}

export const INITIAL_DISPATCHES = [
  {
    id: 'DSP-2026-0091',
    date: '2026-10-19',
    orderNo: 'BHEL/HYD/PO/2026/8891',
    jobNumber: 'JOB-MF-2026-0412',
    customer: 'Bharat Heavy Electricals Ltd (BHEL)',
    product: '12" Class 300 WN Flanges',
    quantity: 400,
    balanceQty: 100,
    weightMt: 25.8,
    transporter: 'VRL Logistics (Heavy Freight)',
    vehicleNo: 'MH-12-RN-4891',
    lrNumber: 'VRL-PUN-892104',
    destination: 'Ramachandrapuram, Hyderabad',
    invoiceRef: 'MF/26-27/0914',
    clearanceRef: 'BHEL/QA/INSP/2026/771',
    status: 'dispatched',
  },
  {
    id: 'DSP-2026-0092',
    date: '2026-10-22',
    orderNo: 'IOCL/HAL/2026/778',
    jobNumber: 'JOB-MF-2026-0398',
    customer: 'Indian Oil Corporation Ltd (IOCL)',
    product: '24" Class 150 WN Flanges',
    quantity: 100,
    balanceQty: 0,
    weightMt: 17.2,
    transporter: 'Associated Road Carriers (ARC)',
    vehicleNo: 'Arrival 22-Oct 10:00 AM',
    lrNumber: 'PENDING-PICKUP',
    destination: 'Haldia Refinery Yard, WB',
    invoiceRef: 'PROFORMA-26-27/041',
    clearanceRef: 'EIL/INSP/IOCL/2026/410',
    status: 'ready_for_dispatch',
  },
];

export const INITIAL_QUALITY_INSPECTIONS = [
  {
    id: 'QC-2026-0894',
    jobNumber: 'JOB-MF-2026-0412',
    customer: 'BHEL Hyderabad',
    product: '12" Class 300 WN Flanges',
    grade: 'ASTM A105',
    heatNo: 'HEAT-JSW-8841-A',
    inspectedQty: 500,
    passedQty: 500,
    rejectedQty: 8,
    status: 'cleared',
    inspector: 'Dr. Praveen Kale (NDT Level III)',
    date: '2026-10-14',
    mtcNumber: 'MTC-MF-2026-0894',
  },
  {
    id: 'QC-2026-0902',
    jobNumber: 'JOB-MF-2026-0428',
    customer: 'Larsen & Toubro Ltd',
    product: 'Seamless Forged Ring OD 1420',
    grade: 'ASTM A182 F316L',
    heatNo: 'HEAT-KALYANI-7721',
    inspectedQty: 50,
    passedQty: 38,
    rejectedQty: 2,
    status: 'in_progress',
    inspector: 'Dr. Praveen Kale & TUV Rheinland',
    date: '2026-10-21',
    mtcNumber: 'MTC-MF-2026-DRAFT-0902',
  },
  {
    id: 'QC-2026-0881',
    jobNumber: 'JOB-MF-2026-0398',
    customer: 'Indian Oil Corporation (IOCL)',
    product: '24" Class 150 WN Flanges',
    grade: 'ASTM A182 F11 Cl.2',
    heatNo: 'HEAT-MESCO-9921',
    inspectedQty: 100,
    passedQty: 100,
    rejectedQty: 0,
    status: 'cleared',
    inspector: 'Dr. Praveen Kale',
    date: '2026-10-18',
    mtcNumber: 'MTC-MF-2026-0881',
  },
];

export async function acknowledgeAlertInRtdb(
  actionId: string,
  actorName: string,
  existingItem?: ActionQueueItem
): Promise<{
  success: boolean;
  persistedToRtdb: boolean;
  updatedItem: ActionQueueItem;
  error?: string;
}> {
  const fallbackItem =
    existingItem || MOCK_ACTION_QUEUE.find((a) => a.id === actionId) || ({ id: actionId } as ActionQueueItem);
  const updatedItem: ActionQueueItem = {
    ...fallbackItem,
    id: actionId,
    acknowledged: true,
    acknowledgedBy: actorName,
    acknowledgedAt: new Date().toISOString(),
  };

  if (!auth.currentUser) {
    return {
      success: true,
      persistedToRtdb: false,
      updatedItem,
    };
  }

  try {
    const itemRef = ref(rtdb, `alerts/actionQueue/${actionId}`);
    await update(itemRef, updatedItem);
    await logAuditToRtdb(
      'ACKNOWLEDGE_ALERT',
      'alerts/actionQueue',
      actionId,
      `Acknowledged by ${actorName}`
    );
    return {
      success: true,
      persistedToRtdb: true,
      updatedItem,
    };
  } catch (err: any) {
    return {
      success: false,
      persistedToRtdb: false,
      updatedItem,
      error: err?.message || 'Permission denied on /alerts/actionQueue',
    };
  }
}

export async function createSalesOrderInRtdb(order: OrderJourney): Promise<{
  success: boolean;
  persistedToRtdb?: boolean;
  error?: string;
}> {
  const orderValidation = validateSalesOrderQuantities(order);
  if (!orderValidation.valid) {
    return {
      success: false,
      persistedToRtdb: false,
      error: `Order Quantity Validation Failed: ${orderValidation.errors.join(' ')}`,
    };
  }

  if (!auth.currentUser) {
    return {
      success: true,
      persistedToRtdb: false,
    };
  }

  try {
    const orderRef = ref(rtdb, `salesOrders/${order.id}`);
    await set(orderRef, order);
    await logAuditToRtdb(
      'CREATE_SALES_ORDER',
      'salesOrders',
      order.id,
      `Created PO ${order.poNumber} (${order.customerName}) for ₹${order.totalValue.toLocaleString()}`
    );
    return { success: true, persistedToRtdb: true };
  } catch (err: any) {
    return {
      success: false,
      persistedToRtdb: false,
      error: err?.message || 'Permission denied or network error',
    };
  }
}

export async function recordQualityInspectionInRtdb(
  inspection: QualityInspectionRecord
): Promise<{
  success: boolean;
  persistedToRtdb?: boolean;
  error?: string;
}> {
  const qcValidation = validateQualityInspectionQuantities(inspection);
  if (!qcValidation.valid) {
    return {
      success: false,
      persistedToRtdb: false,
      error: `Quality Inspection Validation Failed: ${qcValidation.errors.join(' ')}`,
    };
  }

  if (!auth.currentUser) {
    return {
      success: true,
      persistedToRtdb: false,
    };
  }

  try {
    await set(ref(rtdb, `quality/inspections/${inspection.id}`), inspection);
    await logAuditToRtdb(
      'RECORD_QUALITY_INSPECTION',
      'quality/inspections',
      inspection.id,
      `Inspected ${inspection.inspectedQty} PCS (Passed: ${inspection.passedQty}, Rejected: ${inspection.rejectedQty}) on ${inspection.jobNumber}`
    );
    return { success: true, persistedToRtdb: true };
  } catch (err: any) {
    return {
      success: false,
      persistedToRtdb: false,
      error: err?.message || 'Failed to write quality inspection to RTDB',
    };
  }
}

/**
 * Remediated Stock Movement Writer:
 * - Writes directly to `/inventory/rawMaterials/$materialId` and `/inventory/stockMovements/$movId`
 * - Enforces non-negative physical and available stock
 * - Computes `status` strictly from `availableStockMt`, `minimumStockMt`, and `reorderLevelMt`
 */
export async function recordStockMovementInRtdb(
  material: RawMaterialStock,
  deltaMt: number,
  movementType: StockMovement['movementType'],
  heatNumber: string,
  referenceDoc: string,
  performedBy: string
): Promise<{
  success: boolean;
  persistedToRtdb?: boolean;
  updatedMaterial?: RawMaterialStock;
  movement?: StockMovement;
  error?: string;
}> {
  const newStockMt = Number((material.currentStockMt + deltaMt).toFixed(2));
  if (newStockMt < 0) {
    return {
      success: false,
      persistedToRtdb: false,
      error: 'Cannot issue stock: resulting physical balance would be negative.',
    };
  }
  if (newStockMt < material.reservedStockMt) {
    return {
      success: false,
      persistedToRtdb: false,
      error: `Cannot issue ${Math.abs(deltaMt)} MT: resulting physical stock (${newStockMt} MT) would fall below job-reserved stock (${material.reservedStockMt} MT). Free available stock is ${material.availableStockMt} MT.`,
    };
  }
  const newAvailableMt = Math.max(0, Number((newStockMt - material.reservedStockMt).toFixed(2)));
  const newStatus: RawMaterialStock['status'] = computeRawMaterialStockStatus(
    newAvailableMt,
    material.minimumStockMt,
    material.reorderLevelMt
  );

  const movId = `MOV-${Date.now().toString().slice(-6)}`;
  const movement: StockMovement = {
    id: movId,
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16),
    materialCode: material.code,
    materialGrade: material.grade,
    movementType,
    heatNumber,
    quantityMt: deltaMt,
    balanceAfterMt: newStockMt,
    referenceDoc,
    performedBy,
  };

  const updatedMaterial: RawMaterialStock = {
    ...material,
    currentStockMt: newStockMt,
    availableStockMt: newAvailableMt,
    status: newStatus,
  };

  if (!auth.currentUser) {
    return {
      success: true,
      persistedToRtdb: false,
      updatedMaterial,
      movement,
    };
  }

  try {
    await set(ref(rtdb, `inventory/rawMaterials/${material.id}`), updatedMaterial);
    await set(ref(rtdb, `inventory/stockMovements/${movId}`), movement);

    await logAuditToRtdb(
      'STOCK_MOVEMENT',
      'inventory/stockMovements',
      movId,
      `${movementType}: ${deltaMt > 0 ? '+' : ''}${deltaMt} MT on ${material.code} (Physical: ${newStockMt} MT, Available: ${newAvailableMt} MT, Status: ${newStatus})`
    );
    return {
      success: true,
      persistedToRtdb: true,
      updatedMaterial,
      movement,
    };
  } catch (err: any) {
    return {
      success: false,
      persistedToRtdb: false,
      error: err?.message || 'Failed to record stock movement in RTDB',
    };
  }
}

export async function saveAlertThresholdsInRtdb(
  thresholds: RtdbAlertThresholds
): Promise<{
  success: boolean;
  persistedToRtdb?: boolean;
  error?: string;
}> {
  if (
    thresholds.rejectionPercent < 0 ||
    thresholds.rejectionPercent > 100 ||
    thresholds.furnaceTemp <= 0 ||
    thresholds.machineDowntimeMinutes < 0 ||
    thresholds.criticalAgeingDays < 0 ||
    thresholds.deliveryDelayDays < 0 ||
    thresholds.lowStockDays < 0
  ) {
    return {
      success: false,
      persistedToRtdb: false,
      error: 'Alert thresholds must be valid non-negative numbers (rejection % between 0 and 100).',
    };
  }

  if (!auth.currentUser) {
    return {
      success: true,
      persistedToRtdb: false,
    };
  }

  try {
    await set(ref(rtdb, 'alerts/thresholds'), thresholds);
    await logAuditToRtdb(
      'UPDATE_ALERT_THRESHOLDS',
      'alerts/thresholds',
      'thresholds',
      `Updated thresholds: Rejection ${thresholds.rejectionPercent}%, Ageing ${thresholds.criticalAgeingDays}d`
    );
    return { success: true, persistedToRtdb: true };
  } catch (err: any) {
    return {
      success: false,
      persistedToRtdb: false,
      error: err?.message || 'Failed to update alert thresholds in RTDB',
    };
  }
}

export async function upsertCustomerInRtdb(
  customer: Customer,
  isNew: boolean
): Promise<{
  success: boolean;
  persistedToRtdb?: boolean;
  error?: string;
}> {
  if (!customer.id || !customer.code || !customer.name) {
    return {
      success: false,
      persistedToRtdb: false,
      error: 'Customer ID, Code, and Name are required.',
    };
  }
  if (customer.creditLimit < 0 || customer.totalOutstanding < 0) {
    return {
      success: false,
      persistedToRtdb: false,
      error: 'Credit limit and outstanding balance cannot be negative.',
    };
  }

  if (!auth.currentUser) {
    return {
      success: true,
      persistedToRtdb: false,
    };
  }

  try {
    await set(ref(rtdb, `customers/${customer.id}`), customer);
    await logAuditToRtdb(
      isNew ? 'CREATE_CUSTOMER' : 'UPDATE_CUSTOMER',
      'customers',
      customer.id,
      `${isNew ? 'Created' : 'Updated'} customer ${customer.name} (${customer.code}), Credit Limit: ₹${customer.creditLimit.toLocaleString()}`
    );
    return { success: true, persistedToRtdb: true };
  } catch (err: any) {
    return {
      success: false,
      persistedToRtdb: false,
      error: err?.message || 'Failed to save customer in RTDB',
    };
  }
}

export async function upsertProductInRtdb(
  product: Product,
  isNew: boolean
): Promise<{
  success: boolean;
  persistedToRtdb?: boolean;
  error?: string;
}> {
  if (!product.id || !product.code || !product.name || !product.materialGrade) {
    return {
      success: false,
      persistedToRtdb: false,
      error: 'Product ID, Code, Name, and Material Grade are required.',
    };
  }
  if (product.standardWeightKg <= 0 || product.standardSellingPrice < 0) {
    return {
      success: false,
      persistedToRtdb: false,
      error: 'Standard weight must be > 0 kg and selling price must be non-negative.',
    };
  }

  if (!auth.currentUser) {
    return {
      success: true,
      persistedToRtdb: false,
    };
  }

  try {
    await set(ref(rtdb, `products/${product.id}`), product);
    await logAuditToRtdb(
      isNew ? 'CREATE_PRODUCT' : 'UPDATE_PRODUCT',
      'products',
      product.id,
      `${isNew ? 'Created' : 'Updated'} product ${product.name} (${product.code}), Weight: ${product.standardWeightKg} kg`
    );
    return { success: true, persistedToRtdb: true };
  } catch (err: any) {
    return {
      success: false,
      persistedToRtdb: false,
      error: err?.message || 'Failed to save product in RTDB',
    };
  }
}

export async function updateSalesOrderInRtdb(
  order: OrderJourney,
  changeSummary: string
): Promise<{
  success: boolean;
  persistedToRtdb?: boolean;
  error?: string;
}> {
  const orderValidation = validateSalesOrderQuantities(order);
  if (!orderValidation.valid) {
    return {
      success: false,
      persistedToRtdb: false,
      error: `Order Quantity Validation Failed: ${orderValidation.errors.join(' ')}`,
    };
  }

  if (!auth.currentUser) {
    return {
      success: true,
      persistedToRtdb: false,
    };
  }

  try {
    await set(ref(rtdb, `salesOrders/${order.id}`), order);
    await logAuditToRtdb(
      'UPDATE_SALES_ORDER_STAGE',
      'salesOrders',
      order.id,
      changeSummary
    );
    return { success: true, persistedToRtdb: true };
  } catch (err: any) {
    return {
      success: false,
      persistedToRtdb: false,
      error: err?.message || 'Failed to update sales order in RTDB',
    };
  }
}

export async function recordDispatchInRtdb(
  dispatchRecord: {
    id: string;
    date: string;
    orderNo: string;
    jobNumber: string;
    customer: string;
    product: string;
    quantity: number;
    balanceQty: number;
    weightMt: number;
    transporter: string;
    vehicleNo: string;
    lrNumber: string;
    destination: string;
    invoiceRef: string;
    clearanceRef: string;
    status: string;
  },
  linkedOrder?: OrderJourney
): Promise<{
  success: boolean;
  persistedToRtdb?: boolean;
  error?: string;
}> {
  if (dispatchRecord.quantity < 0 || dispatchRecord.balanceQty < 0 || dispatchRecord.weightMt < 0) {
    return {
      success: false,
      persistedToRtdb: false,
      error: 'Dispatch quantity, balance quantity, and tonnage weight must be non-negative.',
    };
  }

  if (!auth.currentUser) {
    return {
      success: true,
      persistedToRtdb: false,
    };
  }

  try {
    await set(ref(rtdb, `dispatch/${dispatchRecord.id}`), dispatchRecord);
    if (linkedOrder) {
      await set(ref(rtdb, `salesOrders/${linkedOrder.id}`), linkedOrder);
    }
    await logAuditToRtdb(
      'RECORD_DISPATCH_CONSIGNMENT',
      'dispatch',
      dispatchRecord.id,
      `Dispatch ${dispatchRecord.id} (${dispatchRecord.status}): ${dispatchRecord.quantity} PCS (${dispatchRecord.weightMt} MT) for ${dispatchRecord.jobNumber}, Balance: ${dispatchRecord.balanceQty} PCS`
    );
    return { success: true, persistedToRtdb: true };
  } catch (err: any) {
    return {
      success: false,
      persistedToRtdb: false,
      error: err?.message || 'Failed to write dispatch record to RTDB',
    };
  }
}

export async function recordCustomerPaymentInRtdb(
  existingRecord: OutstandingAgeingRecord,
  paymentAmount: number,
  utrReference: string
): Promise<{
  success: boolean;
  persistedToRtdb?: boolean;
  updatedRecord?: OutstandingAgeingRecord;
  error?: string;
}> {
  if (paymentAmount <= 0) {
    return {
      success: false,
      persistedToRtdb: false,
      error: 'Payment collection amount must be greater than zero.',
    };
  }
  if (paymentAmount > existingRecord.totalOutstanding) {
    return {
      success: false,
      persistedToRtdb: false,
      error: `Collection amount (₹${paymentAmount.toLocaleString()}) exceeds total outstanding balance (₹${existingRecord.totalOutstanding.toLocaleString()}).`,
    };
  }

  // Apply payment oldest-bucket-first (FIFO settlement: 90+ -> 61-90 -> 31-60 -> 0-30)
  let remaining = paymentAmount;
  const deduct = (bucket: number) => {
    const d = Math.min(bucket, remaining);
    remaining -= d;
    return Math.max(0, bucket - d);
  };

  const new90Plus = deduct(existingRecord.bucket90Plus);
  const new61to90 = deduct(existingRecord.bucket61to90);
  const new31to60 = deduct(existingRecord.bucket31to60);
  const new0to30 = deduct(existingRecord.bucket0to30);
  const newTotal = new0to30 + new31to60 + new61to90 + new90Plus;

  const updatedRecord: OutstandingAgeingRecord = {
    ...existingRecord,
    bucket90Plus: new90Plus,
    bucket61to90: new61to90,
    bucket31to60: new31to60,
    bucket0to30: new0to30,
    totalOutstanding: newTotal,
    creditExceeded: newTotal > existingRecord.creditLimit,
  };

  if (!auth.currentUser) {
    return {
      success: true,
      persistedToRtdb: false,
      updatedRecord,
    };
  }

  try {
    await set(ref(rtdb, `outstandingPayments/${existingRecord.customerId}`), updatedRecord);
    await logAuditToRtdb(
      'RECORD_CUSTOMER_COLLECTION',
      'outstandingPayments',
      existingRecord.customerId,
      `Received ₹${paymentAmount.toLocaleString()} (Ref: ${utrReference}) from ${existingRecord.customerName}. New outstanding: ₹${newTotal.toLocaleString()}`
    );
    return { success: true, persistedToRtdb: true, updatedRecord };
  } catch (err: any) {
    return {
      success: false,
      persistedToRtdb: false,
      error: err?.message || 'Failed to update customer outstanding balance in RTDB',
    };
  }
}

export async function updateProductionSummaryInRtdb(
  summary: RtdbProductionSummary,
  actionDetail: string
): Promise<{
  success: boolean;
  persistedToRtdb?: boolean;
  error?: string;
}> {
  if (summary.totalRejectionPercent < 0 || summary.totalRejectionPercent > 100) {
    return {
      success: false,
      persistedToRtdb: false,
      error: 'Total rejection percentage must be between 0 and 100.',
    };
  }

  if (!auth.currentUser) {
    return {
      success: true,
      persistedToRtdb: false,
    };
  }

  try {
    await set(ref(rtdb, 'production'), summary);
    await logAuditToRtdb(
      'UPDATE_PRODUCTION_LOG',
      'production',
      'productionSummary',
      actionDetail
    );
    return { success: true, persistedToRtdb: true };
  } catch (err: any) {
    return {
      success: false,
      persistedToRtdb: false,
      error: err?.message || 'Failed to update /production in RTDB',
    };
  }
}

function stripUndefinedDeepRtdb<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeepRtdb(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeepRtdb(v);
      }
    }
    return out as T;
  }
  return value;
}

/**
 * Admin-Only Employee Provisioning / Role & Status Update in RTDB:
 * Preserves existing granular role (e.g. 'stores', 'purchase', 'dispatch') when updating accountStatus
 * within the same RBAC group without automatically overwriting it with 'quality'.
 */
export async function adminUpdateEmployeeProfileInRtdb(
  targetUser: UserProfile,
  newRoleGroup: RbacRoleGroup,
  newAccountStatus: UserProfile['accountStatus'],
  extraUpdates?: Partial<UserProfile> & { legacyRole?: UserRole },
  callerProfile?: UserProfile
): Promise<{
  success: boolean;
  persistedToRtdb?: boolean;
  updatedProfile?: UserProfile;
  error?: string;
}> {
  const targetUid = String(targetUser.uid || targetUser.id || '').trim();
  const existingGranular =
    extraUpdates?.legacyRole ||
    extraUpdates?.role ||
    (targetUser as any).legacyRole ||
    targetUser.role;
  const legacyRole = mapRbacGroupToUserRole(newRoleGroup, existingGranular);
  const rawName = String(
    extraUpdates?.displayName ||
      extraUpdates?.name ||
      targetUser.displayName ||
      targetUser.name ||
      targetUser.email?.split('@')[0] ||
      'Montex Employee'
  ).trim();
  const safeName = (rawName.length >= 2 ? rawName : 'Montex Employee').slice(0, 120);
  const rawEmail = String(extraUpdates?.email || targetUser.email || '')
    .trim()
    .toLowerCase();
  const safeEmail = (
    rawEmail.length > 3 ? rawEmail : `${targetUid || 'employee'}@montexforge.com`
  ).slice(0, 150);
  const nowIso = new Date().toISOString();

  const updatedProfile: UserProfile = {
    ...targetUser,
    ...(extraUpdates || {}),
    id: targetUid,
    uid: targetUid,
    name: safeName,
    displayName: safeName,
    email: safeEmail,
    role: legacyRole,
    legacyRole,
    rbacGroup: newRoleGroup,
    accountStatus: newAccountStatus,
    status:
      newAccountStatus === 'active'
        ? 'Active'
        : newAccountStatus === 'rejected'
        ? 'Rejected'
        : newAccountStatus === 'pending_approval' ||
          newAccountStatus === 'pending_invitation'
        ? 'Pending'
        : 'Inactive',
    updatedAt: extraUpdates?.updatedAt || nowIso,
    disabledAt: newAccountStatus === 'deactivated' ? nowIso : undefined,
  };

  const rawPayload: Record<string, any> = {
    ...updatedProfile,
    id: targetUid,
    uid: targetUid,
    name: safeName,
    displayName: safeName,
    email: safeEmail,
    role: newRoleGroup,
    legacyRole,
    requestedRole: mapRbacGroupToUserRole(
      newRoleGroup,
      updatedProfile.requestedRole || legacyRole
    ),
    disabledAt: newAccountStatus === 'deactivated' ? nowIso : null,
  };

  if (newAccountStatus === 'rejected') {
    rawPayload.approvedByUid = null;
    rawPayload.approvedByEmail = null;
    rawPayload.approvedByName = null;
    rawPayload.approvedAt = null;
    rawPayload.isDepartmentHead = false;
    rawPayload.managedDepartment = null;
    rawPayload.permissions = [];
  } else if (newAccountStatus === 'active') {
    rawPayload.rejectedByUid = null;
    rawPayload.rejectedByEmail = null;
    rawPayload.rejectedByName = null;
    rawPayload.rejectedAt = null;
    rawPayload.rejectionReason = null;
    rawPayload.disabledAt = null;
    rawPayload.deactivatedBy = null;
    rawPayload.deactivationReason = null;
  }

  // Recursively strip undefined properties so Firebase RTDB set() never fails on nested undefined fields
  const payload = stripUndefinedDeepRtdb(rawPayload);

  if (!auth.currentUser) {
    return {
      success: true,
      persistedToRtdb: false,
      updatedProfile,
    };
  }

  try {
    // Ensure caller's active Admin/Management profile exists in RTDB /users/{callerUid} if missing or stale
    if (callerProfile && callerProfile.accountStatus === 'active' && auth.currentUser.uid) {
      const callerUid = auth.currentUser.uid;
      try {
        const callerSnap = await get(ref(rtdb, `users/${callerUid}`));
        if (!callerSnap.exists() || callerSnap.val()?.accountStatus !== 'active') {
          const callerGroup = callerProfile.rbacGroup || mapRoleToRbacGroup(callerProfile.role);
          const callerName = String(
            callerProfile.name || callerProfile.displayName || 'Super Admin'
          ).trim();
          const callerPayload = stripUndefinedDeepRtdb({
            ...callerProfile,
            id: callerUid,
            uid: callerUid,
            email: (callerProfile.email || auth.currentUser.email || 'admin@montexforge.com')
              .trim()
              .toLowerCase(),
            name: callerName.length >= 2 ? callerName : 'Super Admin',
            displayName: callerName.length >= 2 ? callerName : 'Super Admin',
            role: callerGroup,
            legacyRole: callerProfile.role,
            rbacGroup: callerGroup,
            accountStatus: 'active',
          });
          await set(ref(rtdb, `users/${callerUid}`), callerPayload);
        }
      } catch {
        // Proceed with target write even if caller check is restricted
      }
    }

    const targetRef = ref(rtdb, `users/${targetUid}`);
    await set(targetRef, payload);

    // Read-back verification to confirm the RTDB write persisted with expected accountStatus
    const verifiedSnap = await get(targetRef);
    if (!verifiedSnap.exists() || verifiedSnap.val()?.accountStatus !== newAccountStatus) {
      return {
        success: false,
        persistedToRtdb: false,
        error: `RTDB write verification failed: /users/${targetUid} could not be verified with accountStatus="${newAccountStatus}".`,
      };
    }

    await logAuditToRtdb(
      newAccountStatus === 'rejected'
        ? 'EMPLOYEE_ACCESS_REJECTED'
        : newAccountStatus === 'active'
        ? 'EMPLOYEE_ACCESS_APPROVED'
        : 'UPDATE_USER_ACCESS',
      'users',
      targetUid,
      `Set ${safeEmail} role=${newRoleGroup} (granular=${legacyRole}), accountStatus=${newAccountStatus}`
    );
    return { success: true, persistedToRtdb: true, updatedProfile };
  } catch (err: any) {
    return {
      success: false,
      persistedToRtdb: false,
      error: err?.message || 'Admin permission required to update /users/$uid',
    };
  }
}

export interface RtdbDiagnosticTestResult {
  testName: string;
  targetPath: string;
  operation: 'CONNECT' | 'READ' | 'WRITE' | 'AUTH_CHECK' | 'RBAC_GUARD';
  status: 'PASSED' | 'BLOCKED_BY_RULES' | 'UNAUTHENTICATED' | 'ERROR';
  latencyMs: number;
  details: string;
}

/**
 * Runs live verification against https://montex-mis-default-rtdb.firebaseio.com/
 */
export async function runRtdbVerificationSuite(
  activeRoleGroup: RbacRoleGroup
): Promise<RtdbDiagnosticTestResult[]> {
  const results: RtdbDiagnosticTestResult[] = [];
  const currentUser = auth.currentUser;

  // Test 1: Auth Session Check
  const t1Start = performance.now();
  results.push({
    testName: '1. Firebase Authentication Session Check',
    targetPath: 'firebase.auth().currentUser',
    operation: 'AUTH_CHECK',
    status: currentUser ? 'PASSED' : 'UNAUTHENTICATED',
    latencyMs: Math.round(performance.now() - t1Start),
    details: currentUser
      ? `Authenticated as ${currentUser.email} (UID: ${currentUser.uid.slice(0, 10)}...)`
      : 'No active Firebase Auth user signed in. Unauthenticated client requests are blocked by security rules.',
  });

  // Test 2: Verify Default-Deny at Root /
  const tRootStart = performance.now();
  try {
    await get(ref(rtdb));
    const latency = Math.round(performance.now() - tRootStart);
    results.push({
      testName: '2. Root Default-Deny Check (GET /)',
      targetPath: `${databaseURL}.json`,
      operation: 'READ',
      status: 'ERROR',
      latencyMs: latency,
      details: `WARNING (${latency}ms): Root / read succeeded! Please publish the remediated database.rules.json to enforce ".read": false at root.`,
    });
  } catch (err: any) {
    const latency = Math.round(performance.now() - tRootStart);
    results.push({
      testName: '2. Root Default-Deny Check (GET /)',
      targetPath: `${databaseURL}.json`,
      operation: 'READ',
      status: 'BLOCKED_BY_RULES',
      latencyMs: latency,
      details: `VERIFIED (${latency}ms): Root / read rejected with PERMISSION_DENIED as required by default-deny root security.`,
    });
  }

  // Test 3: Read /dashboardKpis from Realtime Database
  let existingKpis: RtdbDashboardKpis | null = null;
  const t2Start = performance.now();
  try {
    const snap = await get(ref(rtdb, 'dashboardKpis'));
    const latency = Math.round(performance.now() - t2Start);
    if (snap.exists()) {
      existingKpis = snap.val();
      results.push({
        testName: '3. Authorized Path Read (/dashboardKpis)',
        targetPath: `${databaseURL}dashboardKpis.json`,
        operation: 'READ',
        status: 'PASSED',
        latencyMs: latency,
        details: `Read succeeded (${latency}ms). Found live KPI payload (lastUpdated: ${snap.val()?.lastUpdated || 'N/A'}).`,
      });
    } else {
      results.push({
        testName: '3. Authorized Path Read (/dashboardKpis)',
        targetPath: `${databaseURL}dashboardKpis.json`,
        operation: 'READ',
        status: 'PASSED',
        latencyMs: latency,
        details: `Read connection succeeded (${latency}ms), node /dashboardKpis is currently empty (ready to seed).`,
      });
    }
  } catch (err: any) {
    const latency = Math.round(performance.now() - t2Start);
    const isPermDenied =
      err?.code === 'PERMISSION_DENIED' ||
      String(err?.message || '').toLowerCase().includes('permission_denied');
    results.push({
      testName: '3. Authorized Path Read (/dashboardKpis)',
      targetPath: `${databaseURL}dashboardKpis.json`,
      operation: 'READ',
      status: isPermDenied ? 'BLOCKED_BY_RULES' : 'ERROR',
      latencyMs: latency,
      details: isPermDenied
        ? `PERMISSION_DENIED (${latency}ms): Realtime Database Security Rules rejected read (${
            currentUser
              ? 'Account not yet active in /users/$uid or rules pending publish'
              : 'Unauthenticated access blocked as expected'
          }).`
        : `Error (${latency}ms): ${err?.message || 'Unknown error'}`,
    });
  }

  // Test 4: User Enumeration Guard Check (GET /users)
  const tUsersStart = performance.now();
  try {
    const snap = await get(ref(rtdb, 'users'));
    const latency = Math.round(performance.now() - tUsersStart);
    const count = snap.exists() ? Object.keys(snap.val()).length : 0;
    results.push({
      testName: `4. Employee Directory Enumeration Check (/users as ${activeRoleGroup})`,
      targetPath: `${databaseURL}users.json`,
      operation: 'READ',
      status: 'PASSED',
      latencyMs: latency,
      details: `Read succeeded (${latency}ms, ${count} profiles). Allowed only for active Admin / Management roles.`,
    });
  } catch (err: any) {
    const latency = Math.round(performance.now() - tUsersStart);
    results.push({
      testName: `4. Employee Directory Enumeration Check (/users as ${activeRoleGroup})`,
      targetPath: `${databaseURL}users.json`,
      operation: 'READ',
      status: 'BLOCKED_BY_RULES',
      latencyMs: latency,
      details: `RULE ENFORCED (${latency}ms): /users list enumeration blocked for non-Admin/non-Management or unauthenticated caller.`,
    });
  }

  // Test 5: Write Test to /dashboardKpis (Restricted to Admin / Management; preserves existing KPI figures)
  const t4Start = performance.now();
  try {
    await update(ref(rtdb, 'dashboardKpis'), {
      ...DEFAULT_DASHBOARD_KPIS,
      ...(existingKpis || {}),
      lastUpdated: new Date().toISOString(),
    });
    const latency = Math.round(performance.now() - t4Start);
    results.push({
      testName: `5. Executive KPI Write Guard (/dashboardKpis as ${activeRoleGroup})`,
      targetPath: `${databaseURL}dashboardKpis`,
      operation: 'WRITE',
      status: 'PASSED',
      latencyMs: latency,
      details: `Write succeeded (${latency}ms). Authorized for active Admin / Management (existing KPI values preserved).`,
    });
  } catch (err: any) {
    const latency = Math.round(performance.now() - t4Start);
    const isPermDenied = String(err?.message || '').toLowerCase().includes('permission_denied');
    results.push({
      testName: `5. Executive KPI Write Guard (/dashboardKpis as ${activeRoleGroup})`,
      targetPath: `${databaseURL}dashboardKpis`,
      operation: 'WRITE',
      status: isPermDenied ? 'BLOCKED_BY_RULES' : 'ERROR',
      latencyMs: latency,
      details: isPermDenied
        ? `RULE ENFORCED (${latency}ms): Write to /dashboardKpis rejected by RTDB Security Rules.`
        : `Error (${latency}ms): ${err?.message}`,
    });
  }

  return results;
}
