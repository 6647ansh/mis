import {
  runComprehensiveSecurityRuleAudit,
  evaluateRtdbOperation,
} from '../src/services/rtdbSecurityEvaluator';
import {
  MOCK_ORDER_JOURNEYS,
  MOCK_RAW_MATERIALS,
  MOCK_STOCK_MOVEMENTS,
  MOCK_ACTION_QUEUE,
  MOCK_OUTSTANDING_AGEING,
  MOCK_CUSTOMERS,
  MOCK_PRODUCTS,
  PROTOTYPE_USERS,
} from '../src/data/mockData';
import {
  DEFAULT_DASHBOARD_KPIS,
  DEFAULT_PRODUCTION_SUMMARY,
  DEFAULT_ALERT_THRESHOLDS,
  mapRoleToRbacGroup,
} from '../src/services/rtdbService';

const results = runComprehensiveSecurityRuleAudit();

let passedCount = 0;
let failedCount = 0;

console.log('================================================================================');
console.log('MONTEX MIS — FIREBASE REALTIME DATABASE SECURITY RULES VERIFICATION REPORT');
console.log('Target Rules File: /database.rules.json');
console.log('Runner: Custom TypeScript RTDB Rule Evaluator (scripts/verify-rtdb-rules.ts)');
console.log('================================================================================\n');

for (const tc of results) {
  const statusStr = tc.passed ? 'PASS' : 'FAIL';
  if (tc.passed) passedCount++;
  else failedCount++;

  console.log(
    `[${statusStr}] ${tc.id} (${tc.category}) | Actor: ${tc.actorLabel} | ${tc.operation.toUpperCase()} ${tc.path}`
  );
  console.log(
    `       Expected: ${tc.expectedAllowed ? 'ALLOW' : 'DENY'} | Actual: ${
      tc.actualAllowed ? 'ALLOW' : 'DENY'
    } | ${tc.description}`
  );
  console.log(`       Engine Reason: ${tc.reason}\n`);
}

// SEC-23: Bootstrap One-Time Creation when !data.exists()
const emptyUsersDb = { users: {} };
const bootstrapFirstTime = evaluateRtdbOperation(
  emptyUsersDb,
  { uid: 'uid-owner', token: { email: 'anshyadav6647@gmail.com', email_verified: true } },
  'write',
  '/users/uid-owner',
  {
    id: 'uid-owner',
    name: 'Ansh Yadav',
    email: 'anshyadav6647@gmail.com',
    role: 'Admin',
    accountStatus: 'active',
  }
);
console.log(
  `[${bootstrapFirstTime.allowed === true ? 'PASS' : 'FAIL'}] SEC-23 (Bootstrap One-Time Creation) | Verified owner email can initialize /users/$uid when !data.exists(): ${
    bootstrapFirstTime.allowed ? 'ALLOW' : 'DENY'
  } (${bootstrapFirstTime.reason})`
);
if (bootstrapFirstTime.allowed === true) passedCount++;
else failedCount++;

// SEC-24: Bootstrap Unverified Email Spoof Guard
const unverifiedBootstrapSpoof = evaluateRtdbOperation(
  emptyUsersDb,
  { uid: 'uid-spoof', token: { email: 'anshyadav6647@gmail.com', email_verified: false } },
  'write',
  '/users/uid-spoof',
  {
    id: 'uid-spoof',
    name: 'Spoofed Owner',
    email: 'anshyadav6647@gmail.com',
    role: 'Admin',
    accountStatus: 'active',
  }
);
console.log(
  `[${unverifiedBootstrapSpoof.allowed === false ? 'PASS' : 'FAIL'}] SEC-24 (Bootstrap Unverified Email Spoof Guard) | Unverified email_verified=false rejected: ${
    unverifiedBootstrapSpoof.allowed ? 'ALLOW' : 'DENY'
  } (${unverifiedBootstrapSpoof.reason})`
);
if (unverifiedBootstrapSpoof.allowed === false) passedCount++;
else failedCount++;

// SEC-25: Bootstrap CANNOT Re-Activate or Re-Promote Once Profile Already Exists (data.exists() === true)
const deactivatedOwnerDb = {
  users: {
    'uid-owner': {
      id: 'uid-owner',
      name: 'Ansh Yadav',
      email: 'anshyadav6647@gmail.com',
      role: 'Admin',
      accountStatus: 'deactivated',
    },
  },
};
const bootstrapReActivateAttempt = evaluateRtdbOperation(
  deactivatedOwnerDb,
  { uid: 'uid-owner', token: { email: 'anshyadav6647@gmail.com', email_verified: true } },
  'write',
  '/users/uid-owner',
  {
    id: 'uid-owner',
    name: 'Ansh Yadav',
    email: 'anshyadav6647@gmail.com',
    role: 'Admin',
    accountStatus: 'active',
  }
);
console.log(
  `[${bootstrapReActivateAttempt.allowed === false ? 'PASS' : 'FAIL'}] SEC-25 (Bootstrap Blocked When Profile Already Exists) | Deactivated bootstrap owner CANNOT re-activate own profile when data.exists(): ${
    bootstrapReActivateAttempt.allowed ? 'ALLOW' : 'DENY'
  } (${bootstrapReActivateAttempt.reason})`
);
if (bootstrapReActivateAttempt.allowed === false) passedCount++;
else failedCount++;

