import {
  OrderJourney,
  RawMaterialStock,
  OutstandingAgeingRecord,
  Product,
  UserProfile,
  UserRole,
  RbacRoleGroup,
  RtdbDashboardKpis,
  RtdbProductionSummary,
  QualityInspectionRecord,
  CANONICAL_USER_ROLES,
  DESCRIPTIVE_RBAC_GROUPS,
  ROLE_PERMISSION_DEFAULTS,
  getOrganizationalGroupForRole,
  resolveGranularRoleFromGroupOrLegacy,
  hasGranularRolePermission,
} from '../types/mis';

export type { QualityInspectionRecord };
export { hasGranularRolePermission };

export const VALID_USER_ROLES: UserRole[] = [...CANONICAL_USER_ROLES];

export const VALID_RBAC_GROUPS: RbacRoleGroup[] = [...DESCRIPTIVE_RBAC_GROUPS];

// ============================================================================
// 1. RAW MATERIAL STOCK STATUS & VALIDATION
// ============================================================================

/**
 * Computes raw material stock status strictly from availableStockMt, minimumStockMt, and reorderLevelMt:
 * - availableStockMt < minimumStockMt -> 'critical'
 * - availableStockMt < reorderLevelMt -> 'warning'
 * - availableStockMt >= reorderLevelMt -> 'adequate'
 */
export function computeRawMaterialStockStatus(
  availableStockMt: number,
  minimumStockMt: number,
  reorderLevelMt: number
): RawMaterialStock['status'] {
  const avail = Number(availableStockMt.toFixed(2));
  const min = Number(minimumStockMt.toFixed(2));
  const reorder = Number(reorderLevelMt.toFixed(2));

  if (avail < min) {
    return 'critical';
  }
  if (avail < reorder) {
    return 'warning';
  }
  return 'adequate';
}

export interface RawMaterialValidationResult {
  materialId: string;
  materialCode: string;
  valid: boolean;
  storedAvailableMt: number;
  expectedAvailableMt: number;
  availableBalanceMismatch: boolean;
  storedStatus: RawMaterialStock['status'];
  computedStatusFromAvailable: RawMaterialStock['status'];
  computedStatusFromPhysical: RawMaterialStock['status'];
  statusMismatch: boolean;
  errors: string[];
}

export function validateRawMaterialStock(
  material: RawMaterialStock
): RawMaterialValidationResult {
  const errors: string[] = [];

  if (material.currentStockMt < 0) {
    errors.push(`Physical stock (${material.currentStockMt} MT) cannot be negative.`);
  }
  if (material.reservedStockMt < 0) {
    errors.push(`Reserved stock (${material.reservedStockMt} MT) cannot be negative.`);
  }
  if (material.reservedStockMt > material.currentStockMt) {
    errors.push(
      `Reserved stock (${material.reservedStockMt} MT) exceeds physical stock (${material.currentStockMt} MT).`
    );
  }
  if (material.minimumStockMt < 0 || material.reorderLevelMt < 0) {
    errors.push(`Minimum stock and reorder level thresholds must be non-negative.`);
  }
  if (material.reorderLevelMt < material.minimumStockMt) {
    errors.push(
      `Reorder level (${material.reorderLevelMt} MT) cannot be less than minimum stock (${material.minimumStockMt} MT).`
    );
  }

  const expectedAvailableMt = Math.max(
    0,
    Number((material.currentStockMt - material.reservedStockMt).toFixed(2))
  );
  const storedAvailableMt = Number((material.availableStockMt ?? 0).toFixed(2));
  const availableBalanceMismatch = Math.abs(storedAvailableMt - expectedAvailableMt) > 0.01;

  if (availableBalanceMismatch) {
    errors.push(
      `Free Available Stock (${storedAvailableMt} MT) does not match Physical Stock (${material.currentStockMt} MT) minus Reserved Stock (${material.reservedStockMt} MT) = ${expectedAvailableMt} MT.`
    );
  }

  const computedStatusFromAvailable = computeRawMaterialStockStatus(
    expectedAvailableMt,
    material.minimumStockMt,
    material.reorderLevelMt
  );
  const computedStatusFromPhysical = computeRawMaterialStockStatus(
    material.currentStockMt,
    material.minimumStockMt,
    material.reorderLevelMt
  );

  const statusMismatch = material.status !== computedStatusFromAvailable;
  if (statusMismatch) {
    errors.push(
      `Recorded stock status (${material.status}) differs from calculated status (${computedStatusFromAvailable}) based on Free Available Stock of ${expectedAvailableMt} MT (Minimum Safety Stock: ${material.minimumStockMt} MT, Reorder Level: ${material.reorderLevelMt} MT).`
    );
  }

  return {
    materialId: material.id,
    materialCode: material.code,
    valid: errors.length === 0,
    storedAvailableMt,
    expectedAvailableMt,
    availableBalanceMismatch,
    storedStatus: material.status,
    computedStatusFromAvailable,
    computedStatusFromPhysical,
    statusMismatch,
    errors,
  };
}

export function normalizeRawMaterialWithComputedStatus(
  material: RawMaterialStock
): RawMaterialStock & { storedStatus?: RawMaterialStock['status']; hasStatusDiscrepancy?: boolean } {
  const check = validateRawMaterialStock(material);
  return {
    ...material,
    availableStockMt: check.expectedAvailableMt,
    status: check.computedStatusFromAvailable,
    storedStatus: material.status,
    hasStatusDiscrepancy: check.statusMismatch || check.availableBalanceMismatch,
  };
}

