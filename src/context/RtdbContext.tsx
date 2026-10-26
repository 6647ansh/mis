import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { ref, onValue, set, get, remove, Unsubscribe } from 'firebase/database';
import { doc as fsDocRef, onSnapshot as onFirestoreSnapshot } from 'firebase/firestore';
import { auth, rtdb, firestore, googleProvider, isFirestoreConfigured } from '../lib/firebase';
import {
  canRoleReadCollection,
  canActorVerifyDepartmentTask,
  canActorAcceptOrRejectHandover,
  canActorApprovePurchaseRequisition,
  canActorExecuteExecutiveOverride,
} from '../types/roles';
import {
  OrderJourney,
  RawMaterialStock,
  StockMovement,
  ActionQueueItem,
  OutstandingAgeingRecord,
  Customer,
  Product,
  UserProfile,
  UserRole,
  ApprovalHistoryEntry,
  AuditLogEntry,
  RtdbDashboardKpis,
  RtdbProductionSummary,
  RtdbAlertThresholds,
  RbacRoleGroup,
  QuotationRecord,
  TenderRecord,
  PurchaseOrderRecord,
  ShopMachineLog,
  FurnaceBatchLog,
  MachineMaintenanceTicket,
  PowerConsumptionLog,
  DimensionalInspectionReport,
  SteelMillSupplier,
  JobCostSheet,
  DispatchConsignmentRecord,
  QualityInspectionRecord,
  TaskRecord,
  HandoverRecord,
  PurchaseRequisitionRecord,
  NcrCapaRecord,
  PaymentFollowUpRecord,
  PreRfqLeadRecord,
  PpcScheduleEntry,
  RoleDutySopChecklist,
  ROLE_PERMISSION_DEFAULTS,
  isCanonicalUserRole,
} from '../types/mis';
import {
  MOCK_ORDER_JOURNEYS,
  MOCK_RAW_MATERIALS,
  MOCK_STOCK_MOVEMENTS,
  MOCK_ACTION_QUEUE,
  MOCK_OUTSTANDING_AGEING,
  MOCK_CUSTOMERS,
  MOCK_PRODUCTS,
  PROTOTYPE_USERS,
  MOCK_AUDIT_LOGS,
} from '../data/mockData';
import {
  INITIAL_QUOTATIONS,
  INITIAL_TENDERS,
  INITIAL_PURCHASE_ORDERS,
  INITIAL_SHOP_MACHINE_LOGS,
  INITIAL_FURNACE_BATCH_LOGS as INITIAL_FURNACE_LOGS,
  INITIAL_MAINTENANCE_TICKETS,
  INITIAL_POWER_LOGS,
  INITIAL_DIMENSIONAL_REPORTS,
  INITIAL_STEEL_MILLS,
  INITIAL_JOB_COST_SHEETS,
  INITIAL_TASKS,
  INITIAL_HANDOVERS,
  INITIAL_PURCHASE_REQUISITIONS,
  INITIAL_NCR_CAPA_RECORDS,
  INITIAL_PAYMENT_FOLLOW_UPS,
  INITIAL_PRE_RFQ_LEADS,
  INITIAL_PPC_SCHEDULES,
  INITIAL_ROLE_DUTY_MANUALS,
} from '../data/requirementsRegister';
import {
  DEFAULT_DASHBOARD_KPIS,
  DEFAULT_PRODUCTION_SUMMARY,
  DEFAULT_ALERT_THRESHOLDS,
  INITIAL_DISPATCHES,
  INITIAL_QUALITY_INSPECTIONS,
  recordToArray,
  mapRoleToRbacGroup,
  mapRbacGroupToUserRole,
  seedMontexRealtimeDatabase,
  adminUpdateEmployeeProfileInRtdb,
} from '../services/rtdbService';
import {
  resolveUserRoleMapping,
  normalizeRawMaterialWithComputedStatus,
} from '../services/misDataValidator';
import { firestoreService } from '../services/firestoreService';
import { mapUserProfileToFirestoreDoc } from '../services/firestoreMappers';
import {
  adminApproveEmployeeViaApi,
  adminRejectEmployeeViaApi,
  submitAccessRequestViaApi,
} from '../services/adminEmployeeApi';
import {
  CutoverWriteResult,
  DEFAULT_CLEAN_ALERT_THRESHOLDS,
  ZERO_DASHBOARD_KPIS,
  ZERO_PRODUCTION_SUMMARY,
  computeLiveDashboardKpis,
  computeLiveProductionSummary,
  cutoverEngine,
} from '../services/firestoreCutoverService';

/**
 * Controlled Cutover Backend Selector:
 * - Defaults to `'firestore'` in Phase 5.
 * - Can be switched to `'rtdb'` via `VITE_DATA_BACKEND=rtdb` for instant rollback.
 */
export const DATA_BACKEND_MODE: 'firestore' | 'rtdb' =
  (import.meta as any).env?.VITE_DATA_BACKEND === 'rtdb' ? 'rtdb' : 'firestore';

/**
 * R-1 Fix: Deterministic ID-based RTDB–Firestore Reconciliation.
 * Preserves RTDB-only records when Firestore has partial records, while giving
 * Cloud Firestore strict precedence when the same ID exists in both stores.
 */
export function reconcileRecordsById<T extends Record<string, any>>(
  firestoreRecords: T[],
  rtdbRecords: T[],
  idField: keyof T = 'id' as keyof T
): T[] {
  const merged = new Map<string, T>();
  for (const r of rtdbRecords) {
    if (r && typeof r === 'object') {
      const key = String(r[idField] ?? r.id ?? '');
      if (key) {
        merged.set(key, r);
      }
    }
  }
  // Merge records on ID collision using updatedAt timestamp and accountStatus resolution
  for (const f of firestoreRecords) {
    if (f && typeof f === 'object') {
      const key = String(f[idField] ?? f.id ?? '');
      if (key) {
        const existingRtdb = merged.get(key);
        if (!existingRtdb) {
          merged.set(key, f);
        } else {
          const rtdbUpdated = String(existingRtdb.updatedAt || '');
          const fsUpdated = String(f.updatedAt || '');
          const rtdbHasNewerTimestamp = Boolean(rtdbUpdated && fsUpdated && rtdbUpdated > fsUpdated);
          const rtdbResolvedPending =
            existingRtdb.accountStatus &&
            existingRtdb.accountStatus !== 'pending_approval' &&
            f.accountStatus === 'pending_approval' &&
            (!fsUpdated || !rtdbUpdated || rtdbUpdated >= fsUpdated);

          if (rtdbHasNewerTimestamp || rtdbResolvedPending) {
            merged.set(key, { ...f, ...existingRtdb });
          } else {
            merged.set(key, { ...existingRtdb, ...f });
          }
        }
      }
    }
  }
  return Array.from(merged.values());
}

interface RtdbContextType {
  firebaseUser: User | null;
  authLoading: boolean;
  currentUser: UserProfile;
  activeRbacGroup: RbacRoleGroup;
  setPreviewUserRole: (user: UserProfile) => void;
  setActiveRbacGroup: (group: RbacRoleGroup) => void;

  // Auth actions
  submitOrUpdateOwnAccessRequest: (input: {
    displayName: string;
    department: string;
    requestedRole: UserRole;
    designation?: string;
  }) => Promise<{
    success: boolean;
    error?: string;
    profile?: UserProfile;
  }>;
  refreshOwnUserProfile: () => Promise<{
    success: boolean;
    profile?: UserProfile;
    error?: string;
  }>;
  approveEmployeeAccount: (
    targetUser: UserProfile,
    input: {
      role: UserRole;
      department: string;
      designation?: string;
      isDepartmentHead?: boolean;
      notes?: string;
    }
  ) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    updatedProfile?: UserProfile;
    persistedToFirestore?: boolean;
    persistedToRtdb?: boolean;
  }>;
  rejectEmployeeAccount: (
    targetUser: UserProfile,
    reason: string
  ) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    updatedProfile?: UserProfile;
    persistedToFirestore?: boolean;
    persistedToRtdb?: boolean;
  }>;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string; code?: string; cancelled?: boolean }>;
  logoutUser: () => Promise<void>;

  // Connection & Cutover State
  isRtdbConnected: boolean;
  isDemoMode: boolean;
  dataBackend: 'firestore' | 'rtdb' | 'demo_sandbox';
  dataSource: 'live_rtdb' | 'fallback_seed';
  rtdbError: string | null;
  lastSyncedAt: string | null;
  seedDatabase: () => Promise<{ success: boolean; message: string }>;
  refreshFirestoreSnapshot: () => Promise<void>;

  // Live MIS Data
  dashboardKpis: RtdbDashboardKpis;
  productionSummary: RtdbProductionSummary;
  salesOrders: OrderJourney[];
  dispatches: DispatchConsignmentRecord[];
  qualityInspections: QualityInspectionRecord[];
  rawMaterials: RawMaterialStock[];
  stockMovements: StockMovement[];
  actionQueue: ActionQueueItem[];
  alertThresholds: RtdbAlertThresholds;
  outstandingAgeing: OutstandingAgeingRecord[];
  customers: Customer[];
  products: Product[];
  suppliers: SteelMillSupplier[];
  jobCostSheets: JobCostSheet[];
  usersList: UserProfile[];
  auditLogs: AuditLogEntry[];

  // All 8 Persistent Operational Registers
  quotations: QuotationRecord[];
  tenders: TenderRecord[];
  purchaseOrders: PurchaseOrderRecord[];
  machineLogs: ShopMachineLog[];
  furnaceLogs: FurnaceBatchLog[];
  maintenanceTickets: MachineMaintenanceTicket[];
  powerLogs: PowerConsumptionLog[];
  dimensionalReports: DimensionalInspectionReport[];
  tasks: TaskRecord[];
  handovers: HandoverRecord[];
  purchaseRequisitions: PurchaseRequisitionRecord[];
  ncrCapaRecords: NcrCapaRecord[];
  paymentFollowUps: PaymentFollowUpRecord[];
  preRfqLeads: PreRfqLeadRecord[];
  ppcSchedules: PpcScheduleEntry[];
  roleDutyManuals: RoleDutySopChecklist[];

  // State Updaters
  setProductionSummary: React.Dispatch<React.SetStateAction<RtdbProductionSummary>>;
  setSalesOrders: React.Dispatch<React.SetStateAction<OrderJourney[]>>;
  setDispatches: React.Dispatch<React.SetStateAction<DispatchConsignmentRecord[]>>;
  setQualityInspections: React.Dispatch<React.SetStateAction<QualityInspectionRecord[]>>;
  setRawMaterials: React.Dispatch<React.SetStateAction<RawMaterialStock[]>>;
  setStockMovements: React.Dispatch<React.SetStateAction<StockMovement[]>>;
  setActionQueue: React.Dispatch<React.SetStateAction<ActionQueueItem[]>>;
  setAlertThresholds: React.Dispatch<React.SetStateAction<RtdbAlertThresholds>>;
  setOutstandingAgeing: React.Dispatch<React.SetStateAction<OutstandingAgeingRecord[]>>;
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  setSuppliers: React.Dispatch<React.SetStateAction<SteelMillSupplier[]>>;
  setJobCostSheets: React.Dispatch<React.SetStateAction<JobCostSheet[]>>;
  setUsersList: React.Dispatch<React.SetStateAction<UserProfile[]>>;
  setAuditLogs: React.Dispatch<React.SetStateAction<AuditLogEntry[]>>;
  setQuotations: React.Dispatch<React.SetStateAction<QuotationRecord[]>>;
  setTenders: React.Dispatch<React.SetStateAction<TenderRecord[]>>;
  setPurchaseOrders: React.Dispatch<React.SetStateAction<PurchaseOrderRecord[]>>;
  setMachineLogs: React.Dispatch<React.SetStateAction<ShopMachineLog[]>>;
  setFurnaceLogs: React.Dispatch<React.SetStateAction<FurnaceBatchLog[]>>;
  setMaintenanceTickets: React.Dispatch<React.SetStateAction<MachineMaintenanceTicket[]>>;
  setPowerLogs: React.Dispatch<React.SetStateAction<PowerConsumptionLog[]>>;
  setDimensionalReports: React.Dispatch<React.SetStateAction<DimensionalInspectionReport[]>>;
  setTasks: React.Dispatch<React.SetStateAction<TaskRecord[]>>;
  setHandovers: React.Dispatch<React.SetStateAction<HandoverRecord[]>>;
  setPurchaseRequisitions: React.Dispatch<React.SetStateAction<PurchaseRequisitionRecord[]>>;
  setNcrCapaRecords: React.Dispatch<React.SetStateAction<NcrCapaRecord[]>>;
  setPaymentFollowUps: React.Dispatch<React.SetStateAction<PaymentFollowUpRecord[]>>;
  setPreRfqLeads: React.Dispatch<React.SetStateAction<PreRfqLeadRecord[]>>;
  setPpcSchedules: React.Dispatch<React.SetStateAction<PpcScheduleEntry[]>>;

  // Phase 5 Persistent Register & Core Module Actions (Cloud Firestore Cutover)
  createQuotationRecord: (
    quote: QuotationRecord
  ) => Promise<CutoverWriteResult<QuotationRecord>>;
  updateQuotationRecord: (
    quote: QuotationRecord
  ) => Promise<CutoverWriteResult<QuotationRecord>>;
  convertQuotationToOrderRecord: (
    updatedQuote: QuotationRecord,
    newOrder: OrderJourney
  ) => Promise<CutoverWriteResult<{ quotation: QuotationRecord; order: OrderJourney }>>;
  createTenderRecord: (tender: TenderRecord) => Promise<CutoverWriteResult<TenderRecord>>;
  createPurchaseOrderRecord: (
    po: PurchaseOrderRecord
  ) => Promise<CutoverWriteResult<PurchaseOrderRecord>>;
  receivePurchaseOrderGrnRecord: (params: {
    po: PurchaseOrderRecord;
    material: RawMaterialStock;
    receiptQtyMt: number;
    heatNumber: string;
    grnNumber: string;
  }) => Promise<
    CutoverWriteResult<{
      updatedPo: PurchaseOrderRecord;
      updatedMaterial: RawMaterialStock;
      movement: StockMovement;
    }>
  >;
  createMachineLogRecord: (
    log: ShopMachineLog
  ) => Promise<CutoverWriteResult<ShopMachineLog>>;
  createFurnaceLogRecord: (
    batch: FurnaceBatchLog
  ) => Promise<CutoverWriteResult<FurnaceBatchLog>>;
  createMaintenanceTicketRecord: (
    ticket: MachineMaintenanceTicket
  ) => Promise<CutoverWriteResult<MachineMaintenanceTicket>>;
  createPowerLogRecord: (
    powerLog: PowerConsumptionLog
  ) => Promise<CutoverWriteResult<PowerConsumptionLog>>;
  createDimensionalReportRecord: (
    dir: DimensionalInspectionReport
  ) => Promise<CutoverWriteResult<DimensionalInspectionReport>>;
  createSalesOrderRecord: (order: OrderJourney) => Promise<CutoverWriteResult<OrderJourney>>;
  updateSalesOrderRecord: (
    order: OrderJourney,
    changeSummary: string
  ) => Promise<CutoverWriteResult<OrderJourney>>;
  recordStockMovementRecord: (params: {
    material: RawMaterialStock;
    quantityDeltaMt: number;
    movementType: StockMovement['movementType'];
    heatNumber: string;
    referenceDoc: string;
  }) => Promise<
    CutoverWriteResult<{ updatedMaterial: RawMaterialStock; movement: StockMovement }>
  >;
  recordQualityInspectionRecord: (
    inspection: QualityInspectionRecord
  ) => Promise<CutoverWriteResult<QualityInspectionRecord>>;
  recordDispatchRecord: (
    dispatchRecord: DispatchConsignmentRecord,
    updatedOrder?: OrderJourney
  ) => Promise<
    CutoverWriteResult<{
      dispatch: DispatchConsignmentRecord;
      updatedOrder?: OrderJourney;
    }>
  >;
  recordCustomerPaymentRecord: (
    record: OutstandingAgeingRecord,
    paymentAmountInr: number,
    utrReference: string
  ) => Promise<CutoverWriteResult<OutstandingAgeingRecord>>;
  upsertCustomerRecord: (
    customer: Customer,
    isNew: boolean
  ) => Promise<CutoverWriteResult<Customer>>;
  upsertProductRecord: (
    product: Product,
    isNew: boolean
  ) => Promise<CutoverWriteResult<Product>>;
  deleteCustomerRecord: (
    customerId: string
  ) => Promise<CutoverWriteResult<{ deletedId: string }>>;
  deleteProductRecord: (
    productId: string
  ) => Promise<CutoverWriteResult<{ deletedId: string }>>;
  saveAlertThresholdsRecord: (
    thresholds: RtdbAlertThresholds
  ) => Promise<CutoverWriteResult<RtdbAlertThresholds>>;
  acknowledgeAlertRecord: (
    item: ActionQueueItem
  ) => Promise<CutoverWriteResult<ActionQueueItem>>;

  // Enterprise Task, Handover, PR, NCR/CAPA, Payment Follow-Up & SLA Actions
  upsertTaskRecord: (
    task: TaskRecord,
    isNew?: boolean
  ) => Promise<CutoverWriteResult<TaskRecord>>;
  submitTaskForVerificationRecord: (
    task: TaskRecord,
    submissionNotes: string
  ) => Promise<CutoverWriteResult<TaskRecord>>;
  verifyTaskRecord: (
    task: TaskRecord,
    approved: boolean,
    verificationRemarks: string
  ) => Promise<CutoverWriteResult<TaskRecord>>;
  initiateHandoverRecord: (
    handover: HandoverRecord
  ) => Promise<CutoverWriteResult<HandoverRecord>>;
  resolveHandoverRecord: (
    handover: HandoverRecord,
    accepted: boolean,
    remarks: string
  ) => Promise<CutoverWriteResult<HandoverRecord>>;
  createPurchaseRequisitionRecord: (
    pr: PurchaseRequisitionRecord
  ) => Promise<CutoverWriteResult<PurchaseRequisitionRecord>>;
  approvePurchaseRequisitionRecord: (
    pr: PurchaseRequisitionRecord,
    approved: boolean,
    remarks?: string
  ) => Promise<CutoverWriteResult<PurchaseRequisitionRecord>>;
  upsertNcrCapaRecord: (
    ncr: NcrCapaRecord,
    isNew?: boolean
  ) => Promise<CutoverWriteResult<NcrCapaRecord>>;
  upsertPaymentFollowUpRecord: (
    followUp: PaymentFollowUpRecord,
    isNew?: boolean
  ) => Promise<CutoverWriteResult<PaymentFollowUpRecord>>;
  updateMonthlySalesTargetRecord: (
    newTargetInr: number
  ) => Promise<CutoverWriteResult<{ monthlySalesTarget: number }>>;
  runSlaAutomationScanRecord: () => Promise<{
    scannedCount: number;
    escalatedTasksCount: number;
    newAlertsGenerated: number;
  }>;
}