// SEC-26: Existing Active Admin Profile Passes /users/$uid .write and .validate
const activeOwnerDb = {
  users: {
    'uid-owner': {
      id: 'uid-owner',
      name: 'Ansh Yadav',
      email: 'anshyadav6647@gmail.com',
      role: 'Admin',
      legacyRole: 'super_admin',
      rbacGroup: 'Admin',
      roleTitle: 'Super Administrator (Bootstrapped)',
      department: 'Administration & IT',
      avatarInitials: 'AY',
      accountStatus: 'active',
      createdAt: '2026-10-22',
      lastLoginAt: '2026-10-22T00:00:00.000Z',
    },
  },
};
const existingAdminUpdateCheck = evaluateRtdbOperation(
  activeOwnerDb,
  { uid: 'uid-owner', token: { email: 'anshyadav6647@gmail.com', email_verified: true } },
  'write',
  '/users/uid-owner',
  {
    ...activeOwnerDb.users['uid-owner'],
    lastLoginAt: '2026-10-22T01:00:00.000Z',
  }
);
console.log(
  `[${existingAdminUpdateCheck.allowed === true ? 'PASS' : 'FAIL'}] SEC-26 (Existing Active Admin Profile Validation) | Existing Admin profile passes /users/$uid .write & .validate: ${
    existingAdminUpdateCheck.allowed ? 'ALLOW' : 'DENY'
  } (${existingAdminUpdateCheck.reason})`
);
if (existingAdminUpdateCheck.allowed === true) passedCount++;
else failedCount++;

// SEC-28: Management / CEO CANNOT Assign 'ceo' or 'Management' Role to Another User or Self
const mgmtPrivilegeDb = {
  users: {
    'uid-admin': {
      id: 'uid-admin',
      name: 'Anand Vernekar',
      email: 'admin@montexforge.com',
      role: 'Admin',
      legacyRole: 'super_admin',
      rbacGroup: 'Admin',
      accountStatus: 'active',
    },
    'uid-mgmt': {
      id: 'uid-mgmt',
      name: 'Vikramaditya Deshmukh',
      email: 'ceo@montexforge.com',
      role: 'Management',
      legacyRole: 'ceo',
      rbacGroup: 'Management',
      accountStatus: 'active',
    },
    'uid-mgmt-peer': {
      id: 'uid-mgmt-peer',
      name: 'Peer Director',
      email: 'director2@montexforge.com',
      role: 'ceo',
      legacyRole: 'ceo',
      rbacGroup: 'Management',
      accountStatus: 'active',
    },
    'uid-pending-emp': {
      id: 'uid-pending-emp',
      name: 'Pending Engineer',
      email: 'pending@montexforge.com',
      role: 'Unassigned',
      legacyRole: 'sales',
      requestedRole: 'sales',
      department: 'Sales',
      accountStatus: 'pending_approval',
    },
    'uid-sales': {
      id: 'uid-sales',
      name: 'Rajeshwari Kulkarni',
      email: 'sales@montexforge.com',
      role: 'Sales',
      legacyRole: 'sales',
      rbacGroup: 'Sales',
      department: 'Sales',
      isDepartmentHead: false,
      approvedByUid: 'uid-admin',
      approvedAt: '2026-10-01T00:00:00.000Z',
      accountStatus: 'active',
    },
  },
};

const mgmtAssignCeoAttempt = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-mgmt', token: { email: 'ceo@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-pending-emp',
  {
    id: 'uid-pending-emp',
    name: 'Pending Engineer',
    email: 'pending@montexforge.com',
    role: 'ceo',
    legacyRole: 'ceo',
    rbacGroup: 'Management',
    accountStatus: 'active',
    approvedByUid: 'uid-mgmt',
  }
);
const mgmtAssignManagementGroupAttempt = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-mgmt', token: { email: 'ceo@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-pending-emp',
  {
    id: 'uid-pending-emp',
    name: 'Pending Engineer',
    email: 'pending@montexforge.com',
    role: 'Management',
    legacyRole: 'sales',
    accountStatus: 'active',
  }
);
const sec28Passed =
  mgmtAssignCeoAttempt.allowed === false && mgmtAssignManagementGroupAttempt.allowed === false;
console.log(
  `[${sec28Passed ? 'PASS' : 'FAIL'}] SEC-28 (Management/CEO Blocked From Assigning CEO/Management) | CEO cannot assign role='ceo' or 'Management' to another user: ${
    sec28Passed ? 'DENY' : 'ALLOW'
  } (${mgmtAssignCeoAttempt.reason})`
);
if (sec28Passed) passedCount++;
else failedCount++;

// SEC-29: Management / CEO CANNOT Assign 'super_admin' or 'Admin' or legacyRole='super_admin' to Self or Another User
const mgmtAssignSuperAdminOther = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-mgmt', token: { email: 'ceo@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-pending-emp',
  {
    id: 'uid-pending-emp',
    name: 'Pending Engineer',
    email: 'pending@montexforge.com',
    role: 'Sales',
    legacyRole: 'super_admin',
    accountStatus: 'active',
  }
);
const mgmtSelfEscalateSuperAdmin = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-mgmt', token: { email: 'ceo@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-mgmt',
  {
    ...mgmtPrivilegeDb.users['uid-mgmt'],
    role: 'Admin',
    legacyRole: 'super_admin',
  }
);
const sec29Passed =
  mgmtAssignSuperAdminOther.allowed === false && mgmtSelfEscalateSuperAdmin.allowed === false;
