/**
 * Montex Forge MIS — Centralized Role & Permission Definitions (Phase 1)
 *
 * Canonical source of truth for:
 * 1. The 8 granular operational roles (`UserRole`).
 * 2. The 5 descriptive organizational classifications (`RbacRoleGroup`).
 * 3. Explicit, module-level granular permissions per `UserRole`.
 * 4. Safe, non-promoting normalization of legacy role values.
 *
 * IMPORTANT SECURITY INVARIANT:
 * - `RbacRoleGroup` ('Admin' | 'Management' | 'Sales' | 'Production' | 'Finance') is a
 *   descriptive organizational grouping (and legacy RTDB rule compatibility label).
 * - Belonging to the 'Production' group MUST NOT automatically grant blanket permissions
 *   across Stores, Purchase, Quality, Dispatch, or Finance. All application authorization
 *   decisions should evaluate the user's canonical `UserRole` and active `accountStatus`.
 */

export type UserRole =
  | 'super_admin'
  | 'ceo'
  | 'sales'
  | 'stores'
  | 'purchase'
  | 'quality'
  | 'dispatch'
  | 'finance';

/**
 * Descriptive organizational classifications.
 * Note: Legacy `database.rules.json` in Firebase Realtime Database stores one of these 5 strings
 * (or `'Unassigned'`) in `/users/$uid/role`. Do not use `RbacRoleGroup` alone to grant
 * cross-departmental write permissions.
 */
export type RbacRoleGroup = 'Admin' | 'Management' | 'Sales' | 'Production' | 'Finance';

/**
 * Legacy role values encountered in `/users/$uid/role` in RTDB or self-registration requests.
 */
export type LegacyRtdbRoleValue = RbacRoleGroup | 'Unassigned';

export type AccountStatus =
  | 'active'
  | 'deactivated'
  | 'inactive'
  | 'suspended'
  | 'rejected'
  | 'pending_invitation'
  | 'pending_approval'
  | 'pending_setup';

export function isAccountStatusActive(status: unknown): status is 'active' {
  return status === 'active';
}

export type MisModuleId =
  | 'Dashboard'
  | 'Sales Orders'
  | 'Quotations & Tenders'
  | 'Customer & Product Master'
  | 'Production & Shop Floor'
  | 'Inventory / Stores'
  | 'Purchase & Steel Mills'
  | 'Quality & MTC'
  | 'Dispatch'
  | 'Finance & Tally'
  | 'Reports & Exports'
  | 'Alerts & Thresholds'
  | 'User Management';

export type PermissionAction =
  | 'view'
  | 'create'
  | 'edit'
  | 'approve'
  | 'import'
  | 'export'
  | 'admin';

export interface UserPermission {
  module: MisModuleId | string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canApprove: boolean;
  canImport: boolean;
  canExport: boolean;
  canAdmin: boolean;
}

export const CANONICAL_USER_ROLES: readonly UserRole[] = [
  'super_admin',
  'ceo',
  'sales',
  'stores',
  'purchase',
  'quality',
  'dispatch',
  'finance',
] as const;

export const DESCRIPTIVE_RBAC_GROUPS: readonly RbacRoleGroup[] = [
  'Admin',
  'Management',
  'Sales',
  'Production',
  'Finance',
] as const;

/**
 * Descriptive mapping from each canonical `UserRole` to its organizational `RbacRoleGroup`.
 */
export const USER_ROLE_TO_RBAC_GROUP: Readonly<Record<UserRole, RbacRoleGroup>> = {
  super_admin: 'Admin',
  ceo: 'Management',
  sales: 'Sales',
  stores: 'Production',
  purchase: 'Production',
  quality: 'Production',
  dispatch: 'Production',
  finance: 'Finance',
};

/**
 * Human-readable metadata for each canonical `UserRole`.
 */
export const USER_ROLE_METADATA: Readonly<
  Record<
    UserRole,
    {
      role: UserRole;
      label: string;
      defaultTitle: string;
      defaultDepartment: string;
      organizationalGroup: RbacRoleGroup;
      description: string;
    }
  >
