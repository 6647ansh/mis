import databaseRulesJson from '../../database.rules.json';

export interface SimulatedAuth {
  uid: string;
  token: {
    email?: string;
    email_verified?: boolean;
  };
}

export interface SecurityRuleTestCase {
  id: string;
  category:
    | 'Root & Provisioning'
    | 'User Enumeration & Privacy'
    | 'Bootstrap & Deactivation'
    | 'KPI & Executive Protection'
    | 'Module RBAC & Active Status'
    | 'Audit Log Anti-Forgery'
    | 'Data & Invariant Validation';
  description: string;
  actorLabel: string;
  auth: SimulatedAuth | null;
  operation: 'read' | 'write';
  path: string;
  newData?: any;
  expectedAllowed: boolean;
  actualAllowed?: boolean;
  passed?: boolean;
  reason?: string;
}

/**
 * Helper class mimicking Firebase Realtime Database RuleDataSnapshot
 * (`root`, `data`, `newData`)
 */
class MockRuleSnapshot {
  private value: any;

  constructor(value: any) {
    this.value = value === undefined ? null : value;
  }

  exists(): boolean {
    return this.value !== null && this.value !== undefined;
  }

  val(): any {
    return this.value === undefined ? null : this.value;
  }

  child(path: string): MockRuleSnapshot {
    const parts = String(path)
      .split('/')
      .filter(Boolean);
    let curr = this.value;
    for (const part of parts) {
      if (curr !== null && typeof curr === 'object' && part in curr) {
        curr = curr[part];
      } else {
        return new MockRuleSnapshot(null);
      }
    }
    return new MockRuleSnapshot(curr);
  }

  hasChild(childPath: string): boolean {
    return this.child(childPath).exists();
  }

  hasChildren(children?: string[]): boolean {
    if (!this.exists() || typeof this.value !== 'object' || this.value === null) {
      return false;
    }
    if (!children || children.length === 0) {
      return Object.keys(this.value).length > 0;
    }
    return children.every((c) => this.hasChild(c));
  }

  isNumber(): boolean {
    return typeof this.value === 'number' && !Number.isNaN(this.value);
  }

  isString(): boolean {
    return typeof this.value === 'string';
  }

  isBoolean(): boolean {
    return typeof this.value === 'boolean';
  }
}

function getValueAtPath(tree: any, pathSegments: string[]): any {
  let curr = tree;
  for (const seg of pathSegments) {
    if (curr !== null && typeof curr === 'object' && seg in curr) {
      curr = curr[seg];
    } else {
      return null;
    }
  }
  return curr === undefined ? null : curr;
}

interface MatchedRuleNode {
  ruleNode: any;
  wildcardBindings: Record<string, string>;
  dataAtNode: any;
  newDataAtNode: any;
}

/**
 * Walks the database.rules.json tree along the target path and collects
 * all matching rule nodes from root down to the target path.
 */
function collectRuleChain(
  rulesRoot: any,
  dbRoot: any,
  newDbRoot: any,
  pathSegments: string[]
): MatchedRuleNode[] {
  const chain: MatchedRuleNode[] = [];
  let currentRule = rulesRoot;
  const bindings: Record<string, string> = {};

  chain.push({
    ruleNode: currentRule,
    wildcardBindings: { ...bindings },
    dataAtNode: dbRoot,
    newDataAtNode: newDbRoot,
  });

  for (let i = 0; i < pathSegments.length; i++) {
    const seg = pathSegments[i];
    if (!currentRule || typeof currentRule !== 'object') break;

    let nextRule: any = null;
    if (seg in currentRule) {
      nextRule = currentRule[seg];
    } else {
      const wildcardKey = Object.keys(currentRule).find((k) => k.startsWith('$'));
      if (wildcardKey) {
        bindings[wildcardKey] = seg;
        nextRule = currentRule[wildcardKey];
      }
    }

    if (!nextRule) break;
    currentRule = nextRule;
    const subPath = pathSegments.slice(0, i + 1);
    chain.push({
      ruleNode: currentRule,
      wildcardBindings: { ...bindings },
      dataAtNode: getValueAtPath(dbRoot, subPath),
      newDataAtNode: getValueAtPath(newDbRoot, subPath),
    });
  }

  return chain;
}

