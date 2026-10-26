/**
 * Montex Forge MIS — Phase 5 Verification Suite
 * Controlled Firestore Cutover & Persistent Operational Registers
 *
 * Verifies:
 * 1. P5-T01: Pre-Cutover Safety Gates (6 gates) & Phase 5 Migration Plan documentation
 * 2. P5-T02: Empty Production Collection Isolation (Zero MOCK_* / INITIAL_* demo fallback when Firestore is empty)
 * 3. P5-T03: Persistent Operational Registers #1 (/quotations) & #2 (/tenders) + Quotation-to-Order conversion
 * 4. P5-T04: Persistent Operational Register #3 (/purchaseOrders) + Atomic GRN Receipt & Over-Receipt Guard
 * 5. P5-T05: Persistent Shop-Floor Registers #4 (/machineLogs), #5 (/furnaceLogs), #6 (/maintenanceTickets), #7 (/powerLogs)
 * 6. P5-T06: Persistent Register #8 (/dimensionalReports) & Quality Inspection Lots (/qualityInspections)
 * 7. P5-T07: Core Module Cutover Workflows (Stock Movements, Dispatches, Customer Payments, Master Data, Alert Thresholds)
 * 8. P5-T08: 8-Role Granular RBAC & Inactive Account Enforcement across all 8 Operational Registers
 * 9. P5-T09: Idempotent Duplicate-Submission Lock Protection (DUPLICATE_IN_FLIGHT) & Live KPI Computation
 * 10. P5-T10: Rollback Readiness & RTDB Service Preservation
 */

import fs from 'fs';
import path from 'path';
import {
  ALL_FIRESTORE_COLLECTIONS,
  FirestoreCollectionName,
  FirestoreListOptions,
  FirestorePersistenceDriver,
  FirestoreQueryFilter,
  FirestoreTransactionContext,
  MontexFirestoreService,
} from '../src/services/firestoreService';
import {
  DEFAULT_CLEAN_ALERT_THRESHOLDS,
  MontexCutoverEngine,
  ZERO_DASHBOARD_KPIS,
  ZERO_PRODUCTION_SUMMARY,
  computeLiveDashboardKpis,
  computeLiveProductionSummary,
  runPreCutoverSafetyDiagnostics,
} from '../src/services/firestoreCutoverService';
import {
  ActionQueueItem,
  Customer,
  DimensionalInspectionReport,
  DispatchConsignmentRecord,
  FurnaceBatchLog,
  MachineMaintenanceTicket,
  OrderJourney,
  OutstandingAgeingRecord,
  PowerConsumptionLog,
  Product,
  PurchaseOrderRecord,
  QualityInspectionRecord,
  QuotationRecord,
  RawMaterialStock,
  ShopMachineLog,
  TenderRecord,
  UserProfile,
} from '../src/types/mis';
import * as rtdbService from '../src/services/rtdbService';

interface TestResult {
  id: string;
  suite: string;
  description: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function recordResult(
  id: string,
  suite: string,
  description: string,
  passed: boolean,
  details: string
): void {
  results.push({ id, suite, description, passed, details });
  const badge = passed ? 'PASS' : 'FAIL';
  console.log(`[${badge}] ${id} (${suite}): ${description} — ${details}`);
}

class InMemoryCutoverFirestoreDriver implements FirestorePersistenceDriver {
  private store: Map<string, Map<string, Record<string, any>>> = new Map();
  public artificialDelayMs = 0;

  constructor() {
    for (const col of ALL_FIRESTORE_COLLECTIONS) {
      this.store.set(col, new Map());
    }
  }

  private getCol(name: string): Map<string, Record<string, any>> {
    let col = this.store.get(name);
    if (!col) {
      col = new Map();
      this.store.set(name, col);
    }
    return col;
  }

  public countCollection(name: string): number {
    return this.getCol(name).size;
  }

  private matchesFilter(doc: Record<string, any>, filter: FirestoreQueryFilter): boolean {
    const val = doc[filter.field];
    switch (filter.op) {
      case '==':
        return val === filter.value;
      case '!=':
        return val !== filter.value;
      case '<':
        return typeof val === 'number' && typeof filter.value === 'number' && val < filter.value;
      case '<=':
        return typeof val === 'number' && typeof filter.value === 'number' && val <= filter.value;
      case '>':
        return typeof val === 'number' && typeof filter.value === 'number' && val > filter.value;
      case '>=':
        return typeof val === 'number' && typeof filter.value === 'number' && val >= filter.value;
      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(val);
      default:
        return false;
    }
  }

  async getDoc<T = Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string
  ): Promise<T | null> {
    const doc = this.getCol(collectionName).get(docId);
    return doc ? (JSON.parse(JSON.stringify(doc)) as T) : null;
  }

  async listDocs<T = Record<string, any>>(
    collectionName: FirestoreCollectionName,
    options: FirestoreListOptions = {}
  ): Promise<{ items: T[]; nextPageCursor: string | null; hasMore: boolean }> {
    const col = this.getCol(collectionName);
    let entries = Array.from(col.entries()).map(([id, data]) => ({
      id,
      data: JSON.parse(JSON.stringify(data)) as Record<string, any>,
    }));

    if (options.filters && options.filters.length > 0) {
      entries = entries.filter((e) =>
        options.filters!.every((f) => this.matchesFilter(e.data, f))
      );
    }

    const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
    const hasMore = entries.length > pageSize;
    const sliced = hasMore ? entries.slice(0, pageSize) : entries;
    return {
      items: sliced.map((e) => e.data as T),
      nextPageCursor: hasMore && sliced.length > 0 ? sliced[sliced.length - 1].id : null,
      hasMore,
    };
  }