> = {
  super_admin: {
    role: 'super_admin',
    label: 'Super Administrator',
    defaultTitle: 'Super Administrator & IT Head',
    defaultDepartment: 'Information Technology',
    organizationalGroup: 'Admin',
    description:
      'Full system administration, employee account provisioning, RBAC assignment, security audit trail, and threshold configuration.',
  },
  ceo: {
    role: 'ceo',
    label: 'Managing Director / CEO (Higher Authority)',
    defaultTitle: 'Managing Director & CEO',
    defaultDepartment: 'Top Management',
    organizationalGroup: 'Management',
    description:
      'Higher Authority operational leadership across all business modules, KPI command center, employee & Higher Authority role promotion, alert threshold approvals, and audit log review.',
  },
  sales: {
    role: 'sales',
    label: 'Sales & Commercial Officer',
    defaultTitle: 'VP - Sales & Marketing',
    defaultDepartment: 'Sales',
    organizationalGroup: 'Sales',
    description:
      'Manages Customer Master, Product Master, Quotations, PSU/EPC Tenders, and Customer Sales Orders / Job Number registration.',
  },
  stores: {
    role: 'stores',
    label: 'Stores & Yard Superintendent',
    defaultTitle: 'Stores & Yard Superintendent',
    defaultDepartment: 'Inventory / Stores',
    organizationalGroup: 'Production',
    description:
      'Manages Raw Material Billet/Ingot Yard Inventory, Heat-Traceable Stock Movements (GRN / Production Issue / Scrap Return), and Job Material Allocations.',
  },
  purchase: {
    role: 'purchase',
    label: 'Procurement & Steel Mill Buyer',
    defaultTitle: 'Head of Strategic Procurement',
    defaultDepartment: 'Purchase',
    organizationalGroup: 'Production',
    description:
      'Manages Approved Steel Mill Suppliers, Purchase Orders to Steel Mills, and Mill GRN Receipts into Raw Material Inventory.',
  },
  quality: {
    role: 'quality',
    label: 'Quality Assurance & Metallurgy',
    defaultTitle: 'Quality Assurance Head (NDT Level III)',
    defaultDepartment: 'Quality Assurance',
    organizationalGroup: 'Production',
    description:
      'Manages Lot Quality Inspections, NDT/Metallurgical Testing, EN 10204 3.1 MTCs, TPI Clearances, and Dimensional Inspection Reports.',
  },
  dispatch: {
    role: 'dispatch',
    label: 'Dispatch & Logistics Officer',
    defaultTitle: 'Dispatch & Logistics Officer',
    defaultDepartment: 'Logistics',
    organizationalGroup: 'Production',
    description:
      'Manages Outward Consignment Planning, Gate Passes, Transporter/Vehicle LRs, Delivery Challans, and Order Dispatch Quantities.',
  },
  finance: {
    role: 'finance',
    label: 'Finance, Costing & Accounts',
    defaultTitle: 'Chief Financial Officer',
    defaultDepartment: 'Finance & Accounts',
    organizationalGroup: 'Finance',
    description:
      'Manages Tax Invoices, Customer Payment Collections, Receivables Ageing Buckets, Credit Limits, 8-Head Job Costing, and Tally Prime CSV Sync.',
  },
};

/**
 * Documented mapping of legacy RTDB `role` strings when no granular `legacyRole` field is present.
 *
 * SECURITY SAFEGUARDS:
 * - `'Unassigned'` or unknown strings NEVER map to `'super_admin'` or `'ceo'`.
 * - `'Production'` (ambiguous legacy group covering `stores`, `purchase`, `quality`, `dispatch`)
 *   preserves the user's explicit `legacyRole` if valid; if absent, defaults conservatively to
 *   `'quality'` (lowest-privilege shop-floor inspection role) and flags `requiresExplicitRoleConfirmation: true`.
 */
export const LEGACY_GROUP_DEFAULT_ROLE_MAP: Readonly<Record<RbacRoleGroup, UserRole>> = {
  Admin: 'super_admin',
  Management: 'ceo',
  Sales: 'sales',
  Production: 'quality',
  Finance: 'finance',
};

/**
 * Granular, module-by-module permission matrix for all 8 canonical `UserRole` values.
 *
 * Includes both the original 7 module labels (for 100% backward compatibility with existing UI
 * components) and the 6 specific sub-module labels (`Quotations & Tenders`, `Customer & Product Master`,
 * `Production & Shop Floor`, `Purchase & Steel Mills`, `Reports & Exports`, `Alerts & Thresholds`)
 * so that `stores`, `purchase`, `quality`, and `dispatch` are strictly separated.
 */
