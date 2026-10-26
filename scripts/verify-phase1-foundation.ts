import {
  CANONICAL_USER_ROLES,
  DESCRIPTIVE_RBAC_GROUPS,
  USER_ROLE_TO_RBAC_GROUP,
  ROLE_PERMISSION_DEFAULTS,
  isCanonicalUserRole,
  isDescriptiveRbacGroup,
  getOrganizationalGroupForRole,
  resolveGranularRoleFromGroupOrLegacy,
  hasGranularRolePermission,
} from '../src/types/roles';
import {
  CLEAN_PRODUCTION_DASHBOARD_KPIS,
  CLEAN_PRODUCTION_SUMMARY,
  CONSISTENT_DEMO_SANDBOX_FIXTURES,
} from '../src/data/mockData';
import {
  resolveUserRoleMapping,
  validateRawMaterialStock,
  validateQualityInspectionQuantities,
  validateSalesOrderQuantities,
  validateCrossModuleQuantities,
} from '../src/services/misDataValidator';

let passed = 0;
let failed = 0;

function assertPhase1(id: string, title: string, condition: boolean, detail: string) {
  console.log(`[${condition ? 'PASS' : 'FAIL'}] ${id} | ${title}`);
  console.log(`       Detail: ${detail}\n`);
  if (condition) passed++;
  else failed++;
}

console.log('================================================================================');
console.log('MONTEX FORGE MIS — PHASE 1 FOUNDATION & DATA HYGIENE VERIFICATION SUITE');
console.log('================================================================================\n');

// 1. Canonical 8 Roles & 5 Descriptive Organizational Groups
assertPhase1(
  'PH1-01',
  'Canonical 8 UserRole Identifiers',
  CANONICAL_USER_ROLES.length === 8 &&
    CANONICAL_USER_ROLES.includes('super_admin') &&
    CANONICAL_USER_ROLES.includes('ceo') &&
    CANONICAL_USER_ROLES.includes('sales') &&
    CANONICAL_USER_ROLES.includes('stores') &&
    CANONICAL_USER_ROLES.includes('purchase') &&
    CANONICAL_USER_ROLES.includes('quality') &&
    CANONICAL_USER_ROLES.includes('dispatch') &&
    CANONICAL_USER_ROLES.includes('finance'),
  `Verified exact 8 canonical roles: ${CANONICAL_USER_ROLES.join(', ')}`
);

assertPhase1(
  'PH1-02',
  'Descriptive 5 RbacRoleGroup Classifications',
  DESCRIPTIVE_RBAC_GROUPS.length === 5 &&
    DESCRIPTIVE_RBAC_GROUPS.includes('Admin') &&
    DESCRIPTIVE_RBAC_GROUPS.includes('Management') &&
    DESCRIPTIVE_RBAC_GROUPS.includes('Sales') &&
    DESCRIPTIVE_RBAC_GROUPS.includes('Production') &&
    DESCRIPTIVE_RBAC_GROUPS.includes('Finance'),
  `Verified 5 organizational groups: ${DESCRIPTIVE_RBAC_GROUPS.join(', ')}`
);

// 2. Granular Permission Separation Within Production Group
const storesCanEditInventory = hasGranularRolePermission('stores', 'Inventory / Stores', 'edit');
const storesCannotEditQuality = !hasGranularRolePermission('stores', 'Quality & MTC', 'edit');
const storesCannotEditDispatch = !hasGranularRolePermission('stores', 'Dispatch', 'edit');
const storesCannotEditPurchase = !hasGranularRolePermission('stores', 'Purchase & Steel Mills', 'edit');
const storesCannotViewFinance = !hasGranularRolePermission('stores', 'Finance & Tally', 'view');

assertPhase1(
  'PH1-03',
  'Granular Role Separation: "stores" Role Cannot Edit Quality, Dispatch, Purchase, or View Finance',
  storesCanEditInventory &&
    storesCannotEditQuality &&
    storesCannotEditDispatch &&
    storesCannotEditPurchase &&
    storesCannotViewFinance,
  'stores can edit Inventory/Stores, but is denied edit on Quality, Dispatch, Purchase & denied view on Finance'
);