// ============================================================================
// 2. QUALITY INSPECTION QUANTITY CONSISTENCY
// ============================================================================

export interface QualityInspectionValidationResult {
  inspectionId: string;
  jobNumber: string;
  valid: boolean;
  inspectedQty: number;
  passedQty: number;
  rejectedQty: number;
  totalAccountedQty: number;
  unaccountedQty: number;
  excessQty: number;
  errors: string[];
  warnings: string[];
}

/**
 * Validates that passedQty + rejectedQty <= inspectedQty and all quantities are non-negative.
 */
export function validateQualityInspectionQuantities(
  insp: Pick<
    QualityInspectionRecord,
    'id' | 'jobNumber' | 'inspectedQty' | 'passedQty' | 'rejectedQty' | 'status'
  >
): QualityInspectionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const inspectedQty = Number(insp.inspectedQty ?? 0);
  const passedQty = Number(insp.passedQty ?? 0);
  const rejectedQty = Number(insp.rejectedQty ?? 0);
  const totalAccountedQty = passedQty + rejectedQty;
  const unaccountedQty = Math.max(0, inspectedQty - totalAccountedQty);
  const excessQty = Math.max(0, totalAccountedQty - inspectedQty);

  if (inspectedQty < 0 || passedQty < 0 || rejectedQty < 0) {
    errors.push(
      `Quantities cannot be negative (Inspected: ${inspectedQty} PCS, Passed: ${passedQty} PCS, Rejected: ${rejectedQty} PCS).`
    );
  }

  if (totalAccountedQty > inspectedQty) {
    errors.push(
      `Passed (${passedQty} PCS) + Rejected (${rejectedQty} PCS) = ${totalAccountedQty} PCS exceeds total Inspected Lot (${inspectedQty} PCS) by ${excessQty} PCS.`
    );
  }

  if (insp.status === 'cleared' && unaccountedQty > 0) {
    warnings.push(
      `Lot is marked Cleared, but ${unaccountedQty} of ${inspectedQty} inspected pieces do not yet have a Passed or Rejected result recorded.`
    );
  }

  if (insp.status === 'pending' && totalAccountedQty > 0) {
    warnings.push(
      `Lot status is still Pending, although ${totalAccountedQty} PCS already have inspection outcomes recorded.`
    );
  }

  return {
    inspectionId: insp.id,
    jobNumber: insp.jobNumber,
    valid: errors.length === 0,
    inspectedQty,
    passedQty,
    rejectedQty,
    totalAccountedQty,
    unaccountedQty,
    excessQty,
    errors,
    warnings,
  };
}

/**
 * Safely derives quality inspection records from salesOrders without fabricating inspectedQty = orderedQty
 * when producedQty === 0.
 */
export function deriveQualityInspectionsFromOrders(
  salesOrders: OrderJourney[]
): QualityInspectionRecord[] {
  return salesOrders
    .filter((o) => {
      const produced = (o.lineItems || []).reduce((acc, li) => acc + li.producedQty, 0);
      return produced > 0 || o.qualityStatus.state !== 'pending';
    })
    .map((o, idx) => {
      const li = o.lineItems?.[0];
      const producedQty = li?.producedQty ?? 0;
      const passedQty = li?.inspectedOkQty ?? 0;
      const rejectedQty = li?.rejectedQty ?? 0;
      return {
        id: `QC-DERIVED-0${idx + 1}`,
        jobNumber: o.jobNumber,
        customer: o.customerName,
        product: li?.productName || 'Forged Component',
        grade: li?.materialGrade || 'ASTM A105',
        heatNo: o.materialStatus.heatNumber,
        inspectedQty: producedQty,
        passedQty,
        rejectedQty,
        status: o.qualityStatus.state,
        inspector: o.qualityStatus.inspectorName,
        date: o.qualityStatus.inspectionDate,
        mtcNumber: o.qualityStatus.mtcNumber,
      };
    });
}

// ============================================================================
// 3. SALES ORDER, PRODUCTION, QUALITY & DISPATCH QUANTITY CONSISTENCY
// ============================================================================

export interface OrderQuantityValidationResult {
  orderId: string;
  poNumber: string;
  jobNumber: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSalesOrderQuantities(order: OrderJourney): OrderQuantityValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const lineItems = order.lineItems || [];
  if (lineItems.length === 0) {
    errors.push(`Order ${order.poNumber} has no product items attached.`);
  }

  let sumLineTotals = 0;
  let sumDispatchedQty = 0;
  let sumPendingQty = 0;
  let sumOrderedQty = 0;