console.log(
  `[${sec29Passed ? 'PASS' : 'FAIL'}] SEC-29 (Management/CEO Blocked From Super-Admin Escalation) | CEO cannot assign Admin/super_admin or legacyRole='super_admin' to self or others: ${
    sec29Passed ? 'DENY' : 'ALLOW'
  } (${mgmtAssignSuperAdminOther.reason})`
);
if (sec29Passed) passedCount++;
else failedCount++;

// SEC-30: Management / CEO CANNOT Modify Existing Admin/super_admin or Management/ceo Accounts
const mgmtModifyAdminAttempt = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-mgmt', token: { email: 'ceo@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-admin',
  {
    ...mgmtPrivilegeDb.users['uid-admin'],
    accountStatus: 'deactivated',
  }
);
const mgmtModifyPeerCeoAttempt = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-mgmt', token: { email: 'ceo@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-mgmt-peer',
  {
    ...mgmtPrivilegeDb.users['uid-mgmt-peer'],
    role: 'sales',
    legacyRole: 'sales',
    accountStatus: 'deactivated',
  }
);
const sec30Passed =
  mgmtModifyAdminAttempt.allowed === false && mgmtModifyPeerCeoAttempt.allowed === false;
console.log(
  `[${sec30Passed ? 'PASS' : 'FAIL'}] SEC-30 (Management/CEO Blocked From Modifying Privileged Accounts) | CEO cannot modify or deactivate existing Admin/super_admin or CEO/Management accounts: ${
    sec30Passed ? 'DENY' : 'ALLOW'
  } (${mgmtModifyPeerCeoAttempt.reason})`
);
if (sec30Passed) passedCount++;
else failedCount++;

// SEC-31: Management / CEO CAN Approve Pending Operational Department Employee (e.g. Sales)
const mgmtApproveSales = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-mgmt', token: { email: 'ceo@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-pending-emp',
  {
    id: 'uid-pending-emp',
    name: 'Pending Engineer',
    email: 'pending@montexforge.com',
    role: 'Sales',
    legacyRole: 'sales',
    requestedRole: 'sales',
    rbacGroup: 'Sales',
    department: 'Sales & Marketing',
    accountStatus: 'active',
    approvedByUid: 'uid-mgmt',
    approvedByEmail: 'ceo@montexforge.com',
    approvedAt: '2026-10-25T10:00:00.000Z',
  }
);
console.log(
  `[${mgmtApproveSales.allowed === true ? 'PASS' : 'FAIL'}] SEC-31 (Management/CEO Operational Employee Approval Allowed) | CEO can approve pending operational employee as Sales: ${
    mgmtApproveSales.allowed ? 'ALLOW' : 'DENY'
  } (${mgmtApproveSales.reason})`
);
if (mgmtApproveSales.allowed === true) passedCount++;
else failedCount++;

// SEC-32: Active Non-Admin (Sales) User CANNOT Self-Escalate via legacyRole or rbacGroup While Keeping role='Sales'
const salesLegacyRoleEscalation = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-sales',
  {
    ...mgmtPrivilegeDb.users['uid-sales'],
    legacyRole: 'super_admin',
  }
);
const salesLegacyCeoEscalation = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-sales',
  {
    ...mgmtPrivilegeDb.users['uid-sales'],
    legacyRole: 'ceo',
  }
);
const salesRbacGroupEscalation = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-sales',
  {
    ...mgmtPrivilegeDb.users['uid-sales'],
    rbacGroup: 'Admin',
  }
);
const sec32Passed =
  salesLegacyRoleEscalation.allowed === false &&
  salesLegacyCeoEscalation.allowed === false &&
  salesRbacGroupEscalation.allowed === false;
console.log(
  `[${sec32Passed ? 'PASS' : 'FAIL'}] SEC-32 (Active Employee Blocked From legacyRole/rbacGroup Self-Escalation) | Active Sales user cannot set legacyRole='super_admin'|'ceo' or rbacGroup='Admin': ${
    sec32Passed ? 'DENY' : 'ALLOW'
  } (${salesLegacyRoleEscalation.reason})`
);
if (sec32Passed) passedCount++;
else failedCount++;

// SEC-33: Active Non-Admin (Sales) User CANNOT Modify Protected Approval or Department-Head Fields on Own Profile
const salesApprovalFieldTamper = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-sales',
  {
    ...mgmtPrivilegeDb.users['uid-sales'],
    approvedByUid: 'uid-sales',
    approvedAt: '2026-10-25T12:00:00.000Z',
  }
);
const salesDeptHeadTamper = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-sales',
  {
    ...mgmtPrivilegeDb.users['uid-sales'],
    isDepartmentHead: true,
  }
);
const sec33Passed =
  salesApprovalFieldTamper.allowed === false && salesDeptHeadTamper.allowed === false;
console.log(
  `[${sec33Passed ? 'PASS' : 'FAIL'}] SEC-33 (Active Employee Blocked From Modifying Protected Approval/Governance Fields) | Active Sales user cannot tamper with approvedByUid, approvedAt, or isDepartmentHead: ${
    sec33Passed ? 'DENY' : 'ALLOW'
  } (${salesApprovalFieldTamper.reason})`
);
if (sec33Passed) passedCount++;
else failedCount++;