const purchaseCanEditPurchase = hasGranularRolePermission('purchase', 'Purchase & Steel Mills', 'edit');
const purchaseCannotApproveInventory = !hasGranularRolePermission('purchase', 'Inventory / Stores', 'approve');
const purchaseCannotEditQuality = !hasGranularRolePermission('purchase', 'Quality & MTC', 'edit');
const purchaseCannotViewDispatch = !hasGranularRolePermission('purchase', 'Dispatch', 'view');

assertPhase1(
  'PH1-04',
  'Granular Role Separation: "purchase" Role Cannot Approve Stores, Edit Quality, or View Dispatch',
  purchaseCanEditPurchase &&
    purchaseCannotApproveInventory &&
    purchaseCannotEditQuality &&
    purchaseCannotViewDispatch,
  'purchase can edit Purchase & Steel Mills, but cannot approve Stores, edit Quality, or view Dispatch'
);

const qualityCanApproveQuality = hasGranularRolePermission('quality', 'Quality & MTC', 'approve');
const qualityCannotEditInventory = !hasGranularRolePermission('quality', 'Inventory / Stores', 'edit');
const qualityCannotEditDispatch = !hasGranularRolePermission('quality', 'Dispatch', 'edit');
const qualityCannotViewFinance = !hasGranularRolePermission('quality', 'Finance & Tally', 'view');

assertPhase1(
  'PH1-05',
  'Granular Role Separation: "quality" Role Cannot Edit Inventory, Dispatch, or View Finance',
  qualityCanApproveQuality &&
    qualityCannotEditInventory &&
    qualityCannotEditDispatch &&
    qualityCannotViewFinance,
  'quality can approve Quality & MTC, but cannot edit Inventory, Dispatch, or view Finance'
);

const dispatchCanEditDispatch = hasGranularRolePermission('dispatch', 'Dispatch', 'edit');
const dispatchCannotEditInventory = !hasGranularRolePermission('dispatch', 'Inventory / Stores', 'edit');
const dispatchCannotEditQuality = !hasGranularRolePermission('dispatch', 'Quality & MTC', 'edit');
const dispatchCannotEditFinance = !hasGranularRolePermission('dispatch', 'Finance & Tally', 'edit');

assertPhase1(
  'PH1-06',
  'Granular Role Separation: "dispatch" Role Cannot Edit Inventory, Quality, or Finance',
  dispatchCanEditDispatch &&
    dispatchCannotEditInventory &&
    dispatchCannotEditQuality &&
    dispatchCannotEditFinance,
  'dispatch can edit Dispatch, but cannot edit Inventory, Quality, or Finance'
);

// 3. Non-Promotion & Inactive Account Safeguards
const inactiveSuperAdminDenied = !hasGranularRolePermission(
  'super_admin',
  'User Management',
  'admin',
  'deactivated'
);
const pendingSalesDenied = !hasGranularRolePermission(
  'sales',
  'Sales Orders',
  'create',
  'pending_approval'
);
const unknownRoleFallback = resolveGranularRoleFromGroupOrLegacy('UnknownRogueRole');
const unassignedMapping = resolveUserRoleMapping({
  id: 'uid-unassigned',
  role: 'Unassigned',
  accountStatus: 'pending_approval',
});

assertPhase1(
  'PH1-07',
  'Non-Promotion & Inactive Account Guard (No Silent Promotion to super_admin or ceo)',
  inactiveSuperAdminDenied &&
    pendingSalesDenied &&
    unknownRoleFallback !== 'super_admin' &&
    unknownRoleFallback !== 'ceo' &&
    unassignedMapping.isActive === false &&
    (unassignedMapping.permissions?.length ?? 0) === 0,
  `Deactivated super_admin denied; pending_approval sales denied; unknown role -> '${unknownRoleFallback}'; Unassigned permissions=${unassignedMapping.permissions?.length}`
);