function evaluateRuleExpression(
  expr: boolean | string | undefined,
  auth: SimulatedAuth | null,
  rootSnap: MockRuleSnapshot,
  dataSnap: MockRuleSnapshot,
  newDataSnap: MockRuleSnapshot,
  wildcards: Record<string, string>
): boolean {
  if (expr === undefined) return false;
  if (typeof expr === 'boolean') return expr;

  const wildcardNames = Object.keys(wildcards);
  const wildcardValues = wildcardNames.map((k) => wildcards[k]);

  try {
    const fn = new Function(
      'auth',
      'root',
      'data',
      'newData',
      'now',
      ...wildcardNames,
      `return Boolean(${expr});`
    );
    return fn(auth, rootSnap, dataSnap, newDataSnap, Date.now(), ...wildcardValues);
  } catch {
    return false;
  }
}

/**
 * Evaluates a read or write operation against database.rules.json
 * following Firebase Realtime Database rule semantics:
 * - `.read` / `.write`: Cascading OR from root down to target path (if any parent grants true, access is granted).
 * - `.validate`: Cascading AND on all nodes from root down to target path where `.validate` is defined (when newData exists).
 */
export function evaluateRtdbOperation(
  dbState: any,
  auth: SimulatedAuth | null,
  operation: 'read' | 'write',
  rawPath: string,
  newValue?: any
): { allowed: boolean; reason: string } {
  const pathSegments = rawPath.split('/').filter(Boolean);
  const rulesRoot = (databaseRulesJson as any).rules;

  // Build simulated new database state for writes
  const newDbState = JSON.parse(JSON.stringify(dbState || {}));
  if (operation === 'write') {
    if (pathSegments.length === 0) {
      // Root write
      Object.assign(newDbState, newValue);
    } else {
      let ptr = newDbState;
      for (let i = 0; i < pathSegments.length - 1; i++) {
        const s = pathSegments[i];
        if (!ptr[s] || typeof ptr[s] !== 'object') {
          ptr[s] = {};
        }
        ptr = ptr[s];
      }
      const lastSeg = pathSegments[pathSegments.length - 1];
      if (newValue === null || newValue === undefined) {
        delete ptr[lastSeg];
      } else {
        ptr[lastSeg] = newValue;
      }
    }
  }

  const rootSnap = new MockRuleSnapshot(dbState);
  const chain = collectRuleChain(rulesRoot, dbState, newDbState, pathSegments);

  const ruleKey = operation === 'read' ? '.read' : '.write';
  let permissionGranted = false;

  for (const step of chain) {
    const expr = step.ruleNode?.[ruleKey];
    if (expr !== undefined) {
      const dataSnap = new MockRuleSnapshot(step.dataAtNode);
      const newDataSnap = new MockRuleSnapshot(step.newDataAtNode);
      if (
        evaluateRuleExpression(
          expr,
          auth,
          rootSnap,
          dataSnap,
          newDataSnap,
          step.wildcardBindings
        )
      ) {
        permissionGranted = true;
        break;
      }
    }
  }

  if (!permissionGranted) {
    return {
      allowed: false,
      reason: `PERMISSION_DENIED: ${ruleKey} evaluated to false at /${pathSegments.join('/')}`,
    };
  }

  // For write operations where newData exists, ALL .validate rules in the chain must pass
  if (operation === 'write' && newValue !== null && newValue !== undefined) {
    for (const step of chain) {
      const valExpr = step.ruleNode?.['.validate'];
      if (valExpr !== undefined) {
        const dataSnap = new MockRuleSnapshot(step.dataAtNode);
        const newDataSnap = new MockRuleSnapshot(step.newDataAtNode);
        const valid = evaluateRuleExpression(
          valExpr,
          auth,
          rootSnap,
          dataSnap,
          newDataSnap,
          step.wildcardBindings
        );
        if (!valid) {
          return {
            allowed: false,
            reason: `VALIDATION_FAILED: .validate rule rejected payload at /${pathSegments.join('/')}`,
          };
        }
      }
    }
  }

  return {
    allowed: true,
    reason: `ALLOWED: ${ruleKey}${operation === 'write' ? ' + .validate' : ''} passed at /${pathSegments.join('/')}`,
  };
}