// SEC-34: Self-Registering User CANNOT Inject Privileged legacyRole, requestedRole, rbacGroup, isDepartmentHead, or approvedByUid
const selfRegLegacyEscalation = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-new-rogue', token: { email: 'rogue@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-new-rogue',
  {
    id: 'uid-new-rogue',
    name: 'Rogue Applicant',
    email: 'rogue@montexforge.com',
    role: 'Unassigned',
    legacyRole: 'super_admin',
    accountStatus: 'pending_approval',
  }
);
const selfRegRequestedCeo = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-new-rogue', token: { email: 'rogue@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-new-rogue',
  {
    id: 'uid-new-rogue',
    name: 'Rogue Applicant',
    email: 'rogue@montexforge.com',
    role: 'sales',
    requestedRole: 'ceo',
    accountStatus: 'pending_approval',
  }
);
const selfRegFakeApprovalFields = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-new-rogue', token: { email: 'rogue@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-new-rogue',
  {
    id: 'uid-new-rogue',
    name: 'Rogue Applicant',
    email: 'rogue@montexforge.com',
    role: 'sales',
    approvedByUid: 'uid-admin',
    accountStatus: 'pending_approval',
  }
);
const sec34Passed =
  selfRegLegacyEscalation.allowed === false &&
  selfRegRequestedCeo.allowed === false &&
  selfRegFakeApprovalFields.allowed === false;
console.log(
  `[${sec34Passed ? 'PASS' : 'FAIL'}] SEC-34 (Self-Registration Blocked From Privileged Role/Approval Field Poisoning) | Self-registering user cannot inject legacyRole='super_admin', requestedRole='ceo', or approvedByUid: ${
    sec34Passed ? 'DENY' : 'ALLOW'
  } (${selfRegLegacyEscalation.reason})`
);
if (sec34Passed) passedCount++;
else failedCount++;