/**
 * Placeholder profile while nobody is signed in. It is never active and carries
 * no permissions, so no protected module can render or read data for it.
 */
const SIGNED_OUT_PROFILE: UserProfile = {
  ...PROTOTYPE_USERS[0],
  id: '',
  uid: '',
  name: '',
  displayName: '',
  email: '',
  avatarInitials: '',
  accountStatus: 'pending_approval',
  permissions: [],
  approvalHistory: [],
};

/** Maps Firebase Auth error codes to messages an employee can act on. */
function describeGoogleSignInError(code: string | undefined): string {
  switch (code) {
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.';
    case 'auth/network-request-failed':
      return 'Could not reach Google. Check your internet connection, then try again.';
    case 'auth/unauthorized-domain':
      return 'Sign-in is not enabled for this web address yet. Ask your system administrator to add it in Firebase Authentication settings.';
    case 'auth/user-disabled':
      return 'This Google account has been disabled for Montex MIS. Contact your system administrator.';
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts. Wait a minute, then try again.';
    default:
      return 'Google sign-in did not complete. Please try again, or contact your system administrator if it keeps failing.';
  }
}

const RtdbContext = createContext<RtdbContextType | undefined>(undefined);

export const RtdbProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<UserProfile>(SIGNED_OUT_PROFILE);

  const [isRtdbConnected, setIsRtdbConnected] = useState<boolean>(false);
  const [dataSource, setDataSource] = useState<'live_rtdb' | 'fallback_seed'>('fallback_seed');
  const [rtdbError, setRtdbError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const isDemoMode = !firebaseUser;
  const dataBackend: 'firestore' | 'rtdb' | 'demo_sandbox' = isDemoMode
    ? 'demo_sandbox'
    : DATA_BACKEND_MODE;

  // Live MIS states initialized with demo fixtures ONLY for unauthenticated preview mode
  const [dashboardKpis, setDashboardKpis] =
    useState<RtdbDashboardKpis>(DEFAULT_DASHBOARD_KPIS);
  const [productionSummary, setProductionSummary] =
    useState<RtdbProductionSummary>(DEFAULT_PRODUCTION_SUMMARY);
  const [salesOrders, setSalesOrders] = useState<OrderJourney[]>(MOCK_ORDER_JOURNEYS);
  const [dispatches, setDispatches] =
    useState<DispatchConsignmentRecord[]>(INITIAL_DISPATCHES);
  const [qualityInspections, setQualityInspections] = useState<QualityInspectionRecord[]>(
    INITIAL_QUALITY_INSPECTIONS
  );
  const [rawMaterials, setRawMaterials] = useState<RawMaterialStock[]>(() =>
    MOCK_RAW_MATERIALS.map(normalizeRawMaterialWithComputedStatus)
  );
  const [stockMovements, setStockMovements] =
    useState<StockMovement[]>(MOCK_STOCK_MOVEMENTS);
  const [actionQueue, setActionQueue] = useState<ActionQueueItem[]>(MOCK_ACTION_QUEUE);
  const [alertThresholds, setAlertThresholds] =
    useState<RtdbAlertThresholds>(DEFAULT_ALERT_THRESHOLDS);
  const [outstandingAgeing, setOutstandingAgeing] =
    useState<OutstandingAgeingRecord[]>(MOCK_OUTSTANDING_AGEING);
  const [customers, setCustomers] = useState<Customer[]>(MOCK_CUSTOMERS);
  const [products, setProducts] = useState<Product[]>(MOCK_PRODUCTS);
  const [suppliers, setSuppliers] = useState<SteelMillSupplier[]>(INITIAL_STEEL_MILLS);
  const [jobCostSheets, setJobCostSheets] =
    useState<JobCostSheet[]>(INITIAL_JOB_COST_SHEETS);
  const [usersList, setUsersList] = useState<UserProfile[]>(PROTOTYPE_USERS);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(MOCK_AUDIT_LOGS);

  // All 8 Persistent Operational Registers
  const [quotations, setQuotations] = useState<QuotationRecord[]>(INITIAL_QUOTATIONS);
  const [tenders, setTenders] = useState<TenderRecord[]>(INITIAL_TENDERS);
  const [purchaseOrders, setPurchaseOrders] =
    useState<PurchaseOrderRecord[]>(INITIAL_PURCHASE_ORDERS);
  const [machineLogs, setMachineLogs] =
    useState<ShopMachineLog[]>(INITIAL_SHOP_MACHINE_LOGS);
  const [furnaceLogs, setFurnaceLogs] =
    useState<FurnaceBatchLog[]>(INITIAL_FURNACE_LOGS);
  const [maintenanceTickets, setMaintenanceTickets] = useState<
    MachineMaintenanceTicket[]
  >(INITIAL_MAINTENANCE_TICKETS);
  const [powerLogs, setPowerLogs] = useState<PowerConsumptionLog[]>(INITIAL_POWER_LOGS);
  const [dimensionalReports, setDimensionalReports] = useState<
    DimensionalInspectionReport[]
  >(INITIAL_DIMENSIONAL_REPORTS);
  const [tasks, setTasks] = useState<TaskRecord[]>(INITIAL_TASKS);
  const [handovers, setHandovers] = useState<HandoverRecord[]>(INITIAL_HANDOVERS);
  const [purchaseRequisitions, setPurchaseRequisitions] = useState<
    PurchaseRequisitionRecord[]
  >(INITIAL_PURCHASE_REQUISITIONS);
  const [ncrCapaRecords, setNcrCapaRecords] = useState<NcrCapaRecord[]>(
    INITIAL_NCR_CAPA_RECORDS
  );
  const [paymentFollowUps, setPaymentFollowUps] = useState<PaymentFollowUpRecord[]>(
    INITIAL_PAYMENT_FOLLOW_UPS
  );
  const [preRfqLeads, setPreRfqLeads] =
    useState<PreRfqLeadRecord[]>(INITIAL_PRE_RFQ_LEADS);
  const [ppcSchedules, setPpcSchedules] =
    useState<PpcScheduleEntry[]>(INITIAL_PPC_SCHEDULES);
  const [roleDutyManuals] = useState<RoleDutySopChecklist[]>(INITIAL_ROLE_DUTY_MANUALS);

  const activeRbacGroup: RbacRoleGroup =
    currentUser.rbacGroup || mapRoleToRbacGroup(currentUser.role);

  const clearProductionCollections = useCallback(() => {
    setDashboardKpis({ ...ZERO_DASHBOARD_KPIS });
    setProductionSummary({ ...ZERO_PRODUCTION_SUMMARY });
    setAlertThresholds({ ...DEFAULT_CLEAN_ALERT_THRESHOLDS });
    setSalesOrders([]);
    setDispatches([]);
    setQualityInspections([]);
    setRawMaterials([]);
    setStockMovements([]);
    setActionQueue([]);
    setOutstandingAgeing([]);
    setCustomers([]);
    setProducts([]);
    setSuppliers([]);
    setJobCostSheets([]);
    setUsersList([]);
    setAuditLogs([]);
    setQuotations([]);
    setTenders([]);
    setPurchaseOrders([]);
    setMachineLogs([]);
    setFurnaceLogs([]);
    setMaintenanceTickets([]);
    setPowerLogs([]);
    setDimensionalReports([]);
    setTasks([]);
    setHandovers([]);
    setPurchaseRequisitions([]);
    setNcrCapaRecords([]);
    setPaymentFollowUps([]);
    setPreRfqLeads([]);
    setPpcSchedules([]);
  }, []);

  const setPreviewUserRole = (user: UserProfile) => {
    if (firebaseUser) return; // Never allow preview role switching when signed in to production
    setCurrentUser({
      ...user,
      rbacGroup: user.rbacGroup || mapRoleToRbacGroup(user.role),
    });
  };

  const setActiveRbacGroup = (group: RbacRoleGroup) => {
    if (firebaseUser) return; // Never allow client-side group spoofing when signed in
    const mappedRole = mapRbacGroupToUserRole(group);
    const matchingPersona =
      usersList.find(
        (u) => mapRoleToRbacGroup(u.role) === group && u.accountStatus === 'active'
      ) ||
      PROTOTYPE_USERS.find((u) => mapRoleToRbacGroup(u.role) === group) ||
      currentUser;

    setCurrentUser({
      ...matchingPersona,
      role: mappedRole,
      rbacGroup: group,
      roleTitle: `${group} (${matchingPersona.roleTitle})`,
    });
  };

  const buildResolvedUserProfile = useCallback(
    (rawDoc: Record<string, any>, fallbackAuthUser: User): UserProfile => {
      const resolved = resolveUserRoleMapping(rawDoc);
      const status = (rawDoc.accountStatus || 'pending_approval') as UserProfile['accountStatus'];
      const isAct = status === 'active' && !resolved.isUnassigned;
      const requestedRole = isCanonicalUserRole(rawDoc.requestedRole)
        ? rawDoc.requestedRole
        : isCanonicalUserRole(rawDoc.legacyRole)
        ? rawDoc.legacyRole
        : resolved.granularRole;
      const requestedDept =
        rawDoc.requestedDepartment || rawDoc.department || 'Sales';

      const roleTitle =
        status === 'deactivated'
          ? 'ACCOUNT DEACTIVATED'
          : status === 'rejected'
          ? 'ACCESS REQUEST REJECTED'
          : status === 'pending_approval' || status === 'pending_invitation'
          ? `Pending Admin Approval (Requested: ${requestedRole.toUpperCase()} — ${requestedDept})`
          : resolved.isUnassigned
          ? 'Pending Admin Role Assignment'
          : rawDoc.designation || rawDoc.roleTitle || `${resolved.rbacGroup} (Authenticated)`;

      return {
        ...rawDoc,
        id: rawDoc.uid || rawDoc.id || fallbackAuthUser.uid,
        uid: rawDoc.uid || rawDoc.id || fallbackAuthUser.uid,
        name:
          rawDoc.displayName ||
          rawDoc.name ||
          fallbackAuthUser.displayName ||
          fallbackAuthUser.email?.split('@')[0] ||
          'Employee',
        displayName:
          rawDoc.displayName ||
          rawDoc.name ||
          fallbackAuthUser.displayName ||
          fallbackAuthUser.email?.split('@')[0] ||
          'Employee',
        email: (rawDoc.email || fallbackAuthUser.email || '').trim().toLowerCase(),
        role: resolved.granularRole,
        requestedRole,
        requestedDepartment: requestedDept,
        rbacGroup: resolved.rbacGroup,
        roleTitle,
        designation: rawDoc.designation || roleTitle,
        department: rawDoc.department || requestedDept || 'Operations',
        avatarInitials:
          rawDoc.avatarInitials ||
          (rawDoc.displayName || rawDoc.name || fallbackAuthUser.email || 'MU')
            .slice(0, 2)
            .toUpperCase(),
        accountStatus: status,
        isDepartmentHead: isAct ? Boolean(rawDoc.isDepartmentHead) : false,
        managedDepartment: isAct ? rawDoc.managedDepartment : undefined,
        mustChangePassword: Boolean(rawDoc.mustChangePassword),
        createdAt: rawDoc.createdAt || new Date().toISOString().split('T')[0],
        updatedAt: rawDoc.updatedAt,
        lastLoginAt: rawDoc.lastLoginAt || new Date().toISOString(),
        approvedByUid: rawDoc.approvedByUid,
        approvedByEmail: rawDoc.approvedByEmail,
        approvedByName: rawDoc.approvedByName,
        approvedAt: rawDoc.approvedAt,
        rejectedByUid: rawDoc.rejectedByUid,
        rejectedByEmail: rawDoc.rejectedByEmail,
        rejectedByName: rawDoc.rejectedByName,
        rejectedAt: rawDoc.rejectedAt,
        rejectionReason: rawDoc.rejectionReason,
        approvalHistory: Array.isArray(rawDoc.approvalHistory)
          ? rawDoc.approvalHistory
          : undefined,
        permissions: isAct ? resolved.permissions : [],
        dataOrigin: 'production',
      };
    },
    []
  );

  // Monitor Firebase Authentication Session & Resolve Profile (/users/{uid} in Firestore primary)
  useEffect(() => {
    let unsubOwnProfile: Unsubscribe | null = null;
    let unsubOwnFirestoreProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubOwnProfile) {
        unsubOwnProfile();
        unsubOwnProfile = null;
      }
      if (unsubOwnFirestoreProfile) {
        unsubOwnFirestoreProfile();
        unsubOwnFirestoreProfile = null;
      }

      // Hold the UI on the loading screen until this user's profile is resolved,
      // so a signed-in employee never sees the "pending" page flash first.
      setAuthLoading(true);
      setFirebaseUser(user);
      if (!user) {
        setCurrentUser(SIGNED_OUT_PROFILE);
        clearProductionCollections();
        setDataSource('fallback_seed');
        setRtdbError(null);
        setAuthLoading(false);
        return;
      }

      // Immediately clear demo collections when entering an authenticated session
      clearProductionCollections();

      try {
        let fsDoc: Record<string, any> | null = null;
        let rtdbDoc: Record<string, any> | null = null;

        // 1. Try Cloud Firestore /users/{uid}
        if (isFirestoreConfigured && DATA_BACKEND_MODE === 'firestore') {
          const fsProfileRes = await firestoreService.getUserProfile(user.uid);
          if (fsProfileRes.success && fsProfileRes.data) {
            fsDoc = fsProfileRes.data;
          }
        }

        // 2. Also check RTDB /users/{uid} so RTDB-only or newly updated records are reconciled
        try {
          const ownProfileRef = ref(rtdb, `users/${user.uid}`);
          const rtdbSnap = await get(ownProfileRef);
          if (rtdbSnap.exists()) {
            rtdbDoc = rtdbSnap.val();
          }
        } catch {
          // Ignore RTDB read error if offline
        }

        const normalizedAuthEmail = (user.email || '').trim().toLowerCase();
        const isBootstrapSuperAdminOwner =
          normalizedAuthEmail === 'anshyadav6647@gmail.com' &&
          user.emailVerified === true;

        if (fsDoc || rtdbDoc) {
          // Merge RTDB and Firestore with timestamp-aware precedence so newer approvals/rejections/deactivations in either store win
          const mergedRaw: Record<string, any> = {
            ...(rtdbDoc || {}),
            ...(fsDoc || {}),
          };
          const rtdbUpdated = String(rtdbDoc?.updatedAt || '');
          const fsUpdated = String(fsDoc?.updatedAt || '');
          const rtdbIsNewer = Boolean(rtdbDoc && rtdbUpdated && (!fsUpdated || rtdbUpdated > fsUpdated));
          const rtdbResolvedWhileFsPending = Boolean(
            rtdbDoc?.accountStatus &&
              rtdbDoc.accountStatus !== 'pending_approval' &&
              fsDoc?.accountStatus === 'pending_approval' &&
              (!fsUpdated || !rtdbUpdated || rtdbUpdated >= fsUpdated)
          );
          if (rtdbIsNewer || rtdbResolvedWhileFsPending) {
            Object.assign(mergedRaw, rtdbDoc);
          }

          let resolvedProfile = buildResolvedUserProfile(mergedRaw, user);

          // Ensure verified bootstrap Super Admin owner is never trapped in pending_approval unless explicitly deactivated
          if (
            isBootstrapSuperAdminOwner &&
            resolvedProfile.accountStatus !== 'deactivated' &&
            (resolvedProfile.accountStatus !== 'active' ||
              resolvedProfile.role !== 'super_admin')
          ) {
            const nowIso = new Date().toISOString();
            resolvedProfile = {
              ...resolvedProfile,
              role: 'super_admin',
              rbacGroup: 'Admin',
              roleTitle: 'Super Admin / System Owner',
              designation: 'Super Admin / System Owner',
              department: 'Executive Management & IT',
              accountStatus: 'active',
              status: 'Active',
              isDepartmentHead: true,
              managedDepartment: 'Executive Management & IT',
              approvedByUid: user.uid,
              approvedByEmail: normalizedAuthEmail,
              approvedByName: resolvedProfile.name,
              approvedAt: resolvedProfile.approvedAt || nowIso,
              updatedAt: nowIso,
              permissions: ROLE_PERMISSION_DEFAULTS.super_admin,
              dataOrigin: 'production',
            };
            firestoreService.syncOwnActiveProfileToFirestore(resolvedProfile).catch(() => {});
          }

          setCurrentUser(resolvedProfile);

          // If active in RTDB/memory but missing or stale in Firestore, sync active profile to Firestore
          if (
            resolvedProfile.accountStatus === 'active' &&
            (!fsDoc || fsDoc.accountStatus !== 'active')
          ) {
            firestoreService.syncOwnActiveProfileToFirestore(resolvedProfile).catch(() => {});
          }
          // If pending in RTDB but missing in Firestore, ensure pending request exists in Firestore
          if (resolvedProfile.accountStatus === 'pending_approval' && !fsDoc && isFirestoreConfigured) {
            firestoreService
              .upsertSelfPendingAccessRequestToFirestore(
                mapUserProfileToFirestoreDoc(resolvedProfile)
              )
              .catch(() => {});
          }
        } else if (isBootstrapSuperAdminOwner) {
          // Verified bootstrap Super Admin signing in with no existing document: bootstrap active super_admin profile
          const displayName =
            user.displayName || 'Ansh Yadav (Super Admin)';
          const nowIso = new Date().toISOString();
          const ownerProfile: UserProfile = {
            id: user.uid,
            uid: user.uid,
            name: displayName,
            displayName,
            email: normalizedAuthEmail,
            role: 'super_admin',
            rbacGroup: 'Admin',
            roleTitle: 'Super Admin / System Owner',
            designation: 'Super Admin / System Owner',
            department: 'Executive Management & IT',
            avatarInitials: 'AY',
            accountStatus: 'active',
            isDepartmentHead: true,
            managedDepartment: 'Executive Management & IT',
            approvedByUid: user.uid,
            approvedByEmail: normalizedAuthEmail,
            approvedByName: displayName,
            approvedAt: nowIso,
            createdAt: nowIso,
            updatedAt: nowIso,
            lastLoginAt: nowIso,
            approvalHistory: [
              {
                status: 'active',
                actorUid: user.uid,
                actorEmail: normalizedAuthEmail,
                actorName: displayName,
                timestamp: nowIso,
                roleAssigned: 'super_admin',
                departmentAssigned: 'Executive Management & IT',
                notes: 'Verified Bootstrap Super Admin owner profile initialized.',
              },
            ],
            permissions: ROLE_PERMISSION_DEFAULTS.super_admin,
            dataOrigin: 'production',
          };
          setCurrentUser(ownerProfile);
          if (isFirestoreConfigured) {
            firestoreService.syncOwnActiveProfileToFirestore(ownerProfile).catch(() => {});
          }
        } else {
          // Profile does not exist in Firestore or RTDB yet — create a canonical pending_approval request
          // so the employee immediately appears in the Super Admin Employee Approval Queue, with ZERO permissions.
          const displayName =
            user.displayName || user.email?.split('@')[0] || 'Pending Employee';
          const email = normalizedAuthEmail;
          const nowIso = new Date().toISOString();
          const initials = displayName
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2) || 'PE';

          const autoPendingProfile: UserProfile = {
            id: user.uid,
            uid: user.uid,
            name: displayName,
            displayName,
            email,
            role: 'sales',
            requestedRole: 'sales',
            requestedDepartment: 'Sales & Marketing',
            rbacGroup: 'Sales',
            roleTitle: 'Pending Admin Approval (Requested: SALES — Sales & Marketing)',
            designation: 'Pending Admin Approval',
            department: 'Sales & Marketing',
            avatarInitials: initials,
            accountStatus: 'pending_approval',
            createdAt: nowIso,
            updatedAt: nowIso,
            lastLoginAt: nowIso,
            approvalHistory: [
              {
                status: 'pending_approval',
                actorUid: user.uid,
                actorEmail: email,
                actorName: displayName,
                timestamp: nowIso,
                notes: 'Authenticated session initiated; pending Super Admin approval.',
              },
            ],
            permissions: [],
            dataOrigin: 'production',
          };

          setCurrentUser(autoPendingProfile);

          // Persist to Firestore & RTDB as pending_approval (never active!) so Admin Approval Queue sees it
          if (isFirestoreConfigured) {
            firestoreService
              .upsertSelfPendingAccessRequestToFirestore(
                mapUserProfileToFirestoreDoc(autoPendingProfile)
              )
              .catch(() => {});
          }
          try {
            await set(ref(rtdb, `users/${user.uid}`), {
              id: user.uid,
              uid: user.uid,
              name: displayName,
              displayName,
              email,
              role: 'Unassigned',
              legacyRole: 'sales',
              requestedRole: 'sales',
              requestedDepartment: 'Sales & Marketing',
              rbacGroup: 'Sales',
              roleTitle: autoPendingProfile.roleTitle,
              department: 'Sales & Marketing',
              avatarInitials: initials,
              accountStatus: 'pending_approval',
              createdAt: nowIso,
              updatedAt: nowIso,
              lastLoginAt: nowIso,
              approvalHistory: autoPendingProfile.approvalHistory,
              permissions: [],
            });
          } catch {
            // Ignore if RTDB write blocked
          }
        }

        // Subscribe to real-time updates on own Firestore /users/{uid} document so live Super Admin approvals reflect immediately
        if (isFirestoreConfigured && DATA_BACKEND_MODE === 'firestore') {
          try {
            unsubOwnFirestoreProfile = onFirestoreSnapshot(
              fsDocRef(firestore, 'users', user.uid),
              (docSnap) => {
                if (!docSnap.exists()) return;
                const fsData = { id: docSnap.id, ...docSnap.data() };
                setCurrentUser(buildResolvedUserProfile(fsData, user));
              },
              () => {
                // Ignore snapshot listener error if permissions change
              }
            );
          } catch {
            // Ignore Firestore listener setup error
          }
        }

        // Subscribe to real-time updates on own RTDB user node so live Admin approvals reflect immediately
        try {
          unsubOwnProfile = onValue(ref(rtdb, `users/${user.uid}`), async (snap) => {
            if (!snap.exists()) return;
            const rtdbVal = snap.val();
            let latestFs: Record<string, any> | null = null;
            if (isFirestoreConfigured && DATA_BACKEND_MODE === 'firestore') {
              const fsCheck = await firestoreService.getUserProfile(user.uid).catch(() => null);
              if (fsCheck?.success && fsCheck.data) {
                latestFs = fsCheck.data;
              }
            }
            const combined = {
              ...rtdbVal,
              ...(latestFs || {}),
            };
            if (
              rtdbVal?.accountStatus &&
              latestFs?.accountStatus &&
              rtdbVal.updatedAt &&
              latestFs.updatedAt &&
              String(rtdbVal.updatedAt) > String(latestFs.updatedAt)
            ) {
              Object.assign(combined, rtdbVal);
            }
            setCurrentUser(buildResolvedUserProfile(combined, user));
          });
        } catch {
          // Ignore listener error
        }
      } catch {
        setCurrentUser({
          id: user.uid,
          uid: user.uid,
          name: user.displayName || user.email?.split('@')[0] || 'Pending Employee',
          email: user.email || '',
          role: 'sales',
          requestedRole: 'sales',
          requestedDepartment: 'Sales & Marketing',
          rbacGroup: 'Sales',
          roleTitle: 'Pending Admin Approval',
          department: 'Pending Provisioning',
          avatarInitials: (user.displayName || user.email || 'UP').slice(0, 2).toUpperCase(),
          accountStatus: 'pending_approval',
          createdAt: new Date().toISOString().split('T')[0],
          permissions: [],
        });
      }
      setAuthLoading(false);
    });

    return () => {
      if (unsubOwnProfile) unsubOwnProfile();
      if (unsubOwnFirestoreProfile) unsubOwnFirestoreProfile();
      unsubAuth();
    };
  }, [buildResolvedUserProfile, clearProductionCollections]);

  const refreshFirestoreSnapshot = useCallback(async () => {
    if (!firebaseUser || currentUser.accountStatus !== 'active') {
      return;
    }
    const snap = await cutoverEngine.loadProductionSnapshot(currentUser);
    const role = currentUser.role;
    const unresolvedWarnings = new Set<string>(snap.warnings);

    // Live Authenticated RTDB–Firestore Reconciliation (R-1 Fix):
    // Reconciles Cloud Firestore records and Firebase Realtime Database records by ID
    // with Firestore precedence, so RTDB-only records never disappear when Firestore
    // contains a partial subset of records.
    // NEVER falls back to MOCK_* or demo sandbox fixtures!
    const readLiveRtdbArrayIfPermitted = async <T extends Record<string, any>>(
      collectionKey: Parameters<typeof canRoleReadCollection>[1],
      rtdbPath: string,
      firestoreItems: T[],
      warningPrefix: string,
      idField: keyof T = 'id' as keyof T
    ): Promise<T[]> => {
      if (!canRoleReadCollection(role, collectionKey)) {
        unresolvedWarnings.delete(warningPrefix);
        return [];
      }
      try {
        const rtdbSnap = await get(ref(rtdb, rtdbPath));
        for (const w of Array.from(unresolvedWarnings)) {
          if (w.startsWith(`/${collectionKey}:`)) {
            unresolvedWarnings.delete(w);
          }
        }
        const rtdbItems = rtdbSnap.exists() ? recordToArray<T>(rtdbSnap.val(), []) : [];
        if (firestoreItems.length === 0) {
          return rtdbItems;
        }
        if (rtdbItems.length === 0) {
          return firestoreItems;
        }
        return reconcileRecordsById<T>(firestoreItems, rtdbItems, idField);
      } catch {
        return firestoreItems;
      }
    };

    const [
      liveCustomers,
      liveProducts,
      liveSalesOrders,
      liveRawMaterialsRaw,
      liveStockMovements,
      liveQualityInspections,
      liveDispatches,
      liveOutstandingAgeing,
      liveActionQueue,
      liveSuppliers,
      liveJobCostSheets,
      liveQuotations,
      liveTenders,
      livePurchaseOrders,
      liveMachineLogs,
      liveFurnaceLogs,
      liveMaintenanceTickets,
      livePowerLogs,
      liveDimensionalReports,
      liveUsers,
      liveAuditLogs,
    ] = await Promise.all([
      readLiveRtdbArrayIfPermitted<Customer>('customers', 'customers', snap.customers, '/customers:'),
      readLiveRtdbArrayIfPermitted<Product>('products', 'products', snap.products, '/products:'),
      readLiveRtdbArrayIfPermitted<OrderJourney>('salesOrders', 'salesOrders', snap.salesOrders, '/salesOrders:'),
      readLiveRtdbArrayIfPermitted<RawMaterialStock>(
        'rawMaterials',
        'inventory/rawMaterials',
        snap.rawMaterials,
        '/rawMaterials:'
      ),
      readLiveRtdbArrayIfPermitted<StockMovement>(
        'stockMovements',
        'inventory/stockMovements',
        snap.stockMovements,
        '/stockMovements:'
      ),
      readLiveRtdbArrayIfPermitted<QualityInspectionRecord>(
        'qualityInspections',
        'quality/inspections',
        snap.qualityInspections,
        '/qualityInspections:'
      ),
      readLiveRtdbArrayIfPermitted<DispatchConsignmentRecord>(
        'dispatches',
        'dispatch',
        snap.dispatches,
        '/dispatches:'
      ),
      readLiveRtdbArrayIfPermitted<OutstandingAgeingRecord>(
        'outstandingPayments',
        'outstandingPayments',
        snap.outstandingAgeing,
        '/outstandingPayments:',
        'customerId'
      ),
      readLiveRtdbArrayIfPermitted<ActionQueueItem>(
        'actionQueue',
        'alerts/actionQueue',
        snap.actionQueue,
        '/actionQueue:'
      ),
      readLiveRtdbArrayIfPermitted<SteelMillSupplier>(
        'suppliers',
        'suppliers',
        snap.suppliers,
        '/suppliers:'
      ),
      readLiveRtdbArrayIfPermitted<JobCostSheet>(
        'jobCostSheets',
        'jobCostSheets',
        snap.jobCostSheets,
        '/jobCostSheets:',
        'jobNumber'
      ),
      readLiveRtdbArrayIfPermitted<QuotationRecord>(
        'quotations',
        'quotations',
        snap.quotations,
        '/quotations:'
      ),
      readLiveRtdbArrayIfPermitted<TenderRecord>('tenders', 'tenders', snap.tenders, '/tenders:'),
      readLiveRtdbArrayIfPermitted<PurchaseOrderRecord>(
        'purchaseOrders',
        'purchaseOrders',
        snap.purchaseOrders,
        '/purchaseOrders:'
      ),
      readLiveRtdbArrayIfPermitted<ShopMachineLog>(
        'machineLogs',
        'machineLogs',
        snap.machineLogs,
        '/machineLogs:'
      ),
      readLiveRtdbArrayIfPermitted<FurnaceBatchLog>(
        'furnaceLogs',
        'furnaceLogs',
        snap.furnaceLogs,
        '/furnaceLogs:'
      ),
      readLiveRtdbArrayIfPermitted<MachineMaintenanceTicket>(
        'maintenanceTickets',
        'maintenanceTickets',
        snap.maintenanceTickets,
        '/maintenanceTickets:'
      ),
      readLiveRtdbArrayIfPermitted<PowerConsumptionLog>(
        'powerLogs',
        'powerLogs',
        snap.powerLogs,
        '/powerLogs:'
      ),
      readLiveRtdbArrayIfPermitted<DimensionalInspectionReport>(
        'dimensionalReports',
        'dimensionalReports',
        snap.dimensionalReports,
        '/dimensionalReports:'
      ),
      readLiveRtdbArrayIfPermitted<UserProfile>('users', 'users', snap.users, '/users:'),
      readLiveRtdbArrayIfPermitted<AuditLogEntry>(
        'auditLogs',
        'auditLogs',
        snap.auditLogs,
        '/auditLogs:'
      ),
    ]);

    const liveRawMaterials = liveRawMaterialsRaw.map(normalizeRawMaterialWithComputedStatus);

    setCustomers(liveCustomers);
    setProducts(liveProducts);
    setSalesOrders(liveSalesOrders);
    setRawMaterials(liveRawMaterials);
    setStockMovements(liveStockMovements);
    setQualityInspections(liveQualityInspections);
    setDispatches(liveDispatches);
    setOutstandingAgeing(liveOutstandingAgeing);
    setActionQueue(liveActionQueue);
    setSuppliers(liveSuppliers);
    setJobCostSheets(liveJobCostSheets);
    setQuotations(liveQuotations);
    setTenders(liveTenders);
    setPurchaseOrders(livePurchaseOrders);
    setMachineLogs(liveMachineLogs);
    setFurnaceLogs(liveFurnaceLogs);
    setMaintenanceTickets(liveMaintenanceTickets);
    setPowerLogs(livePowerLogs);
    setDimensionalReports(liveDimensionalReports);
    setTasks(snap.tasks);
    setHandovers(snap.handovers);
    setPurchaseRequisitions(snap.purchaseRequisitions);
    setNcrCapaRecords(snap.ncrCapaRecords);
    setPaymentFollowUps(snap.paymentFollowUps);
    setAlertThresholds(snap.alertThresholds);

    setDashboardKpis(
      computeLiveDashboardKpis({
        baseKpis: snap.dashboardKpis,
        salesOrders: liveSalesOrders,
        rawMaterials: liveRawMaterials,
        outstandingAgeing: liveOutstandingAgeing,
        dispatches: liveDispatches,
      })
    );
    setProductionSummary(
      computeLiveProductionSummary({
        baseSummary: snap.productionSummary,
        qualityInspections: liveQualityInspections,
        machineLogs: liveMachineLogs,
      })
    );

    if (liveUsers.length > 0) {
      setUsersList(liveUsers);
    } else if (currentUser) {
      setUsersList([currentUser]);
    }
    if (liveAuditLogs.length > 0) {
      setAuditLogs(liveAuditLogs);
    }
    setIsRtdbConnected(true);
    setDataSource('live_rtdb');
    setLastSyncedAt(new Date().toLocaleTimeString());

    // Suppress warnings for newly added collections if live Firestore rules have not been deployed yet
    for (const w of Array.from(unresolvedWarnings)) {
      if (
        w.startsWith('/tasks:') ||
        w.startsWith('/handovers:') ||
        w.startsWith('/purchaseRequisitions:') ||
        w.startsWith('/ncrCapaRecords:') ||
        w.startsWith('/paymentFollowUps:') ||
        (role === 'sales' && w.startsWith('/outstandingPayments:'))
      ) {
        unresolvedWarnings.delete(w);
      }
    }

    const remainingWarnings = Array.from(unresolvedWarnings);
    if (remainingWarnings.length > 0) {
      setRtdbError(remainingWarnings[0]);
    } else {
      setRtdbError(null);
    }
  }, [firebaseUser, currentUser]);

  // Load Authorized Data from Cloud Firestore (Primary) or RTDB (Rollback)
  useEffect(() => {
    if (!firebaseUser) {
      setDataSource('fallback_seed');
      return;
    }

    if (currentUser.accountStatus !== 'active') {
      clearProductionCollections();
      setDataSource('live_rtdb');
      setRtdbError(
        `Account status is "${currentUser.accountStatus}". Only active employee accounts with an assigned RBAC role can access protected production collections.`
      );
      return;
    }

    if (DATA_BACKEND_MODE === 'firestore' && isFirestoreConfigured) {
      refreshFirestoreSnapshot();
      return;
    }

    // Rollback Mode: RTDB listeners (still enforcing zero demo fallback when authenticated!)
    const connectedRef = ref(rtdb, '.info/connected');
    const unsubConnected = onValue(
      connectedRef,
      (snap) => setIsRtdbConnected(Boolean(snap.val())),
      () => setIsRtdbConnected(false)
    );
    const unsubs: Unsubscribe[] = [unsubConnected];

    unsubs.push(
      onValue(ref(rtdb, 'salesOrders'), (snap) => {
        setDataSource('live_rtdb');
        setSalesOrders(snap.exists() ? recordToArray(snap.val(), []) : []);
      })
    );
    unsubs.push(
      onValue(ref(rtdb, 'inventory/rawMaterials'), (snap) => {
        setRawMaterials(
          snap.exists()
            ? recordToArray(snap.val(), []).map(normalizeRawMaterialWithComputedStatus)
            : []
        );
      })
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [
    firebaseUser,
    currentUser,
    clearProductionCollections,
    refreshFirestoreSnapshot,
  ]);

  // Keep live KPIs synchronized when production records change in state
  useEffect(() => {
    if (!firebaseUser || currentUser.accountStatus !== 'active') return;
    setDashboardKpis((prev) =>
      computeLiveDashboardKpis({
        baseKpis: prev,
        salesOrders,
        rawMaterials,
        outstandingAgeing,
        dispatches,
      })
    );
    setProductionSummary((prev) =>
      computeLiveProductionSummary({
        baseSummary: prev,
        qualityInspections,
        machineLogs,
      })
    );
  }, [
    firebaseUser,
    currentUser.accountStatus,
    salesOrders,
    rawMaterials,
    outstandingAgeing,
    dispatches,
    qualityInspections,
    machineLogs,
  ]);

  // ==========================================================================
  // PERSISTENT OPERATIONAL REGISTER & MODULE ACTIONS
  // ==========================================================================

  const createQuotationRecord = async (quote: QuotationRecord) => {
    const res = await cutoverEngine.createQuotation(quote, currentUser, isDemoMode);
    if (res.success && res.data) {
      const saved = res.data;
      setQuotations((prev) =>
        prev.some((q) => q.id === saved.id) ? prev : [saved, ...prev]
      );
    }
    return res;
  };

  const updateQuotationRecord = async (quote: QuotationRecord) => {
    const res = await cutoverEngine.updateQuotation(quote, currentUser, isDemoMode);
    if (res.success && res.data) {
      const saved = res.data;
      setQuotations((prev) => prev.map((q) => (q.id === saved.id ? saved : q)));
    }
    return res;
  };

  const convertQuotationToOrderRecord = async (
    updatedQuote: QuotationRecord,
    newOrder: OrderJourney
  ) => {
    const res = await cutoverEngine.convertQuotationToOrder(
      updatedQuote,
      newOrder,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const { quotation, order } = res.data;
      setQuotations((prev) => prev.map((q) => (q.id === quotation.id ? quotation : q)));
      setSalesOrders((prev) =>
        prev.some((o) => o.id === order.id) ? prev : [order, ...prev]
      );
    }
    return res;
  };

  const createTenderRecord = async (tender: TenderRecord) => {
    const res = await cutoverEngine.createTender(tender, currentUser, isDemoMode);
    if (res.success && res.data) {
      const saved = res.data;
      setTenders((prev) =>
        prev.some((t) => t.id === saved.id) ? prev : [saved, ...prev]
      );
    }
    return res;
  };

  const createPurchaseOrderRecord = async (po: PurchaseOrderRecord) => {
    const res = await cutoverEngine.createPurchaseOrder(po, currentUser, isDemoMode);
    if (res.success && res.data) {
      const saved = res.data;
      setPurchaseOrders((prev) =>
        prev.some((p) => p.id === saved.id) ? prev : [saved, ...prev]
      );
    }
    return res;
  };

  const receivePurchaseOrderGrnRecord = async (params: {
    po: PurchaseOrderRecord;
    material: RawMaterialStock;
    receiptQtyMt: number;
    heatNumber: string;
    grnNumber: string;
  }) => {
    const res = await cutoverEngine.receivePurchaseOrderGrn({
      ...params,
      user: currentUser,
      isDemoMode,
    });
    if (res.success && res.data) {
      const { updatedPo, updatedMaterial, movement } = res.data;
      setPurchaseOrders((prev) =>
        prev.map((p) => (p.id === updatedPo.id ? updatedPo : p))
      );
      setRawMaterials((prev) =>
        prev.map((m) => (m.id === updatedMaterial.id ? updatedMaterial : m))
      );
      setStockMovements((prev) =>
        prev.some((m) => m.id === movement.id) ? prev : [movement, ...prev]
      );
    }
    return res;
  };

  const createMachineLogRecord = async (log: ShopMachineLog) => {
    const res = await cutoverEngine.createMachineLog(log, currentUser, isDemoMode);
    if (res.success && res.data) {
      const saved = res.data;
      setMachineLogs((prev) =>
        prev.some((m) => m.id === saved.id) ? prev : [saved, ...prev]
      );
    }
    return res;
  };

  const createFurnaceLogRecord = async (batch: FurnaceBatchLog) => {
    const res = await cutoverEngine.createFurnaceLog(batch, currentUser, isDemoMode);
    if (res.success && res.data) {
      const saved = res.data;
      setFurnaceLogs((prev) =>
        prev.some((b) => b.id === saved.id) ? prev : [saved, ...prev]
      );
    }
    return res;
  };

  const createMaintenanceTicketRecord = async (ticket: MachineMaintenanceTicket) => {
    const res = await cutoverEngine.createMaintenanceTicket(
      ticket,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const saved = res.data;
      setMaintenanceTickets((prev) =>
        prev.some((t) => t.id === saved.id) ? prev : [saved, ...prev]
      );
    }
    return res;
  };

  const createPowerLogRecord = async (powerLog: PowerConsumptionLog) => {
    const res = await cutoverEngine.createPowerLog(powerLog, currentUser, isDemoMode);
    if (res.success && res.data) {
      const saved = res.data;
      setPowerLogs((prev) =>
        prev.some((p) => p.id === saved.id) ? prev : [saved, ...prev]
      );
    }
    return res;
  };

  const createDimensionalReportRecord = async (dir: DimensionalInspectionReport) => {
    const res = await cutoverEngine.createDimensionalReport(
      dir,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const saved = res.data;
      setDimensionalReports((prev) =>
        prev.some((d) => d.id === saved.id) ? prev : [saved, ...prev]
      );
    }
    return res;
  };

  const createSalesOrderRecord = async (order: OrderJourney) => {
    const res = await cutoverEngine.createSalesOrder(order, currentUser, isDemoMode);
    if (res.success && res.data) {
      const saved = res.data;
      setSalesOrders((prev) =>
        prev.some((o) => o.id === saved.id) ? prev : [saved, ...prev]
      );
    }
    return res;
  };

  const updateSalesOrderRecord = async (order: OrderJourney, changeSummary: string) => {
    const res = await cutoverEngine.updateSalesOrder(
      order,
      changeSummary,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const saved = res.data;
      setSalesOrders((prev) => prev.map((o) => (o.id === saved.id ? saved : o)));
    }
    return res;
  };

  const recordStockMovementRecord = async (params: {
    material: RawMaterialStock;
    quantityDeltaMt: number;
    movementType: StockMovement['movementType'];
    heatNumber: string;
    referenceDoc: string;
  }) => {
    const res = await cutoverEngine.recordStockMovement({
      ...params,
      user: currentUser,
      isDemoMode,
    });
    if (res.success && res.data) {
      const { updatedMaterial, movement } = res.data;
      setRawMaterials((prev) =>
        prev.map((m) => (m.id === updatedMaterial.id ? updatedMaterial : m))
      );
      setStockMovements((prev) =>
        prev.some((m) => m.id === movement.id) ? prev : [movement, ...prev]
      );
    }
    return res;
  };

  const recordQualityInspectionRecord = async (inspection: QualityInspectionRecord) => {
    const res = await cutoverEngine.recordQualityInspection(
      inspection,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const saved = res.data;
      setQualityInspections((prev) =>
        prev.some((q) => q.id === saved.id) ? prev : [saved, ...prev]
      );
    }
    return res;
  };

  const recordDispatchRecord = async (
    dispatchRecord: DispatchConsignmentRecord,
    updatedOrder?: OrderJourney
  ) => {
    const res = await cutoverEngine.recordDispatch(
      dispatchRecord,
      updatedOrder,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const { dispatch, updatedOrder: savedOrder } = res.data;
      setDispatches((prev) =>
        prev.some((d) => d.id === dispatch.id) ? prev : [dispatch, ...prev]
      );
      if (savedOrder) {
        setSalesOrders((prev) =>
          prev.map((o) => (o.id === savedOrder.id ? savedOrder : o))
        );
      }
    }
    return res;
  };

  const recordCustomerPaymentRecord = async (
    record: OutstandingAgeingRecord,
    paymentAmountInr: number,
    utrReference: string
  ) => {
    const res = await cutoverEngine.recordCustomerPayment(
      record,
      paymentAmountInr,
      utrReference,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const saved = res.data;
      setOutstandingAgeing((prev) =>
        prev.map((a) => (a.customerId === saved.customerId ? saved : a))
      );
    }
    return res;
  };

  const upsertCustomerRecord = async (customer: Customer, isNew: boolean) => {
    const res = await cutoverEngine.upsertCustomer(
      customer,
      isNew,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const saved = res.data;
      if (!isDemoMode && firebaseUser) {
        set(ref(rtdb, `customers/${saved.id}`), saved).catch(() => {});
      }
      setCustomers((prev) =>
        isNew ? [saved, ...prev] : prev.map((c) => (c.id === saved.id ? saved : c))
      );
      return res;
    }

    // If caller is authorized in live session, but Cloud Firestore rule deployment is still pending,
    // persist to live authenticated Firebase Realtime Database (/customers/{id}) and verify write.
    const canWriteCustomerLive =
      !isDemoMode &&
      Boolean(firebaseUser) &&
      currentUser.accountStatus === 'active' &&
      ['super_admin', 'ceo', 'sales', 'finance'].includes(currentUser.role);

    if (canWriteCustomerLive && res.code === 'PERMISSION_DENIED') {
      try {
        const custRef = ref(rtdb, `customers/${customer.id}`);
        await set(custRef, customer);
        const verifySnap = await get(custRef);
        if (verifySnap.exists()) {
          const verifiedCustomer = verifySnap.val() as Customer;
          setCustomers((prev) =>
            isNew
              ? [verifiedCustomer, ...prev]
              : prev.map((c) => (c.id === verifiedCustomer.id ? verifiedCustomer : c))
          );
          return {
            success: true,
            persistedToFirestore: false,
            persistedToRtdb: true,
            code: 'PERSISTED_TO_LIVE_RTDB',
            data: verifiedCustomer,
          };
        }
      } catch (rtdbErr: any) {
        return {
          success: false,
          persistedToFirestore: false,
          persistedToRtdb: false,
          code: 'PERMISSION_DENIED',
          error: rtdbErr?.message || res.error,
        };
      }
    }
    return res;
  };

  const upsertProductRecord = async (product: Product, isNew: boolean) => {
    const res = await cutoverEngine.upsertProduct(
      product,
      isNew,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const saved = res.data;
      if (!isDemoMode && firebaseUser) {
        set(ref(rtdb, `products/${saved.id}`), saved).catch(() => {});
      }
      setProducts((prev) =>
        isNew ? [saved, ...prev] : prev.map((p) => (p.id === saved.id ? saved : p))
      );
      return res;
    }

    const canWriteProductLive =
      !isDemoMode &&
      Boolean(firebaseUser) &&
      currentUser.accountStatus === 'active' &&
      ['super_admin', 'ceo', 'sales', 'quality'].includes(currentUser.role);

    if (canWriteProductLive && res.code === 'PERMISSION_DENIED') {
      try {
        const prodRef = ref(rtdb, `products/${product.id}`);
        await set(prodRef, product);
        const verifySnap = await get(prodRef);
        if (verifySnap.exists()) {
          const verifiedProduct = verifySnap.val() as Product;
          setProducts((prev) =>
            isNew
              ? [verifiedProduct, ...prev]
              : prev.map((p) => (p.id === verifiedProduct.id ? verifiedProduct : p))
          );
          return {
            success: true,
            persistedToFirestore: false,
            persistedToRtdb: true,
            code: 'PERSISTED_TO_LIVE_RTDB',
            data: verifiedProduct,
          };
        }
      } catch (rtdbErr: any) {
        return {
          success: false,
          persistedToFirestore: false,
          persistedToRtdb: false,
          code: 'PERMISSION_DENIED',
          error: rtdbErr?.message || res.error,
        };
      }
    }
    return res;
  };

  const deleteCustomerRecord = async (customerId: string) => {
    const targetCustomer =
      customers.find((c) => c.id === customerId) || {
        id: customerId,
        code: customerId,
        name: customerId,
        contactPerson: '-',
        phone: '-',
        email: 'customer@montex.in',
        location: '-',
        industry: '-',
        creditLimit: 0,
        creditDays: 30,
        assignedSalesPerson: '-',
        active: false,
        totalOrders: 0,
        totalOutstanding: 0,
      };
    const activeOrdersCount =
      salesOrders.filter((o) => o.customerId === customerId || o.customerName === targetCustomer.name).length +
      quotations.filter((q) => q.customerId === customerId || q.customerName === targetCustomer.name).length;

    const res = await cutoverEngine.deleteCustomerRecord(
      targetCustomer,
      activeOrdersCount,
      currentUser,
      isDemoMode
    );
    if (res.success) {
      if (!isDemoMode && firebaseUser) {
        remove(ref(rtdb, `customers/${customerId}`)).catch(() => {});
      }
      setCustomers((prev) => prev.filter((c) => c.id !== customerId));
      return res;
    }

    const canDeleteLive =
      !isDemoMode &&
      Boolean(firebaseUser) &&
      currentUser.accountStatus === 'active' &&
      ['super_admin', 'ceo'].includes(currentUser.role) &&
      activeOrdersCount === 0 &&
      (targetCustomer.totalOutstanding || 0) <= 0;

    if (
      canDeleteLive &&
      (res.code === 'PERMISSION_DENIED' || res.code === 'FIRESTORE_OPERATION_FAILED')
    ) {
      try {
        await remove(ref(rtdb, `customers/${customerId}`));
        setCustomers((prev) => prev.filter((c) => c.id !== customerId));
        return {
          success: true,
          persistedToFirestore: false,
          persistedToRtdb: true,
          code: 'DELETED_FROM_LIVE_RTDB',
          data: { deletedId: customerId },
        };
      } catch {
        return res;
      }
    }
    return res;
  };

  const deleteProductRecord = async (productId: string) => {
    const targetProduct =
      products.find((p) => p.id === productId) || {
        id: productId,
        code: productId,
        name: productId,
        category: 'Flange',
        size: '-',
        materialGrade: 'ASTM A105',
        standard: 'ASME B16.5',
        uom: 'PCS',
        standardWeightKg: 10,
        hsnCode: '73079100',
        standardSellingPrice: 1000,
      };
    const activeOrdersCount =
      salesOrders.filter((o) =>
        o.lineItems?.some((li) => li.productId === productId || li.productName === targetProduct.name)
      ).length +
      quotations.filter((q) => q.productId === productId || q.productName === targetProduct.name).length;

    const res = await cutoverEngine.deleteProductRecord(
      targetProduct,
      activeOrdersCount,
      currentUser,
      isDemoMode
    );
    if (res.success) {
      if (!isDemoMode && firebaseUser) {
        remove(ref(rtdb, `products/${productId}`)).catch(() => {});
      }
      setProducts((prev) => prev.filter((p) => p.id !== productId));
      return res;
    }

    const canDeleteLive =
      !isDemoMode &&
      Boolean(firebaseUser) &&
      currentUser.accountStatus === 'active' &&
      ['super_admin', 'ceo'].includes(currentUser.role) &&
      activeOrdersCount === 0;

    if (
      canDeleteLive &&
      (res.code === 'PERMISSION_DENIED' || res.code === 'FIRESTORE_OPERATION_FAILED')
    ) {
      try {
        await remove(ref(rtdb, `products/${productId}`));
        setProducts((prev) => prev.filter((p) => p.id !== productId));
        return {
          success: true,
          persistedToFirestore: false,
          persistedToRtdb: true,
          code: 'DELETED_FROM_LIVE_RTDB',
          data: { deletedId: productId },
        };
      } catch {
        return res;
      }
    }
    return res;
  };

  const saveAlertThresholdsRecord = async (thresholds: RtdbAlertThresholds) => {
    const res = await cutoverEngine.saveAlertThresholds(
      thresholds,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      setAlertThresholds(res.data);
    }
    return res;
  };

  const acknowledgeAlertRecord = async (item: ActionQueueItem) => {
    const res = await cutoverEngine.acknowledgeAlert(item, currentUser, isDemoMode);
    if (res.success && res.data) {
      const saved = res.data;
      setActionQueue((prev) => prev.map((a) => (a.id === saved.id ? saved : a)));
    }
    return res;
  };

  // ==========================================================================
  // ENTERPRISE AUTOMATION, ACCOUNTABILITY, HANDOVER & APPROVAL ACTIONS
  // ==========================================================================

  const upsertTaskRecord = async (task: TaskRecord, isNew: boolean = false) => {
    const res = await cutoverEngine.upsertTaskRecord(
      task,
      isNew,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const saved = res.data;
      setTasks((prev) =>
        isNew ? [saved, ...prev] : prev.map((t) => (t.id === saved.id ? saved : t))
      );
    }
    return res;
  };

  const submitTaskForVerificationRecord = async (
    task: TaskRecord,
    submissionNotes: string
  ) => {
    const nowIso = new Date().toISOString();
    const updatedTask: TaskRecord = {
      ...task,
      status: 'submitted_for_verification',
      submissionNotes: submissionNotes.trim() || 'Completed and submitted for supervisor verification.',
      submittedAt: nowIso,
      updatedAt: nowIso,
    };
    return upsertTaskRecord(updatedTask, false);
  };

  const verifyTaskRecord = async (
    task: TaskRecord,
    approved: boolean,
    verificationRemarks: string
  ) => {
    const canVerify = canActorVerifyDepartmentTask({
      actorUid: currentUser.id,
      actorRole: currentUser.role,
      actorStatus: currentUser.accountStatus,
      actorDepartment: currentUser.department,
      isDepartmentHead: currentUser.isDepartmentHead,
      managedDepartment: currentUser.managedDepartment,
      taskDepartment: task.department,
      taskAssignedToUid: task.assignedToUid,
    });

    if (!canVerify.allowed) {
      return {
        success: false,
        persistedToFirestore: false,
        persistedToRtdb: false,
        code: 'SOD_MAKER_CHECKER_VIOLATION',
        error:
          canVerify.reason ||
          'Separation of Duties (Maker ≠ Checker): An employee cannot self-verify their own task. Verification requires the Department Head, CEO, or Super Admin.',
      };
    }

    const nowIso = new Date().toISOString();
    const updatedTask: TaskRecord = {
      ...task,
      status: approved ? 'verified_approved' : 'rejected_rework',
      verifiedByUid: currentUser.id,
      verifiedByName: currentUser.name,
      verifiedAt: nowIso,
      verificationRemarks:
        verificationRemarks.trim() ||
        (approved ? 'Verified and approved.' : 'Returned for rework.'),
      updatedAt: nowIso,
    };
    return upsertTaskRecord(updatedTask, false);
  };

  const initiateHandoverRecord = async (handover: HandoverRecord) => {
    const res = await cutoverEngine.upsertHandoverRecord(
      handover,
      true,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const saved = res.data;
      setHandovers((prev) =>
        prev.some((h) => h.id === saved.id) ? prev : [saved, ...prev]
      );
    }
    return res;
  };

  const resolveHandoverRecord = async (
    handover: HandoverRecord,
    accepted: boolean,
    remarks: string
  ) => {
    const canResolve = canActorAcceptOrRejectHandover({
      actorUid: currentUser.id,
      actorRole: currentUser.role,
      actorStatus: currentUser.accountStatus,
      actorDepartment: currentUser.department,
      initiatedByUid: handover.initiatedByUid,
      toDepartment: handover.toDepartment,
    });

    if (!canResolve.allowed) {
      return {
        success: false,
        persistedToFirestore: false,
        persistedToRtdb: false,
        code: 'DUAL_CUSTODY_VIOLATION',
        error:
          canResolve.reason ||
          `Dual-Custody Handover Rule: The initiator (${handover.initiatedByName}) cannot self-accept their own handover, and the receiver must belong to ${handover.toDepartment} (or be CEO/Super Admin).`,
      };
    }

    const nowIso = new Date().toISOString();
    const updatedHandover: HandoverRecord = {
      ...handover,
      status: accepted ? 'accepted' : 'rejected',
      receivedByUid: currentUser.id,
      receivedByName: currentUser.name,
      remarks: remarks.trim() || (accepted ? 'Custody accepted.' : 'Custody rejected.'),
      resolvedAt: nowIso,
    };

    const res = await cutoverEngine.upsertHandoverRecord(
      updatedHandover,
      false,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const saved = res.data;
      setHandovers((prev) => prev.map((h) => (h.id === saved.id ? saved : h)));
    }
    return res;
  };

  const createPurchaseRequisitionRecord = async (pr: PurchaseRequisitionRecord) => {
    const res = await cutoverEngine.upsertPurchaseRequisitionRecord(
      pr,
      true,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const saved = res.data;
      setPurchaseRequisitions((prev) =>
        prev.some((p) => p.id === saved.id) ? prev : [saved, ...prev]
      );
    }
    return res;
  };

  const approvePurchaseRequisitionRecord = async (
    pr: PurchaseRequisitionRecord,
    approved: boolean,
    remarks?: string
  ) => {
    const canApprove = canActorApprovePurchaseRequisition({
      actorUid: currentUser.id,
      actorRole: currentUser.role,
      actorStatus: currentUser.accountStatus,
      isDepartmentHead: currentUser.isDepartmentHead,
      requestedByUid: pr.requestedByUid,
    });

    if (!canApprove.allowed) {
      return {
        success: false,
        persistedToFirestore: false,
        persistedToRtdb: false,
        code: 'SOD_PR_SELF_APPROVAL_BLOCKED',
        error:
          canApprove.reason ||
          'Separation of Duties (Maker ≠ Checker): Purchase Requisition requester cannot self-approve their own requisition.',
      };
    }

    const nowIso = new Date().toISOString();
    const updatedPr: PurchaseRequisitionRecord = {
      ...pr,
      status: approved ? 'approved' : 'rejected',
      approvedByUid: currentUser.id,
      approvedByName: currentUser.name,
      approvedAt: nowIso,
      justification: remarks ? `${pr.justification} | Approval Note: ${remarks}` : pr.justification,
    };

    const res = await cutoverEngine.upsertPurchaseRequisitionRecord(
      updatedPr,
      false,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const saved = res.data;
      setPurchaseRequisitions((prev) =>
        prev.map((p) => (p.id === saved.id ? saved : p))
      );
    }
    return res;
  };

  const upsertNcrCapaRecord = async (ncr: NcrCapaRecord, isNew: boolean = false) => {
    if (!isNew && ncr.status === 'verified_closed') {
      const check = canActorVerifyDepartmentTask({
        actorUid: currentUser.id,
        actorRole: currentUser.role,
        actorStatus: currentUser.accountStatus,
        isDepartmentHead: currentUser.isDepartmentHead,
        taskOwnerUid:
          ncr.raisedByUid ||
          (ncr.raisedByName && ncr.raisedByName === currentUser.name ? currentUser.id : undefined),
        taskDepartmentRole: 'quality',
      });
      if (!check.allowed) {
        return {
          success: false,
          persistedToFirestore: false,
          persistedToRtdb: false,
          code: 'SOD_CAPA_SELF_VERIFY_BLOCKED',
          error:
            check.reason ||
            'Separation of Duties (Maker ≠ Checker): NCR/CAPA creator cannot self-verify closure.',
        };
      }
    }

    const res = await cutoverEngine.upsertNcrCapaRecord(
      ncr,
      isNew,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const saved = res.data;
      setNcrCapaRecords((prev) =>
        isNew ? [saved, ...prev] : prev.map((n) => (n.id === saved.id ? saved : n))
      );
    }
    return res;
  };

  const upsertPaymentFollowUpRecord = async (
    followUp: PaymentFollowUpRecord,
    isNew: boolean = false
  ) => {
    const res = await cutoverEngine.upsertPaymentFollowUpRecord(
      followUp,
      isNew,
      currentUser,
      isDemoMode
    );
    if (res.success && res.data) {
      const saved = res.data;
      setPaymentFollowUps((prev) =>
        isNew ? [saved, ...prev] : prev.map((f) => (f.id === saved.id ? saved : f))
      );
    }
    return res;
  };

  const updateMonthlySalesTargetRecord = async (
    newTargetInr: number
  ): Promise<CutoverWriteResult<{ monthlySalesTarget: number }>> => {
    const check = canActorExecuteExecutiveOverride(currentUser.role, currentUser.accountStatus);
    if (!check.allowed) {
      return {
        success: false,
        persistedToFirestore: false,
        persistedToRtdb: false,
        code: 'PERMISSION_DENIED',
        error:
          check.reason ||
          'Only CEO / Managing Director or Super Admin can update the Monthly Revenue Target.',
      };
    }
    if (newTargetInr <= 0) {
      return {
        success: false,
        persistedToFirestore: false,
        persistedToRtdb: false,
        code: 'VALIDATION_FAILED',
        error: 'Monthly sales target must be greater than zero.',
      };
    }

    const updatedKpis: RtdbDashboardKpis = {
      ...dashboardKpis,
      monthlySalesTarget: newTargetInr,
      lastUpdated: new Date().toISOString(),
    };
    setDashboardKpis(updatedKpis);

    if (!isDemoMode && firebaseUser) {
      try {
        await set(ref(rtdb, 'dashboardKpis'), updatedKpis);
      } catch {
        // Ignore if RTDB write not needed
      }
    }

    return {
      success: true,
      persistedToFirestore: !isDemoMode,
      persistedToRtdb: !isDemoMode,
      code: 'OK',
      data: { monthlySalesTarget: newTargetInr },
    };
  };

  const runSlaAutomationScanRecord = async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    let escalatedTasksCount = 0;
    let newAlertsGenerated = 0;

    const updatedTasks = tasks.map((t) => {
      const currentEsc = typeof t.escalationLevel === 'number' ? t.escalationLevel : 0;
      if (
        t.status !== 'verified_approved' &&
        t.dueDate < todayStr &&
        currentEsc < 3
      ) {
        escalatedTasksCount += 1;
        return {
          ...t,
          escalationLevel: Math.min(3, currentEsc + 1) as 0 | 1 | 2 | 3,
          updatedAt: new Date().toISOString(),
        };
      }
      return t;
    });

    if (escalatedTasksCount > 0) {
      setTasks(updatedTasks);
    }

    // Deduplicated SLA alerts for overdue tasks, pending handovers, and overdue quotations
    const existingRefs = new Set(actionQueue.map((a) => a.associatedRef));
    const newAlerts: ActionQueueItem[] = [];

    for (const t of updatedTasks) {
      const refCode = t.taskNumber || t.taskNo || t.id;
      if (
        t.status !== 'verified_approved' &&
        t.dueDate < todayStr &&
        !existingRefs.has(refCode)
      ) {
        newAlerts.push({
          id: `ALT-SLA-${t.id}`,
          type: 'overdue_order',
          severity: t.priority === 'critical' ? 'critical' : 'high',
          title: `SLA Breach (L${t.escalationLevel}): ${refCode}`,
          description: `${t.title} assigned to ${t.assignedToName} (${t.department}) is overdue since ${t.dueDate}.`,
          associatedRef: refCode,
          customerOrSupplier: t.linkedJobNumber || t.department,
          daysPending: 2,
          suggestedAction: `Supervisor / CEO verification & escalation check for ${t.assignedToName}`,
          assignedToDepartment: t.department as any,
          acknowledged: false,
        });
        existingRefs.add(refCode);
      }
    }

    for (const h of handovers) {
      if (h.status === 'pending_acceptance' && !existingRefs.has(h.id)) {
        newAlerts.push({
          id: `ALT-HND-${h.id}`,
          type: 'quality_hold',
          severity: 'medium',
          title: `Pending ${h.handoverCode} Custody Acceptance (${h.fromDepartment} → ${h.toDepartment})`,
          description: `${h.stageLabel} for Job ${h.jobNumber} (${h.quantityPcs} PCS) is awaiting ${h.toDepartment} acceptance.`,
          associatedRef: h.id,
          customerOrSupplier: h.jobNumber,
          daysPending: 1,
          suggestedAction: `${h.toDepartment} officer to inspect lot and accept/reject handover`,
          assignedToDepartment: h.toDepartment === 'Quality' ? 'Quality' : 'Production',
          acknowledged: false,
        });
        existingRefs.add(h.id);
      }
    }

    if (newAlerts.length > 0) {
      newAlertsGenerated = newAlerts.length;
      setActionQueue((prev) => [...newAlerts, ...prev]);
    }

    return {
      scannedCount: tasks.length + handovers.length + quotations.length,
      escalatedTasksCount,
      newAlertsGenerated,
    };
  };

  // ==========================================================================
  // AUTHENTICATION HANDLERS
  // ==========================================================================

  const submitOrUpdateOwnAccessRequest = async (input: {
    displayName: string;
    department: string;
    requestedRole: UserRole;
    designation?: string;
  }) => {
    const activeAuthUser = auth.currentUser || firebaseUser;
    const targetUid = activeAuthUser?.uid || currentUser.id;
    const targetEmail = (activeAuthUser?.email || currentUser.email || '').trim().toLowerCase();

    if (!targetUid || !targetEmail) {
      return {
        success: false,
        error: 'You must be signed in with Firebase Authentication to submit an access request.',
      };
    }

    if (currentUser.accountStatus === 'active') {
      return {
        success: false,
        error: 'Your account is already active.',
      };
    }

    if (currentUser.accountStatus === 'deactivated') {
      return {
        success: false,
        error: 'Deactivated accounts cannot self-submit access requests. Please contact a Super Admin.',
      };
    }

    if (currentUser.accountStatus === 'rejected') {
      return {
        success: false,
        error:
          'Your access request was rejected by an administrator. Only an authorized administrator can reconsider your account.',
      };
    }

    const safeRole: UserRole =
      isCanonicalUserRole(input.requestedRole) &&
      input.requestedRole !== 'super_admin' &&
      input.requestedRole !== 'ceo'
        ? input.requestedRole
        : 'sales';

    const cleanName = input.displayName.trim() || currentUser.name || 'Employee';
    const cleanDept = input.department.trim() || 'Sales & Marketing';
    const nowIso = new Date().toISOString();
    const initials =
      cleanName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) || 'MU';

    const historyEntry: ApprovalHistoryEntry = {
      status: 'pending_approval',
      actorUid: targetUid,
      actorEmail: targetEmail,
      actorName: cleanName,
      timestamp: nowIso,
      roleAssigned: safeRole,
      departmentAssigned: cleanDept,
      notes: `Employee submitted/updated access request for ${cleanDept} (${safeRole}).`,
    };

    const updatedPendingProfile: UserProfile = {
      ...currentUser,
      id: targetUid,
      uid: targetUid,
      name: cleanName,
      displayName: cleanName,
      email: targetEmail,
      role: safeRole,
      requestedRole: safeRole,
      requestedDepartment: cleanDept,
      rbacGroup: mapRoleToRbacGroup(safeRole),
      roleTitle: `Pending Admin Approval (Requested: ${safeRole.toUpperCase()} — ${cleanDept})`,
      designation: input.designation?.trim() || `Requested: ${safeRole.toUpperCase()}`,
      department: cleanDept,
      avatarInitials: initials,
      accountStatus: 'pending_approval',
      createdAt: currentUser.createdAt || nowIso,
      updatedAt: nowIso,
      approvalHistory: [...(currentUser.approvalHistory || []), historyEntry],
      permissions: [],
      dataOrigin: 'production',
    };

    await submitAccessRequestViaApi({
      displayName: cleanName,
      department: cleanDept,
      requestedRole: safeRole,
      designation: updatedPendingProfile.designation,
    }).catch(() => null);

    let fsSaved = false;
    let rtdbSaved = false;

    if (isFirestoreConfigured) {
      const fsRes = await firestoreService
        .upsertSelfPendingAccessRequestToFirestore(
          mapUserProfileToFirestoreDoc(updatedPendingProfile)
        )
        .catch(() => null);
      if (fsRes?.success) {
        fsSaved = true;
      }
    }

    try {
      await set(ref(rtdb, `users/${targetUid}`), {
        ...updatedPendingProfile,
        role: 'Unassigned',
        legacyRole: safeRole,
      });
      rtdbSaved = true;
    } catch {
      // Ignore RTDB write failure if Firestore succeeded
    }

    if (!fsSaved && !rtdbSaved && !isDemoMode) {
      return {
        success: false,
        error: 'Failed to persist access request to database. Please check your connection or permissions.',
      };
    }

    setCurrentUser(updatedPendingProfile);
    setUsersList((prev) =>
      prev.some((u) => u.id === targetUid)
        ? prev.map((u) => (u.id === targetUid ? updatedPendingProfile : u))
        : [updatedPendingProfile, ...prev]
    );

    return {
      success: true,
      profile: updatedPendingProfile,
    };
  };

  const refreshOwnUserProfile = async () => {
    const activeAuthUser = auth.currentUser || firebaseUser;
    if (!activeAuthUser) {
      return {
        success: false,
        error: 'No active Firebase Authentication session.',
      };
    }

    try {
      let fsDoc: Record<string, any> | null = null;
      let rtdbDoc: Record<string, any> | null = null;

      if (isFirestoreConfigured) {
        const fsRes = await firestoreService.getUserProfile(activeAuthUser.uid);
        if (fsRes.success && fsRes.data) {
          fsDoc = fsRes.data;
        }
      }

      try {
        const rtdbSnap = await get(ref(rtdb, `users/${activeAuthUser.uid}`));
        if (rtdbSnap.exists()) {
          rtdbDoc = rtdbSnap.val();
        }
      } catch {
        // Ignore RTDB error
      }

      if (!fsDoc && !rtdbDoc) {
        return {
          success: false,
          error: 'No employee profile found in /users/{uid}. Please submit your access request.',
        };
      }

      const combined: Record<string, any> = {
        ...(rtdbDoc || {}),
        ...(fsDoc || {}),
      };
      if (
        rtdbDoc?.accountStatus &&
        fsDoc?.accountStatus &&
        rtdbDoc.updatedAt &&
        fsDoc.updatedAt &&
        String(rtdbDoc.updatedAt) > String(fsDoc.updatedAt)
      ) {
        Object.assign(combined, rtdbDoc);
      }

      const resolvedProfile = buildResolvedUserProfile(combined, activeAuthUser);
      setCurrentUser(resolvedProfile);
      setUsersList((prev) =>
        prev.some((u) => u.id === resolvedProfile.id)
          ? prev.map((u) => (u.id === resolvedProfile.id ? resolvedProfile : u))
          : [resolvedProfile, ...prev]
      );

      return {
        success: true,
        profile: resolvedProfile,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Failed to refresh employee profile.',
      };
    }
  };

  const approveEmployeeAccount = async (
    targetUser: UserProfile,
    input: {
      role: UserRole;
      department: string;
      designation?: string;
      isDepartmentHead?: boolean;
      notes?: string;
    }
  ) => {
    const targetUid = String(targetUser.uid || targetUser.id || '').trim();
    const actorUid = String(auth.currentUser?.uid || currentUser.uid || currentUser.id || '').trim();
    const actorEmail = String(auth.currentUser?.email || currentUser.email || '')
      .trim()
      .toLowerCase();
    const actorName = String(currentUser.displayName || currentUser.name || 'Administrator').trim();

    if (!targetUid) {
      return {
        success: false,
        code: 'INVALID_TARGET_UID',
        error: 'Cannot approve employee: missing target user UID.',
      };
    }

    // 1. Strict client + server authority & self-approval guards
    if (currentUser.accountStatus !== 'active') {
      return {
        success: false,
        code: 'ACCOUNT_INACTIVE',
        error: 'Only active administrators can approve employee accounts.',
      };
    }
    if (currentUser.role !== 'super_admin' && currentUser.role !== 'ceo') {
      return {
        success: false,
        code: 'INSUFFICIENT_ROLE',
        error: `Role "${currentUser.role}" is not authorized to approve employee accounts. Only Super Admin and CEO/Director are permitted.`,
      };
    }
    if (actorUid === targetUid) {
      return {
        success: false,
        code: 'SELF_APPROVAL_FORBIDDEN',
        error: 'Security policy violation: You cannot self-approve your own employee account.',
      };
    }
    if (!isCanonicalUserRole(input.role)) {
      return {
        success: false,
        code: 'INVALID_ROLE',
        error: `Invalid canonical role "${input.role}".`,
      };
    }
    if (
      currentUser.role === 'ceo' &&
      (input.role === 'super_admin' ||
        input.role === 'ceo' ||
        targetUser.role === 'super_admin' ||
        targetUser.role === 'ceo')
    ) {
      return {
        success: false,
        code: 'PRIVILEGE_ESCALATION_FORBIDDEN',
        error:
          'Higher Authority (CEO) can approve operational department roles, but only a Super Administrator can approve or modify Super Admin or CEO accounts.',
      };
    }
    if (targetUser.accountStatus === 'active' && targetUser.role === input.role) {
      return {
        success: false,
        code: 'ALREADY_APPROVED',
        error: `Employee "${targetUser.email}" is already approved and active with role "${input.role}".`,
      };
    }

    // 2. Call trusted server endpoint first
    const apiRes = await adminApproveEmployeeViaApi(targetUid, {
      role: input.role,
      department: input.department,
      designation: input.designation,
      isDepartmentHead: input.isDepartmentHead,
      notes: input.notes,
    });

    const hardRejectCodes = new Set([
      'SELF_APPROVAL_FORBIDDEN',
      'INSUFFICIENT_ROLE',
      'PRIVILEGE_ESCALATION_FORBIDDEN',
      'SUPER_ADMIN_IMMUTABLE_BY_HIGHER_AUTHORITY',
      'LAST_SUPER_ADMIN_PROTECTION',
      'ACCOUNT_INACTIVE',
      'TOKEN_REVOKED',
      'INVALID_ROLE',
      'ALREADY_APPROVED',
    ]);

    if (!apiRes.success && apiRes.code && hardRejectCodes.has(apiRes.code)) {
      return {
        success: false,
        code: apiRes.code,
        error: apiRes.message,
      };
    }

    // 3. Build canonical approved profile & persist to Firestore + RTDB
    const nowIso = new Date().toISOString();
    const rbacGroup = mapRoleToRbacGroup(input.role);
    const cleanDept =
      input.department && input.department.trim().length >= 2
        ? input.department.trim()
        : targetUser.department && targetUser.department.trim().length >= 2
          ? targetUser.department.trim()
          : 'Operations';
    const rawDisplayName = String(targetUser.displayName || targetUser.name || '').trim();
    const cleanDisplayName = rawDisplayName.length >= 2 ? rawDisplayName : 'Employee';
    const cleanDesignation =
      input.designation && input.designation.trim().length >= 2
        ? input.designation.trim()
        : targetUser.designation && targetUser.designation.trim().length >= 2
          ? targetUser.designation.trim()
          : `${rbacGroup} (${input.role})`;
    const safeRequestedRole: UserRole = isCanonicalUserRole(targetUser.requestedRole)
      ? targetUser.requestedRole
      : isCanonicalUserRole(targetUser.role)
        ? targetUser.role
        : input.role;
    const cleanCreatedAt =
      targetUser.createdAt && String(targetUser.createdAt).trim().length >= 4
        ? String(targetUser.createdAt).trim()
        : nowIso;

    const historyEntry: ApprovalHistoryEntry = {
      action: targetUser.accountStatus === 'rejected' ? 'reconsidered' : 'approved',
      statusAfter: 'active',
      status: 'active',
      actorUid,
      actorEmail,
      actorName,
      timestamp: nowIso,
      roleAssigned: input.role,
      departmentAssigned: cleanDept,
      reason:
        input.notes?.trim() ||
        `Approved and activated with role ${input.role} (${cleanDept}).`,
      notes:
        input.notes?.trim() ||
        `Approved and activated with role ${input.role} (${cleanDept}).`,
    };

    const approvedProfile: UserProfile = {
      ...targetUser,
      id: targetUid,
      uid: targetUid,
      name: cleanDisplayName,
      displayName: cleanDisplayName,
      email: String(targetUser.email || '').trim().toLowerCase(),
      role: input.role,
      requestedRole: safeRequestedRole,
      requestedDepartment: targetUser.requestedDepartment || cleanDept,
      rbacGroup,
      department: cleanDept,
      designation: cleanDesignation,
      roleTitle: cleanDesignation,
      accountStatus: 'active',
      status: 'Active',
      isDepartmentHead: Boolean(input.isDepartmentHead),
      managedDepartment: input.isDepartmentHead ? cleanDept : undefined,
      approvedByUid: actorUid,
      approvedByEmail: actorEmail,
      approvedByName: actorName,
      approvedAt: nowIso,
      rejectedByUid: undefined,
      rejectedByEmail: undefined,
      rejectedByName: undefined,
      rejectedAt: undefined,
      rejectionReason: undefined,
      disabledAt: undefined,
      deactivatedBy: undefined,
      deactivationReason: undefined,
      createdAt: cleanCreatedAt,
      updatedAt: nowIso,
      approvalHistory: [...(targetUser.approvalHistory || []), historyEntry],
      permissions: ROLE_PERMISSION_DEFAULTS[input.role] || [],
      dataOrigin: 'production',
    };

    let persistedToFirestore = Boolean(apiRes.success);
    let persistedToRtdb = false;
    let lastError = '';

    if (isFirestoreConfigured && !isDemoMode) {
      // Ensure caller's own active administrator profile exists in Firestore so firestore.rules isSuperAdmin() / isCeo() succeeds
      await firestoreService
        .syncOwnActiveProfileToFirestore({
          ...currentUser,
          uid: actorUid,
          id: actorUid,
          email: actorEmail || currentUser.email,
        })
        .catch(() => false);

      const fsDoc = mapUserProfileToFirestoreDoc(approvedProfile);
      const fsWrite = await firestoreService.adminUpsertEmployeeProfileToFirestore(
        targetUid,
        fsDoc,
        apiRes.success
          ? undefined
          : {
              auditAction: 'EMPLOYEE_ACCESS_APPROVED',
              auditDetails: `Approved ${approvedProfile.email} (UID: ${targetUid}) with role=${input.role}, department=${cleanDept} by ${actorEmail}`,
            }
      );
      if (fsWrite.success) {
        persistedToFirestore = true;
      } else {
        lastError = fsWrite.message;
      }
    }

    if (!isDemoMode) {
      const rtdbWrite = await adminUpdateEmployeeProfileInRtdb(
        approvedProfile,
        rbacGroup,
        'active',
        {
          legacyRole: input.role,
          role: input.role,
          department: approvedProfile.department,
          designation: approvedProfile.designation,
          roleTitle: approvedProfile.roleTitle,
          isDepartmentHead: approvedProfile.isDepartmentHead,
          managedDepartment: approvedProfile.managedDepartment,
          approvedByUid: actorUid,
          approvedByEmail: actorEmail,
          approvedByName: actorName,
          approvedAt: nowIso,
          approvalHistory: approvedProfile.approvalHistory,
          permissions: approvedProfile.permissions,
        },
        {
          ...currentUser,
          uid: actorUid,
          id: actorUid,
          email: actorEmail || currentUser.email,
        }
      );
      if (rtdbWrite.success && rtdbWrite.persistedToRtdb) {
        persistedToRtdb = true;
      } else if (rtdbWrite.error && !lastError) {
        lastError = rtdbWrite.error;
      }
    }

    if (!isDemoMode && !persistedToFirestore && !persistedToRtdb) {
      return {
        success: false,
        code: 'DATABASE_WRITE_FAILED',
        error:
          lastError ||
          'Database write failed: Unable to persist employee approval to Cloud Firestore or Realtime Database.',
      };
    }

    // Update local state and append audit log entry only after confirmed write
    setUsersList((prev) =>
      prev.some((u) => u.id === targetUid || u.uid === targetUid)
        ? prev.map((u) =>
            u.id === targetUid || u.uid === targetUid ? approvedProfile : u
          )
        : [approvedProfile, ...prev]
    );

    const newAudit: AuditLogEntry = {
      id: `AUD-EMP-APR-${Date.now()}`,
      timestamp: nowIso,
      userId: actorUid,
      actorUid,
      userName: actorName,
      actorName,
      actorRole: currentUser.role,
      action: 'EMPLOYEE_ACCESS_APPROVED',
      collectionName: 'users',
      module: 'users',
      documentId: targetUid,
      targetUid,
      newValueSummary: `Approved ${approvedProfile.email} (UID: ${targetUid}) as ${input.role} in ${approvedProfile.department} by ${actorEmail}`,
      details: `Approved ${approvedProfile.email} (UID: ${targetUid}) as ${input.role} in ${approvedProfile.department} by ${actorEmail}`,
    };
    setAuditLogs((prev) => [newAudit, ...prev]);

    return {
      success: true,
      code: 'OK',
      updatedProfile: approvedProfile,
      persistedToFirestore: isDemoMode ? true : persistedToFirestore,
      persistedToRtdb: isDemoMode ? true : persistedToRtdb,
    };
  };

  const rejectEmployeeAccount = async (targetUser: UserProfile, reason: string) => {
    const targetUid = String(targetUser.uid || targetUser.id || '').trim();
    const actorUid = String(auth.currentUser?.uid || currentUser.uid || currentUser.id || '').trim();
    const actorEmail = String(auth.currentUser?.email || currentUser.email || '')
      .trim()
      .toLowerCase();
    const actorName = String(currentUser.displayName || currentUser.name || 'Administrator').trim();
    const cleanReason = String(reason || '').trim();

    if (!targetUid) {
      return {
        success: false,
        code: 'INVALID_TARGET_UID',
        error: 'Cannot reject employee: missing target user UID.',
      };
    }

    if (!cleanReason || cleanReason.length < 3) {
      return {
        success: false,
        code: 'MISSING_REJECTION_REASON',
        error: 'A clear rejection reason (at least 3 characters) is required when rejecting an employee account.',
      };
    }
    if (currentUser.accountStatus !== 'active') {
      return {
        success: false,
        code: 'ACCOUNT_INACTIVE',
        error: 'Only active administrators can reject employee accounts.',
      };
    }
    if (currentUser.role !== 'super_admin' && currentUser.role !== 'ceo') {
      return {
        success: false,
        code: 'INSUFFICIENT_ROLE',
        error: `Role "${currentUser.role}" is not authorized to reject employee accounts.`,
      };
    }
    if (actorUid === targetUid) {
      return {
        success: false,
        code: 'SELF_REJECTION_FORBIDDEN',
        error: 'You cannot reject your own active administrator account.',
      };
    }
    if (
      currentUser.role === 'ceo' &&
      (targetUser.role === 'super_admin' || targetUser.role === 'ceo')
    ) {
      return {
        success: false,
        code: 'PRIVILEGE_ESCALATION_FORBIDDEN',
        error:
          'Higher Authority (CEO) cannot reject or modify a Super Admin or CEO account.',
      };
    }

    // 1. Call trusted server endpoint first
    const apiRes = await adminRejectEmployeeViaApi(targetUid, { reason: cleanReason });
    const hardRejectCodes = new Set([
      'SELF_REJECTION_FORBIDDEN',
      'INSUFFICIENT_ROLE',
      'PRIVILEGE_ESCALATION_FORBIDDEN',
      'SUPER_ADMIN_IMMUTABLE_BY_HIGHER_AUTHORITY',
      'LAST_SUPER_ADMIN_PROTECTION',
      'ACCOUNT_INACTIVE',
      'TOKEN_REVOKED',
      'MISSING_REJECTION_REASON',
      'REJECTION_REASON_REQUIRED',
    ]);
    if (!apiRes.success && apiRes.code && hardRejectCodes.has(apiRes.code)) {
      return {
        success: false,
        code: apiRes.code,
        error: apiRes.message,
      };
    }

    const nowIso = new Date().toISOString();
    const safeRole: UserRole = isCanonicalUserRole(targetUser.role)
      ? targetUser.role
      : isCanonicalUserRole(targetUser.requestedRole)
        ? targetUser.requestedRole
        : 'sales';
    const safeRequestedRole: UserRole = isCanonicalUserRole(targetUser.requestedRole)
      ? targetUser.requestedRole
      : safeRole;
    const rbacGroup = mapRoleToRbacGroup(safeRole);
    const rawDisplayName = String(targetUser.displayName || targetUser.name || '').trim();
    const cleanDisplayName = rawDisplayName.length >= 2 ? rawDisplayName : 'Employee';
    const rawDept = String(targetUser.department || targetUser.requestedDepartment || '').trim();
    const cleanDept = rawDept.length >= 2 ? rawDept : 'Operations';
    const rawDesignation = String(targetUser.designation || '').trim();
    const cleanDesignation =
      rawDesignation.length >= 2 ? rawDesignation : 'Access Request Rejected';
    const cleanCreatedAt =
      targetUser.createdAt && String(targetUser.createdAt).trim().length >= 4
        ? String(targetUser.createdAt).trim()
        : nowIso;

    const historyEntry: ApprovalHistoryEntry = {
      action: 'rejected',
      statusAfter: 'rejected',
      status: 'rejected',
      actorUid,
      actorEmail,
      actorName,
      timestamp: nowIso,
      roleAssigned: safeRole,
      departmentAssigned: cleanDept,
      reason: cleanReason,
      notes: `Rejected by ${actorEmail}: ${cleanReason}`,
    };

    const rejectedProfile: UserProfile = {
      ...targetUser,
      id: targetUid,
      uid: targetUid,
      name: cleanDisplayName,
      displayName: cleanDisplayName,
      email: String(targetUser.email || '').trim().toLowerCase(),
      role: safeRole,
      requestedRole: safeRequestedRole,
      requestedDepartment: targetUser.requestedDepartment || cleanDept,
      department: cleanDept,
      designation: cleanDesignation,
      rbacGroup,
      roleTitle: 'ACCESS REQUEST REJECTED',
      accountStatus: 'rejected',
      status: 'Rejected',
      isDepartmentHead: false,
      managedDepartment: undefined,
      approvedByUid: undefined,
      approvedByEmail: undefined,
      approvedByName: undefined,
      approvedAt: undefined,
      rejectedByUid: actorUid,
      rejectedByEmail: actorEmail,
      rejectedByName: actorName,
      rejectedAt: nowIso,
      rejectionReason: cleanReason,
      createdAt: cleanCreatedAt,
      updatedAt: nowIso,
      approvalHistory: [...(targetUser.approvalHistory || []), historyEntry],
      permissions: [],
      dataOrigin: 'production',
    };

    let persistedToFirestore = Boolean(apiRes.success);
    let persistedToRtdb = false;
    let lastError = '';

    if (isFirestoreConfigured && !isDemoMode) {
      await firestoreService
        .syncOwnActiveProfileToFirestore({
          ...currentUser,
          uid: actorUid,
          id: actorUid,
          email: actorEmail || currentUser.email,
        })
        .catch(() => false);

      const fsDoc = mapUserProfileToFirestoreDoc(rejectedProfile);
      const fsWrite = await firestoreService.adminUpsertEmployeeProfileToFirestore(
        targetUid,
        fsDoc,
        apiRes.success
          ? undefined
          : {
              auditAction: 'EMPLOYEE_ACCESS_REJECTED',
              auditDetails: `Rejected ${rejectedProfile.email} (UID: ${targetUid}). Reason: ${cleanReason}`,
            }
      );
      if (fsWrite.success) {
        persistedToFirestore = true;
      } else {
        lastError = fsWrite.message;
      }
    }

    if (!isDemoMode) {
      const rtdbWrite = await adminUpdateEmployeeProfileInRtdb(
        rejectedProfile,
        rbacGroup,
        'rejected',
        {
          legacyRole: safeRole,
          role: safeRole,
          department: cleanDept,
          designation: cleanDesignation,
          roleTitle: 'ACCESS REQUEST REJECTED',
          isDepartmentHead: false,
          managedDepartment: undefined,
          rejectedByUid: actorUid,
          rejectedByEmail: actorEmail,
          rejectedByName: actorName,
          rejectedAt: nowIso,
          rejectionReason: cleanReason,
          approvalHistory: rejectedProfile.approvalHistory,
          permissions: [],
        },
        {
          ...currentUser,
          uid: actorUid,
          id: actorUid,
          email: actorEmail || currentUser.email,
        }
      );
      if (rtdbWrite.success && rtdbWrite.persistedToRtdb) {
        persistedToRtdb = true;
      } else if (rtdbWrite.error && !lastError) {
        lastError = rtdbWrite.error;
      }
    }

    if (!isDemoMode && !persistedToFirestore && !persistedToRtdb) {
      return {
        success: false,
        code: 'DATABASE_WRITE_FAILED',
        error:
          lastError ||
          'Database write failed: Unable to persist employee rejection to Cloud Firestore or Realtime Database.',
      };
    }

    setUsersList((prev) =>
      prev.some((u) => u.id === targetUid || u.uid === targetUid)
        ? prev.map((u) =>
            u.id === targetUid || u.uid === targetUid ? rejectedProfile : u
          )
        : [rejectedProfile, ...prev]
    );

    const newAudit: AuditLogEntry = {
      id: `AUD-EMP-REJ-${Date.now()}`,
      timestamp: nowIso,
      userId: actorUid,
      actorUid,
      userName: actorName,
      actorName,
      actorRole: currentUser.role,
      action: 'EMPLOYEE_ACCESS_REJECTED',
      collectionName: 'users',
      module: 'users',
      documentId: targetUid,
      targetUid,
      newValueSummary: `Rejected ${rejectedProfile.email} (UID: ${targetUid}) by ${actorEmail}. Reason: ${cleanReason}`,
      details: `Rejected ${rejectedProfile.email} (UID: ${targetUid}) by ${actorEmail}. Reason: ${cleanReason}`,
    };
    setAuditLogs((prev) => [newAudit, ...prev]);

    return {
      success: true,
      code: 'OK',
      updatedProfile: rejectedProfile,
      persistedToFirestore: isDemoMode ? true : persistedToFirestore,
      persistedToRtdb: isDemoMode ? true : persistedToRtdb,
    };
  };

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      return { success: true };
    } catch (err: any) {
      const code: string | undefined = err?.code;
      // Closing the Google window is a choice, not an error.
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return { success: false, cancelled: true };
      }
      return { success: false, error: describeGoogleSignInError(code), code };
    }
  };

  const logoutUser = async () => {
    await signOut(auth);
  };

  const seedDatabase = async () => {
    const res = await seedMontexRealtimeDatabase();
    if (res.success) {
      setDataSource('live_rtdb');
      setRtdbError(null);
      setLastSyncedAt(new Date().toLocaleTimeString());
    }
    return res;
  };

  return (
    <RtdbContext.Provider
      value={{
        firebaseUser,
        authLoading,
        currentUser,
        activeRbacGroup,
        setPreviewUserRole,
        setActiveRbacGroup,
        submitOrUpdateOwnAccessRequest,
        refreshOwnUserProfile,
        approveEmployeeAccount,
        rejectEmployeeAccount,
        loginWithGoogle,
        logoutUser,
        isRtdbConnected,
        isDemoMode,
        dataBackend,
        dataSource,
        rtdbError,
        lastSyncedAt,
        seedDatabase,
        refreshFirestoreSnapshot,
        dashboardKpis,
        productionSummary,
        salesOrders,
        dispatches,
        qualityInspections,
        rawMaterials,
        stockMovements,
        actionQueue,
        alertThresholds,
        outstandingAgeing,
        customers,
        products,
        suppliers,
        jobCostSheets,
        usersList,
        auditLogs,
        quotations,
        tenders,
        purchaseOrders,
        machineLogs,
        furnaceLogs,
        maintenanceTickets,
        powerLogs,
        dimensionalReports,
        tasks,
        handovers,
        purchaseRequisitions,
        ncrCapaRecords,
        paymentFollowUps,
        preRfqLeads,
        ppcSchedules,
        roleDutyManuals,
        setProductionSummary,
        setSalesOrders,
        setDispatches,
        setQualityInspections,
        setRawMaterials,
        setStockMovements,
        setActionQueue,
        setAlertThresholds,
        setOutstandingAgeing,
        setCustomers,
        setProducts,
        setSuppliers,
        setJobCostSheets,
        setUsersList,
        setAuditLogs,
        setQuotations,
        setTenders,
        setPurchaseOrders,
        setMachineLogs,
        setFurnaceLogs,
        setMaintenanceTickets,
        setPowerLogs,
        setDimensionalReports,
        setTasks,
        setHandovers,
        setPurchaseRequisitions,
        setNcrCapaRecords,
        setPaymentFollowUps,
        setPreRfqLeads,
        setPpcSchedules,
        createQuotationRecord,
        updateQuotationRecord,
        convertQuotationToOrderRecord,
        createTenderRecord,
        createPurchaseOrderRecord,
        receivePurchaseOrderGrnRecord,
        createMachineLogRecord,
        createFurnaceLogRecord,
        createMaintenanceTicketRecord,
        createPowerLogRecord,
        createDimensionalReportRecord,
        createSalesOrderRecord,
        updateSalesOrderRecord,
        recordStockMovementRecord,
        recordQualityInspectionRecord,
        recordDispatchRecord,
        recordCustomerPaymentRecord,
        upsertCustomerRecord,
        upsertProductRecord,
        deleteCustomerRecord,
        deleteProductRecord,
        saveAlertThresholdsRecord,
        acknowledgeAlertRecord,
        upsertTaskRecord,
        submitTaskForVerificationRecord,
        verifyTaskRecord,
        initiateHandoverRecord,
        resolveHandoverRecord,
        createPurchaseRequisitionRecord,
        approvePurchaseRequisitionRecord,
        upsertNcrCapaRecord,
        upsertPaymentFollowUpRecord,
        updateMonthlySalesTargetRecord,
        runSlaAutomationScanRecord,
      }}
    >
      {children}
    </RtdbContext.Provider>
  );
};

export const useRtdb = (): RtdbContextType => {
  const ctx = useContext(RtdbContext);
  if (!ctx) {
    throw new Error('useRtdb must be used within an RtdbProvider');
  }
  return ctx;
};