export const ROLE_PERMISSION_DEFAULTS: Record<UserRole, UserPermission[]> = {
  super_admin: [
    { module: 'Dashboard', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Sales Orders', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Quotations & Tenders', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Customer & Product Master', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Production & Shop Floor', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Inventory / Stores', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Purchase & Steel Mills', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Quality & MTC', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Dispatch', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Finance & Tally', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Reports & Exports', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Alerts & Thresholds', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'User Management', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
  ],
  ceo: [
    { module: 'Dashboard', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Sales Orders', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Quotations & Tenders', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Customer & Product Master', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Production & Shop Floor', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Inventory / Stores', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Purchase & Steel Mills', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Quality & MTC', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Dispatch', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Finance & Tally', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Reports & Exports', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'Alerts & Thresholds', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: true },
    { module: 'User Management', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: false, canExport: true, canAdmin: true },
  ],
  sales: [
    { module: 'Dashboard', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Sales Orders', canView: true, canCreate: true, canEdit: true, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Quotations & Tenders', canView: true, canCreate: true, canEdit: true, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Customer & Product Master', canView: true, canCreate: true, canEdit: true, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Production & Shop Floor', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Inventory / Stores', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Purchase & Steel Mills', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Quality & MTC', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Dispatch', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Finance & Tally', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Reports & Exports', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Alerts & Thresholds', canView: true, canCreate: false, canEdit: true, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'User Management', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
  ],
  stores: [
    { module: 'Dashboard', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Sales Orders', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Quotations & Tenders', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Customer & Product Master', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Production & Shop Floor', canView: true, canCreate: true, canEdit: true, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Inventory / Stores', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: false, canExport: true, canAdmin: false },
    { module: 'Purchase & Steel Mills', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Quality & MTC', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Dispatch', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Finance & Tally', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Reports & Exports', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Alerts & Thresholds', canView: true, canCreate: false, canEdit: true, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'User Management', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
  ],
  purchase: [
    { module: 'Dashboard', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Sales Orders', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Quotations & Tenders', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Customer & Product Master', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Production & Shop Floor', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Inventory / Stores', canView: true, canCreate: true, canEdit: true, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Purchase & Steel Mills', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: false, canExport: true, canAdmin: false },
    { module: 'Quality & MTC', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Dispatch', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Finance & Tally', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Reports & Exports', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Alerts & Thresholds', canView: true, canCreate: false, canEdit: true, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'User Management', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
  ],
  quality: [
    { module: 'Dashboard', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Sales Orders', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Quotations & Tenders', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Customer & Product Master', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Production & Shop Floor', canView: true, canCreate: true, canEdit: true, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Inventory / Stores', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Purchase & Steel Mills', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Quality & MTC', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: false, canExport: true, canAdmin: false },
    { module: 'Dispatch', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Finance & Tally', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Reports & Exports', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Alerts & Thresholds', canView: true, canCreate: false, canEdit: true, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'User Management', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
  ],
  dispatch: [
    { module: 'Dashboard', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Sales Orders', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Quotations & Tenders', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Customer & Product Master', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Production & Shop Floor', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Inventory / Stores', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Purchase & Steel Mills', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Quality & MTC', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Dispatch', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: false, canExport: true, canAdmin: false },
    { module: 'Finance & Tally', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Reports & Exports', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Alerts & Thresholds', canView: true, canCreate: false, canEdit: true, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'User Management', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
  ],
  finance: [
    { module: 'Dashboard', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Sales Orders', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Quotations & Tenders', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Customer & Product Master', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Production & Shop Floor', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Inventory / Stores', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Purchase & Steel Mills', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Quality & MTC', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'Dispatch', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Finance & Tally', canView: true, canCreate: true, canEdit: true, canApprove: true, canImport: true, canExport: true, canAdmin: false },
    { module: 'Reports & Exports', canView: true, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: true, canAdmin: false },
    { module: 'Alerts & Thresholds', canView: true, canCreate: false, canEdit: true, canApprove: false, canImport: false, canExport: false, canAdmin: false },
    { module: 'User Management', canView: false, canCreate: false, canEdit: false, canApprove: false, canImport: false, canExport: false, canAdmin: false },
  ],
};

export function isCanonicalUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (CANONICAL_USER_ROLES as readonly string[]).includes(value);
}

export function isDescriptiveRbacGroup(value: unknown): value is RbacRoleGroup {
  return typeof value === 'string' && (DESCRIPTIVE_RBAC_GROUPS as readonly string[]).includes(value);
}

/**
 * Returns the descriptive `RbacRoleGroup` for a canonical `UserRole` or legacy role string.
 * Never promotes an unknown or `'Unassigned'` string to `'Admin'`, `'Management'`, or `'Finance'`.
 */
export function getOrganizationalGroupForRole(role: UserRole | string): RbacRoleGroup {
  if (isCanonicalUserRole(role)) {
    return USER_ROLE_TO_RBAC_GROUP[role];
  }
  if (isDescriptiveRbacGroup(role)) {
    return role;
  }
  return 'Production';
}

/**
 * Resolves a legacy `RbacRoleGroup` or role string to a canonical `UserRole`, preserving
 * `existingGranularRole` whenever it is a valid `UserRole` in the same organizational group.
 *
 * Never promotes unknown or `'Unassigned'` values to `'super_admin'`.
 */
export function resolveGranularRoleFromGroupOrLegacy(
  groupOrRole: RbacRoleGroup | UserRole | string,
  existingGranularRole?: UserRole | string
): UserRole {
  if (
    existingGranularRole &&
    isCanonicalUserRole(existingGranularRole) &&
    (!isDescriptiveRbacGroup(groupOrRole) ||
      USER_ROLE_TO_RBAC_GROUP[existingGranularRole] === groupOrRole)
  ) {
    return existingGranularRole;
  }

  if (isCanonicalUserRole(groupOrRole)) {
    return groupOrRole;
  }

  if (isDescriptiveRbacGroup(groupOrRole)) {
    return LEGACY_GROUP_DEFAULT_ROLE_MAP[groupOrRole];
  }

  return 'quality';
}

/**
 * Evaluates whether a given `UserRole` (with active `accountStatus`) has a specific
 * action permission on a module.
 *
 * Returns `false` if `accountStatus !== 'active'` or if the role is not recognized.
 */
export function hasGranularRolePermission(
  role: UserRole | string | undefined | null,
  moduleName: MisModuleId | string,
  action: PermissionAction,
  accountStatus: AccountStatus | string = 'active'
): boolean {
  if (accountStatus !== 'active' || !role || !isCanonicalUserRole(role)) {
    return false;
  }
  const perms = ROLE_PERMISSION_DEFAULTS[role] || [];
  const modPerm = perms.find((p) => p.module === moduleName);
  if (!modPerm) return false;

  switch (action) {
    case 'view':
      return modPerm.canView;
    case 'create':
      return modPerm.canCreate;
    case 'edit':
      return modPerm.canEdit;
    case 'approve':
      return modPerm.canApprove;
    case 'import':
      return modPerm.canImport;
    case 'export':
      return modPerm.canExport;
    case 'admin':
      return modPerm.canAdmin;
    default:
      return false;
  }
}

export const ALL_USER_ROLES = CANONICAL_USER_ROLES;

export const ROLE_DISPLAY_LABELS: Readonly<Record<UserRole, string>> = {
  super_admin: USER_ROLE_METADATA.super_admin.defaultTitle,
  ceo: USER_ROLE_METADATA.ceo.defaultTitle,
  sales: USER_ROLE_METADATA.sales.defaultTitle,
  stores: USER_ROLE_METADATA.stores.defaultTitle,
  purchase: USER_ROLE_METADATA.purchase.defaultTitle,
  quality: USER_ROLE_METADATA.quality.defaultTitle,
  dispatch: USER_ROLE_METADATA.dispatch.defaultTitle,
  finance: USER_ROLE_METADATA.finance.defaultTitle,
};

export const mapRoleToRbacGroup = getOrganizationalGroupForRole;

/**
 * Safely normalizes a canonical UserRole or legacy RbacRoleGroup string to a canonical UserRole,
 * returning null if unrecognized or 'Unassigned'.
 */
export function normalizeRoleInput(value: unknown): UserRole | null {
  if (isCanonicalUserRole(value)) {
    return value;
  }
  if (isDescriptiveRbacGroup(value)) {
    return LEGACY_GROUP_DEFAULT_ROLE_MAP[value];
  }
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower.includes('sales') || lower.includes('commercial') || lower.includes('marketing')) {
      return 'sales';
    }
    if (lower.includes('store') || lower.includes('inventory') || lower.includes('ppc') || lower.includes('production') || lower.includes('forging')) {
      return 'stores';
    }
    if (lower.includes('purchase') || lower.includes('procurement')) {
      return 'purchase';
    }
    if (lower.includes('quality') || lower.includes('metallurg') || lower.includes('qc')) {
      return 'quality';
    }
    if (lower.includes('dispatch') || lower.includes('logistic')) {
      return 'dispatch';
    }
    if (lower.includes('finance') || lower.includes('account')) {
      return 'finance';
    }
    if (lower.includes('ceo') || lower.includes('executive') || lower.includes('director')) {
      return 'ceo';
    }
    if (lower.includes('super_admin') || lower.includes('super admin')) {
      return 'super_admin';
    }
  }
  return null;
}

export type CanonicalRole = UserRole;
export const resolveCanonicalRole = normalizeRoleInput;

/**
 * 3-Tier Authority Hierarchy Evaluators:
 * - Tier 1: `super_admin` (Highest system authority — full control including `super_admin` governance)
 * - Tier 2: `ceo` (Higher Authority / Executive Management — full operational access & ability to manage
 *           department employees and promote eligible employees to `ceo` Higher Authority, but strictly
 *           forbidden from creating, promoting to, modifying, demoting, or deactivating `super_admin`)
 * - Tier 3: Department Roles (`sales`, `stores`, `purchase`, `quality`, `dispatch`, `finance`)
 */
export function isHigherAuthorityOrAdmin(role: UserRole | string | undefined | null): boolean {
  const canonical = normalizeRoleInput(role);
  return canonical === 'super_admin' || canonical === 'ceo';
}

export function canActorManageTargetRole(params: {
  actorRole: UserRole | string | undefined | null;
  actorStatus?: AccountStatus | string;
  targetCurrentRole?: UserRole | string | null;
  targetNewRole?: UserRole | string | null;
}): { allowed: boolean; reason?: string } {
  const { actorRole, actorStatus = 'active', targetCurrentRole, targetNewRole } = params;
  if (actorStatus !== 'active') {
    return { allowed: false, reason: 'Caller account is not active.' };
  }
  const canonicalActor = normalizeRoleInput(actorRole);
  if (canonicalActor === 'super_admin') {
    return { allowed: true };
  }
  if (canonicalActor === 'ceo') {
    const canonicalCurrent = targetCurrentRole ? normalizeRoleInput(targetCurrentRole) : null;
    const canonicalNew = targetNewRole ? normalizeRoleInput(targetNewRole) : null;
    if (canonicalCurrent === 'super_admin' || targetCurrentRole === 'Admin') {
      return {
        allowed: false,
        reason:
          'Security Policy: Higher Authority (CEO / Management) cannot modify, demote, or deactivate a Super Administrator account.',
      };
    }
    if (canonicalNew === 'super_admin' || targetNewRole === 'Admin') {
      return {
        allowed: false,
        reason:
          'Security Policy: Higher Authority (CEO / Management) can promote users up to Higher Authority (CEO), but cannot create or promote anyone to Super Administrator.',
      };
    }
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: 'Only Super Administrator or Higher Authority (CEO) can manage employee roles.',
  };
}

export type FirestoreCollectionKey =
  | 'users'
  | 'systemConfig'
  | 'customers'
  | 'orderCommercials'
  | 'products'
  | 'salesOrders'
  | 'dispatches'
  | 'rawMaterials'
  | 'stockMovements'
  | 'qualityInspections'
  | 'outstandingPayments'
  | 'actionQueue'
  | 'auditLogs'
  | 'quotations'
  | 'tenders'
  | 'leads'
  | 'suppliers'
  | 'purchaseOrders'
  | 'machineLogs'
  | 'furnaceLogs'
  | 'maintenanceTickets'
  | 'powerLogs'
  | 'dimensionalReports'
  | 'jobCostSheets'
  | 'tasks'
  | 'handovers'
  | 'purchaseRequisitions'
  | 'ncrCapaRecords'
  | 'paymentFollowUps';

const ROLE_COLLECTION_READ_MATRIX: Readonly<
  Record<FirestoreCollectionKey, readonly UserRole[]>
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
  orderCommercials: ['super_admin', 'ceo', 'sales', 'finance'], // order value: commercial roles only
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
  // R-4 Resolved: Sales has read-only access to outstandingPayments for credit-limit & follow-up coordination
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
  leads: ['super_admin', 'ceo', 'sales'],
  suppliers: ['super_admin', 'ceo', 'purchase', 'stores', 'quality', 'finance'],
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
  purchaseRequisitions: ['super_admin', 'ceo', 'purchase', 'stores', 'finance'],
  ncrCapaRecords: [
    'super_admin',
    'ceo',
    'quality',
    'stores',
    'sales',
    'dispatch',
  ],
  paymentFollowUps: ['super_admin', 'ceo', 'finance', 'sales'],
};

const ROLE_COLLECTION_WRITE_MATRIX: Readonly<
  Record<FirestoreCollectionKey, readonly UserRole[]>
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
  // R-2 Resolved: Customers write aligned across roles.ts, firestore.rules, and database.rules.json
  customers: ['super_admin', 'ceo', 'sales', 'finance'],
  // R-3 Resolved: Products write aligned to super_admin, ceo, sales, quality (stores excluded)
  products: ['super_admin', 'ceo', 'sales', 'quality'],
  orderCommercials: ['super_admin', 'ceo', 'sales', 'finance'],
  salesOrders: [
    'super_admin',
    'ceo',
    'sales',
    'purchase',
    'stores',
    'quality',
    'dispatch',
    'finance',
  ],
  dispatches: ['super_admin', 'ceo', 'dispatch'],
  rawMaterials: ['super_admin', 'ceo', 'stores'],
  stockMovements: ['super_admin', 'ceo', 'stores'],
  qualityInspections: ['super_admin', 'ceo', 'quality'],
  // R-4 Resolved: Payment write remains strictly restricted to financial & executive authority
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
  leads: ['super_admin', 'ceo', 'sales'],
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

export function canRoleReadCollection(
  role: UserRole | string | undefined | null,
  collectionName: FirestoreCollectionKey
): boolean {
  const canonical = normalizeRoleInput(role);
  if (!canonical) return false;
  const allowed = ROLE_COLLECTION_READ_MATRIX[collectionName];
  return Boolean(allowed && allowed.includes(canonical));
}

export function canRoleWriteCollection(
  role: UserRole | string | undefined | null,
  collectionName: FirestoreCollectionKey
): boolean {
  const canonical = normalizeRoleInput(role);
  if (!canonical) return false;
  const allowed = ROLE_COLLECTION_WRITE_MATRIX[collectionName];
  return Boolean(allowed && allowed.includes(canonical));
}

/**
 * ============================================================================
 * STRICT DEPARTMENT HEAD & SEPARATION-OF-DUTIES (SoD) EVALUATORS
 * ============================================================================
 * Enforces the 4 mathematical Separation-of-Duties invariants:
 * 1. Strict Department Scope: A Department Head (`isDepartmentHead === true`) may only
 *    verify/approve tasks or requisitions belonging to their own canonical `UserRole`.
 * 2. Maker != Checker: A user (even a Department Head or CEO) cannot self-verify or
 *    self-approve a task, requisition, or stock adjustment they created/own (only `super_admin`
 *    can override in single-operator emergency mode).
 * 3. Dual-Custody Handovers: An inter-department handover initiated by `fromRole` can only
 *    be accepted or rejected by an active member of `toRole` whose `uid !== initiatedByUid`.
 * 4. Executive Overrides: Credit-hold dispatch overrides, finalized cost-sheet edits, and
 *    company-wide target/threshold changes require `ceo` or `super_admin`.
 */
export function canActorVerifyDepartmentTask(params: {
  actorUid: string;
  actorRole: UserRole | string | undefined | null;
  actorStatus?: AccountStatus | string;
  actorDepartment?: string;
  isDepartmentHead?: boolean;
  managedDepartment?: string;
  taskOwnerUid?: string;
  taskAssignedToUid?: string;
  taskSubmittedByUid?: string;
  taskDepartmentRole?: UserRole | string;
  taskDepartment?: string;
}): { allowed: boolean; reason?: string } {
  const {
    actorUid,
    actorRole,
    actorStatus = 'active',
    isDepartmentHead = false,
    taskOwnerUid,
    taskAssignedToUid,
    taskSubmittedByUid,
    taskDepartmentRole,
    taskDepartment,
  } = params;

  if (actorStatus !== 'active') {
    return { allowed: false, reason: 'Caller account is not active.' };
  }
  const canonicalActor = normalizeRoleInput(actorRole);
  const canonicalTaskRole = normalizeRoleInput(
    taskDepartmentRole || taskDepartment || actorRole
  );
  if (!canonicalActor || !canonicalTaskRole) {
    return { allowed: false, reason: 'Unrecognized actor or task department role.' };
  }

  const effectiveOwnerUid = taskOwnerUid || taskSubmittedByUid || taskAssignedToUid || '';

  // Maker != Checker invariant (applies to all roles except super_admin system override)
  if (effectiveOwnerUid && actorUid === effectiveOwnerUid && canonicalActor !== 'super_admin') {
    return {
      allowed: false,
      reason:
        'Separation of Duties (Maker ≠ Checker): Task owner cannot verify or approve their own submission. Escalate to your Department Head or Higher Authority (CEO).',
    };
  }

  if (canonicalActor === 'super_admin' || canonicalActor === 'ceo') {
    return { allowed: true };
  }

  if (isDepartmentHead && canonicalActor === canonicalTaskRole) {
    return { allowed: true };
  }

  if (isDepartmentHead && canonicalActor !== canonicalTaskRole) {
    return {
      allowed: false,
      reason: `Department Scope Violation: A Department Head for "${canonicalActor}" cannot verify or approve tasks belonging to "${canonicalTaskRole}".`,
    };
  }

  return {
    allowed: false,
    reason:
      'Verification requires Department Head authority for this department, Higher Authority (CEO), or Super Administrator.',
  };
}

export function canActorAcceptOrRejectHandover(params: {
  actorUid: string;
  actorRole: UserRole | string | undefined | null;
  actorStatus?: AccountStatus | string;
  actorDepartment?: string;
  initiatedByUid: string;
  fromRole?: UserRole | string;
  toRole?: UserRole | string;
  toDepartment?: string;
}): { allowed: boolean; reason?: string } {
  const {
    actorUid,
    actorRole,
    actorStatus = 'active',
    initiatedByUid,
    fromRole,
    toRole,
    toDepartment,
  } = params;

  if (actorStatus !== 'active') {
    return { allowed: false, reason: 'Caller account is not active.' };
  }
  const canonicalActor = normalizeRoleInput(actorRole);
  const canonicalFrom = fromRole ? normalizeRoleInput(fromRole) : canonicalActor;
  const canonicalTo = normalizeRoleInput(toRole || toDepartment);
  if (!canonicalActor || !canonicalFrom || !canonicalTo) {
    return { allowed: false, reason: 'Invalid handover role configuration.' };
  }

  if (actorUid === initiatedByUid && canonicalActor !== 'super_admin') {
    return {
      allowed: false,
      reason:
        'Dual-Custody Handover Policy: The employee who initiated a handover cannot accept or sign off the receiving side.',
    };
  }

  if (
    canonicalActor === 'super_admin' ||
    canonicalActor === 'ceo' ||
    canonicalActor === canonicalTo
  ) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `Handover Acceptance Restricted: Only the receiving department ("${canonicalTo}"), Higher Authority (CEO), or Super Admin can accept or reject this handover.`,
  };
}

export function canActorApprovePurchaseRequisition(params: {
  actorUid: string;
  actorRole: UserRole | string | undefined | null;
  actorStatus?: AccountStatus | string;
  actorDepartment?: string;
  isDepartmentHead?: boolean;
  managedDepartment?: string;
  requestedByUid: string;
}): { allowed: boolean; reason?: string } {
  const {
    actorUid,
    actorRole,
    actorStatus = 'active',
    isDepartmentHead = false,
    requestedByUid,
  } = params;

  if (actorStatus !== 'active') {
    return { allowed: false, reason: 'Caller account is not active.' };
  }
  const canonicalActor = normalizeRoleInput(actorRole);
  if (!canonicalActor) {
    return { allowed: false, reason: 'Invalid caller role.' };
  }

  if (actorUid === requestedByUid && canonicalActor !== 'super_admin') {
    return {
      allowed: false,
      reason:
        'Separation of Duties (Maker ≠ Checker): The employee who raised a Purchase Requisition cannot self-approve it.',
    };
  }

  if (
    canonicalActor === 'super_admin' ||
    canonicalActor === 'ceo' ||
    (isDepartmentHead && (canonicalActor === 'purchase' || canonicalActor === 'stores'))
  ) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason:
      'Purchase Requisition approval requires Purchase/Stores Department Head, Higher Authority (CEO), or Super Administrator.',
  };
}

export function canActorExecuteExecutiveOverride(
  paramsOrRole:
    | {
        actorRole: UserRole | string | undefined | null;
        actorStatus?: AccountStatus | string;
      }
    | UserRole
    | string
    | undefined
    | null,
  statusArg?: AccountStatus | string
): { allowed: boolean; reason?: string } {
  const actorRole =
    paramsOrRole && typeof paramsOrRole === 'object' ? paramsOrRole.actorRole : paramsOrRole;
  const actorStatus =
    (paramsOrRole && typeof paramsOrRole === 'object' ? paramsOrRole.actorStatus : statusArg) ||
    'active';
  if (actorStatus !== 'active') {
    return { allowed: false, reason: 'Caller account is not active.' };
  }
  const canonicalActor = normalizeRoleInput(actorRole);
  if (canonicalActor === 'super_admin' || canonicalActor === 'ceo') {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason:
      'Executive Override Restricted: Credit-hold dispatch releases, revenue target updates, and finalized cost-sheet unlocks require Higher Authority (CEO) or Super Administrator.',
  };
}

export function canActorVerifyCapaClosure(params: {
  actorUid: string;
  actorName?: string;
  actorRole: UserRole | string | undefined | null;
  actorStatus?: AccountStatus | string;
  isDepartmentHead?: boolean;
  raisedByUid?: string;
  raisedByName?: string;
}): { allowed: boolean; reason?: string } {
  const {
    actorUid,
    actorName,
    actorRole,
    actorStatus = 'active',
    isDepartmentHead = false,
    raisedByUid,
    raisedByName,
  } = params;

  const effectiveOwnerUid =
    raisedByUid || (actorName && raisedByName && actorName === raisedByName ? actorUid : undefined);

  return canActorVerifyDepartmentTask({
    actorUid,
    actorRole,
    actorStatus,
    isDepartmentHead,
    taskOwnerUid: effectiveOwnerUid,
    taskDepartmentRole: 'quality',
  });
}

export type WorkspaceTabId =
  | 'dashboard'
  | 'order_journey'
  | 'tasks_accountability'
  | 'tasks'
  | 'sales_orders'
  | 'orders'
  | 'quotations'
  | 'leads'
  | 'customers'
  | 'products'
  | 'masters'
  | 'production'
  | 'inventory'
  | 'purchase'
  | 'procurement'
  | 'quality'
  | 'dispatch'
  | 'finance'
  | 'reports'
  | 'notifications'
  | 'admin';

export const WORKSPACE_TAB_TO_MODULE: Readonly<Record<WorkspaceTabId, MisModuleId | 'Tasks & Handovers'>> = {
  dashboard: 'Dashboard',
  order_journey: 'Sales Orders',
  tasks_accountability: 'Tasks & Handovers',
  tasks: 'Tasks & Handovers',
  sales_orders: 'Sales Orders',
  orders: 'Sales Orders',
  quotations: 'Quotations & Tenders',
  leads: 'Quotations & Tenders',
  customers: 'Customer & Product Master',
  products: 'Customer & Product Master',
  masters: 'Customer & Product Master',
  production: 'Production & Shop Floor',
  inventory: 'Inventory / Stores',
  purchase: 'Purchase & Steel Mills',
  procurement: 'Purchase & Steel Mills',
  quality: 'Quality & MTC',
  dispatch: 'Dispatch',
  finance: 'Finance & Tally',
  reports: 'Reports & Exports',
  notifications: 'Alerts & Thresholds',
  admin: 'User Management',
};

export function canRoleAccessWorkspaceTab(
  role: UserRole | string | undefined | null,
  tabId: WorkspaceTabId | string,
  accountStatus: AccountStatus | string = 'active'
): boolean {
  if (accountStatus !== 'active') return false;
  const canonical = normalizeRoleInput(role);
  if (!canonical) return false;
  if (tabId === 'tasks' || tabId === 'tasks_accountability' || tabId === 'dashboard') {
    return true;
  }
  // Enquiries hold prospect contacts: only the people who sell (rules match this).
  if (tabId === 'leads') return canRoleReadCollection(canonical, 'leads');
  const moduleName = WORKSPACE_TAB_TO_MODULE[tabId as WorkspaceTabId];
  if (!moduleName || moduleName === 'Tasks & Handovers') {
    return true;
  }
  return hasGranularRolePermission(canonical, moduleName, 'view', accountStatus);
}