// SEC-35: Administrator CANNOT Spoof Another User's UID in approvedByUid or rejectedByUid
const spoofedApproverUid = evaluateRtdbOperation(
  mgmtPrivilegeDb,
  { uid: 'uid-mgmt', token: { email: 'ceo@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-pending-emp',
  {
    id: 'uid-pending-emp',
    name: 'Pending Engineer',
    email: 'pending@montexforge.com',
    role: 'Sales',
    legacyRole: 'sales',
    accountStatus: 'active',
    approvedByUid: 'uid-admin', // Spoofed another admin's UID!
  }
);
console.log(
  `[${spoofedApproverUid.allowed === false ? 'PASS' : 'FAIL'}] SEC-35 (Approver UID Anti-Spoofing in /users/$uid .validate) | Approver cannot forge another administrator's UID in approvedByUid: ${
    spoofedApproverUid.allowed ? 'ALLOW' : 'DENY'
  } (${spoofedApproverUid.reason})`
);
if (spoofedApproverUid.allowed === false) passedCount++;
else failedCount++;

// SEC-36: Non-Admin Cannot Modify Other Users' Profiles, Overwrite/Delete Audit Logs, or Delete Master Records; Admin/CEO Can Delete Master Records
const nonAdminProtectedDb = {
  ...mgmtPrivilegeDb,
  customers: {
    'CUST-DEL-1': {
      id: 'CUST-DEL-1',
      code: 'CUST-DEL-1',
      name: 'Test Customer',
      creditLimit: 100000,
      totalOutstanding: 0,
    },
  },
  products: {
    'PROD-DEL-1': {
      id: 'PROD-DEL-1',
      code: 'PROD-DEL-1',
      name: 'Test Flange',
      materialGrade: 'ASTM A105',
      standardWeightKg: 12,
      standardSellingPrice: 1500,
    },
  },
  auditLogs: {
    'log-existing-1': {
      id: 'log-existing-1',
      timestamp: '2026-10-25 10:00:00',
      userId: 'uid-sales',
      userName: 'Rajeshwari Kulkarni',
      action: 'CREATE_SALES_ORDER',
      collectionName: 'salesOrders',
      documentId: 'ORD-2026-001',
      newValueSummary: 'Created order',
    },
  },
};
const salesModifyOtherUser = evaluateRtdbOperation(
  nonAdminProtectedDb,
  { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
  'write',
  '/users/uid-pending-emp',
  {
    ...nonAdminProtectedDb.users['uid-pending-emp'],
    name: 'Tampered Name',
  }
);
const salesOverwriteAuditLog = evaluateRtdbOperation(
  nonAdminProtectedDb,
  { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
  'write',
  '/auditLogs/log-existing-1',
  {
    ...nonAdminProtectedDb.auditLogs['log-existing-1'],
    newValueSummary: 'Tampered audit log',
  }
);
const salesDeleteAuditLog = evaluateRtdbOperation(
  nonAdminProtectedDb,
  { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
  'write',
  '/auditLogs/log-existing-1',
  null
);
const salesDeleteCustomer = evaluateRtdbOperation(
  nonAdminProtectedDb,
  { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
  'write',
  '/customers/CUST-DEL-1',
  null
);
const adminDeleteCustomer = evaluateRtdbOperation(
  nonAdminProtectedDb,
  { uid: 'uid-admin', token: { email: 'admin@montexforge.com', email_verified: true } },
  'write',
  '/customers/CUST-DEL-1',
  null
);
const ceoDeleteProduct = evaluateRtdbOperation(
  nonAdminProtectedDb,
  { uid: 'uid-mgmt', token: { email: 'ceo@montexforge.com', email_verified: true } },
  'write',
  '/products/PROD-DEL-1',
  null
);
const sec36Passed =
  salesModifyOtherUser.allowed === false &&
  salesOverwriteAuditLog.allowed === false &&
  salesDeleteAuditLog.allowed === false &&
  salesDeleteCustomer.allowed === false &&
  adminDeleteCustomer.allowed === true &&
  ceoDeleteProduct.allowed === true;
console.log(
  `[${sec36Passed ? 'PASS' : 'FAIL'}] SEC-36 (Non-Admin Cross-User/Audit/Delete Isolation & Admin Master Delete) | Sales blocked from modifying other user, overwriting/deleting auditLogs, or deleting customer; Admin/CEO allowed master delete: ${
    sec36Passed ? 'PASS' : 'FAIL'
  }`
);
if (sec36Passed) passedCount++;
else failedCount++;

// SEC-27: Full End-to-End Path-Scoped Seeding Simulation (Every Seed Payload vs .write & .validate)
console.log('\n--------------------------------------------------------------------------------');
console.log('PATH-SCOPED SEEDING VALIDATION (Testing all 38 seed writes against .validate)');
console.log('--------------------------------------------------------------------------------');

const liveSimDb: any = {};
const ownerAuth = {
  uid: 'uid-owner',
  token: { email: 'anshyadav6647@gmail.com', email_verified: true },
};

const seedOperations: { path: string; payload: any }[] = [
  // Step 1: Bootstrap /users/uid-owner
  {
    path: '/users/uid-owner',
    payload: {
      id: 'uid-owner',
      name: 'Ansh Yadav',
      email: 'anshyadav6647@gmail.com',
      role: 'Admin',
      legacyRole: 'super_admin',
      rbacGroup: 'Admin',
      roleTitle: 'Super Administrator',
      department: 'Management & IT',
      avatarInitials: 'AY',
      accountStatus: 'active',
      createdAt: '2026-10-22',
      lastLoginAt: '2026-10-22T00:55:00.000Z',
    },
  },
  // Step 2: Prototype employee profiles
  ...PROTOTYPE_USERS.map((u) => ({
    path: `/users/${u.id}`,
    payload: {
      ...u,
      id: u.id,
      rbacGroup: mapRoleToRbacGroup(u.role),
      role: mapRoleToRbacGroup(u.role),
      legacyRole: u.role,
    },
  })),
  // Step 3: /dashboardKpis & /production
  {
    path: '/dashboardKpis',
    payload: { ...DEFAULT_DASHBOARD_KPIS, lastUpdated: '2026-10-22T00:55:00.000Z' },
  },
  {
    path: '/production',
    payload: DEFAULT_PRODUCTION_SUMMARY,
  },
  // Step 4: /salesOrders/$orderId
  ...MOCK_ORDER_JOURNEYS.map((o) => ({
    path: `/salesOrders/${o.id}`,
    payload: o,
  })),
  // Step 5: /dispatch/$dispatchId
  {
    path: '/dispatch/DSP-2026-0091',
    payload: {
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
  },
  {
    path: '/dispatch/DSP-2026-0092',
    payload: {
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
  },
  // Step 6: /inventory/rawMaterials & /inventory/stockMovements
  ...MOCK_RAW_MATERIALS.map((rm) => ({
    path: `/inventory/rawMaterials/${rm.id}`,
    payload: rm,
  })),
  ...MOCK_STOCK_MOVEMENTS.map((mov) => ({
    path: `/inventory/stockMovements/${mov.id}`,
    payload: mov,
  })),
  // Step 7: /quality/inspections
  {
    path: '/quality/inspections/QC-2026-0894',
    payload: {
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
  },
  {
    path: '/quality/inspections/QC-2026-0902',
    payload: {
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
  },
  {
    path: '/quality/inspections/QC-2026-0881',
    payload: {
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
  },
  // Step 8: /outstandingPayments
  ...MOCK_OUTSTANDING_AGEING.map((op) => ({
    path: `/outstandingPayments/${op.customerId}`,
    payload: op,
  })),
  // Step 9: /alerts/actionQueue & /alerts/thresholds
  ...MOCK_ACTION_QUEUE.map((act) => ({
    path: `/alerts/actionQueue/${act.id}`,
    payload: act,
  })),
  {
    path: '/alerts/thresholds',
    payload: DEFAULT_ALERT_THRESHOLDS,
  },
  // Step 10: /customers & /products
  ...MOCK_CUSTOMERS.map((c) => ({
    path: `/customers/${c.id}`,
    payload: c,
  })),
  ...MOCK_PRODUCTS.map((p) => ({
    path: `/products/${p.id}`,
    payload: p,
  })),
  // Step 11: /auditLogs/$logId
  {
    path: '/auditLogs/log-seed-001',
    payload: {
      id: 'log-seed-001',
      timestamp: '2026-10-22 00:55:00',
      userId: 'uid-owner',
      userName: 'Ansh Yadav',
      action: 'SEED_AUTHORIZED_RTDB_PATHS',
      collectionName: 'root',
      documentId: 'montex-mis-default-rtdb',
      oldValueSummary: '-',
      newValueSummary: 'Seeded authorized MIS paths without root write bypass',
      ipAddress: 'Firebase RTDB Authenticated Client',
    },
  },
];

let seedAllPassed = true;
for (const op of seedOperations) {
  const res = evaluateRtdbOperation(liveSimDb, ownerAuth, 'write', op.path, op.payload);
  if (!res.allowed) {
    seedAllPassed = false;
    console.error(`[FAIL] Seed write failed at ${op.path}: ${res.reason}`);
  } else {
    // Apply write to simulated DB state so subsequent rules depend on liveSimDb
    const segs = op.path.split('/').filter(Boolean);
    let ptr = liveSimDb;
    for (let i = 0; i < segs.length - 1; i++) {
      if (!ptr[segs[i]]) ptr[segs[i]] = {};
      ptr = ptr[segs[i]];
    }
    ptr[segs[segs.length - 1]] = op.payload;
  }
}

console.log(
  `[${seedAllPassed ? 'PASS' : 'FAIL'}] SEC-27 (Path-Scoped Seed Simulation) | All ${
    seedOperations.length
  } individual seed writes succeeded with root .read=false and .write=false`
);
if (seedAllPassed) passedCount++;
else failedCount++;

// ================================================================================
// PART 2: BUSINESS LOGIC & DATA INTEGRITY AUTOMATED TEST SUITE (REQUIREMENTS 1–5)
// ================================================================================
import {
  computeRawMaterialStockStatus,
  validateRawMaterialStock,
  normalizeRawMaterialWithComputedStatus,
  validateQualityInspectionQuantities,
  deriveQualityInspectionsFromOrders,
  validateSalesOrderQuantities,
  validateCrossModuleQuantities,
  deriveDispatchesFromOrders,
  resolveUserRoleMapping,
  verifyAdminAccountProfile,
  calculateDashboardKpisFromRecords,
  reconcileDashboardKpis,
} from '../src/services/misDataValidator';
import {
  INITIAL_DISPATCHES,
  INITIAL_QUALITY_INSPECTIONS,
} from '../src/services/rtdbService';

console.log('\n================================================================================');
console.log('MONTEX MIS — BUSINESS LOGIC & DATA INTEGRITY VERIFICATION SUITE (REQ 1–5)');
console.log('================================================================================\n');

function assertCheck(id: string, title: string, condition: boolean, detail: string) {
  console.log(`[${condition ? 'PASS' : 'FAIL'}] ${id} | ${title}`);
  console.log(`       Detail: ${detail}\n`);
  if (condition) passedCount++;
  else failedCount++;
}

// --- REQUIREMENT 1: Raw Material Stock Status based on availableStockMt, minimumStockMt, reorderLevelMt ---
assertCheck(
  'BIZ-01',
  'Raw Material Status Thresholds (availableStockMt vs minimumStockMt & reorderLevelMt)',
  computeRawMaterialStockStatus(11.5, 25.0, 35.0) === 'critical' &&
    computeRawMaterialStockStatus(28.0, 25.0, 35.0) === 'warning' &&
    computeRawMaterialStockStatus(35.0, 25.0, 35.0) === 'adequate',
  '11.5 < 25.0 -> critical; 25.0 <= 28.0 < 35.0 -> warning; 35.0 >= 35.0 -> adequate'
);

const rmAudits = MOCK_RAW_MATERIALS.map(validateRawMaterialStock);
const mismatchedRmIds = rmAudits.filter((r) => r.statusMismatch).map((r) => r.materialId);
assertCheck(
  'BIZ-02',
  'Detect Existing Seeded Raw Material Status Discrepancies (RM-001, RM-003, RM-004, RM-005)',
  mismatchedRmIds.length === 4 &&
    mismatchedRmIds.includes('RM-001') &&
    mismatchedRmIds.includes('RM-003') &&
    mismatchedRmIds.includes('RM-004') &&
    mismatchedRmIds.includes('RM-005'),
  `Flagged ${mismatchedRmIds.join(', ')} where stored status used physical stock or arbitrary warning despite availableStockMt < minimumStockMt`
);

const normalizedRm001 = normalizeRawMaterialWithComputedStatus(MOCK_RAW_MATERIALS[0]);
assertCheck(
  'BIZ-03',
  'Non-Destructive Raw Material Status Normalization Preserves Stored Status Metadata',
  normalizedRm001.status === 'critical' &&
    normalizedRm001.storedStatus === 'adequate' &&
    normalizedRm001.hasStatusDiscrepancy === true &&
    MOCK_RAW_MATERIALS[0].status === 'adequate',
  `RM-001 normalized status='${normalizedRm001.status}' (storedStatus='${normalizedRm001.storedStatus}') without mutating source record`
);

// --- REQUIREMENT 2: Quality Inspection Quantity Consistency (passedQty + rejectedQty <= inspectedQty) ---
const qc0894Check = validateQualityInspectionQuantities(INITIAL_QUALITY_INSPECTIONS[0]);
const qc0902Check = validateQualityInspectionQuantities(INITIAL_QUALITY_INSPECTIONS[1]);
const qc0881Check = validateQualityInspectionQuantities(INITIAL_QUALITY_INSPECTIONS[2]);

assertCheck(
  'BIZ-04',
  'Detect Quality Inspection Quantity Overflow on QC-2026-0894 (500 + 8 > 500)',
  qc0894Check.valid === false && qc0894Check.excessQty === 8 && qc0894Check.totalAccountedQty === 508,
  qc0894Check.errors[0] || ''
);

assertCheck(
  'BIZ-05',
  'Accept Valid Quality Inspections (QC-2026-0902: 38+2 <= 50; QC-2026-0881: 100+0 <= 100)',
  qc0902Check.valid === true &&
    qc0902Check.unaccountedQty === 10 &&
    qc0881Check.valid === true &&
    qc0881Check.unaccountedQty === 0,
  `QC-2026-0902 valid (${qc0902Check.totalAccountedQty}/50, 10 in progress); QC-2026-0881 valid (100/100)`
);

const derivedQc = deriveQualityInspectionsFromOrders(MOCK_ORDER_JOURNEYS);
assertCheck(
  'BIZ-06',
  'Derived Quality Inspections Exclude Unproduced Material-Pending Orders (ORD-2026-003)',
  derivedQc.length === 3 && !derivedQc.some((q) => q.jobNumber === 'JOB-MF-2026-0435'),
  `Derived ${derivedQc.length} lots (excluded JOB-MF-2026-0435 where producedQty=0)`
);

// --- REQUIREMENT 3: Sales Order, Production, Quality, and Dispatch Quantity Consistency ---
const ord1Check = validateSalesOrderQuantities(MOCK_ORDER_JOURNEYS[0]);
const ord2Check = validateSalesOrderQuantities(MOCK_ORDER_JOURNEYS[1]);
const ord3Check = validateSalesOrderQuantities(MOCK_ORDER_JOURNEYS[2]);
const ord4Check = validateSalesOrderQuantities(MOCK_ORDER_JOURNEYS[3]);

assertCheck(
  'BIZ-07',
  'Sales Order Line-Item Production vs QC Validation (ORD-2026-001 & ORD-2026-002)',
  ord1Check.valid === false &&
    ord2Check.valid === true &&
    ord2Check.warnings.length === 1 &&
    ord3Check.valid === true &&
    ord4Check.valid === true,
  `ORD-2026-001 flagged (500+8 > 500 produced); ORD-2026-002 warns (50 produced - 2 rejected = 48 < 50 ordered)`
);

const crossModuleCheck = validateCrossModuleQuantities(
  MOCK_ORDER_JOURNEYS,
  INITIAL_QUALITY_INSPECTIONS,
  INITIAL_DISPATCHES,
  DEFAULT_PRODUCTION_SUMMARY
);

assertCheck(
  'BIZ-08',
  'Cross-Module Dispatch vs Sales Order Consistency (Detect DSP-2026-0092 vs ORD-2026-004 Mismatch)',
  crossModuleCheck.confirmedErrors.some((e) => e.includes('DSP-2026-0092')),
  'Detected DSP-2026-0092 has status=ready_for_dispatch, quantity=100, balanceQty=0 while ORD-2026-004 has totalShippedQty=0, balanceQty=100'
);

assertCheck(
  'BIZ-09',
  'Cross-Module Production Summary vs Shift Weighted Yield & Order Rejections',
  crossModuleCheck.businessConfirmationsRequired.some((w) =>
    w.includes('totalRejectionPercent (1.6%)')
  ) &&
    crossModuleCheck.businessConfirmationsRequired.some((w) =>
      w.includes('rejectedPcs sum (12 PCS')
    ),
  'Flagged 1.6% vs 1.75% shift weighted rejection rate and 12 shift rejected PCS vs 10 PO rejected PCS for business confirmation'
);

const derivedDsp = deriveDispatchesFromOrders(MOCK_ORDER_JOURNEYS, MOCK_PRODUCTS);
const ioclDerived = derivedDsp.find((d) => d.jobNumber === 'JOB-MF-2026-0398');
assertCheck(
  'BIZ-10',
  'Derived Dispatches Use Actual Product Weight (172 kg for PROD-005) and Actual Shipped Qty (0 PCS)',
  ioclDerived !== undefined && ioclDerived.quantity === 0 && ioclDerived.weightMt === 17.2,
  `IOCL derived dispatch: shipped quantity=${ioclDerived?.quantity} PCS, staged lot weight=${ioclDerived?.weightMt} MT (100 * 172kg)`
);

// --- REQUIREMENT 4: Admin Account Verification & Non-Destructive Role Mapping ---
const storesUserResolved = resolveUserRoleMapping({
  id: 'uid-stores-001',
  role: 'stores',
  accountStatus: 'active',
});
const purchaseWithRbacGroupResolved = resolveUserRoleMapping({
  id: 'uid-purchase-001',
  role: 'Production',
  legacyRole: 'purchase',
  rbacGroup: 'Production',
  accountStatus: 'active',
});
const dispatchUserResolved = resolveUserRoleMapping({
  id: 'uid-dispatch-001',
  role: 'dispatch',
  accountStatus: 'active',
});

assertCheck(
  'BIZ-11',
  'Preserve Granular User Roles (stores, purchase, dispatch, super_admin, ceo) Without Overwriting With quality',
  storesUserResolved.granularRole === 'stores' &&
    storesUserResolved.rbacGroup === 'Production' &&
    purchaseWithRbacGroupResolved.granularRole === 'purchase' &&
    dispatchUserResolved.granularRole === 'dispatch',
  `stores -> ${storesUserResolved.granularRole}, purchase -> ${purchaseWithRbacGroupResolved.granularRole}, dispatch -> ${dispatchUserResolved.granularRole}`
);

const unassignedResolved = resolveUserRoleMapping({
  id: 'uid-new-001',
  role: 'Unassigned',
  accountStatus: 'pending_approval',
});
assertCheck(
  'BIZ-12',
  'Unassigned Self-Registered Accounts Receive Zero Permissions and Are Not Promoted',
  unassignedResolved.isUnassigned === true &&
    unassignedResolved.isActive === false &&
    (unassignedResolved.permissions?.length ?? 0) === 0,
  `isUnassigned=${unassignedResolved.isUnassigned}, isActive=${unassignedResolved.isActive}, permissions=${unassignedResolved.permissions?.length}`
);

const validLiveAdminProfile = {
  id: 'uid-owner',
  name: 'Ansh Yadav',
  email: 'anshyadav6647@gmail.com',
  role: 'Admin',
  rbacGroup: 'Admin',
  accountStatus: 'active',
};
const legacySuperAdminProfile = {
  id: 'uid-admin-001',
  name: 'Anand Vernekar',
  email: 'admin@montexforge.com',
  role: 'super_admin',
  rbacGroup: 'Admin',
  accountStatus: 'active',
};
const validAdminVerif = verifyAdminAccountProfile(validLiveAdminProfile, 'uid-owner');
const legacyAdminVerif = verifyAdminAccountProfile(legacySuperAdminProfile, 'uid-admin-001');

assertCheck(
  'BIZ-13',
  'Admin Account Verification Distinguishes Rule-Compliant role="Admin" From Legacy role="super_admin" Without Mutating Input',
  validAdminVerif.valid === true &&
    legacyAdminVerif.valid === false &&
    legacyAdminVerif.requiresRoleNormalizationWarn === true &&
    legacySuperAdminProfile.role === 'super_admin',
  `Live Admin valid=${validAdminVerif.valid}; Legacy super_admin requiresRoleNormalizationWarn=${legacyAdminVerif.requiresRoleNormalizationWarn} (input role preserved as '${legacySuperAdminProfile.role}')`
);

// --- REQUIREMENT 5: Dashboard KPI Calculations Against Actual Underlying Records ---
const computedKpis = calculateDashboardKpisFromRecords({
  salesOrders: MOCK_ORDER_JOURNEYS,
  dispatches: INITIAL_DISPATCHES,
  rawMaterials: MOCK_RAW_MATERIALS,
  qualityInspections: INITIAL_QUALITY_INSPECTIONS,
  outstandingAgeing: MOCK_OUTSTANDING_AGEING,
  referenceDate: '2026-10-22',
});

assertCheck(
  'BIZ-14',
  'Calculate Open Order Quantities & Values From Actual /salesOrders Records',
  computedKpis.openOrdersCount === 4 &&
    computedKpis.openOrdersTotalPoValue === 14880000 &&
    computedKpis.openOrdersPendingBacklogValue === 11500000 &&
    computedKpis.openOrdersTotalOrderedQty === 670 &&
    computedKpis.openOrdersTotalShippedQty === 400 &&
    computedKpis.openOrdersTotalPendingQty === 270,
  `Open POs=4, Gross PO=₹1,48,80,000, Undispatched Backlog=₹1,15,00,000, Ordered=670 PCS, Shipped=400 PCS, Pending=270 PCS`
);

assertCheck(
  'BIZ-15',
  'Calculate Receivables Total & Exact Ageing Buckets From /outstandingPayments',
  computedKpis.totalOutstanding === 21410000 &&
    computedKpis.bucket0to30 === 11035000 &&
    computedKpis.bucket31to60 === 6935000 &&
    computedKpis.bucket61to90 === 2960000 &&
    computedKpis.bucket90Plus === 480000 &&
    computedKpis.bucket0to30 +
      computedKpis.bucket31to60 +
      computedKpis.bucket61to90 +
      computedKpis.bucket90Plus ===
      computedKpis.totalOutstanding,
  `Total=₹2,14,10,000 (0-30d: ₹1,10,35,000 | 31-60d: ₹69,35,000 | 61-90d: ₹29,60,000 | 90+d: ₹4,80,000)`
);

assertCheck(
  'BIZ-16',
  'Calculate Material Shortages Across Available Stock (5), Physical Stock (1), and Blocked Orders (1) vs Stored KPI (2)',
  computedKpis.materialShortagesByAvailableStockCount === 5 &&
    computedKpis.materialShortagesByPhysicalStockCount === 1 &&
    computedKpis.materialShortagesByOrderStateCount === 1,
  `Available<Min: 5, Physical<Min: 1, Blocked Orders: 1 (confirms stored materialShortagesCount=2 is inconsistent)`
);

assertCheck(
  'BIZ-17',
  'Calculate Dispatch Pending & Overdue Counts From Actual Orders & Dispatches',
  computedKpis.dispatchReadyClearedQty === 100 &&
    computedKpis.dispatchClearedUndispatchedQty === 200 &&
    computedKpis.overdueByContractualDateCount === 0 &&
    computedKpis.overdueByTargetDateCount === 1,
  `Ready Cleared=100 PCS (ORD-2026-004), All QC-Cleared Undispatched=200 PCS (+ORD-2026-001), Past Target Date=1 (ORD-2026-004)`
);

const kpiReconciliation = reconcileDashboardKpis(DEFAULT_DASHBOARD_KPIS, computedKpis);
assertCheck(
  'BIZ-18',
  'KPI Reconciliation Report Classifies Confirmed Errors vs Business Confirmations Required',
  kpiReconciliation.length === 8 &&
    kpiReconciliation.some(
      (item) =>
        item.kpiField === 'materialShortagesCount' &&
        item.classification === 'CONFIRMED_ERROR'
    ),
  `Reconciled ${kpiReconciliation.length} executive KPI groups without modifying /dashboardKpis`
);

console.log('\n================================================================================');
console.log(
  `SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED (Total: ${
    passedCount + failedCount
  } assertions: 27 Security Rule + 18 Business Logic & Data Integrity assertions)`
);
console.log('================================================================================');

if (failedCount > 0) {
  process.exit(1);
}