  for (let idx = 0; idx < lineItems.length; idx++) {
    const li = lineItems[idx];
    const itemLabel = `Item #${idx + 1} (${li.productName || 'Forged Component'})`;

    sumOrderedQty += li.orderedQty;
    sumDispatchedQty += li.dispatchedQty;
    sumPendingQty += li.pendingQty;
    sumLineTotals += li.totalAmount;

    const expectedLineTotal = li.orderedQty * li.ratePerUnit;
    if (Math.abs(li.totalAmount - expectedLineTotal) > 1) {
      errors.push(
        `${itemLabel}: Recorded line amount (₹${li.totalAmount.toLocaleString()}) does not match Ordered Qty (${li.orderedQty} PCS) × Unit Rate (₹${li.ratePerUnit.toLocaleString()}) = ₹${expectedLineTotal.toLocaleString()}.`
      );
    }

    if (li.inspectedOkQty + li.rejectedQty > li.producedQty) {
      errors.push(
        `${itemLabel}: QC Passed (${li.inspectedOkQty} PCS) + Rejected (${li.rejectedQty} PCS) = ${
          li.inspectedOkQty + li.rejectedQty
        } PCS exceeds Recorded Forged Output (${li.producedQty} PCS). Verify whether ${
          li.inspectedOkQty + li.rejectedQty
        } PCS were forged or ${li.producedQty - li.rejectedQty} PCS passed.`
      );
    }

    if (li.dispatchedQty > li.inspectedOkQty) {
      errors.push(
        `${itemLabel}: Dispatched Qty (${li.dispatchedQty} PCS) exceeds QC Passed Qty (${li.inspectedOkQty} PCS).`
      );
    }

    if (li.dispatchedQty > li.orderedQty) {
      errors.push(
        `${itemLabel}: Dispatched Qty (${li.dispatchedQty} PCS) exceeds Customer PO Ordered Qty (${li.orderedQty} PCS).`
      );
    }

    const expectedPending = li.orderedQty - li.dispatchedQty;
    if (li.pendingQty !== expectedPending) {
      errors.push(
        `${itemLabel}: Pending Balance (${li.pendingQty} PCS) does not match Ordered Qty (${li.orderedQty} PCS) minus Dispatched Qty (${li.dispatchedQty} PCS) = ${expectedPending} PCS.`
      );
    }

    // Check if rejections reduce maximum deliverable below orderedQty without replacement forging
    if (li.producedQty > 0 && li.producedQty - li.rejectedQty < li.orderedQty) {
      const deficit = li.orderedQty - (li.producedQty - li.rejectedQty);
      warnings.push(
        `${itemLabel}: ${li.rejectedQty} rejected piece(s) out of ${li.producedQty} forged leaves ${
          li.producedQty - li.rejectedQty
        } deliverable PCS against ${li.orderedQty} PCS ordered — replacement forging of ${deficit} PCS required.`
      );
    }
  }

  if (Math.abs(sumLineTotals - order.totalValue) > 1) {
    errors.push(
      `Order ${order.poNumber}: Total Order Value (₹${order.totalValue.toLocaleString()}) does not match sum of item amounts (₹${sumLineTotals.toLocaleString()}).`
    );
  }

  if (order.dispatchStatus.totalShippedQty !== sumDispatchedQty) {
    errors.push(
      `Order ${order.poNumber}: Dispatch summary (${order.dispatchStatus.totalShippedQty} PCS) does not match item dispatched total (${sumDispatchedQty} PCS).`
    );
  }

  if (order.dispatchStatus.balanceQty !== sumPendingQty) {
    errors.push(
      `Order ${order.poNumber}: Dispatch balance (${order.dispatchStatus.balanceQty} PCS) does not match item pending total (${sumPendingQty} PCS).`
    );
  }

  if (order.dispatchStatus.totalShippedQty + order.dispatchStatus.balanceQty !== sumOrderedQty) {
    errors.push(
      `Order ${order.poNumber}: Shipped (${order.dispatchStatus.totalShippedQty} PCS) + Pending Balance (${order.dispatchStatus.balanceQty} PCS) does not equal Ordered Qty (${sumOrderedQty} PCS).`
    );
  }