// 4. Legacy Role Preservation Within Same Organizational Group
const preservedStores = resolveGranularRoleFromGroupOrLegacy('Production', 'stores');
const preservedPurchase = resolveGranularRoleFromGroupOrLegacy('Production', 'purchase');
const preservedDispatch = resolveGranularRoleFromGroupOrLegacy('Production', 'dispatch');
const changedToSales = resolveGranularRoleFromGroupOrLegacy('Sales', 'stores');

assertPhase1(
  'PH1-08',
  'Legacy Group Normalization Preserves Granular Role Within Group & Updates When Group Changes',
  preservedStores === 'stores' &&
    preservedPurchase === 'purchase' &&
    preservedDispatch === 'dispatch' &&
    changedToSales === 'sales' &&
    getOrganizationalGroupForRole('stores') === 'Production' &&
    isCanonicalUserRole('purchase') &&
    isDescriptiveRbacGroup('Production'),
  `Production+stores -> ${preservedStores}; Production+purchase -> ${preservedPurchase}; Production+dispatch -> ${preservedDispatch}; Sales+stores -> ${changedToSales}`
);

// 5. Reconciled Demo Sandbox Fixtures Validation (0 Errors)
const demoOrderChecks = CONSISTENT_DEMO_SANDBOX_FIXTURES.salesOrders.map(validateSalesOrderQuantities);
const demoRmChecks = CONSISTENT_DEMO_SANDBOX_FIXTURES.rawMaterials.map(validateRawMaterialStock);
const demoQcChecks = CONSISTENT_DEMO_SANDBOX_FIXTURES.qualityInspections.map(
  validateQualityInspectionQuantities
);
const demoCrossCheck = validateCrossModuleQuantities(
  CONSISTENT_DEMO_SANDBOX_FIXTURES.salesOrders,
  CONSISTENT_DEMO_SANDBOX_FIXTURES.qualityInspections,
  CONSISTENT_DEMO_SANDBOX_FIXTURES.dispatches
);

assertPhase1(
  'PH1-09',
  'Reconciled Demo Sandbox Fixtures Pass All Order, QC, Stock & Cross-Module Validations With 0 Errors',
  CONSISTENT_DEMO_SANDBOX_FIXTURES.dataOrigin === 'demo_sandbox' &&
    demoOrderChecks.every((c) => c.valid) &&
    demoRmChecks.every((c) => c.valid) &&
    demoQcChecks.every((c) => c.valid) &&
    demoCrossCheck.valid === true &&
    demoCrossCheck.confirmedErrors.length === 0,
  `Orders valid=${demoOrderChecks.every((c) => c.valid)}, RM valid=${demoRmChecks.every(
    (c) => c.valid
  )}, QC valid=${demoQcChecks.every((c) => c.valid)}, Cross-Module errors=${
    demoCrossCheck.confirmedErrors.length
  }`
);

// 6. Clean Production Baselines Have Zero Sample Data
assertPhase1(
  'PH1-10',
  'Clean Production Workspace Baselines Contain Zero Sample Data',
  CLEAN_PRODUCTION_DASHBOARD_KPIS.openOrdersCount === 0 &&
    CLEAN_PRODUCTION_DASHBOARD_KPIS.openOrdersValue === 0 &&
    CLEAN_PRODUCTION_DASHBOARD_KPIS.todaysDispatchValue === 0 &&
    CLEAN_PRODUCTION_DASHBOARD_KPIS.totalOutstanding === 0 &&
    CLEAN_PRODUCTION_SUMMARY.totalRejectionPercent === 0 &&
    CLEAN_PRODUCTION_SUMMARY.shifts.shiftA.tonnageMt === 0 &&
    Object.keys(USER_ROLE_TO_RBAC_GROUP).length === 8 &&
    Object.keys(ROLE_PERMISSION_DEFAULTS).length === 8,
  'Verified CLEAN_PRODUCTION_DASHBOARD_KPIS and CLEAN_PRODUCTION_SUMMARY counters are all 0'
);

console.log('================================================================================');
console.log(
  `PHASE 1 VERIFICATION SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed} checks)`
);
console.log('================================================================================');

if (failed > 0) {
  process.exit(1);
}