  async createDoc<T extends Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string,
    data: T
  ): Promise<void> {
    if (this.artificialDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.artificialDelayMs));
    }
    const col = this.getCol(collectionName);
    if (col.has(docId)) {
      const err = new Error(`Document ${collectionName}/${docId} already exists`) as Error & {
        code?: string;
      };
      err.code = 'already-exists';
      throw err;
    }
    col.set(docId, JSON.parse(JSON.stringify(data)));
  }

  async updateDoc<T extends Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string,
    data: Partial<T>
  ): Promise<void> {
    const col = this.getCol(collectionName);
    const existing = col.get(docId);
    if (!existing) {
      const err = new Error(`Document ${collectionName}/${docId} not found`) as Error & {
        code?: string;
      };
      err.code = 'not-found';
      throw err;
    }
    col.set(docId, {
      ...JSON.parse(JSON.stringify(existing)),
      ...JSON.parse(JSON.stringify(data)),
    });
  }

  async deleteDoc(collectionName: FirestoreCollectionName, docId: string): Promise<void> {
    this.getCol(collectionName).delete(docId);
  }

  async runTransaction<R>(
    updateFunction: (tx: FirestoreTransactionContext) => Promise<R>
  ): Promise<R> {
    const txContext: FirestoreTransactionContext = {
      getDoc: (c, id) => this.getDoc(c, id),
      setDoc: async (c, id, data) => {
        this.getCol(c).set(id, JSON.parse(JSON.stringify(data)));
      },
      updateDoc: (c, id, data) => this.updateDoc(c, id, data),
    };
    return updateFunction(txContext);
  }
}

// ============================================================================
// TEST USERS ACROSS ALL 8 CANONICAL ROLES + INACTIVE STATES
// ============================================================================

const USERS: Record<string, UserProfile> = {
  super_admin: {
    id: 'uid-super-admin',
    name: 'Vikramaditya Deshmukh',
    email: 'vikram@montexforge.com',
    role: 'super_admin',
    roleTitle: 'Super Administrator',
    department: 'Administration & IT',
    avatarInitials: 'VD',
    accountStatus: 'active',
    createdAt: '2026-01-01',
  },
  ceo: {
    id: 'uid-ceo',
    name: 'Rajeshwar Rao',
    email: 'ceo@montexforge.com',
    role: 'ceo',
    roleTitle: 'CEO / Managing Director',
    department: 'Executive Board',
    avatarInitials: 'RR',
    accountStatus: 'active',
    createdAt: '2026-01-01',
  },
  sales: {
    id: 'uid-sales',
    name: 'Anil Verma',
    email: 'sales@montexforge.com',
    role: 'sales',
    roleTitle: 'Sales & Marketing',
    department: 'Commercial & Marketing',
    avatarInitials: 'AV',
    accountStatus: 'active',
    createdAt: '2026-01-01',
  },
  purchase: {
    id: 'uid-purchase',
    name: 'Suresh Nair',
    email: 'purchase@montexforge.com',
    role: 'purchase',
    roleTitle: 'Purchase Officer',
    department: 'Steel Procurement',
    avatarInitials: 'SN',
    accountStatus: 'active',
    createdAt: '2026-01-01',
  },
  stores: {
    id: 'uid-stores',
    name: 'Mahesh Kulkarni',
    email: 'stores@montexforge.com',
    role: 'stores',
    roleTitle: 'Stores & Shop-Floor',
    department: 'Raw Material Yard & Forge Shop',
    avatarInitials: 'MK',
    accountStatus: 'active',
    createdAt: '2026-01-01',
  },
  quality: {
    id: 'uid-quality',
    name: 'Dr. Pradeep Joshi',
    email: 'quality@montexforge.com',
    role: 'quality',
    roleTitle: 'Quality & Metallurgy',
    department: 'QA / NABL Lab',
    avatarInitials: 'PJ',
    accountStatus: 'active',
    createdAt: '2026-01-01',
  },
  dispatch: {
    id: 'uid-dispatch',
    name: 'Ramesh Pawar',
    email: 'dispatch@montexforge.com',
    role: 'dispatch',
    roleTitle: 'Dispatch & Logistics',
    department: 'Outward Logistics',
    avatarInitials: 'RP',
    accountStatus: 'active',
    createdAt: '2026-01-01',
  },
  finance: {
    id: 'uid-finance',
    name: 'Kavita Iyer',
    email: 'finance@montexforge.com',
    role: 'finance',
    roleTitle: 'Finance & Accounts',
    department: 'Accounts & Costing',
    avatarInitials: 'KI',
    accountStatus: 'active',
    createdAt: '2026-01-01',
  },
  pendingUser: {
    id: 'uid-pending',
    name: 'Pending Employee',
    email: 'pending@montexforge.com',
    role: 'sales',
    roleTitle: 'Sales',
    department: 'Sales',
    avatarInitials: 'PE',
    accountStatus: 'pending_approval',
    createdAt: '2026-01-01',
  },
  suspendedUser: {
    id: 'uid-suspended',
    name: 'Suspended Employee',
    email: 'suspended@montexforge.com',
    role: 'stores',
    roleTitle: 'Stores',
    department: 'Stores',
    avatarInitials: 'SE',
    accountStatus: 'suspended',
    createdAt: '2026-01-01',
  },
};