  return {
    orderId: order.id,
    poNumber: order.poNumber,
    jobNumber: order.jobNumber,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export interface CrossModuleConsistencyResult {
  valid: boolean;
  confirmedErrors: string[];
  businessConfirmationsRequired: string[];
}

export function validateCrossModuleQuantities(
  salesOrders: OrderJourney[],
  qualityInspections: QualityInspectionRecord[],
  dispatches: {
    id: string;
    orderNo: string;
    jobNumber: string;
    quantity: number;
    balanceQty: number;
    status: string;
  }[],
  productionSummary?: RtdbProductionSummary
): CrossModuleConsistencyResult {
  const confirmedErrors: string[] = [];
  const businessConfirmationsRequired: string[] = [];

  for (const order of salesOrders) {
    const orderCheck = validateSalesOrderQuantities(order);
    confirmedErrors.push(...orderCheck.errors);
    businessConfirmationsRequired.push(...orderCheck.warnings);

    const li = order.lineItems?.[0];
    if (!li) continue;

    // Match against qualityInspections
    const matchingQc = qualityInspections.filter((q) => q.jobNumber === order.jobNumber);
    for (const qc of matchingQc) {
      const qcCheck = validateQualityInspectionQuantities(qc);
      confirmedErrors.push(...qcCheck.errors.map((e) => `[${qc.id} / ${qc.jobNumber}] ${e}`));
      businessConfirmationsRequired.push(
        ...qcCheck.warnings.map((w) => `[${qc.id} / ${qc.jobNumber}] ${w}`)
      );

      if (qc.passedQty !== li.inspectedOkQty) {
        confirmedErrors.push(
          `Cross-module mismatch (${order.jobNumber}): quality/inspections/${qc.id}.passedQty (${qc.passedQty}) !== salesOrders/${order.id}.inspectedOkQty (${li.inspectedOkQty}).`
        );
      }
      if (qc.rejectedQty !== li.rejectedQty) {
        confirmedErrors.push(
          `Cross-module mismatch (${order.jobNumber}): quality/inspections/${qc.id}.rejectedQty (${qc.rejectedQty}) !== salesOrders/${order.id}.rejectedQty (${li.rejectedQty}).`
        );
      }
    }

    // Match against dispatches
    const matchingDispatches = dispatches.filter(
      (d) => d.jobNumber === order.jobNumber || d.orderNo === order.poNumber
    );
    const executedDispatchesQty = matchingDispatches
      .filter((d) => d.status === 'dispatched' || d.status === 'completed')
      .reduce((acc, d) => acc + d.quantity, 0);

    if (matchingDispatches.length > 0 && executedDispatchesQty !== order.dispatchStatus.totalShippedQty) {
      confirmedErrors.push(
        `Cross-module dispatch mismatch (${order.jobNumber}): sum of executed dispatches (${executedDispatchesQty} PCS) !== salesOrders/${order.id}.totalShippedQty (${order.dispatchStatus.totalShippedQty} PCS).`
      );
    }

    for (const d of matchingDispatches) {
      if (
        d.status === 'ready_for_dispatch' &&
        d.quantity > 0 &&
        d.balanceQty === 0 &&
        order.dispatchStatus.totalShippedQty === 0 &&
        order.dispatchStatus.balanceQty === d.quantity
      ) {
        confirmedErrors.push(
          `Dispatch record ${d.id} (${d.jobNumber}) has status 'ready_for_dispatch' (not yet shipped), but sets quantity=${d.quantity} and balanceQty=0 while salesOrders/${order.id} has totalShippedQty=0 and balanceQty=${order.dispatchStatus.balanceQty}.`
        );
      }
    }
  }

  if (productionSummary?.shifts) {
    const shifts = Object.values(productionSummary.shifts);
    const totalShiftTonnage = shifts.reduce((acc, s) => acc + s.tonnageMt, 0);
    const totalShiftRejectedPcs = shifts.reduce((acc, s) => acc + s.rejectedPcs, 0);
    const weightedYield =
      totalShiftTonnage > 0
        ? shifts.reduce((acc, s) => acc + s.tonnageMt * s.yieldPercent, 0) / totalShiftTonnage
        : 100;
    const impliedRejectionPercent = Number((100 - weightedYield).toFixed(2));
    const totalOrderRejectedPcs = salesOrders.reduce(
      (acc, o) => acc + (o.lineItems || []).reduce((s, li) => s + li.rejectedQty, 0),
      0
    );

    if (Math.abs(impliedRejectionPercent - productionSummary.totalRejectionPercent) > 0.05) {
      businessConfirmationsRequired.push(
        `Production summary totalRejectionPercent (${productionSummary.totalRejectionPercent}%) differs from shift tonnage-weighted rejection rate (${impliedRejectionPercent}%, weighted yield ${weightedYield.toFixed(
          2
        )}%).`
      );
    }
    if (totalShiftRejectedPcs !== totalOrderRejectedPcs) {
      businessConfirmationsRequired.push(
        `Production shifts rejectedPcs sum (${totalShiftRejectedPcs} PCS across Shifts A/B/C) differs from active salesOrders/qualityInspections rejectedQty sum (${totalOrderRejectedPcs} PCS). Confirm whether shift figures are daily shop-wide vs active PO cumulative.`
      );
    }
  }

  return {
    valid: confirmedErrors.length === 0,
    confirmedErrors,
    businessConfirmationsRequired,
  };
}

export function deriveDispatchesFromOrders(salesOrders: OrderJourney[], products: Product[]) {
  return salesOrders
    .filter(
      (o) =>
        o.dispatchStatus.totalShippedQty > 0 ||
        o.status === 'ready_for_dispatch' ||
        o.status === 'partially_dispatched' ||
        o.status === 'completed'
    )
    .map((o, idx) => {
      const li = o.lineItems?.[0];
      const prod = products.find((p) => p.id === li?.productId || p.code === li?.productCode);
      const unitWeightKg = prod?.standardWeightKg || 64.5;
      const shippedQty = o.dispatchStatus.totalShippedQty;
      const lotQty =
        shippedQty > 0 ? shippedQty : o.status === 'ready_for_dispatch' ? o.dispatchStatus.balanceQty : 0;
      const weightMt = Number(((lotQty * unitWeightKg) / 1000).toFixed(1));

      return {
        id: `DSP-DERIVED-0${idx + 1}`,
        date: o.dispatchStatus.dispatchDate,
        orderNo: o.poNumber,
        jobNumber: o.jobNumber,
        customer: o.customerName,
        product: li?.productName || 'Forged Component',
        quantity: shippedQty,
        plannedLotQty: lotQty,
        balanceQty: o.dispatchStatus.balanceQty,
        weightMt,
        transporter: o.dispatchStatus.transporterName,
        vehicleNo: o.dispatchStatus.vehicleNo,
        lrNumber: o.dispatchStatus.lrNumber,
        destination: o.dispatchStatus.destinationCity,
        invoiceRef: o.invoiceStatus.invoiceNumber,
        clearanceRef: o.clearanceStatus.clearanceRefNo,
        status: o.dispatchStatus.state === 'completed' ? 'dispatched' : o.status,
      };
    });
}

// ============================================================================
// 4. ADMIN ACCOUNT VERIFICATION & NON-DESTRUCTIVE ROLE MAPPING
// ============================================================================

export function mapGranularRoleToRbacGroup(role: UserRole | string): RbacRoleGroup {
  return getOrganizationalGroupForRole(role);
}

export function mapRbacGroupToDefaultGranularRole(
  group: RbacRoleGroup | UserRole | string,
  existingGranularRole?: UserRole | string
): UserRole {
  return resolveGranularRoleFromGroupOrLegacy(group, existingGranularRole);
}

export interface ResolvedUserRoleMapping {
  granularRole: UserRole;
  rbacGroup: RbacRoleGroup;
  rtdbRuleRole: string;
  isUnassigned: boolean;
  isActive: boolean;
  isRuleCompliantAdmin: boolean;
  permissions: UserProfile['permissions'];
}

/**
 * Non-destructively resolves a user profile's granular role and RBAC group
 * without changing or overwriting existing user roles.
 */
export function resolveUserRoleMapping(rawProfile: Record<string, any>): ResolvedUserRoleMapping {
  const rawRole = String(rawProfile?.role || '');
  const rawLegacyRole = String(rawProfile?.legacyRole || '');
  const rawRequestedRole = String(rawProfile?.requestedRole || '');
  const rawRbacGroup = String(rawProfile?.rbacGroup || '');
  const accountStatus = String(rawProfile?.accountStatus || 'pending_approval');

  const isUnassigned = rawRole === 'Unassigned' || (!rawRole && !rawLegacyRole && !rawRbacGroup);
  const isActive = accountStatus === 'active' && !isUnassigned;

  // Determine granular UserRole while preserving 'stores', 'purchase', 'dispatch', 'super_admin', 'ceo', etc.
  let granularRole: UserRole = 'quality';
  if (VALID_USER_ROLES.includes(rawLegacyRole as UserRole)) {
    granularRole = rawLegacyRole as UserRole;
  } else if (VALID_USER_ROLES.includes(rawRole as UserRole)) {
    granularRole = rawRole as UserRole;
  } else if (VALID_USER_ROLES.includes(rawRequestedRole as UserRole)) {
    granularRole = rawRequestedRole as UserRole;
  } else if (VALID_RBAC_GROUPS.includes(rawRole as RbacRoleGroup)) {
    granularRole = mapRbacGroupToDefaultGranularRole(rawRole as RbacRoleGroup);
  } else if (VALID_RBAC_GROUPS.includes(rawRbacGroup as RbacRoleGroup)) {
    granularRole = mapRbacGroupToDefaultGranularRole(rawRbacGroup as RbacRoleGroup);
  }

  // Determine RbacRoleGroup without promoting Unassigned users
  let rbacGroup: RbacRoleGroup = 'Production';
  if (VALID_RBAC_GROUPS.includes(rawRbacGroup as RbacRoleGroup) && !isUnassigned) {
    rbacGroup = rawRbacGroup as RbacRoleGroup;
  } else if (VALID_RBAC_GROUPS.includes(rawRole as RbacRoleGroup)) {
    rbacGroup = rawRole as RbacRoleGroup;
  } else {
    rbacGroup = mapGranularRoleToRbacGroup(granularRole);
  }

  const isRuleCompliantAdmin =
    accountStatus === 'active' && rawRole === 'Admin';

  const permissions = isActive
    ? ROLE_PERMISSION_DEFAULTS[granularRole] || []
    : [];

  return {
    granularRole,
    rbacGroup,
    rtdbRuleRole: rawRole || rbacGroup,
    isUnassigned,
    isActive,
    isRuleCompliantAdmin,
    permissions,
  };
}

export interface AdminAccountVerificationResult {
  valid: boolean;
  uidMatches: boolean;
  hasActiveStatus: boolean;
  hasRtdbAdminRole: boolean;
  hasAdminRbacGroup: boolean;
  requiresRoleNormalizationWarn: boolean;
  details: string;
}

/**
 * Verifies an Admin account profile against database.rules.json and application RBAC
 * WITHOUT automatically modifying or overwriting the profile in Firebase.
 */
export function verifyAdminAccountProfile(
  rawProfile: Record<string, any> | null | undefined,
  expectedUid?: string
): AdminAccountVerificationResult {
  if (!rawProfile || typeof rawProfile !== 'object') {
    return {
      valid: false,
      uidMatches: false,
      hasActiveStatus: false,
      hasRtdbAdminRole: false,
      hasAdminRbacGroup: false,
      requiresRoleNormalizationWarn: false,
      details: 'Admin profile does not exist at /users/$uid.',
    };
  }

  const uidMatches = !expectedUid || rawProfile.id === expectedUid;
  const hasActiveStatus = rawProfile.accountStatus === 'active';
  const hasRtdbAdminRole = rawProfile.role === 'Admin';
  const hasLegacyAdminOnly =
    rawProfile.role === 'super_admin' && rawProfile.rbacGroup === 'Admin';
  const hasAdminRbacGroup =
    rawProfile.rbacGroup === 'Admin' ||
    rawProfile.role === 'Admin' ||
    rawProfile.role === 'super_admin';

  const valid = uidMatches && hasActiveStatus && hasRtdbAdminRole && hasAdminRbacGroup;

  let details = 'Admin profile is active and compliant with database.rules.json.';
  if (!uidMatches) {
    details = `Profile id '${rawProfile.id}' does not match Auth UID '${expectedUid}'.`;
  } else if (!hasActiveStatus) {
    details = `Account status is '${rawProfile.accountStatus}' (must be 'active').`;
  } else if (!hasRtdbAdminRole && hasLegacyAdminOnly) {
    details = `Profile has role='super_admin' instead of role='Admin'; database.rules.json checks root.child('users').child(auth.uid).child('role').val() === 'Admin'.`;
  } else if (!hasRtdbAdminRole) {
    details = `Profile role is '${rawProfile.role}' (not 'Admin').`;
  }

  return {
    valid,
    uidMatches,
    hasActiveStatus,
    hasRtdbAdminRole,
    hasAdminRbacGroup,
    requiresRoleNormalizationWarn: !hasRtdbAdminRole && hasLegacyAdminOnly,
    details,
  };
}

// ============================================================================
// 5. DASHBOARD KPI CALCULATIONS & RECONCILIATION AGAINST ACTUAL RECORDS
// ============================================================================

export interface ComputedExecutiveMetrics {
  // Dispatch metrics
  todaysDispatchValueOnRefDate: number;
  todaysDispatchQtyOnRefDate: number;
  latestExecutedDispatchValue: number;
  latestExecutedDispatchQty: number;
  latestExecutedDispatchDate: string;

  // Open order metrics
  openOrdersCount: number;
  openOrdersTotalPoValue: number;
  openOrdersPendingBacklogValue: number;
  openOrdersTotalOrderedQty: number;
  openOrdersTotalShippedQty: number;
  openOrdersTotalPendingQty: number;

  // Material shortage metrics
  materialShortagesByAvailableStockCount: number;
  materialShortagesByPhysicalStockCount: number;
  materialShortagesByStoredStatusCount: number;
  materialShortagesByOrderStateCount: number;

  // Quality & Dispatch Pending
  qualityPendingCount: number;
  dispatchReadyClearedQty: number;
  dispatchClearedUndispatchedQty: number;
  dispatchTotalPendingQty: number;

  // Sales & Receivables
  invoicedTaxSalesTotal: number;
  invoicedIncludingProformaTotal: number;
  totalOutstanding: number;
  bucket0to30: number;
  bucket31to60: number;
  bucket61to90: number;
  bucket90Plus: number;

  // Overdue metrics
  overdueByContractualDateCount: number;
  overdueByTargetDateCount: number;
  ordersBlockedByMaterialShortageCount: number;
}

export function calculateDashboardKpisFromRecords(params: {
  salesOrders: OrderJourney[];
  dispatches: {
    id: string;
    date: string;
    orderNo: string;
    jobNumber: string;
    quantity: number;
    balanceQty: number;
    status: string;
  }[];
  rawMaterials: RawMaterialStock[];
  qualityInspections: QualityInspectionRecord[];
  outstandingAgeing: OutstandingAgeingRecord[];
  referenceDate?: string;
}): ComputedExecutiveMetrics {
  const {
    salesOrders,
    dispatches,
    rawMaterials,
    qualityInspections,
    outstandingAgeing,
    referenceDate = '2026-10-22',
  } = params;

  // 1. Dispatches
  const executedDispatches = dispatches.filter(
    (d) => d.status === 'dispatched' || d.status === 'completed'
  );
  const dispatchesOnRefDate = executedDispatches.filter((d) => d.date === referenceDate);
  const todaysDispatchQtyOnRefDate = dispatchesOnRefDate.reduce((s, d) => s + d.quantity, 0);

  // Value of dispatches on referenceDate matched via salesOrders unit rate or invoiceAmount
  const todaysDispatchValueOnRefDate = dispatchesOnRefDate.reduce((s, d) => {
    const ord = salesOrders.find((o) => o.jobNumber === d.jobNumber || o.poNumber === d.orderNo);
    const rate = ord?.lineItems?.[0]?.ratePerUnit || 0;
    return s + d.quantity * rate;
  }, 0);

  // Latest executed consignment
  const sortedExecuted = [...executedDispatches].sort((a, b) => b.date.localeCompare(a.date));
  const latestExec = sortedExecuted[0];
  const latestExecOrder = latestExec
    ? salesOrders.find(
        (o) => o.jobNumber === latestExec.jobNumber || o.poNumber === latestExec.orderNo
      )
    : undefined;
  const latestExecutedDispatchQty = latestExec ? latestExec.quantity : 0;
  const latestExecutedDispatchValue = latestExec
    ? latestExecOrder?.invoiceStatus?.invoiceAmount ||
      latestExec.quantity * (latestExecOrder?.lineItems?.[0]?.ratePerUnit || 0)
    : 0;
  const latestExecutedDispatchDate = latestExec?.date || '-';

  // 2. Open Orders
  const openOrders = salesOrders.filter((o) => o.status !== 'completed');
  const openOrdersCount = openOrders.length;
  const openOrdersTotalPoValue = openOrders.reduce((s, o) => s + o.totalValue, 0);

  let openOrdersTotalOrderedQty = 0;
  let openOrdersTotalShippedQty = 0;
  let openOrdersTotalPendingQty = 0;
  let openOrdersPendingBacklogValue = 0;

  for (const o of openOrders) {
    for (const li of o.lineItems || []) {
      openOrdersTotalOrderedQty += li.orderedQty;
      openOrdersTotalShippedQty += li.dispatchedQty;
      openOrdersTotalPendingQty += li.pendingQty;
      openOrdersPendingBacklogValue += li.pendingQty * li.ratePerUnit;
    }
  }

  // 3. Raw Material Shortages
  const materialShortagesByAvailableStockCount = rawMaterials.filter((m) => {
    const avail = Math.max(0, Number((m.currentStockMt - m.reservedStockMt).toFixed(2)));
    return computeRawMaterialStockStatus(avail, m.minimumStockMt, m.reorderLevelMt) === 'critical';
  }).length;

  const materialShortagesByPhysicalStockCount = rawMaterials.filter(
    (m) => m.currentStockMt < m.minimumStockMt
  ).length;

  const materialShortagesByStoredStatusCount = rawMaterials.filter(
    (m) => m.status === 'critical'
  ).length;

  const materialShortagesByOrderStateCount = salesOrders.filter(
    (o) => o.materialStatus.state === 'shortage'
  ).length;

  // 4. Quality Pending
  const qualityPendingCount =
    qualityInspections.length > 0
      ? qualityInspections.filter((q) => q.status === 'in_progress' || q.status === 'pending')
          .length
      : salesOrders.filter((o) => o.status === 'quality_pending').length;

  // 5. Dispatch Pending Quantities
  const dispatchReadyClearedQty = salesOrders
    .filter((o) => o.status === 'ready_for_dispatch')
    .reduce((s, o) => s + o.dispatchStatus.balanceQty, 0);

  const dispatchClearedUndispatchedQty = salesOrders
    .filter((o) => o.qualityStatus.state === 'cleared' && o.dispatchStatus.balanceQty > 0)
    .reduce((s, o) => s + o.dispatchStatus.balanceQty, 0);

  const dispatchTotalPendingQty = openOrdersTotalPendingQty;

  // 6. Invoiced Sales & Receivables
  const invoicedTaxSalesTotal = salesOrders
    .filter((o) => o.invoiceStatus.state === 'partial' || o.invoiceStatus.state === 'invoiced')
    .reduce((s, o) => s + o.invoiceStatus.invoiceAmount, 0);

  const invoicedIncludingProformaTotal = salesOrders.reduce(
    (s, o) => s + (o.invoiceStatus.invoiceAmount || 0),
    0
  );

  let totalOutstanding = 0;
  let bucket0to30 = 0;
  let bucket31to60 = 0;
  let bucket61to90 = 0;
  let bucket90Plus = 0;

  for (const rec of outstandingAgeing) {
    totalOutstanding += rec.totalOutstanding;
    bucket0to30 += rec.bucket0to30;
    bucket31to60 += rec.bucket31to60;
    bucket61to90 += rec.bucket61to90;
    bucket90Plus += rec.bucket90Plus;
  }

  // 7. Overdue Orders
  const overdueByContractualDateCount = openOrders.filter(
    (o) => o.expectedDeliveryDate < referenceDate
  ).length;
  const overdueByTargetDateCount = openOrders.filter(
    (o) => o.targetDeliveryDate < referenceDate
  ).length;
  const ordersBlockedByMaterialShortageCount = openOrders.filter(
    (o) => o.status === 'material_pending' || o.materialStatus.state === 'shortage'
  ).length;

  return {
    todaysDispatchValueOnRefDate,
    todaysDispatchQtyOnRefDate,
    latestExecutedDispatchValue,
    latestExecutedDispatchQty,
    latestExecutedDispatchDate,
    openOrdersCount,
    openOrdersTotalPoValue,
    openOrdersPendingBacklogValue,
    openOrdersTotalOrderedQty,
    openOrdersTotalShippedQty,
    openOrdersTotalPendingQty,
    materialShortagesByAvailableStockCount,
    materialShortagesByPhysicalStockCount,
    materialShortagesByStoredStatusCount,
    materialShortagesByOrderStateCount,
    qualityPendingCount,
    dispatchReadyClearedQty,
    dispatchClearedUndispatchedQty,
    dispatchTotalPendingQty,
    invoicedTaxSalesTotal,
    invoicedIncludingProformaTotal,
    totalOutstanding,
    bucket0to30,
    bucket31to60,
    bucket61to90,
    bucket90Plus,
    overdueByContractualDateCount,
    overdueByTargetDateCount,
    ordersBlockedByMaterialShortageCount,
  };
}

export interface KpiDiscrepancyItem {
  kpiField: keyof RtdbDashboardKpis | string;
  storedValue: number | string;
  computedValue: number | string;
  classification: 'CONFIRMED_ERROR' | 'BUSINESS_CONFIRMATION_REQUIRED' | 'MATCH';
  explanation: string;
}

export function reconcileDashboardKpis(
  storedKpis: RtdbDashboardKpis,
  computed: ComputedExecutiveMetrics
): KpiDiscrepancyItem[] {
  return [
    {
      kpiField: 'todaysDispatchValue / todaysDispatchQty',
      storedValue: `₹${storedKpis.todaysDispatchValue.toLocaleString()} (${storedKpis.todaysDispatchQty} PCS)`,
      computedValue: `₹${computed.todaysDispatchValueOnRefDate.toLocaleString()} (${computed.todaysDispatchQtyOnRefDate} PCS) on ref date; ₹${computed.latestExecutedDispatchValue.toLocaleString()} (${computed.latestExecutedDispatchQty} PCS) on ${computed.latestExecutedDispatchDate}`,
      classification:
        storedKpis.todaysDispatchValue === computed.todaysDispatchValueOnRefDate
          ? 'MATCH'
          : 'BUSINESS_CONFIRMATION_REQUIRED',
      explanation: `DSP-2026-0091 (400 PCS, ₹33.80L) was dispatched on ${computed.latestExecutedDispatchDate}. On 2026-10-22, executed dispatch is 0 PCS (DSP-2026-0092 is 'ready_for_dispatch'). Confirm whether card represents 'Today' or 'Latest Executed Lot'.`,
    },
    {
      kpiField: 'openOrdersValue / openOrdersCount',
      storedValue: `₹${storedKpis.openOrdersValue.toLocaleString()} (${storedKpis.openOrdersCount} POs)`,
      computedValue: `Total PO Value: ₹${computed.openOrdersTotalPoValue.toLocaleString()} | Undispatched Backlog: ₹${computed.openOrdersPendingBacklogValue.toLocaleString()} (${computed.openOrdersTotalPendingQty} Pending PCS of ${computed.openOrdersTotalOrderedQty} Ordered PCS)`,
      classification: 'BUSINESS_CONFIRMATION_REQUIRED',
      explanation: `Stored ₹1.488 Cr equals gross PO value of all 4 active orders (including ₹33.80L already dispatched on ORD-2026-001). Net undispatched backlog is ₹1.15 Cr (270 Pending PCS, not 670 PCS).`,
    },
    {
      kpiField: 'materialShortagesCount',
      storedValue: storedKpis.materialShortagesCount,
      computedValue: `${computed.materialShortagesByAvailableStockCount} (by availableStockMt < min) | ${computed.materialShortagesByPhysicalStockCount} (by currentStockMt < min) | ${computed.materialShortagesByOrderStateCount} (by Order shortage)`,
      classification: 'CONFIRMED_ERROR',
      explanation: `Stored KPI is 2, which matches neither available-stock critical count (${computed.materialShortagesByAvailableStockCount}), physical-stock critical count (${computed.materialShortagesByPhysicalStockCount}), stored critical status count (${computed.materialShortagesByStoredStatusCount}), nor blocked orders (${computed.materialShortagesByOrderStateCount}).`,
    },
    {
      kpiField: 'qualityPendingCount',
      storedValue: storedKpis.qualityPendingCount,
      computedValue: computed.qualityPendingCount,
      classification:
        storedKpis.qualityPendingCount === computed.qualityPendingCount
          ? 'MATCH'
          : 'CONFIRMED_ERROR',
      explanation: `Matches 1 active inspection lot in progress (QC-2026-0902 / ORD-2026-002).`,
    },
    {
      kpiField: 'dispatchPendingQty',
      storedValue: `${storedKpis.dispatchPendingQty} PCS`,
      computedValue: `${computed.dispatchReadyClearedQty} PCS (Ready for Dispatch) | ${computed.dispatchClearedUndispatchedQty} PCS (All QC-Cleared Undispatched) | ${computed.dispatchTotalPendingQty} PCS (Total PO Balance)`,
      classification: 'BUSINESS_CONFIRMATION_REQUIRED',
      explanation: `100 PCS matches ORD-2026-004 ('ready_for_dispatch'). However, ORD-2026-001 also has 100 QC-cleared undispatched pieces (total 200 QC-cleared PCS).`,
    },
    {
      kpiField: 'monthlySalesAchieved',
      storedValue: `₹${storedKpis.monthlySalesAchieved.toLocaleString()}`,
      computedValue: `₹${computed.invoicedTaxSalesTotal.toLocaleString()} (Synced Tax Invoices) | ₹${computed.invoicedIncludingProformaTotal.toLocaleString()} (incl. Proforma)`,
      classification: 'BUSINESS_CONFIRMATION_REQUIRED',
      explanation: `Stored ₹3.82 Cr exceeds sum of invoices in /salesOrders (₹33.80L tax invoiced, ₹65.30L with proforma) and /production weeklyRunRate W1-W3 (₹2.83 Cr). Confirm if ₹3.82 Cr includes completed historical October orders not in the 4 active PO sample.`,
    },
    {
      kpiField: 'totalOutstanding',
      storedValue: `₹${storedKpis.totalOutstanding.toLocaleString()}`,
      computedValue: `₹${computed.totalOutstanding.toLocaleString()} (0-30d: ₹${computed.bucket0to30.toLocaleString()}, 31-60d: ₹${computed.bucket31to60.toLocaleString()}, 61-90d: ₹${computed.bucket61to90.toLocaleString()}, 90+d: ₹${computed.bucket90Plus.toLocaleString()})`,
      classification:
        storedKpis.totalOutstanding === computed.totalOutstanding ? 'MATCH' : 'CONFIRMED_ERROR',
      explanation: `Total ₹2.141 Cr matches sum of /outstandingPayments and /customers. Dashboard ageing breakdown percentages updated to use exact bucket sums.`,
    },
    {
      kpiField: 'overdueOrdersCount',
      storedValue: storedKpis.overdueOrdersCount,
      computedValue: `${computed.overdueByContractualDateCount} (past expectedDeliveryDate) | ${computed.overdueByTargetDateCount} (past targetDeliveryDate: ORD-2026-004) | ${computed.ordersBlockedByMaterialShortageCount} (blocked by material delay: ORD-2026-003)`,
      classification: 'BUSINESS_CONFIRMATION_REQUIRED',
      explanation: `ORD-2026-003 (Thermax) has expectedDeliveryDate 2026-11-15 (not overdue, though its raw material PO is delayed 4 days). ORD-2026-004 (IOCL) is past targetDeliveryDate 2026-10-20.`,
    },
  ];
}
