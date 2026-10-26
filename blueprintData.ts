export const BLUEPRINT_DATA = {
  version: '1.1.0 (Step 1 Corrected — Approved Firebase Stack)',
  projectName: 'MONTEX MIS — Operations and Management Information System',
  company: 'Montex Forge Industries',
  date: '2026-10-21',
  author: 'Senior Full-Stack & Database Architect',

  repositoryAssessment: {
    runtime: 'Node.js 22.x LTS (Express server-side runtime for protected operations & API validation)',
    frontend: 'React 19, TypeScript 7, Vite 8, Tailwind CSS v4, Tabular Figures',
    databaseTarget: 'Cloud Firestore (NoSQL Document Store, Server-Authoritative Transactions & Subcollections)',
    authTarget: 'Firebase Authentication (Email/Password, Admin-Only Provisioning, No Public Registration)',
    securityRulesTarget: 'Firebase Security Rules (firestore.rules) enforcing RBAC and accountStatus == "active"',
    persistenceStatus: 'DESIGNED & BLUEPRINTED ONLY. No live Firebase connection or rules deployed in Step 1.',
    sourceDocument: 'Montex Forge MIS Data & Information Requirement Document (Dated 01 Oct 2026, 12 pages)',
  },

  requirementsRegister: [
    {
      category: 'Priority 1 (Essential — In Scope for Steps 1–6)',
      items: [
        'Customer Master with credit limits, payment terms, and assigned sales representatives.',
        'Product Master covering Forged Flanges, Rings, Shafts, Blinds, ASTM/ASME/EN grades, standard weights, and HSN codes.',
        'Sales Order Registration linking Customer PO Number with unique Internal Job Numbers (e.g., JOB-MF-2026-xxxx).',
        'Material Availability and Raw Material Stock Ledger with non-negative stock invariants and mill heat-number tracking.',
        'Traceable Stock Movements: Receipts (GRN), Production Issues, Scrap Returns, and physical adjustments (no silent overwriting).',
        'Quality Inspection logs (NDT/UT, Hardness, MPI, Chemical) and Mill Test Certificate (MTC EN 10204 Type 3.1) generation.',
        'Customer Clearance & Third-Party Inspection (TPI: BHEL, L&T, EIL, Bureau Veritas, TUV) workflow.',
        'Dispatch management supporting partial deliveries, remaining balance quantities, transporter LR numbers, and delivery challans.',
        'Finance & Invoicing integration via Tally CSV/XLSX batch import, payment recording, and age-wise receivables (0-30, 31-60, 61-90, 90+ days).',
        'CEO Command Center dashboard displaying today dispatches, open orders, material shortages, quality pending, and overdue queues.',
      ],
    },
    {
      category: 'Priority 2 (Important — Documented as Architecture Requirements)',
      items: [
        'Furnace heating logs and critical temperature thresholds (designed as manual log entries in Step 1, IoT/SCADA deferred).',
        'Machine maintenance & breakdown downtime tracking (designed as manual incident logs).',
        'Quotation & sales follow-up tracking with win/loss analysis.',
        'Product & job order direct costing framework (raw material, heat treatment, machining, testing, freight).',
      ],
    },
    {
      category: 'Priority 3 (Future Scope & Exclusions)',
      items: [
        'EXCLUDED: Direct live PLC / SCADA automated machine telemetry (no industrial IoT hardware exists on the shop floor).',
        'EXCLUDED: Real-time automated WhatsApp message dispatch (requires official WhatsApp Business API registration).',
        'EXCLUDED: Direct bi-directional programmatic ODBC/XML Tally bridge (Tally runs on an internal office PC without static public IP; batch CSV/XLSX import is the approved robust method).',
        'EXCLUDED: Public self-registration (Disabled: all accounts must be invited by Super Admin).',
      ],
    },
  ],

  firestoreCollections: [
    {
      collection: 'users',
      type: 'root_collection',
      purpose: 'Firebase Auth UIDs mapped to user profile, system role, account status, and audit dates.',
      documentIdFormat: '{firebase_auth_uid}',
      sampleFields: [
        { field: 'email', type: 'string', description: 'Employee corporate email', indexed: true },
        { field: 'role', type: 'string', description: 'super_admin | ceo | sales | purchase | stores | quality | dispatch | finance', indexed: true },
        { field: 'accountStatus', type: 'string', description: 'active | deactivated | pending_invitation', indexed: true },
        { field: 'name', type: 'string', description: 'Employee full name', indexed: false },
        { field: 'department', type: 'string', description: 'Assigned division', indexed: false },
        { field: 'invitedBy', type: 'string', description: 'UID of admin who created invitation', indexed: false },
        { field: 'createdAt', type: 'Timestamp', description: 'Creation date', indexed: true },
        { field: 'disabledAt', type: 'Timestamp | null', description: 'Timestamp of deactivation', indexed: false },
      ],
      accessPattern: 'Read by authenticated active users; Write restricted strictly to super_admin or trusted server Admin SDK.',
    },
    {
      collection: 'customers',
      type: 'root_collection',
      purpose: 'Customer master accounts, credit exposure limits, payment terms, and contact coordinates.',
      documentIdFormat: 'Auto-ID (e.g. CUST_001)',
      sampleFields: [
        { field: 'code', type: 'string', description: 'Unique customer identifier (e.g. BHEL-HYD)', indexed: true },
        { field: 'name', type: 'string', description: 'Legal company entity name', indexed: true },
        { field: 'creditLimit', type: 'number', description: 'Maximum authorized exposure in INR', indexed: false },
        { field: 'creditDays', type: 'number', description: 'Commercial credit window (e.g. 45 days)', indexed: false },
        { field: 'contactPerson', type: 'string', description: 'Primary procurement contact', indexed: false },
        { field: 'active', type: 'boolean', description: 'Active trading account flag', indexed: true },
      ],
      accessPattern: 'Read by Sales, Finance, CEO; Write restricted to Sales & Admin.',
    },
    {
      collection: 'products',
      type: 'root_collection',
      purpose: 'Finished forging catalog: Flanges, Forged Rings, Shafts, ASTM/ASME standards, theoretical weights.',
      documentIdFormat: 'Auto-ID or sanitized item code',
      sampleFields: [
        { field: 'code', type: 'string', description: 'Product item code', indexed: true },
        { field: 'name', type: 'string', description: 'Commercial title', indexed: true },
        { field: 'category', type: 'string', description: 'Flange | Forged Ring | Shaft', indexed: true },
        { field: 'materialGrade', type: 'string', description: 'ASTM A105, A350 LF2, F316L, 42CrMo4', indexed: true },
        { field: 'standardWeightKg', type: 'number', description: 'Calculated piece weight', indexed: false },
        { field: 'hsnCode', type: 'string', description: 'GST tariff code', indexed: false },
      ],
      accessPattern: 'Read by all active employees; Write restricted to Sales & Admin.',
    },
    {
      collection: 'sales_orders',
      type: 'root_collection',
      purpose: 'Customer purchase order header, contractual dates, overall status, and billing tracking.',
      documentIdFormat: 'Auto-ID (e.g. SO_2026_001)',
      sampleFields: [
        { field: 'orderNumber', type: 'string', description: 'Internal order reference', indexed: true },
        { field: 'customerPoNumber', type: 'string', description: 'Customer purchase order number', indexed: true },
        { field: 'customerRef', type: 'DocumentReference', description: 'Reference to /customers/{id}', indexed: false },
        { field: 'customerName', type: 'string', description: 'Denormalized for zero-join listing', indexed: true },
        { field: 'status', type: 'string', description: 'po_registered | in_production | quality_pending | ready_for_dispatch | partially_dispatched | completed', indexed: true },
        { field: 'totalValue', type: 'number', description: 'Total PO value in INR', indexed: true },
        { field: 'poDate', type: 'Timestamp', description: 'PO date', indexed: true },
        { field: 'expectedDeliveryDate', type: 'Timestamp', description: 'Contractual delivery date', indexed: true },
      ],
      accessPattern: 'Read by all authenticated departments; Created by Sales; Status updated atomically by Production/Dispatch.',
    },
    {
      collection: 'sales_orders/{orderId}/items',
      type: 'subcollection',
      parentPath: 'sales_orders/{orderId}',
      purpose: 'Line-item specifications, ordered quantities, unit rates, and produced/dispatched quantities.',
      documentIdFormat: 'Auto-ID (e.g. ITEM_01)',
      sampleFields: [
        { field: 'productRef', type: 'DocumentReference', description: 'Reference to /products/{id}', indexed: false },
        { field: 'productCode', type: 'string', description: 'Item code', indexed: false },
        { field: 'orderedQty', type: 'number', description: 'Quantity on PO', indexed: false },
        { field: 'ratePerUnit', type: 'number', description: 'Quoted unit rate', indexed: false },
        { field: 'dispatchedQty', type: 'number', description: 'Accumulated shipped pieces', indexed: false },
        { field: 'pendingQty', type: 'number', description: 'Balance pieces remaining', indexed: false },
      ],
      accessPattern: 'Subcollection isolation prevents large order document bloat; updated via batch writes during dispatch.',
    },
    {
      collection: 'internal_jobs',
      type: 'root_collection',
      purpose: 'Shop-floor bridge linking Sales PO line items with raw material heats, forging presses, and QC.',
      documentIdFormat: 'Unique Job Number e.g. JOB-MF-2026-0412',
      sampleFields: [
        { field: 'jobNumber', type: 'string', description: 'Unique sequential job number', indexed: true },
        { field: 'orderRef', type: 'DocumentReference', description: 'Reference to /sales_orders/{orderId}', indexed: true },
        { field: 'assignedHeatNumber', type: 'string', description: 'Steel mill heat number stamped on forgings', indexed: true },
        { field: 'status', type: 'string', description: 'allocated | forged | heat_treated | machined | inspected | dispatched', indexed: true },
        { field: 'allocatedKg', type: 'number', description: 'Committed raw material', indexed: false },
      ],
      accessPattern: 'Read by Stores, Quality, Production; Created by Planning/Sales.',
    },
    {
      collection: 'raw_materials',
      type: 'root_collection',
      purpose: 'Raw material grade balances, cross-sections, minimum stock thresholds, and location bays.',
      documentIdFormat: 'Material Code e.g. RM-SA105-R180',
      sampleFields: [
        { field: 'code', type: 'string', description: 'Raw material code', indexed: true },
        { field: 'grade', type: 'string', description: 'SA105, 42CrMo4, F316L, LF2, F11', indexed: true },
        { field: 'sectionShape', type: 'string', description: 'Round Billet | Square Billet | Ingot', indexed: false },
        { field: 'currentStockMt', type: 'number', description: 'Physical tonnage on yard (must be >= 0)', indexed: true },
        { field: 'reservedStockMt', type: 'number', description: 'Tonnage committed to active jobs', indexed: false },
        { field: 'availableStockMt', type: 'number', description: 'currentStockMt - reservedStockMt', indexed: true },
        { field: 'minimumStockMt', type: 'number', description: 'Safety threshold trigger', indexed: false },
      ],
      accessPattern: 'Read by Stores, Purchase, CEO; Mutations execute strictly through Firestore transactions with stock_ledger write.',
    },
    {
      collection: 'stock_ledger',
      type: 'root_collection',
      purpose: 'Immutable double-entry stock movement log. Every receipt, issue, scrap return writes an unalterable movement document.',
      documentIdFormat: 'Auto-ID (e.g. MOV_2026_108)',
      sampleFields: [
        { field: 'timestamp', type: 'Timestamp', description: 'Server timestamp of movement', indexed: true },
        { field: 'materialRef', type: 'DocumentReference', description: 'Reference to /raw_materials/{id}', indexed: true },
        { field: 'movementType', type: 'string', description: 'RECEIPT_GRN | ISSUE_PRODUCTION | SCRAP_RETURN | ADJUSTMENT', indexed: true },
        { field: 'heatNumber', type: 'string', description: 'Steel mill heat number', indexed: true },
        { field: 'deltaQuantityMt', type: 'number', description: 'Signed change (+ for receipt, - for issue)', indexed: false },
        { field: 'balanceAfterMt', type: 'number', description: 'Running yard balance after event', indexed: false },
        { field: 'referenceDoc', type: 'string', description: 'GRN Number, Job Number, or Scrap Slip', indexed: true },
        { field: 'performedByUid', type: 'string', description: 'Firebase Auth UID of storekeeper', indexed: true },
      ],
      accessPattern: 'Create-only by Stores/Admin via atomic transaction; Edits & Deletes strictly forbidden in security rules.',
    },
    {
      collection: 'quality_inspections',
      type: 'root_collection',
      purpose: 'NDT inspection lots, ultrasonic scan results, hardness readings, dimensional reports, and MTC generation.',
      documentIdFormat: 'Inspection No e.g. QC-2026-0894',
      sampleFields: [
        { field: 'inspectionNo', type: 'string', description: 'Unique QC report number', indexed: true },
        { field: 'jobRef', type: 'DocumentReference', description: 'Reference to /internal_jobs/{id}', indexed: true },
        { field: 'inspectedQty', type: 'number', description: 'Total pieces sampled', indexed: false },
        { field: 'passedQty', type: 'number', description: 'Conforming pieces', indexed: false },
        { field: 'rejectedQty', type: 'number', description: 'Non-conforming pieces', indexed: true },
        { field: 'rejectionReason', type: 'string | null', description: 'Defect cause if rejected', indexed: false },
        { field: 'mtcNumber', type: 'string', description: 'Mill Test Certificate EN 10204 3.1 ID', indexed: true },
        { field: 'status', type: 'string', description: 'pending | in_progress | cleared | rejected', indexed: true },
        { field: 'inspectorUid', type: 'string', description: 'UID of NDT Level III inspector', indexed: true },
      ],
      accessPattern: 'Read by Quality, Dispatch, CEO; Written and signed strictly by Quality team.',
    },
    {
      collection: 'customer_clearances',
      type: 'root_collection',
      purpose: 'Third-Party Inspection Release Notes (IRN) by BHEL, L&T, EIL, Bureau Veritas, or TUV Rheinland.',
      documentIdFormat: 'Auto-ID (e.g. CLR_2026_041)',
      sampleFields: [
        { field: 'clearanceRefNo', type: 'string', description: 'Customer or agency IRN number', indexed: true },
        { field: 'orderRef', type: 'DocumentReference', description: 'Reference to /sales_orders/{id}', indexed: true },
        { field: 'agency', type: 'string', description: 'Third-party agency name', indexed: true },
        { field: 'inspectorName', type: 'string', description: 'Visiting surveyor name', indexed: false },
        { field: 'clearedQty', type: 'number', description: 'Quantity authorized for dispatch', indexed: false },
        { field: 'status', type: 'string', description: 'approved | pending | query_raised', indexed: true },
        { field: 'clearanceDate', type: 'Timestamp', description: 'Date of release endorsement', indexed: true },
      ],
      accessPattern: 'Read by Quality, Dispatch, Sales; Written by Quality / Sales.',
    },
    {
      collection: 'dispatches',
      type: 'root_collection',
      purpose: 'Dispatch lots, transporter consignment notes, vehicle plate numbers, partial shipments, and gate passes.',
      documentIdFormat: 'Dispatch No e.g. DSP-2026-0091',
      sampleFields: [
        { field: 'dispatchNumber', type: 'string', description: 'Gate pass / Delivery challan number', indexed: true },
        { field: 'orderRef', type: 'DocumentReference', description: 'Reference to /sales_orders/{id}', indexed: true },
        { field: 'shippedQty', type: 'number', description: 'Pieces in this consignment', indexed: false },
        { field: 'balanceQty', type: 'number', description: 'Remaining balance on PO', indexed: false },
        { field: 'transporterName', type: 'string', description: 'Logistics provider', indexed: true },
        { field: 'vehicleNo', type: 'string', description: 'Truck registration plate', indexed: false },
        { field: 'lrNumber', type: 'string', description: 'Lorry Receipt / Consignment Note number', indexed: true },
        { field: 'dispatchDate', type: 'Timestamp', description: 'Date truck exited gate', indexed: true },
      ],
      accessPattern: 'Created by Dispatch officer; triggers atomic update on sales_orders balance and creates notification.',
    },
    {
      collection: 'invoices',
      type: 'root_collection',
      purpose: 'Commercial invoices linked to dispatches, GST totals, payment receipts, and Tally sync reconciliation.',
      documentIdFormat: 'Invoice No e.g. MF-26-27-0914',
      sampleFields: [
        { field: 'invoiceNumber', type: 'string', description: 'Tax invoice string', indexed: true },
        { field: 'orderRef', type: 'DocumentReference', description: 'Linked sales order', indexed: true },
        { field: 'dispatchRef', type: 'DocumentReference', description: 'Linked dispatch consignment', indexed: true },
        { field: 'customerRef', type: 'DocumentReference', description: 'Customer billed', indexed: true },
        { field: 'totalAmount', type: 'number', description: 'Gross invoice value in INR', indexed: false },
        { field: 'outstandingAmount', type: 'number', description: 'Uncollected debt balance', indexed: true },
        { field: 'dueDate', type: 'Timestamp', description: 'Payment due date', indexed: true },
        { field: 'tallySyncStatus', type: 'string', description: 'synced | pending_import | mismatch', indexed: true },
      ],
      accessPattern: 'Read by Finance & CEO; Updated by Finance via Tally CSV batch reconciler.',
    },
    {
      collection: 'tally_import_batches',
      type: 'root_collection',
      purpose: 'Batch audit logs of CSV/XLSX imports from Tally, recording matched invoices and discrepancies.',
      documentIdFormat: 'Auto-ID (e.g. TB_2026_10_21)',
      sampleFields: [
        { field: 'uploadedAt', type: 'Timestamp', description: 'Import time', indexed: true },
        { field: 'fileName', type: 'string', description: 'Source spreadsheet name', indexed: false },
        { field: 'importedByUid', type: 'string', description: 'Finance user UID', indexed: true },
        { field: 'recordsCount', type: 'number', description: 'Rows processed', indexed: false },
        { field: 'matchedCount', type: 'number', description: 'Rows matched with MIS dispatches', indexed: false },
        { field: 'discrepancyCount', type: 'number', description: 'Unmatched or amount differences', indexed: false },
      ],
      accessPattern: 'Read and written by Finance & Super Admin.',
    },
    {
      collection: 'audit_logs',
      type: 'root_collection',
      purpose: 'Immutable audit trail for invitations, role changes, account deactivation, and sensitive business actions.',
      documentIdFormat: 'Auto-ID',
      sampleFields: [
        { field: 'timestamp', type: 'Timestamp', description: 'Server timestamp', indexed: true },
        { field: 'userId', type: 'string', description: 'Firebase Auth UID of actor', indexed: true },
        { field: 'userName', type: 'string', description: 'Actor display name', indexed: false },
        { field: 'action', type: 'string', description: 'INVITE_USER | DEACTIVATE_USER | APPROVE_QC | ISSUE_STOCK', indexed: true },
        { field: 'collectionName', type: 'string', description: 'Target Firestore collection', indexed: true },
        { field: 'documentId', type: 'string', description: 'Target document ID', indexed: true },
        { field: 'delta', type: 'map', description: 'Changes made', indexed: false },
        { field: 'ipAddress', type: 'string', description: 'Client IP if captured via Express', indexed: false },
      ],
      accessPattern: 'Append-only via trusted server / client rules; Edits and deletes completely forbidden.',
    },
  ],

  firestoreSecurityRulesBlueprint: `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }

    function getUserData() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    function isActiveUser() {
      return isAuthenticated() && getUserData().accountStatus == 'active';
    }

    function hasRole(role) {
      return isActiveUser() && getUserData().role == role;
    }

    function isSuperAdmin() {
      return isActiveUser() && getUserData().role == 'super_admin';
    }

    function isCEO() {
      return isActiveUser() && (getUserData().role == 'ceo' || getUserData().role == 'super_admin');
    }

    // User collection: Self-read; Super Admin only write
    match /users/{userId} {
      allow read: if isAuthenticated() && (request.auth.uid == userId || isSuperAdmin() || isCEO());
      allow create, update, delete: if isSuperAdmin();
    }

    // Customers: Read by active users; Write by Sales & Super Admin
    match /customers/{customerId} {
      allow read: if isActiveUser();
      allow write: if isSuperAdmin() || hasRole('sales');
    }

    // Products Catalog: Read by active users; Write by Super Admin & Sales
    match /products/{productId} {
      allow read: if isActiveUser();
      allow write: if isSuperAdmin() || hasRole('sales');
    }

    // Sales Orders: Read by active users; Write by Sales & Super Admin
    match /sales_orders/{orderId} {
      allow read: if isActiveUser();
      allow create, update: if isSuperAdmin() || hasRole('sales') || hasRole('dispatch');
      allow delete: if false; // Soft delete / status update only

      match /items/{itemId} {
        allow read: if isActiveUser();
        allow write: if isSuperAdmin() || hasRole('sales') || hasRole('dispatch');
      }
    }

    // Raw Materials & Stock Ledger
    match /raw_materials/{materialId} {
      allow read: if isActiveUser();
      allow update: if isSuperAdmin() || hasRole('stores');
      allow create, delete: if isSuperAdmin();
    }

    // Immutable Stock Ledger: Create-only, never edit or delete
    match /stock_ledger/{movementId} {
      allow read: if isActiveUser();
      allow create: if isSuperAdmin() || hasRole('stores');
      allow update, delete: if false; // Strict immutable audit history
    }

    // Quality Inspections
    match /quality_inspections/{inspectionId} {
      allow read: if isActiveUser();
      allow create, update: if isSuperAdmin() || hasRole('quality');
      allow delete: if false;
    }

    // Customer Clearances
    match /customer_clearances/{clearanceId} {
      allow read: if isActiveUser();
      allow create, update: if isSuperAdmin() || hasRole('quality') || hasRole('sales');
      allow delete: if false;
    }

    // Dispatches
    match /dispatches/{dispatchId} {
      allow read: if isActiveUser();
      allow create: if isSuperAdmin() || hasRole('dispatch');
      allow update: if isSuperAdmin();
      allow delete: if false;
    }

    // Invoices & Tally Imports
    match /invoices/{invoiceId} {
      allow read: if isActiveUser() && (hasRole('finance') || isCEO() || isSuperAdmin());
      allow write: if isSuperAdmin() || hasRole('finance');
    }

    match /tally_import_batches/{batchId} {
      allow read, write: if isSuperAdmin() || hasRole('finance');
    }

    // Audit Logs: Append-only
    match /audit_logs/{logId} {
      allow read: if isSuperAdmin() || isCEO();
      allow create: if isActiveUser();
      allow update, delete: if false;
    }
  }
}`,

  authArchitecture: {
    provider: 'Firebase Authentication (Email/Password)',
    selfRegistration: 'STRICTLY DISABLED. No public sign-up form in the application.',
    onboardingWorkflow: [
      '1. Super Administrator navigates to Role & Access Management.',
      '2. Super Admin enters Employee Name, Corporate Email (@montexforge.com), Department, and assigned Role.',
      '3. Server creates user via Firebase Admin SDK (admin.auth().createUser) and writes profile document to /users/{uid} with accountStatus="pending_invitation".',
      '4. Server triggers secure password-reset / activation email to employee.',
      '5. Employee sets initial password through secure link and logs into Montex MIS.',
      '6. System updates accountStatus to "active" upon initial verification.',
    ],
    superAdminBootstrap: [
      'The initial Super Administrator account is provisioned during Step 2 setup through a protected server-side bootstrap script or Firebase Console.',
      'No client-side UI can create a Super Admin without an existing authenticated Super Admin session.',
    ],
    accountDeactivationPolicy: [
      'When an employee departs or role changes, Super Admin toggles accountStatus to "deactivated".',
      'Server-side Firebase Admin SDK calls admin.auth().updateUser(uid, { disabled: true }) and revokes refresh tokens (revokeRefreshTokens(uid)).',
      'Firestore Security Rules immediately block any active token requests because isActiveUser() evaluates to false.',
    ],
  },

  transactionsBlueprint: [
    {
      operation: 'Atomic Raw Material Reservation',
      trigger: 'Job Number allocation to Sales Order line item',
      steps: [
        '1. Transaction starts: Reads /raw_materials/{materialId}.',
        '2. Asserts currentStockMt - reservedStockMt >= requiredKg / 1000.',
        '3. If insufficient, aborts with error: "Raw Material Shortage".',
        '4. Updates /raw_materials/{materialId} setting reservedStockMt += requiredKg/1000 and availableStockMt = current - reserved.',
        '5. Creates new document in /stock_reservations.',
        '6. Appends entry to /audit_logs.',
        '7. Commits atomically.',
      ],
    },
    {
      operation: 'Atomic Production Issue & Ledger Entry',
      trigger: 'Storekeeper issues steel billet from yard to forge shop',
      steps: [
        '1. Transaction starts: Reads /raw_materials/{materialId}.',
        '2. Checks currentStockMt >= issueQtyMt (guarantees non-negative stock).',
        '3. Computes newBalance = currentStockMt - issueQtyMt.',
        '4. Updates /raw_materials/{materialId} setting currentStockMt = newBalance.',
        '5. Creates immutable document in /stock_ledger with deltaQuantityMt = -issueQtyMt, balanceAfterMt = newBalance, heatNumber, and jobRef.',
        '6. Commits atomically.',
      ],
    },
    {
      operation: 'Atomic Partial Dispatch & Balance Decrement',
      trigger: 'Gate Pass preparation and LR entry',
      steps: [
        '1. Transaction starts: Reads /sales_orders/{orderId} and /sales_orders/{orderId}/items/{itemId}.',
        '2. Verifies customer clearance is approved and quality inspection is passed.',
        '3. Asserts shippedQty <= pendingQty.',
        '4. Updates item: dispatchedQty += shippedQty, pendingQty -= shippedQty.',
        '5. Updates order status: if (all items pendingQty == 0) "completed" else "partially_dispatched".',
        '6. Creates document in /dispatches.',
        '7. Commits atomically.',
      ],
    },
  ],

  step2ImplementationPlan: [
    {
      phase: '2.1 Firebase Project Configuration & Firestore Setup',
      details: 'Configure Firebase project credentials, initialize Firestore database instance, and deploy firestore.rules blueprint.',
    },
    {
      phase: '2.2 Firebase Authentication & Employee Onboarding Service',
      details: 'Implement Firebase Auth client SDK in React and trusted Firebase Admin SDK on Express server. Build the Admin-only employee invitation flow and password recovery.',
    },
    {
      phase: '2.3 Firestore Transactions & Data Access Layer',
      details: 'Implement tested Firestore transaction utilities for non-negative stock ledger movements, heat number tracking, and partial dispatch balance decrements.',
    },
    {
      phase: '2.4 Role-Based Authorization & Session Enforcement',
      details: 'Enforce custom claims and Firestore security rules. Implement route guards and disabled-account revocation listeners.',
    },
    {
      phase: '2.5 Persistence Verification & Automated Integration Tests',
      details: 'Execute automated tests verifying actual Firestore document creation, security rules authorization rejection on unauthorized roles, and transactional rollback on stock shortages.',
    },
  ],

  acceptanceChecklist: [
    { item: 'Repository & runtime compatibility assessed (Node.js 22 + Express + Vite + Tailwind v4 + Firebase)', status: 'COMPLETED' },
    { item: 'Requirements, assumptions & exclusions register created based on Montex Forge 12-page document', status: 'COMPLETED' },
    { item: 'Sitemap and role-based visibility matrix designed for 8 operational roles', status: 'COMPLETED' },
    { item: 'Clickable CEO Command Center prototype with realistic industrial KPIs and Action Queue', status: 'COMPLETED' },
    { item: 'Clickable interactive Order Detail Journey showing Customer PO → Job No → Material → Quality → Clearance → Dispatch → Invoice', status: 'COMPLETED' },
    { item: 'Reusable industrial design system adhering to anti-slop rules, zero-pill discipline, and tabular figures', status: 'COMPLETED' },
    { item: 'Cloud Firestore Data Model (14 collections/subcollections) designed with DocumentReferences and query indexes', status: 'COMPLETED' },
    { item: 'Firebase Security Rules (firestore.rules) drafted enforcing RBAC and active account validation', status: 'COMPLETED' },
    { item: 'Firebase Auth Architecture (Admin-only invitation, no public registration, account deactivation) designed', status: 'COMPLETED' },
    { item: 'Firestore atomic transactions designed for non-negative stock ledger and partial dispatches', status: 'COMPLETED' },
    { item: 'External data sources (Tally CSV, Steel Mills, Transporters) registered', status: 'COMPLETED' },
    { item: 'Unresolved business questions compiled for Montex Top Management approval', status: 'COMPLETED' },
    { item: 'Detailed Step 2 Implementation Plan updated for Firebase stack', status: 'COMPLETED' },
    { item: 'Explicit distinction between Prototype UI vs Real Database Persistence maintained (no false claims)', status: 'COMPLETED' },
  ],
};