async function runPhase5Verification(): Promise<void> {
  console.log('================================================================================');
  console.log(' MONTEX FORGE MIS — PHASE 5 CUTOVER & PERSISTENT OPERATIONAL REGISTERS SUITE');
  console.log('================================================================================\n');

  // --------------------------------------------------------------------------
  // SUITE 1: PRE-CUTOVER SAFETY GATES & MIGRATION PLAN AUDIT
  // --------------------------------------------------------------------------
  {
    const safetyReport = runPreCutoverSafetyDiagnostics();
    const planPath = path.resolve(process.cwd(), 'docs/PHASE_5_MIGRATION_PLAN.md');
    const planExists = fs.existsSync(planPath);
    const planContent = planExists ? fs.readFileSync(planPath, 'utf8') : '';
    const hasAllSections =
      planContent.includes('Pre-Cutover Safety Gates') &&
      planContent.includes('Operational Registers') &&
      planContent.includes('Rollback Plan');

    recordResult(
      'P5-T01',
      'Pre-Cutover Safety Gates',
      'All 6 pre-cutover safety gates pass and docs/PHASE_5_MIGRATION_PLAN.md is complete',
      safetyReport.readyForCutover &&
        safetyReport.gates.length === 6 &&
        safetyReport.allEightRegistersMapped &&
        safetyReport.emptyStateNeverUsesDemoFallback &&
        safetyReport.rollbackAvailable &&
        planExists &&
        hasAllSections,
      `readyForCutover=${safetyReport.readyForCutover}, gates=${safetyReport.gates.length}/6, db=${safetyReport.namedDatabaseId}, migrationPlan=${planExists}`
    );
  }

  // --------------------------------------------------------------------------
  // SUITE 2: CLEAN EMPTY PRODUCTION COLLECTION ISOLATION (ZERO DEMO FALLBACK)
  // --------------------------------------------------------------------------
  const driver = new InMemoryCutoverFirestoreDriver();
  const fsService = new MontexFirestoreService(driver);
  const engine = new MontexCutoverEngine(fsService);

  {
    const emptySnap = await engine.loadProductionSnapshot(USERS.super_admin);
    const totalRecordsAcrossAllArrays =
      emptySnap.quotations.length +
      emptySnap.tenders.length +
      emptySnap.purchaseOrders.length +
      emptySnap.machineLogs.length +
      emptySnap.furnaceLogs.length +
      emptySnap.maintenanceTickets.length +
      emptySnap.powerLogs.length +
      emptySnap.dimensionalReports.length +
      emptySnap.salesOrders.length +
      emptySnap.rawMaterials.length +
      emptySnap.stockMovements.length +
      emptySnap.qualityInspections.length +
      emptySnap.dispatches.length +
      emptySnap.outstandingAgeing.length +
      emptySnap.actionQueue.length +
      emptySnap.customers.length +
      emptySnap.products.length +
      emptySnap.suppliers.length +
      emptySnap.jobCostSheets.length;

    const kpisZeroed =
      emptySnap.dashboardKpis.openOrdersValue === 0 &&
      emptySnap.dashboardKpis.openOrdersCount === 0 &&
      emptySnap.dashboardKpis.todaysDispatchQty === 0 &&
      emptySnap.dashboardKpis.totalOutstanding === 0 &&
      emptySnap.productionSummary.totalRejectionPercent === 0;

    recordResult(
      'P5-T02',
      'Empty Production Isolation',
      'Authenticated load on empty Firestore returns [] for all 8 registers + 11 core collections and 0 KPIs (never MOCK_* / INITIAL_*)',
      totalRecordsAcrossAllArrays === 0 &&
        emptySnap.usedDemoFallback === false &&
        kpisZeroed &&
        emptySnap.alertThresholds.rejectionPercent ===
          DEFAULT_CLEAN_ALERT_THRESHOLDS.rejectionPercent,
      `totalRecords=${totalRecordsAcrossAllArrays}, usedDemoFallback=${emptySnap.usedDemoFallback}, openOrdersValue=${emptySnap.dashboardKpis.openOrdersValue}`
    );
  }

  // --------------------------------------------------------------------------
  // SUITE 3: PERSISTENT REGISTERS #1 (/quotations) & #2 (/tenders) + CONVERSION
  // --------------------------------------------------------------------------
  {
    const sampleQuote: QuotationRecord = {
      id: 'QT-2026-901',
      rfqReference: 'RFQ-LT-2026-901',
      quoteDate: '2026-03-29',
      validUntil: '2026-04-28',
      customerId: 'CUST-001',
      customerName: 'Larsen & Toubro Heavy Engg',
      contactPerson: 'S. Raghavan',
      productId: 'PROD-001',
      productName: '12" Class 600 Weld Neck Flange',
      materialGrade: 'ASTM A105',
      standard: 'ASME B16.5',
      unitWeightKg: 48,
      inquiryQtyPcs: 50,
      quotedRatePerKg: 185,
      quotedRatePerPc: 8880,
      totalQuotedValue: 444000,
      estimatedMarginPercent: 18.4,
      deliveryLeadWeeks: 6,
      isRepeatOrder: true,
      status: 'submitted',
      nextFollowUpDate: '2026-04-05',
      followUpNotes: 'Technical offer submitted',
    };

    const createQuoteRes = await engine.createQuotation(sampleQuote, USERS.sales, false);
    const updatedQuoteInput: QuotationRecord = {
      ...sampleQuote,
      status: 'negotiation',
      followUpNotes: 'Price negotiation round 2',
    };
    const updateQuoteRes = await engine.updateQuotation(updatedQuoteInput, USERS.sales, false);

    const convertedOrder: OrderJourney = {
      id: 'ORD-2026-901',
      poNumber: 'PO-LT-2026-901',
      poDate: '2026-03-29',
      jobNumber: 'JOB-MF-2026-0901',
      customerId: 'CUST-001',
      customerName: sampleQuote.customerName,
      totalValue: sampleQuote.totalQuotedValue,
      currency: 'INR',
      expectedDeliveryDate: '2026-05-10',
      targetDeliveryDate: '2026-05-05',
      status: 'po_registered',
      statusLabel: 'Converted from QT-2026-901',
      lineItems: [
        {
          id: 'LI-901',
          salesOrderId: 'ORD-2026-901',
          productId: 'PROD-001',
          productCode: 'FG-WN-12-600',
          productName: sampleQuote.productName,
          materialGrade: sampleQuote.materialGrade,
          size: '12 Inch',
          orderedQty: 50,
          uom: 'PCS',
          ratePerUnit: 8880,
          totalAmount: 444000,
          producedQty: 0,
          inspectedOkQty: 0,
          rejectedQty: 0,
          dispatchedQty: 0,
          pendingQty: 50,
        },
      ],
      materialStatus: {
        state: 'shortage',
        materialGrade: 'ASTM A105',
        heatNumber: 'PENDING',
        requiredKg: 2400,
        allocatedKg: 0,
        supplierName: 'Kalyani Carpenter',
        lastUpdated: '2026-03-29',
      },
      qualityStatus: {
        state: 'pending',
        inspectorName: 'Pending',
        inspectionDate: '-',
        mtcNumber: '-',
        mtcStatus: 'draft',
        testTypes: ['Chemical', 'UT'],
      },
      clearanceStatus: {
        state: 'pending',
        agency: 'Lloyds Register',
        inspectorName: '-',
        clearanceDate: '-',
        clearanceRefNo: '-',
        remarks: 'Pending',
      },
      dispatchStatus: {
        state: 'pending',
        totalShippedQty: 0,
        balanceQty: 50,
        transporterName: '-',
        vehicleNo: '-',
        lrNumber: '-',
        dispatchDate: '-',
        destinationCity: 'Hazira',
      },
      invoiceStatus: {
        state: 'pending',
        invoiceNumber: '-',
        invoiceDate: '-',
        invoiceAmount: 444000,
        paidAmount: 0,
        paymentDueDate: '2026-06-15',
        tallySyncStatus: 'pending_import',
        outstandingAmount: 444000,
      },
    };

    const convertRes = await engine.convertQuotationToOrder(
      { ...updatedQuoteInput, status: 'won', convertedOrderId: convertedOrder.id },
      convertedOrder,
      USERS.sales,
      false
    );

    const sampleTender: TenderRecord = {
      id: 'TND-2026-901',
      tenderNumber: 'BHEL/TRY/HP-VALVES/2026/88',
      issuingAuthority: 'BHEL Tiruchirappalli',
      projectTitle: 'High Pressure Forged Valve Bodies Grade F22',
      itemSummary: 'ASTM A182 F22 Valve Forgings - 85 MT',
      estimatedValueLakhs: 142.5,
      emdAmount: 250000,
      bidSubmissionDate: '2026-04-18',
      priceBidOpeningDate: '2026-04-25',
      technicalBidStatus: 'qualified',
      assignedOwner: 'Anil Verma',
    };

    const createTenderRes = await engine.createTender(sampleTender, USERS.sales, false);

    // Reload from Firestore to verify persistence across sessions
    const reloaded = await engine.loadProductionSnapshot(USERS.sales);
    const persistedQuote = reloaded.quotations.find((q) => q.id === 'QT-2026-901');
    const persistedOrder = reloaded.salesOrders.find((o) => o.id === 'ORD-2026-901');
    const persistedTender = reloaded.tenders.find((t) => t.id === 'TND-2026-901');

    recordResult(
      'P5-T03',
      'Registers #1 & #2 (Quotations & Tenders)',
      'Quotations, follow-ups, Quotation-to-Order conversion, and PSU Tenders persist in Firestore across reloads',
      createQuoteRes.persistedToFirestore &&
        updateQuoteRes.persistedToFirestore &&
        convertRes.persistedToFirestore &&
        createTenderRes.persistedToFirestore &&
        persistedQuote?.status === 'won' &&
        persistedQuote?.convertedOrderId === 'ORD-2026-901' &&
        persistedOrder?.jobNumber === 'JOB-MF-2026-0901' &&
        persistedTender?.tenderNumber === 'BHEL/TRY/HP-VALVES/2026/88' &&
        persistedTender?.estimatedValueLakhs === 142.5,
      `quote=${persistedQuote?.id}(${persistedQuote?.status}), order=${persistedOrder?.id}, tender=${persistedTender?.id}`
    );
  }

  // --------------------------------------------------------------------------
  // SUITE 4: PERSISTENT REGISTER #3 (/purchaseOrders) & ATOMIC GRN RECEIPT
  // --------------------------------------------------------------------------
  {
    // First create raw material stock in Firestore via stores user
    const initialRm: RawMaterialStock = {
      id: 'RM-A105-200',
      code: 'RM-BIL-A105-200',
      name: 'ASTM A105 Carbon Steel Round Billet 200mm',
      grade: 'ASTM A105',
      sectionShape: 'Round Billet',
      dimensionsMm: '200mm Dia x 6000mm',
      currentStockMt: 20,
      reservedStockMt: 8,
      availableStockMt: 12,
      minimumStockMt: 15,
      reorderLevelMt: 25,
      standardRatePerMt: 68500,
      supplier: 'Kalyani Carpenter Special Steels',
      locationBay: 'Bay A-1',
      status: 'critical',
    };

    await engine.recordStockMovement({
      material: { ...initialRm, currentStockMt: 10, availableStockMt: 2 },
      quantityDeltaMt: 10,
      movementType: 'Receipt (GRN)',
      heatNumber: 'KC-HEAT-8801',
      referenceDoc: 'INITIAL-YARD-ENTRY',
      user: USERS.stores,
      isDemoMode: false,
    });

    const samplePo: PurchaseOrderRecord = {
      id: 'PO-MILL-2026-501',
      poNumber: 'MF/PO/26-27/0501',
      poDate: '2026-03-29',
      supplierId: 'SUP-001',
      supplierName: 'Kalyani Carpenter Special Steels',
      materialId: 'RM-A105-200',
      materialCode: 'RM-BIL-A105-200',
      materialGrade: 'ASTM A105',
      sectionMm: '200mm Dia RCS',
      linkedJobNumber: 'JOB-MF-2026-0901',
      orderedMt: 40,
      receivedMt: 0,
      pendingMt: 40,
      ratePerMt: 68500,
      totalValue: 2740000,
      expectedDeliveryDate: '2026-04-12',
      millHeatNumber: 'PENDING-ROLLING',
      status: 'issued',
    };

    const createPoRes = await engine.createPurchaseOrder(samplePo, USERS.purchase, false);

    // Receive 25 MT GRN as Stores user (updates PO + RawMaterial + StockMovement)
    const grnRes = await engine.receivePurchaseOrderGrn({
      po: samplePo,
      material: initialRm,
      receiptQtyMt: 25,
      heatNumber: 'KC-HEAT-9924',
      grnNumber: 'GRN-2026-0501',
      user: USERS.stores,
      isDemoMode: false,
    });

    // Attempt over-receipt (20 MT when only 15 MT pending) -> must fail with PO_OVER_RECEIPT_GUARD
    const overReceiptRes = await engine.receivePurchaseOrderGrn({
      po: grnRes.data!.updatedPo,
      material: grnRes.data!.updatedMaterial,
      receiptQtyMt: 20,
      heatNumber: 'KC-HEAT-9925',
      grnNumber: 'GRN-2026-0502',
      user: USERS.stores,
      isDemoMode: false,
    });

    const reloaded = await engine.loadProductionSnapshot(USERS.stores);
    const persistedPo = reloaded.purchaseOrders.find((p) => p.id === 'PO-MILL-2026-501');
    const persistedRm = reloaded.rawMaterials.find((m) => m.id === 'RM-A105-200');

    recordResult(
      'P5-T04',
      'Register #3 (Purchase Orders & GRN)',
      'Steel Mill PO creation, partial GRN receipt, raw material stock increment, and over-receipt guard work atomically',
      createPoRes.persistedToFirestore &&
        grnRes.persistedToFirestore &&
        persistedPo?.receivedMt === 25 &&
        persistedPo?.pendingMt === 15 &&
        persistedPo?.status === 'partially_received' &&
        persistedRm?.currentStockMt === 45 &&
        persistedRm?.availableStockMt === 37 &&
        !overReceiptRes.success &&
        overReceiptRes.code === 'PO_OVER_RECEIPT_GUARD',
      `PO received=${persistedPo?.receivedMt}/40 MT (${persistedPo?.status}), RM stock=${persistedRm?.currentStockMt} MT, overReceiptBlocked=${overReceiptRes.code}`
    );
  }

  // --------------------------------------------------------------------------
  // SUITE 5: PERSISTENT SHOP-FLOOR REGISTERS #4, #5, #6, #7
  // --------------------------------------------------------------------------
  {
    const machineLog: ShopMachineLog = {
      id: 'MLOG-2026-701',
      date: '2026-03-29',
      shift: 'Shift A (06:00-14:00)',
      machineId: 'MCH-01',
      machineName: '1600T Hydraulic Open-Die Press',
      operatorName: 'R. Shinde',
      jobNumber: 'JOB-MF-2026-0901',
      productName: '12" Class 600 Weld Neck Flange',
      inputBilletsPcs: 30,
      forgedOutputPcs: 28,
      okPcs: 26,
      rejectedPcs: 1,
      reworkPcs: 1,
      downtimeMinutes: 20,
      capacityUtilizationPercent: 91,
    };

    const mlogRes = await engine.createMachineLog(machineLog, USERS.stores, false);

    // Invalid machine log where ok + rejected + rework > forgedOutputPcs
    const invalidMlogRes = await engine.createMachineLog(
      { ...machineLog, id: 'MLOG-INVALID', okPcs: 28, rejectedPcs: 5 },
      USERS.stores,
      false
    );

    const furnaceLog: FurnaceBatchLog = {
      id: 'FLOG-2026-701',
      batchNumber: 'HT-BATCH-2026-701',
      date: '2026-03-29',
      shift: 'Shift B',
      furnaceId: 'HTF-01',
      furnaceName: 'Bogie Hearth Normalizing Furnace #1',
      fuelType: 'PNG (Natural Gas)',
      jobNumber: 'JOB-MF-2026-0901',
      heatNumber: 'KC-HEAT-9924',
      chargeWeightMt: 6.4,
      targetTempC: 890,
      peakRecordedTempC: 894,
      soakingTimeMinutes: 210,
      fuelConsumedQty: 410,
      fuelUnit: 'SCM',
      specificFuelPerMt: 64.1,
      status: 'within_spec',
    };

    const flogRes = await engine.createFurnaceLog(furnaceLog, USERS.stores, false);

    const maintTicket: MachineMaintenanceTicket = {
      id: 'MNT-2026-701',
      ticketDate: '2026-03-29',
      machineId: 'MCH-02',
      machineName: '3.5T Closed-Die Pneumatic Hammer',
      maintenanceType: 'Preventive (PM)',
      issueDescription: 'Scheduled tup guide clearance & lubrication check',
      rootCause: 'Scheduled 500-hour PM cycle',
      replacementParts: 'Bronze guide shims + high-temp grease',
      downtimeMinutes: 45,
      maintenanceCostInr: 18500,
      technicianName: 'D. Jadhav',
      status: 'resolved',
    };

    const mntRes = await engine.createMaintenanceTicket(maintTicket, USERS.stores, false);

    const powerLog: PowerConsumptionLog = {
      id: 'PWR-2026-701',
      date: '2026-03-29',
      totalKwh: 14800,
      totalKvah: 15025,
      powerFactor: 0.985,
      peakDemandKva: 1180,
      forgedOutputMt: 22.5,
      specificEnergyKwhPerMt: 658,
      targetKwhPerMt: 680,
      electricityCostInr: 136160,
      furnaceSharePercent: 44,
      pressHammerSharePercent: 38,
    };

    const pwrRes = await engine.createPowerLog(powerLog, USERS.stores, false);

    const reloaded = await engine.loadProductionSnapshot(USERS.stores);

    recordResult(
      'P5-T05',
      'Registers #4, #5, #6, #7 (Shop-Floor & Energy)',
      'MachineLogs, FurnaceLogs, MaintenanceTickets, and PowerLogs persist in Firestore and enforce shop-floor invariants',
      mlogRes.persistedToFirestore &&
        !invalidMlogRes.success &&
        invalidMlogRes.code === 'VALIDATION_FAILED' &&
        flogRes.persistedToFirestore &&
        mntRes.persistedToFirestore &&
        pwrRes.persistedToFirestore &&
        reloaded.machineLogs.length === 1 &&
        reloaded.machineLogs[0].forgedOutputPcs === 28 &&
        reloaded.furnaceLogs.length === 1 &&
        reloaded.furnaceLogs[0].batchNumber === 'HT-BATCH-2026-701' &&
        reloaded.maintenanceTickets.length === 1 &&
        reloaded.maintenanceTickets[0].maintenanceCostInr === 18500 &&
        reloaded.powerLogs.length === 1 &&
        reloaded.powerLogs[0].specificEnergyKwhPerMt === 658,
      `machineLogs=${reloaded.machineLogs.length}, furnaceLogs=${reloaded.furnaceLogs.length}, maintTickets=${reloaded.maintenanceTickets.length}, powerLogs=${reloaded.powerLogs.length}`
    );
  }

  // --------------------------------------------------------------------------
  // SUITE 6: PERSISTENT REGISTER #8 (/dimensionalReports) & QC INSPECTIONS
  // --------------------------------------------------------------------------
  {
    const dirReport: DimensionalInspectionReport = {
      id: 'DIR-2026-801',
      jobNumber: 'JOB-MF-2026-0901',
      orderNo: 'PO-LT-2026-901',
      customerName: 'Larsen & Toubro Heavy Engg',
      drawingNo: 'DRG-LT-WN12-600-REV4',
      productName: '12" Class 600 Weld Neck Flange',
      sampleSizePcs: 5,
      inspectorName: 'Dr. Pradeep Joshi',
      tpiAgency: 'Lloyds Register',
      inspectionDate: '2026-03-29',
      parameters: [
        {
          dimensionName: 'Outer Diameter (OD)',
          nominalMm: '559.0',
          toleranceMm: '±1.5',
          measuredMinMm: '558.8',
          measuredMaxMm: '559.3',
          instrumentUsed: 'Digital Vernier 600mm',
          result: 'OK',
        },
        {
          dimensionName: 'Inside Bore (ID)',
          nominalMm: '304.8',
          toleranceMm: '±0.8',
          measuredMinMm: '304.6',
          measuredMaxMm: '304.9',
          instrumentUsed: 'Bore Gauge',
          result: 'OK',
        },
        {
          dimensionName: 'Bolt Circle Dia (PCD)',
          nominalMm: '489.0',
          toleranceMm: '±0.5',
          measuredMinMm: '488.9',
          measuredMaxMm: '489.1',
          instrumentUsed: 'CMM Probe',
          result: 'OK',
        },
      ],
      offeringStatus: 'witnessed_cleared',
    };

    const dirRes = await engine.createDimensionalReport(dirReport, USERS.quality, false);

    const qcLot: QualityInspectionRecord = {
      id: 'QC-2026-801',
      jobNumber: 'JOB-MF-2026-0901',
      customer: 'Larsen & Toubro Heavy Engg',
      product: '12" Class 600 Weld Neck Flange',
      grade: 'ASTM A105',
      heatNo: 'KC-HEAT-9924',
      inspectedQty: 50,
      passedQty: 49,
      rejectedQty: 1,
      status: 'cleared',
      inspector: 'Dr. Pradeep Joshi',
      date: '2026-03-29',
      mtcNumber: 'MTC-MF-2026-801',
    };

    const qcRes = await engine.recordQualityInspection(qcLot, USERS.quality, false);

    const invalidQcRes = await engine.recordQualityInspection(
      { ...qcLot, id: 'QC-INVALID', passedQty: 45, rejectedQty: 10 },
      USERS.quality,
      false
    );

    const reloaded = await engine.loadProductionSnapshot(USERS.quality);

    recordResult(
      'P5-T06',
      'Register #8 (Dimensional Reports & QC)',
      'Dimensional Inspection Reports (DIR) and QC lots persist in Firestore and update live rejection rate',
      dirRes.persistedToFirestore &&
        qcRes.persistedToFirestore &&
        !invalidQcRes.success &&
        invalidQcRes.code === 'QUALITY_QUANTITY_INVARIANT' &&
        reloaded.dimensionalReports.length === 1 &&
        reloaded.dimensionalReports[0].drawingNo === 'DRG-LT-WN12-600-REV4' &&
        reloaded.qualityInspections.length === 1 &&
        reloaded.productionSummary.totalRejectionPercent === 2.0,
      `DIR=${reloaded.dimensionalReports[0]?.id}, QC=${reloaded.qualityInspections[0]?.id}, liveRejectionPct=${reloaded.productionSummary.totalRejectionPercent}%`
    );
  }

  // --------------------------------------------------------------------------
  // SUITE 7: CORE MODULE WORKFLOWS (STOCK GUARDS, DISPATCH, PAYMENTS, MASTER DATA)
  // --------------------------------------------------------------------------
  {
    const storesSnap = await engine.loadProductionSnapshot(USERS.stores);
    const currentRm = storesSnap.rawMaterials[0];

    // 1. Negative stock guard (currentStockMt=45, try issuing -50 MT)
    const negStockRes = await engine.recordStockMovement({
      material: currentRm,
      quantityDeltaMt: -50,
      movementType: 'Production Issue',
      heatNumber: 'KC-HEAT-9924',
      referenceDoc: 'JOB-OVER-ISSUE',
      user: USERS.stores,
      isDemoMode: false,
    });

    // 2. Reserved stock guard (currentStockMt=45, reserved=8, try issuing -40 MT -> leaves 5 < 8)
    const reservedStockRes = await engine.recordStockMovement({
      material: currentRm,
      quantityDeltaMt: -40,
      movementType: 'Production Issue',
      heatNumber: 'KC-HEAT-9924',
      referenceDoc: 'JOB-RESERVED-VIOLATION',
      user: USERS.stores,
      isDemoMode: false,
    });

    // 3. Valid dispatch consignment
    const existingOrder = storesSnap.salesOrders[0];
    const dispatchRec: DispatchConsignmentRecord = {
      id: 'DSP-2026-901',
      orderNo: existingOrder.poNumber,
      jobNumber: existingOrder.jobNumber,
      customer: existingOrder.customerName,
      product: existingOrder.lineItems[0].productName,
      quantity: 30,
      balanceQty: 20,
      weightMt: 1.44,
      transporter: 'VRL Heavy Logistics',
      vehicleNo: 'MH-12-PQ-4455',
      lrNumber: 'LR-VRL-99881',
      destination: 'Hazira Works',
      date: '2026-03-29',
      invoiceRef: 'INV-MF-26-901',
      clearanceRef: 'CLR-LR-801',
      status: 'partially_dispatched',
    };

    const updatedOrderForDispatch: OrderJourney = {
      ...existingOrder,
      status: 'partially_dispatched',
      dispatchStatus: {
        ...existingOrder.dispatchStatus,
        state: 'partial',
        totalShippedQty: 30,
        balanceQty: 20,
      },
    };

    const dspRes = await engine.recordDispatch(
      dispatchRec,
      updatedOrderForDispatch,
      USERS.dispatch,
      false
    );

    // 4. Customer payment receipt deducting oldest ageing buckets first
    const initialAgeing: OutstandingAgeingRecord = {
      customerId: 'CUST-001',
      customerName: 'Larsen & Toubro Heavy Engg',
      totalOutstanding: 500000,
      bucket0to30: 200000,
      bucket31to60: 150000,
      bucket61to90: 100000,
      bucket90Plus: 50000,
      creditLimit: 2500000,
      creditExceeded: false,
      oldestInvoiceDate: '2025-12-15',
    };

    const payRes = await engine.recordCustomerPayment(
      initialAgeing,
      120000,
      'UTR-HDFC-20260329991',
      USERS.finance,
      false
    );

    // 5. Customer & Product master upserts + Alert thresholds
    const newCustomer: Customer = {
      id: 'CUST-001',
      code: 'MF-CUST-001',
      name: 'Larsen & Toubro Heavy Engg',
      contactPerson: 'S. Raghavan',
      phone: '+91-261-2805500',
      email: 'raghavan@larsentoubro.com',
      location: 'Hazira, Gujarat',
      industry: 'Heavy Engineering & Nuclear',
      creditLimit: 5000000,
      creditDays: 45,
      assignedSalesPerson: 'Anil Verma',
      active: true,
      totalOrders: 4,
      totalOutstanding: 380000,
    };
    const custRes = await engine.upsertCustomer(newCustomer, true, USERS.sales, false);

    const newProduct: Product = {
      id: 'PROD-001',
      code: 'FG-WN-12-600',
      name: '12" Class 600 Weld Neck Flange',
      category: 'Flange',
      size: '12" NB SCH 80',
      materialGrade: 'ASTM A105',
      standard: 'ASME B16.5',
      uom: 'PCS',
      standardWeightKg: 48,
      hsnCode: '73079100',
      standardSellingPrice: 8880,
    };
    const prodRes = await engine.upsertProduct(newProduct, true, USERS.super_admin, false);

    const threshRes = await engine.saveAlertThresholds(
      { ...DEFAULT_CLEAN_ALERT_THRESHOLDS, rejectionPercent: 1.8 },
      USERS.super_admin,
      false
    );

    const alertItem: ActionQueueItem = {
      id: 'ALT-2026-901',
      type: 'material_shortage',
      severity: 'high',
      title: 'Low Billet Stock Alert',
      description: 'ASTM A105 below reorder level',
      associatedRef: 'RM-A105-200',
      customerOrSupplier: 'Kalyani Carpenter',
      daysPending: 2,
      suggestedAction: 'Expedite PO-MILL-2026-501',
      assignedToDepartment: 'Stores',
      acknowledged: false,
    };
    const ackRes = await engine.acknowledgeAlert(alertItem, USERS.stores, false);

    recordResult(
      'P5-T07',
      'Core Cutover Workflows & Invariants',
      'Stock guards, Dispatch sync, FIFO Ageing Payment deduction, Master Data upserts, and Alert Thresholds persist cleanly',
      !negStockRes.success &&
        negStockRes.code === 'INSUFFICIENT_STOCK' &&
        !reservedStockRes.success &&
        reservedStockRes.code === 'RESERVED_STOCK_VIOLATION' &&
        dspRes.persistedToFirestore &&
        payRes.persistedToFirestore &&
        payRes.data?.totalOutstanding === 380000 &&
        payRes.data?.bucket90Plus === 0 &&
        payRes.data?.bucket61to90 === 30000 &&
        custRes.persistedToFirestore &&
        prodRes.persistedToFirestore &&
        threshRes.persistedToFirestore &&
        ackRes.persistedToFirestore &&
        ackRes.data?.acknowledged === true,
      `negStock=${negStockRes.code}, reservedStock=${reservedStockRes.code}, dispatch=${dspRes.code}, paymentNewBalance=${payRes.data?.totalOutstanding}`
    );
  }

  // --------------------------------------------------------------------------
  // SUITE 8: 8-ROLE GRANULAR RBAC, HIGHER AUTHORITY & RELATIONAL DELETE GUARDS
  // --------------------------------------------------------------------------
  {
    const dummyQuote: QuotationRecord = {
      id: 'QT-RBAC-1',
      rfqReference: 'RFQ-1',
      quoteDate: '2026-03-29',
      validUntil: '2026-04-28',
      customerId: 'CUST-001',
      customerName: 'Test',
      contactPerson: 'Test',
      productId: 'PROD-001',
      productName: 'Test',
      materialGrade: 'ASTM A105',
      standard: 'ASME',
      unitWeightKg: 10,
      inquiryQtyPcs: 10,
      quotedRatePerKg: 150,
      quotedRatePerPc: 1500,
      totalQuotedValue: 15000,
      estimatedMarginPercent: 15,
      deliveryLeadWeeks: 4,
      isRepeatOrder: false,
      status: 'draft',
      nextFollowUpDate: '2026-04-05',
      followUpNotes: '-',
    };

    // 1. Higher Authority (CEO) has full operational access across modules and can guard/delete unreferenced master records
    const ceoReadSnap = await engine.loadProductionSnapshot(USERS.ceo);
    const ceoDeleteReferencedCustomer = await engine.deleteCustomerRecord(
      {
        id: 'CUST-101',
        code: 'CUST-101',
        name: 'Larsen & Toubro',
        contactPerson: 'S. Iyer',
        phone: '9820012345',
        email: 'procurement@lnt.com',
        location: 'Mumbai',
        industry: 'EPC',
        creditLimit: 5000000,
        creditDays: 45,
        assignedSalesPerson: 'Anil',
        active: true,
        totalOrders: 1,
        totalOutstanding: 380000,
      },
      1,
      USERS.ceo,
      false
    );

    // 2. Cross-department write attempts must be denied
    const qualityWriteQuote = await engine.createQuotation(dummyQuote, USERS.quality, false);
    const salesWritePo = await engine.createPurchaseOrder(
      {
        id: 'PO-RBAC-1',
        poNumber: 'PO-1',
        poDate: '2026-03-29',
        supplierId: 'SUP-1',
        supplierName: 'Mill',
        materialId: 'RM-1',
        materialCode: 'RM-1',
        materialGrade: 'ASTM A105',
        sectionMm: '200mm',
        linkedJobNumber: 'JOB-1',
        orderedMt: 10,
        receivedMt: 0,
        pendingMt: 10,
        ratePerMt: 65000,
        totalValue: 650000,
        expectedDeliveryDate: '2026-04-10',
        millHeatNumber: '-',
        status: 'issued',
      },
      USERS.sales,
      false
    );
    const financeWriteThresholds = await engine.saveAlertThresholds(
      DEFAULT_CLEAN_ALERT_THRESHOLDS,
      USERS.finance,
      false
    );

    // 3. Inactive accounts (pending_approval & suspended) must be denied on writes and return empty snapshots
    const pendingWrite = await engine.createQuotation(dummyQuote, USERS.pendingUser, false);
    const suspendedSnap = await engine.loadProductionSnapshot(USERS.suspendedUser);

    recordResult(
      'P5-T08',
      'Granular RBAC, Higher Authority & Relational Delete Guards',
      'Higher Authority access, relational delete protection (RELATIONAL_DEPENDENCY_BLOCKED), cross-department write denials, and inactive account blocks are strictly enforced',
      !ceoDeleteReferencedCustomer.success &&
        ceoDeleteReferencedCustomer.code === 'RELATIONAL_DEPENDENCY_BLOCKED' &&
        ceoReadSnap.quotations.length === 1 &&
        ceoReadSnap.purchaseOrders.length === 1 &&
        !qualityWriteQuote.success &&
        qualityWriteQuote.code === 'PERMISSION_DENIED' &&
        !salesWritePo.success &&
        salesWritePo.code === 'PERMISSION_DENIED' &&
        !financeWriteThresholds.success &&
        financeWriteThresholds.code === 'PERMISSION_DENIED' &&
        !pendingWrite.success &&
        pendingWrite.code === 'ACCOUNT_INACTIVE' &&
        suspendedSnap.quotations.length === 0 &&
        suspendedSnap.salesOrders.length === 0,
      `ceoRelGuard=${ceoDeleteReferencedCustomer.code}, ceoReadQuotes=${ceoReadSnap.quotations.length}, salesWritePo=${salesWritePo.code}, pendingWrite=${pendingWrite.code}`
    );
  }

  // --------------------------------------------------------------------------
  // SUITE 9: DUPLICATE-SUBMISSION LOCKING & LIVE KPI ACCURACY
  // --------------------------------------------------------------------------
  {
    driver.artificialDelayMs = 40;
    const dupQuote: QuotationRecord = {
      id: 'QT-DUP-LOCK-99',
      rfqReference: 'RFQ-DUP-99',
      quoteDate: '2026-03-29',
      validUntil: '2026-04-28',
      customerId: 'CUST-001',
      customerName: 'Bharat Forge Partner',
      contactPerson: 'K. Mehta',
      productId: 'PROD-001',
      productName: 'Forged Gear Blank',
      materialGrade: '42CrMo4',
      standard: 'DIN 17200',
      unitWeightKg: 60,
      inquiryQtyPcs: 20,
      quotedRatePerKg: 210,
      quotedRatePerPc: 12600,
      totalQuotedValue: 252000,
      estimatedMarginPercent: 19,
      deliveryLeadWeeks: 5,
      isRepeatOrder: false,
      status: 'submitted',
      nextFollowUpDate: '2026-04-06',
      followUpNotes: 'Concurrent submit test',
    };

    const [firstCall, secondCall] = await Promise.all([
      engine.createQuotation(dupQuote, USERS.sales, false),
      engine.createQuotation(dupQuote, USERS.sales, false),
    ]);
    driver.artificialDelayMs = 0;

    const fullSnap = await engine.loadProductionSnapshot(USERS.super_admin);
    const liveKpis = computeLiveDashboardKpis({
      baseKpis: ZERO_DASHBOARD_KPIS,
      salesOrders: fullSnap.salesOrders,
      rawMaterials: fullSnap.rawMaterials,
      outstandingAgeing: fullSnap.outstandingAgeing,
      dispatches: fullSnap.dispatches,
    });
    const liveProd = computeLiveProductionSummary({
      baseSummary: ZERO_PRODUCTION_SUMMARY,
      qualityInspections: fullSnap.qualityInspections,
      machineLogs: fullSnap.machineLogs,
    });

    recordResult(
      'P5-T09',
      'Duplicate-Submit Lock & Live KPIs',
      'Concurrent duplicate submissions are blocked with DUPLICATE_IN_FLIGHT and live KPIs compute accurately from Firestore state',
      firstCall.success &&
        !secondCall.success &&
        secondCall.code === 'DUPLICATE_IN_FLIGHT' &&
        liveKpis.openOrdersValue === 444000 &&
        liveKpis.todaysDispatchQty === 30 &&
        liveKpis.dispatchPendingQty === 20 &&
        liveKpis.totalOutstanding === 380000 &&
        liveProd.totalRejectionPercent === 2.0,
      `first=${firstCall.code}, second=${secondCall.code}, openOrdersVal=${liveKpis.openOrdersValue}, dispatchedQty=${liveKpis.todaysDispatchQty}`
    );
  }

  // --------------------------------------------------------------------------
  // SUITE 10: ROLLBACK READINESS & RTDB SERVICE PRESERVATION
  // --------------------------------------------------------------------------
  {
    const rtdbExportsIntact =
      typeof rtdbService.DEFAULT_DASHBOARD_KPIS === 'object' &&
      typeof rtdbService.createSalesOrderInRtdb === 'function' &&
      typeof rtdbService.updateSalesOrderInRtdb === 'function' &&
      typeof rtdbService.recordStockMovementInRtdb === 'function' &&
      typeof rtdbService.recordQualityInspectionInRtdb === 'function' &&
      typeof rtdbService.recordDispatchInRtdb === 'function' &&
      typeof rtdbService.recordCustomerPaymentInRtdb === 'function';

    recordResult(
      'P5-T10',
      'Rollback Readiness',
      'src/services/rtdbService.ts exports remain intact for controlled rollback if required',
      rtdbExportsIntact,
      `rtdbExportsIntact=${rtdbExportsIntact}`
    );
  }

  console.log('\n================================================================================');
  const passedCount = results.filter((r) => r.passed).length;
  console.log(` PHASE 5 VERIFICATION SUMMARY: ${passedCount}/${results.length} TESTS PASSED`);
  console.log('================================================================================\n');

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runPhase5Verification().catch((err) => {
  console.error('Unhandled error in Phase 5 verification suite:', err);
  process.exit(1);
});