/**
 * Runs a comprehensive 22-case security audit suite testing all 10 remediation requirements
 */
export function runComprehensiveSecurityRuleAudit(): SecurityRuleTestCase[] {
  const mockDbState = {
    users: {
      'uid-admin': {
        id: 'uid-admin',
        name: 'Anand Vernekar',
        email: 'admin@montexforge.com',
        role: 'Admin',
        accountStatus: 'active',
      },
      'uid-mgmt': {
        id: 'uid-mgmt',
        name: 'Vikramaditya Deshmukh',
        email: 'ceo@montexforge.com',
        role: 'Management',
        accountStatus: 'active',
      },
      'uid-finance': {
        id: 'uid-finance',
        name: 'CA Meenakshi Iyer',
        email: 'finance@montexforge.com',
        role: 'Finance',
        accountStatus: 'active',
      },
      'uid-sales': {
        id: 'uid-sales',
        name: 'Rajeshwari Kulkarni',
        email: 'sales@montexforge.com',
        role: 'Sales',
        accountStatus: 'active',
      },
      'uid-prod': {
        id: 'uid-prod',
        name: 'Suresh Khandekar',
        email: 'stores@montexforge.com',
        role: 'Production',
        accountStatus: 'active',
      },
      'uid-deactivated-sales': {
        id: 'uid-deactivated-sales',
        name: 'Former Sales Officer',
        email: 'ex.sales@montexforge.com',
        role: 'Sales',
        accountStatus: 'deactivated',
      },
      'uid-deactivated-owner': {
        id: 'uid-deactivated-owner',
        name: 'Deactivated Bootstrap Admin',
        email: 'anshyadav6647@gmail.com',
        role: 'Admin',
        accountStatus: 'deactivated',
      },
    },
    dashboardKpis: {
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
      lastUpdated: '2026-10-22T00:00:00Z',
    },
    salesOrders: {
      'ORD-2026-001': {
        id: 'ORD-2026-001',
        poNumber: 'BHEL/HYD/PO/2026/8891',
        customerName: 'BHEL',
        jobNumber: 'JOB-MF-2026-0412',
        status: 'partially_dispatched',
        totalValue: 4225000,
      },
    },
    inventory: {
      rawMaterials: {
        'RM-001': {
          id: 'RM-001',
          code: 'RM-BIL-A105-200',
          name: 'Carbon Steel Round Billet',
          grade: 'ASTM A105',
          currentStockMt: 82.5,
          reservedStockMt: 34.0,
          availableStockMt: 48.5,
          minimumStockMt: 25.0,
          reorderLevelMt: 40.0,
          status: 'adequate',
        },
      },
    },
    outstandingPayments: {
      'CUST-001': {
        customerId: 'CUST-001',
        customerName: 'BHEL',
        totalOutstanding: 6850000,
        bucket0to30: 3992300,
        bucket31to60: 2857700,
        bucket61to90: 0,
        bucket90Plus: 0,
        creditLimit: 15000000,
      },
    },
    alerts: {
      actionQueue: {
        'ACT-001': {
          id: 'ACT-001',
          type: 'material_shortage',
          severity: 'high',
          title: 'Raw Material Deficit',
          description: '12.5 MT shortage on 42CrMo4',
          associatedRef: 'JOB-MF-2026-0435',
          acknowledged: false,
        },
      },
    },
  };

  const tests: SecurityRuleTestCase[] = [
    // 1. Root Default-Deny
    {
      id: 'SEC-01',
      category: 'Root & Provisioning',
      description: 'Default-deny at root / prevents unauthenticated or blanket root reads/writes',
      actorLabel: 'Active Admin (uid-admin)',
      auth: { uid: 'uid-admin', token: { email: 'admin@montexforge.com', email_verified: true } },
      operation: 'read',
      path: '/',
      expectedAllowed: false,
    },
    // 2. Self-registration privilege escalation attempt
    {
      id: 'SEC-02',
      category: 'Root & Provisioning',
      description: 'Block self-registering user from assigning role="Admin" and accountStatus="active"',
      actorLabel: 'New User (uid-attacker)',
      auth: { uid: 'uid-attacker', token: { email: 'attacker@external.com', email_verified: true } },
      operation: 'write',
      path: '/users/uid-attacker',
      newData: {
        id: 'uid-attacker',
        name: 'Rogue User',
        email: 'attacker@external.com',
        role: 'Admin',
        accountStatus: 'active',
      },
      expectedAllowed: false,
    },
    // 3. Self-registration as Sales/Finance active attempt
    {
      id: 'SEC-03',
      category: 'Root & Provisioning',
      description: 'Block self-registering user from assigning role="Sales" or self-activating',
      actorLabel: 'New User (uid-new-emp)',
      auth: { uid: 'uid-new-emp', token: { email: 'new@montexforge.com', email_verified: true } },
      operation: 'write',
      path: '/users/uid-new-emp',
      newData: {
        id: 'uid-new-emp',
        name: 'New Employee',
        email: 'new@montexforge.com',
        role: 'Sales',
        accountStatus: 'active',
      },
      expectedAllowed: false,
    },
    // 4. Safe unprivileged access request
    {
      id: 'SEC-04',
      category: 'Root & Provisioning',
      description: 'Allow new user to submit pending access request ONLY with role="Unassigned" & accountStatus="pending_approval"',
      actorLabel: 'New User (uid-new-emp)',
      auth: { uid: 'uid-new-emp', token: { email: 'new@montexforge.com', email_verified: true } },
      operation: 'write',
      path: '/users/uid-new-emp',
      newData: {
        id: 'uid-new-emp',
        name: 'New Employee',
        email: 'new@montexforge.com',
        role: 'Unassigned',
        accountStatus: 'pending_approval',
      },
      expectedAllowed: true,
    },
    // 5. Self-promotion by existing Sales user
    {
      id: 'SEC-05',
      category: 'Root & Provisioning',
      description: 'Block existing active Sales user from self-promoting their profile to Admin',
      actorLabel: 'Sales User (uid-sales)',
      auth: { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
      operation: 'write',
      path: '/users/uid-sales',
      newData: {
        id: 'uid-sales',
        name: 'Rajeshwari Kulkarni',
        email: 'sales@montexforge.com',
        role: 'Admin',
        accountStatus: 'active',
      },
      expectedAllowed: false,
    },
    // 6. User Enumeration Protection
    {
      id: 'SEC-06',
      category: 'User Enumeration & Privacy',
      description: 'Block Sales/Production/Finance employees from reading /users collection to enumerate all employees',
      actorLabel: 'Sales User (uid-sales)',
      auth: { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
      operation: 'read',
      path: '/users',
      expectedAllowed: false,
    },
    // 7. Individual User Profile Access (Own Profile)
    {
      id: 'SEC-07',
      category: 'User Enumeration & Privacy',
      description: 'Allow employee to read their own /users/$uid profile',
      actorLabel: 'Sales User (uid-sales)',
      auth: { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
      operation: 'read',
      path: '/users/uid-sales',
      expectedAllowed: true,
    },
    // 8. Individual User Profile Access (Other Employee's Profile Blocked)
    {
      id: 'SEC-08',
      category: 'User Enumeration & Privacy',
      description: 'Block Sales employee from reading another employee profile (/users/uid-finance)',
      actorLabel: 'Sales User (uid-sales)',
      auth: { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
      operation: 'read',
      path: '/users/uid-finance',
      expectedAllowed: false,
    },
    // 9. Admin / Management allowed to read /users
    {
      id: 'SEC-09',
      category: 'User Enumeration & Privacy',
      description: 'Allow active Admin to read /users directory for access governance',
      actorLabel: 'Admin User (uid-admin)',
      auth: { uid: 'uid-admin', token: { email: 'admin@montexforge.com', email_verified: true } },
      operation: 'read',
      path: '/users',
      expectedAllowed: true,
    },
    // 10. Hardcoded Bootstrap Email Cannot Override Deactivation
    {
      id: 'SEC-10',
      category: 'Bootstrap & Deactivation',
      description: 'Deactivated bootstrap admin (anshyadav6647@gmail.com with accountStatus="deactivated") is DENIED access',
      actorLabel: 'Deactivated Bootstrap Admin',
      auth: {
        uid: 'uid-deactivated-owner',
        token: { email: 'anshyadav6647@gmail.com', email_verified: true },
      },
      operation: 'read',
      path: '/dashboardKpis',
      expectedAllowed: false,
    },
    // 11. Deactivated Sales User Cannot Write to /salesOrders
    {
      id: 'SEC-11',
      category: 'Bootstrap & Deactivation',
      description: 'Deactivated Sales user (accountStatus="deactivated") is DENIED writing to /salesOrders',
      actorLabel: 'Deactivated Sales (uid-deactivated-sales)',
      auth: {
        uid: 'uid-deactivated-sales',
        token: { email: 'ex.sales@montexforge.com', email_verified: true },
      },
      operation: 'write',
      path: '/salesOrders/ORD-2026-009',
      newData: {
        id: 'ORD-2026-009',
        poNumber: 'PO-999',
        customerName: 'BHEL',
        jobNumber: 'JOB-999',
        status: 'po_registered',
        totalValue: 100000,
      },
      expectedAllowed: false,
    },
    // 12. Unauthorized KPI Write by Sales / Production / Finance
    {
      id: 'SEC-12',
      category: 'KPI & Executive Protection',
      description: 'Block Sales/Production/Finance users from altering executive /dashboardKpis',
      actorLabel: 'Sales User (uid-sales)',
      auth: { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
      operation: 'write',
      path: '/dashboardKpis',
      newData: mockDbState.dashboardKpis,
      expectedAllowed: false,
    },
    // 13. Authorized KPI Write by Management / Admin
    {
      id: 'SEC-13',
      category: 'KPI & Executive Protection',
      description: 'Allow active Management (CEO) user to update /dashboardKpis with valid numeric KPIs',
      actorLabel: 'Management User (uid-mgmt)',
      auth: { uid: 'uid-mgmt', token: { email: 'ceo@montexforge.com', email_verified: true } },
      operation: 'write',
      path: '/dashboardKpis',
      newData: mockDbState.dashboardKpis,
      expectedAllowed: true,
    },
    // 14. Unauthorized Inventory Write by Finance/Sales
    {
      id: 'SEC-14',
      category: 'Module RBAC & Active Status',
      description: 'Block Finance user from modifying raw material stock in /inventory/rawMaterials',
      actorLabel: 'Finance User (uid-finance)',
      auth: { uid: 'uid-finance', token: { email: 'finance@montexforge.com', email_verified: true } },
      operation: 'write',
      path: '/inventory/rawMaterials/RM-001',
      newData: mockDbState.inventory.rawMaterials['RM-001'],
      expectedAllowed: false,
    },
    // 15. Authorized Inventory Write by Production
    {
      id: 'SEC-15',
      category: 'Module RBAC & Active Status',
      description: 'Allow active Production user to update /inventory/rawMaterials with non-negative stock',
      actorLabel: 'Production User (uid-prod)',
      auth: { uid: 'uid-prod', token: { email: 'stores@montexforge.com', email_verified: true } },
      operation: 'write',
      path: '/inventory/rawMaterials/RM-001',
      newData: {
        ...mockDbState.inventory.rawMaterials['RM-001'],
        currentStockMt: 95.0,
        availableStockMt: 61.0,
      },
      expectedAllowed: true,
    },
    // 16. Unauthorized Financial Write by Sales/Production
    {
      id: 'SEC-16',
      category: 'Module RBAC & Active Status',
      description: 'Block Production user from reading or writing /outstandingPayments receivables',
      actorLabel: 'Production User (uid-prod)',
      auth: { uid: 'uid-prod', token: { email: 'stores@montexforge.com', email_verified: true } },
      operation: 'write',
      path: '/outstandingPayments/CUST-001',
      newData: mockDbState.outstandingPayments['CUST-001'],
      expectedAllowed: false,
    },
    // 17. Authorized Financial Write by Finance
    {
      id: 'SEC-17',
      category: 'Module RBAC & Active Status',
      description: 'Allow active Finance user to update /outstandingPayments/CUST-001 with valid non-negative buckets',
      actorLabel: 'Finance User (uid-finance)',
      auth: { uid: 'uid-finance', token: { email: 'finance@montexforge.com', email_verified: true } },
      operation: 'write',
      path: '/outstandingPayments/CUST-001',
      newData: mockDbState.outstandingPayments['CUST-001'],
      expectedAllowed: true,
    },
    // 18. Audit Log Anti-Forgery (Spoofed UID)
    {
      id: 'SEC-18',
      category: 'Audit Log Anti-Forgery',
      description: 'Block user from forging an audit log entry with another userId (e.g. uid-admin)',
      actorLabel: 'Sales User (uid-sales)',
      auth: { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
      operation: 'write',
      path: '/auditLogs/log-forged-1',
      newData: {
        id: 'log-forged-1',
        timestamp: '2026-10-22 10:00:00',
        userId: 'uid-admin', // Forged UID!
        userName: 'Anand Vernekar',
        action: 'CREATE_SALES_ORDER',
        collectionName: 'salesOrders',
        documentId: 'ORD-2026-001',
        newValueSummary: 'Forged entry',
      },
      expectedAllowed: false,
    },
    // 19. Audit Log Anti-Forgery (Privileged Collection Spoofing)
    {
      id: 'SEC-19',
      category: 'Audit Log Anti-Forgery',
      description: 'Block non-Admin user from creating privileged audit log entries for collectionName="users"',
      actorLabel: 'Sales User (uid-sales)',
      auth: { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
      operation: 'write',
      path: '/auditLogs/log-forged-2',
      newData: {
        id: 'log-forged-2',
        timestamp: '2026-10-22 10:00:00',
        userId: 'uid-sales',
        userName: 'Rajeshwari Kulkarni',
        action: 'GRANT_ADMIN_ROLE',
        collectionName: 'users',
        documentId: 'uid-sales',
        newValueSummary: 'Forged admin role grant log',
      },
      expectedAllowed: false,
    },
    // 20. Authentic Audit Log Creation
    {
      id: 'SEC-20',
      category: 'Audit Log Anti-Forgery',
      description: 'Allow active Sales user to append authentic audit log with matching auth.uid for salesOrders',
      actorLabel: 'Sales User (uid-sales)',
      auth: { uid: 'uid-sales', token: { email: 'sales@montexforge.com', email_verified: true } },
      operation: 'write',
      path: '/auditLogs/log-valid-1',
      newData: {
        id: 'log-valid-1',
        timestamp: '2026-10-22 10:05:00',
        userId: 'uid-sales',
        userName: 'Rajeshwari Kulkarni',
        action: 'CREATE_SALES_ORDER',
        collectionName: 'salesOrders',
        documentId: 'ORD-2026-002',
        newValueSummary: 'Created PO BHEL/PO/2026/9021',
      },
      expectedAllowed: true,
    },
    // 21. Negative Inventory Validation
    {
      id: 'SEC-21',
      category: 'Data & Invariant Validation',
      description: 'Reject negative inventory balance (currentStockMt: -5) via .validate rule even for authorized Production user',
      actorLabel: 'Production User (uid-prod)',
      auth: { uid: 'uid-prod', token: { email: 'stores@montexforge.com', email_verified: true } },
      operation: 'write',
      path: '/inventory/rawMaterials/RM-001',
      newData: {
        ...mockDbState.inventory.rawMaterials['RM-001'],
        currentStockMt: -5.0,
      },
      expectedAllowed: false,
    },
    // 22. Negative Financial Value Validation
    {
      id: 'SEC-22',
      category: 'Data & Invariant Validation',
      description: 'Reject negative totalOutstanding (-100000) in /outstandingPayments via .validate rule even for Finance user',
      actorLabel: 'Finance User (uid-finance)',
      auth: { uid: 'uid-finance', token: { email: 'finance@montexforge.com', email_verified: true } },
      operation: 'write',
      path: '/outstandingPayments/CUST-001',
      newData: {
        ...mockDbState.outstandingPayments['CUST-001'],
        totalOutstanding: -100000,
      },
      expectedAllowed: false,
    },
  ];

  return tests.map((tc) => {
    const evalRes = evaluateRtdbOperation(
      mockDbState,
      tc.auth,
      tc.operation,
      tc.path,
      tc.newData
    );
    const passed = evalRes.allowed === tc.expectedAllowed;
    return {
      ...tc,
      actualAllowed: evalRes.allowed,
      passed,
      reason: evalRes.reason,
    };
  });
}
