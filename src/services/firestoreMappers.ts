import {
  ActionQueueItem,
  AuditLogEntry,
  Customer,
  DataRecordOrigin,
  DimensionalInspectionReport,
  DispatchConsignmentRecord,
  FurnaceBatchLog,
  JobCostSheet,
  MachineMaintenanceTicket,
  OrderJourney,
  OrderStatus,
  OutstandingAgeingRecord,
  PowerConsumptionLog,
  Product,
  PurchaseOrderRecord,
  QualityInspectionRecord,
  QuotationRecord,
  RawMaterialStock,
  RtdbAlertThresholds,
  RtdbDashboardKpis,
  RtdbProductionSummary,
  ShopMachineLog,
  SteelMillSupplier,
  StockMovement,
  TenderRecord,
  LeadRecord,
  UserProfile,
  TaskRecord,
  HandoverRecord,
  PurchaseRequisitionRecord,
  NcrCapaRecord,
  PaymentFollowUpRecord,
  ROLE_PERMISSION_DEFAULTS,
  getOrganizationalGroupForRole,
  resolveGranularRoleFromGroupOrLegacy,
} from '../types/mis';
import {
  FirestoreActionQueueDoc,
  FirestoreAuditLogDoc,
  FirestoreCustomerDoc,
  FirestoreDimensionalReportDoc,
  FirestoreDispatchDoc,
  FirestoreFurnaceLogDoc,
  FirestoreJobCostSheetDoc,
  FirestoreMachineLogDoc,
  FirestoreMaintenanceTicketDoc,
  FirestoreOutstandingPaymentDoc,
  FirestorePowerLogDoc,
  FirestoreProductDoc,
  FirestorePurchaseOrderDoc,
  FirestoreQualityInspectionDoc,
  FirestoreQuotationDoc,
  FirestoreRawMaterialDoc,
  FirestoreSalesOrderDoc,
  FirestoreStockMovementDoc,
  FirestoreSupplierDoc,
  FirestoreSystemConfigDoc,
  FirestoreTenderDoc,
  FirestoreLeadDoc,
  FirestoreTaskDoc,
  FirestoreHandoverDoc,
  FirestorePurchaseRequisitionDoc,
  FirestoreNcrCapaDoc,
  FirestorePaymentFollowUpDoc,
  FirestoreOrderCommercialDoc,
} from './firestoreService';

// ============================================================================
// COMPACT METADATA PACKING HELPERS (bounded to firestore.rules string limits)
// ============================================================================

function packMeta(
  primaryValue: string,
  meta: Record<string, string | number | boolean | undefined>,
  maxLength: number
): string {
  const cleanPrimary = (primaryValue || '-').replace(/\|/g, '/').trim();
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined && v !== null && v !== '') {
      const cleanVal = String(v).replace(/\|/g, '/').replace(/=/g, ':').trim();
      pairs.push(`${k}=${cleanVal}`);
    }
  }
  if (pairs.length === 0) {
    return cleanPrimary.slice(0, maxLength);
  }
  let result = cleanPrimary;
  for (const pair of pairs) {
    const candidate = `${result}|${pair}`;
    if (candidate.length <= maxLength) {
      result = candidate;
    }
  }
  return result.slice(0, maxLength);
}

function unpackMeta(
  packed: string | undefined,
  defaultPrimary = '-'
): {
  primary: string;
  meta: Record<string, string>;
} {
  if (!packed) {
    return { primary: defaultPrimary, meta: {} };
  }
  const parts = packed.split('|');
  const primary = parts[0] || defaultPrimary;
  const meta: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eqIdx = parts[i].indexOf('=');
    if (eqIdx > 0) {
      const key = parts[i].slice(0, eqIdx);
      const val = parts[i].slice(eqIdx + 1);
      meta[key] = val;
    }
  }
  return { primary, meta };
}

function parseNumericMm(val: string | number | undefined, fallback = 100): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val > 0 ? val : fallback;
  if (!val) return fallback;
  const match = String(val).match(/-?\d+(\.\d+)?/);
  if (!match) return fallback;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// ============================================================================
// 1. REGISTER #1: QUOTATIONS (/quotations/{quoteId})
// ============================================================================

const QUOTE_UI_TO_FS_STATUS: Record<
  QuotationRecord['status'],
  FirestoreQuotationDoc['status']
> = {
  draft: 'Draft',
  submitted: 'Sent',
  follow_up: 'Under Negotiation',
  negotiation: 'Under Negotiation',
  won: 'Won',
  lost: 'Lost',
};

const QUOTE_FS_TO_UI_STATUS: Record<
  FirestoreQuotationDoc['status'],
  QuotationRecord['status']
> = {
  Draft: 'draft',
  Sent: 'submitted',
  'Under Negotiation': 'negotiation',
  Won: 'won',
  Lost: 'lost',
  Expired: 'lost',
};

export function mapQuotationToFirestoreDoc(
  q: QuotationRecord,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreQuotationDoc {
  const nowIso = new Date().toISOString();
  const weightKg = q.unitWeightKg > 0 ? q.unitWeightKg : 25;
  const qtyPcs = q.inquiryQtyPcs > 0 ? q.inquiryQtyPcs : 1;
  const quantityMT = Math.max(0.001, Number(((qtyPcs * weightKg) / 1000).toFixed(3)));
  const quotedRatePerKg = Math.max(
    0,
    q.quotedRatePerKg > 0
      ? q.quotedRatePerKg
      : Number((q.quotedRatePerPc / Math.max(1, weightKg)).toFixed(2))
  );

  const preparedBy = packMeta(
    q.contactPerson || 'Sales Desk',
    {
      st: q.status,
      ord: q.convertedOrderId,
      cid: q.customerId,
      pid: q.productId,
      qdt: q.quoteDate,
      pcs: q.inquiryQtyPcs,
      wkg: q.unitWeightKg,
      rpp: q.quotedRatePerPc,
      mgn: q.estimatedMarginPercent,
      lw: q.deliveryLeadWeeks,
      rep: q.isRepeatOrder ? 1 : 0,
      fdt: q.nextFollowUpDate,
      fn: q.followUpNotes ? q.followUpNotes.slice(0, 18) : undefined,
    },
    120
  );

  return {
    id: q.id,
    quoteNo: (q.rfqReference || q.id).slice(0, 64),
    customerId: optionalText(q.customerId, 128),
    customerName: (q.customerName || 'Montex Customer').slice(0, 160),
    contactPerson: (q.contactPerson || 'Procurement Head').slice(0, 120),
    productId: optionalText(q.productId, 128),
    productName: (q.productName || 'Forged Component').slice(0, 160),
    steelGrade: (q.materialGrade || 'ASTM A105').slice(0, 64),
    quantityMT,
    quotedRatePerKg,
    totalValueINR: Math.max(0, q.totalQuotedValue || 0),
    validUntil: (q.validUntil || q.quoteDate || nowIso.split('T')[0]).slice(0, 40),
    status: QUOTE_UI_TO_FS_STATUS[q.status] || 'Sent',
    preparedBy,
    followUpNotes: (q.followUpNotes || '').slice(0, 600),
    nextFollowUpDate: (q.nextFollowUpDate || nowIso.split('T')[0]).slice(0, 40),
    convertedOrderId: q.convertedOrderId ? q.convertedOrderId.slice(0, 128) : undefined,
    inquiryQtyPcs: Math.max(0, q.inquiryQtyPcs || 0),
    unitWeightKg: Math.max(0, q.unitWeightKg || 0),
    quotedRatePerPc: Math.max(0, q.quotedRatePerPc || 0),
    estimatedMarginPercent: q.estimatedMarginPercent || undefined,
    deliveryLeadWeeks: q.deliveryLeadWeeks ? Math.max(0, q.deliveryLeadWeeks) : undefined,
    isRepeatOrder: Boolean(q.isRepeatOrder),
    createdAt: q.quoteDate && q.quoteDate.length >= 4 ? q.quoteDate : nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToQuotation(doc: FirestoreQuotationDoc): QuotationRecord {
  const { primary: packedContact, meta } = unpackMeta(doc.preparedBy, 'Procurement Head');
  const contactPerson = doc.contactPerson || packedContact;
  const unitWeightKg =
    doc.unitWeightKg !== undefined
      ? doc.unitWeightKg
      : meta.wkg
      ? Number(meta.wkg)
      : 0;
  const inquiryQtyPcs =
    doc.inquiryQtyPcs !== undefined
      ? doc.inquiryQtyPcs
      : meta.pcs
      ? Number(meta.pcs)
      : unitWeightKg > 0
      ? Math.round((doc.quantityMT * 1000) / unitWeightKg)
      : 0;
  const quotedRatePerKg =
    doc.quotedRatePerKg ?? Number((doc.totalValueINR / Math.max(1, doc.quantityMT * 1000)).toFixed(2));
  const quotedRatePerPc =
    doc.quotedRatePerPc !== undefined
      ? doc.quotedRatePerPc
      : meta.rpp
      ? Number(meta.rpp)
      : inquiryQtyPcs > 0
      ? Math.round(doc.totalValueINR / inquiryQtyPcs)
      : 0;
  const status: QuotationRecord['status'] =
    (meta.st as QuotationRecord['status']) ||
    QUOTE_FS_TO_UI_STATUS[doc.status] ||
    'submitted';

  return {
    id: doc.id,
    rfqReference: doc.quoteNo,
    quoteDate: meta.qdt || doc.createdAt.split('T')[0],
    validUntil: doc.validUntil || doc.createdAt.split('T')[0],
    customerId: doc.customerId || meta.cid || '',
    customerName: doc.customerName,
    contactPerson,
    productId: doc.productId || meta.pid || '',
    productName: doc.productName,
    materialGrade: doc.steelGrade,
    standard: '',
    unitWeightKg,
    inquiryQtyPcs,
    quotedRatePerKg,
    quotedRatePerPc,
    totalQuotedValue: doc.totalValueINR,
    estimatedMarginPercent:
      doc.estimatedMarginPercent !== undefined
        ? doc.estimatedMarginPercent
        : meta.mgn !== undefined
        ? Number(meta.mgn)
        : 0,
    deliveryLeadWeeks:
      doc.deliveryLeadWeeks !== undefined
        ? doc.deliveryLeadWeeks
        : meta.lw !== undefined
        ? Number(meta.lw)
        : 0,
    isRepeatOrder: doc.isRepeatOrder !== undefined ? doc.isRepeatOrder : meta.rep === '1',
    status,
    nextFollowUpDate: doc.nextFollowUpDate || meta.fdt || '',
    followUpNotes:
      doc.followUpNotes || meta.fn || '',
    convertedOrderId: doc.convertedOrderId || meta.ord || undefined,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

// ============================================================================
// 2. REGISTER #2: TENDERS (/tenders/{tenderId})
// ============================================================================

const TENDER_UI_TO_FS_STATUS: Record<
  TenderRecord['technicalBidStatus'],
  FirestoreTenderDoc['technicalBidStatus']
> = {
  under_preparation: 'Preparing',
  submitted: 'Submitted',
  qualified: 'Qualified',
  disqualified: 'Disqualified',
  awarded: 'Awarded',
};

const TENDER_FS_TO_UI_STATUS: Record<
  FirestoreTenderDoc['technicalBidStatus'],
  TenderRecord['technicalBidStatus']
> = {
  Preparing: 'under_preparation',
  Submitted: 'submitted',
  Qualified: 'qualified',
  Disqualified: 'disqualified',
  Awarded: 'awarded',
  Lost: 'disqualified',
};

export function mapTenderToFirestoreDoc(
  t: TenderRecord,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreTenderDoc {
  const nowIso = new Date().toISOString();
  const ownerName = packMeta(
    t.assignedOwner || 'Tender Desk',
    {
      tb: t.technicalBidStatus,
      pdt: t.priceBidOpeningDate,
      lak: t.estimatedValueLakhs,
      itm: t.itemSummary ? t.itemSummary.slice(0, 32) : undefined,
    },
    120
  );

  return {
    id: t.id,
    tenderNo: (t.tenderNumber || t.id).slice(0, 80),
    issuingAuthority: (t.issuingAuthority || 'PSU Authority').slice(0, 160),
    projectTitle: (t.projectTitle || 'Industrial Forging Supply Tender').slice(0, 200),
    estimatedValueINR: Math.max(0, Math.round((t.estimatedValueLakhs || 0) * 100000)),
    emdAmountINR: Math.max(0, t.emdAmount || 0),
    submissionDeadline: (t.bidSubmissionDate || nowIso.split('T')[0]).slice(0, 40),
    technicalBidStatus: TENDER_UI_TO_FS_STATUS[t.technicalBidStatus] || 'Submitted',
    ownerName,
    createdAt: t.bidSubmissionDate && t.bidSubmissionDate.length >= 4 ? t.bidSubmissionDate : nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

const LEAD_STAGE_TO_FS: Record<LeadRecord['stage'], FirestoreLeadDoc['stage']> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  rfq_received: 'RFQ Received',
  quoted: 'Quoted',
  won: 'Won',
  lost: 'Lost',
};
const LEAD_STAGE_FROM_FS = Object.fromEntries(Object.entries(LEAD_STAGE_TO_FS).map(([k, v]) => [v, k])) as Record<string, LeadRecord['stage']>;

export function mapLeadToFirestoreDoc(l: LeadRecord, dataOrigin: DataRecordOrigin = 'production'): FirestoreLeadDoc {
  const nowIso = new Date().toISOString();
  return {
    id: l.id,
    companyName: requiredText(l.companyName, 160, 'Enter the company name.'),
    contactPerson: requiredText(l.contactPerson, 120, 'Enter who you spoke to.'),
    phone: optionalText(l.phone, 40),
    email: optionalText(l.email, 160),
    city: optionalText(l.city, 120),
    industry: optionalText(l.industry, 120),
    source: requiredText(l.source, 60, 'Choose where the enquiry came from.'),
    productInterest: requiredText(l.productInterest, 300, 'Enter what they are asking for.'),
    materialGrade: optionalText(l.materialGrade, 64),
    estimatedValueINR: l.estimatedValueInr && l.estimatedValueInr > 0 ? l.estimatedValueInr : undefined,
    stage: LEAD_STAGE_TO_FS[l.stage] || 'New',
    ownerUid: requiredText(l.ownerUid, 128, 'Choose who owns this enquiry.'),
    ownerName: requiredText(l.ownerName, 160, 'Choose who owns this enquiry.'),
    nextFollowUpDate: optionalText(l.nextFollowUpDate, 40),
    lastContactDate: optionalText(l.lastContactDate, 40),
    notes: optionalText(l.notes, 4000),
    lostReason: optionalText(l.lostReason, 400),
    customerId: optionalText(l.customerId, 128),
    quotationId: optionalText(l.quotationId, 128),
    createdByUid: requiredText(l.createdByUid, 128, 'Missing creator.'),
    createdAt: l.createdAt && l.createdAt.length >= 4 ? l.createdAt : nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToLead(doc: FirestoreLeadDoc): LeadRecord {
  return {
    ...doc,
    estimatedValueInr: doc.estimatedValueINR,
    stage: LEAD_STAGE_FROM_FS[doc.stage] || 'new',
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

export function mapFirestoreDocToTender(doc: FirestoreTenderDoc): TenderRecord {
  const { primary: assignedOwner, meta } = unpackMeta(doc.ownerName, 'Tender Desk');
  const estimatedValueLakhs =
    meta.lak !== undefined
      ? Number(meta.lak)
      : Number((doc.estimatedValueINR / 100000).toFixed(2));

  return {
    id: doc.id,
    tenderNumber: doc.tenderNo,
    issuingAuthority: doc.issuingAuthority,
    projectTitle: doc.projectTitle,
    itemSummary: meta.itm || doc.projectTitle,
    estimatedValueLakhs,
    emdAmount: doc.emdAmountINR ?? 0,
    bidSubmissionDate: doc.submissionDeadline,
    priceBidOpeningDate: meta.pdt || doc.submissionDeadline,
    technicalBidStatus:
      (meta.tb as TenderRecord['technicalBidStatus']) ||
      TENDER_FS_TO_UI_STATUS[doc.technicalBidStatus] ||
      'submitted',
    assignedOwner,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

// ============================================================================
// 3. REGISTER #3: PURCHASE ORDERS (/purchaseOrders/{poId})
// ============================================================================

const PO_UI_TO_FS_STATUS: Record<
  PurchaseOrderRecord['status'],
  FirestorePurchaseOrderDoc['status']
> = {
  issued: 'Issued',
  in_rolling: 'In Transit',
  partially_received: 'Partially Received',
  completed: 'Received',
};

const PO_FS_TO_UI_STATUS: Record<
  FirestorePurchaseOrderDoc['status'],
  PurchaseOrderRecord['status']
> = {
  Draft: 'issued',
  Issued: 'issued',
  'In Transit': 'in_rolling',
  'Partially Received': 'partially_received',
  Received: 'completed',
  Cancelled: 'issued',
};

export function mapPurchaseOrderToFirestoreDoc(
  po: PurchaseOrderRecord,
  dataOrigin: DataRecordOrigin = 'production'
): FirestorePurchaseOrderDoc {
  const nowIso = new Date().toISOString();
  const createdBy = packMeta(
    'Purchase Desk',
    {
      mid: po.materialId,
      mcd: po.materialCode,
      sec: po.sectionMm,
      ht: po.millHeatNumber,
      job: po.linkedJobNumber,
      st: po.status,
    },
    128
  );

  return {
    id: po.id,
    poNumber: (po.poNumber || po.id).slice(0, 64),
    supplierId: (po.supplierId || 'SUP-001').slice(0, 128),
    supplierName: (po.supplierName || 'Approved Steel Mill').slice(0, 160),
    steelGrade: (po.materialGrade || 'ASTM A105').slice(0, 64),
    orderedMT: Math.max(0.01, Number((po.orderedMt || 1).toFixed(2))),
    receivedMT: Math.max(0, Number((po.receivedMt || 0).toFixed(2))),
    ratePerMT: Math.max(0, po.ratePerMt || 0),
    totalAmountINR: Math.max(0, po.totalValue || 0),
    orderDate: (po.poDate || nowIso.split('T')[0]).slice(0, 40),
    expectedDeliveryDate: (po.expectedDeliveryDate || nowIso.split('T')[0]).slice(0, 40),
    status: PO_UI_TO_FS_STATUS[po.status] || 'Issued',
    createdBy,
    createdAt: po.poDate && po.poDate.length >= 4 ? po.poDate : nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToPurchaseOrder(
  doc: FirestorePurchaseOrderDoc
): PurchaseOrderRecord {
  const { meta } = unpackMeta(doc.createdBy, 'Purchase Desk');
  const orderedMt = doc.orderedMT;
  const receivedMt = doc.receivedMT ?? 0;
  const pendingMt = Math.max(0, Number((orderedMt - receivedMt).toFixed(2)));

  return {
    id: doc.id,
    poNumber: doc.poNumber,
    poDate: doc.orderDate || doc.createdAt.split('T')[0],
    supplierId: doc.supplierId || '',
    supplierName: doc.supplierName,
    materialId: meta.mid || '',
    materialCode: meta.mcd || '',
    materialGrade: doc.steelGrade,
    sectionMm: meta.sec || '',
    linkedJobNumber: meta.job || '',
    orderedMt,
    receivedMt,
    pendingMt,
    ratePerMt: doc.ratePerMT,
    totalValue: doc.totalAmountINR,
    expectedDeliveryDate: doc.expectedDeliveryDate,
    millHeatNumber: meta.ht || '',
    // Quantities are the truth for receipt progress; the packed status only adds 'at mill'.
    status:
      (receivedMt >= orderedMt && orderedMt > 0 ? 'completed' : receivedMt > 0 ? 'partially_received' : undefined) ||
      (meta.st as PurchaseOrderRecord['status']) ||
      PO_FS_TO_UI_STATUS[doc.status] ||
      'issued',
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

// ============================================================================
// 4. REGISTER #4: SHOP MACHINE LOGS (/machineLogs/{logId})
// ============================================================================

export function mapMachineLogToFirestoreDoc(
  log: ShopMachineLog,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreMachineLogDoc {
  const nowIso = new Date().toISOString();
  const shiftMap: Record<string, FirestoreMachineLogDoc['shift']> = {
    'Shift A (06:00-14:00)': 'Shift A',
    'Shift B (14:00-22:00)': 'Shift B',
    'Shift C (22:00-06:00)': 'Shift C',
    'Shift A': 'Shift A',
    'Shift B': 'Shift B',
    'Shift C': 'Shift C',
  };

  const operationType: FirestoreMachineLogDoc['operationType'] =
    log.machineName.toLowerCase().includes('ring')
      ? 'Ring Rolling'
      : log.machineName.toLowerCase().includes('hammer')
      ? 'Closed Die Hammer'
      : log.machineName.toLowerCase().includes('cnc')
      ? 'CNC Turning'
      : log.machineName.toLowerCase().includes('saw')
      ? 'Band Saw Cutting'
      : 'Open Die Forging';

  const outputTons = Math.max(
    0,
    Number(((Math.max(0, log.forgedOutputPcs) * 42) / 1000).toFixed(2))
  );

  const operatorName = packMeta(
    log.operatorName || 'Shop Operator',
    {
      dt: log.date,
      in: log.inputBilletsPcs,
      out: log.forgedOutputPcs,
      ok: log.okPcs,
      rj: log.rejectedPcs,
      rw: log.reworkPcs,
      pn: log.productName ? log.productName.slice(0, 22) : undefined,
    },
    120
  );

  return {
    id: log.id,
    machineId: (log.machineId || 'MCH-01').slice(0, 64),
    machineName: (log.machineName || 'Forging Press').slice(0, 120),
    shift: shiftMap[log.shift] || 'Shift A',
    operatorName,
    orderId: (log.jobNumber || 'JOB-MF-2026-0412').slice(0, 128),
    operationType,
    outputTons,
    utilizationPct: Math.min(100, Math.max(0, log.capacityUtilizationPercent || 0)),
    downtimeMinutes: Math.max(0, log.downtimeMinutes || 0),
    status: log.downtimeMinutes > 60 ? 'Breakdown' : 'Running',
    loggedAt: log.date && log.date.length >= 4 ? log.date : nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToMachineLog(doc: FirestoreMachineLogDoc): ShopMachineLog {
  const { primary: operatorName, meta } = unpackMeta(doc.operatorName, '');
  const shiftLabelMap: Record<FirestoreMachineLogDoc['shift'], ShopMachineLog['shift']> = {
    'Shift A': 'Shift A (06:00-14:00)',
    'Shift B': 'Shift B (14:00-22:00)',
    'Shift C': 'Shift C (22:00-06:00)',
  };

  const forgedOutputPcs =
    meta.out !== undefined
      ? Number(meta.out)
      : Math.max(1, Math.round((doc.outputTons * 1000) / 42));
  const inputBilletsPcs = meta.in !== undefined ? Number(meta.in) : forgedOutputPcs;
  const rejectedPcs = meta.rj !== undefined ? Number(meta.rj) : 0;
  const reworkPcs = meta.rw !== undefined ? Number(meta.rw) : 0;
  const okPcs =
    meta.ok !== undefined
      ? Number(meta.ok)
      : Math.max(0, forgedOutputPcs - rejectedPcs - reworkPcs);

  return {
    id: doc.id,
    date: meta.dt || doc.loggedAt.split('T')[0],
    shift: shiftLabelMap[doc.shift] || 'Shift A (06:00-14:00)',
    machineId: doc.machineId,
    machineName: doc.machineName,
    operatorName,
    jobNumber: doc.orderId || '',
    productName: meta.pn || '',
    inputBilletsPcs,
    forgedOutputPcs,
    okPcs,
    rejectedPcs,
    reworkPcs,
    downtimeMinutes: doc.downtimeMinutes ?? 0,
    capacityUtilizationPercent: doc.utilizationPct ?? 0,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

// ============================================================================
// 5. REGISTER #5: FURNACE BATCH LOGS (/furnaceLogs/{batchId})
// ============================================================================

const FURNACE_UI_TO_FS_STATUS: Record<
  FurnaceBatchLog['status'],
  FirestoreFurnaceLogDoc['status']
> = {
  within_spec: 'Completed',
  completed: 'Completed',
  temp_deviation: 'Aborted',
};

const FURNACE_FS_TO_UI_STATUS: Record<
  FirestoreFurnaceLogDoc['status'],
  FurnaceBatchLog['status']
> = {
  Charging: 'within_spec',
  Heating: 'within_spec',
  Soaking: 'within_spec',
  Cooling: 'within_spec',
  Completed: 'within_spec',
  Aborted: 'temp_deviation',
};

export function mapFurnaceLogToFirestoreDoc(
  batch: FurnaceBatchLog,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreFurnaceLogDoc {
  const nowIso = new Date().toISOString();
  const orderId = packMeta(
    batch.jobNumber || 'JOB-MF-2026-0412',
    {
      fn: batch.furnaceName,
      sh: batch.shift,
      ft: batch.fuelType,
      fu: batch.fuelUnit,
      ht: batch.heatNumber,
      pk: batch.peakRecordedTempC,
      sf: batch.specificFuelPerMt,
      st: batch.status,
    },
    128
  );

  return {
    id: batch.id,
    furnaceId: (batch.furnaceId || 'HTF-01').slice(0, 64),
    batchNo: (batch.batchNumber || batch.id).slice(0, 64),
    orderId,
    steelGrade: 'ASTM A105',
    cycleType: 'Normalizing',
    targetTempC: Math.max(100, batch.targetTempC || 880),
    soakTimeHours: Math.max(0, Number(((batch.soakingTimeMinutes || 180) / 60).toFixed(2))),
    chargeWeightMT: Math.max(0.01, Number((batch.chargeWeightMt || 1).toFixed(2))),
    fuelConsumedSCM: Math.max(0, batch.fuelConsumedQty || 0),
    status: FURNACE_UI_TO_FS_STATUS[batch.status] || 'Completed',
    startedAt: batch.date && batch.date.length >= 4 ? batch.date : nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToFurnaceLog(doc: FirestoreFurnaceLogDoc): FurnaceBatchLog {
  const { primary: jobNumber, meta } = unpackMeta(doc.orderId, '');
  const chargeWeightMt = doc.chargeWeightMT;
  const fuelConsumedQty = doc.fuelConsumedSCM ?? 0;

  return {
    id: doc.id,
    batchNumber: doc.batchNo,
    date: doc.startedAt.split('T')[0],
    shift: meta.sh || 'Shift A',
    furnaceId: doc.furnaceId,
    furnaceName: meta.fn || `${doc.furnaceId} Furnace`,
    fuelType: (meta.ft as FurnaceBatchLog['fuelType']) || 'PNG (Natural Gas)',
    jobNumber,
    heatNumber: meta.ht || '',
    chargeWeightMt,
    targetTempC: doc.targetTempC,
    peakRecordedTempC: meta.pk !== undefined ? Number(meta.pk) : doc.targetTempC,
    soakingTimeMinutes: Math.round((doc.soakTimeHours ?? 0) * 60),
    fuelConsumedQty,
    fuelUnit: (meta.fu as FurnaceBatchLog['fuelUnit']) || 'SCM',
    specificFuelPerMt:
      meta.sf !== undefined
        ? Number(meta.sf)
        : Number((fuelConsumedQty / Math.max(0.1, chargeWeightMt)).toFixed(1)),
    status:
      (meta.st as FurnaceBatchLog['status']) ||
      FURNACE_FS_TO_UI_STATUS[doc.status] ||
      'within_spec',
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

// ============================================================================
// 6. REGISTER #6: MAINTENANCE TICKETS (/maintenanceTickets/{ticketId})
// ============================================================================

const MAINT_UI_TO_FS_STATUS: Record<
  MachineMaintenanceTicket['status'],
  FirestoreMaintenanceTicketDoc['status']
> = {
  resolved: 'Resolved',
  in_repair: 'In Progress',
  awaiting_spares: 'Awaiting Spares',
};

const MAINT_FS_TO_UI_STATUS: Record<
  FirestoreMaintenanceTicketDoc['status'],
  MachineMaintenanceTicket['status']
> = {
  Open: 'in_repair',
  'In Progress': 'in_repair',
  'Awaiting Spares': 'awaiting_spares',
  Resolved: 'resolved',
  Closed: 'resolved',
};

export function mapMaintenanceTicketToFirestoreDoc(
  t: MachineMaintenanceTicket,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreMaintenanceTicketDoc {
  const nowIso = new Date().toISOString();
  const typeMap: Record<
    MachineMaintenanceTicket['maintenanceType'],
    FirestoreMaintenanceTicketDoc['maintenanceType']
  > = {
    Breakdown: 'Breakdown',
    'Preventive (PM)': 'Preventive',
    'Die Changeover': 'Die Change',
    Calibration: 'Calibration',
  };

  const assignedTechnician = packMeta(
    t.technicianName || 'Maintenance Team',
    {
      mt: t.maintenanceType,
      st: t.status,
      dm: t.downtimeMinutes,
      cost: t.maintenanceCostInr,
      rc: t.rootCause ? t.rootCause.slice(0, 18) : undefined,
      rp: t.replacementParts ? t.replacementParts.slice(0, 18) : undefined,
    },
    120
  );

  return {
    id: t.id,
    ticketNo: t.id.slice(0, 64),
    machineId: (t.machineId || 'MCH-01').slice(0, 64),
    machineName: (t.machineName || 'Shop Machine').slice(0, 120),
    maintenanceType: typeMap[t.maintenanceType] || 'Breakdown',
    priority: t.maintenanceType === 'Breakdown' ? 'Critical' : 'Medium',
    issueDescription: (t.issueDescription || 'Scheduled maintenance inspection').slice(0, 500),
    assignedTechnician,
    estimatedDowntimeHours: Math.max(0, Number(((t.downtimeMinutes || 0) / 60).toFixed(2))),
    status: MAINT_UI_TO_FS_STATUS[t.status] || 'In Progress',
    reportedAt: t.ticketDate && t.ticketDate.length >= 4 ? t.ticketDate : nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToMaintenanceTicket(
  doc: FirestoreMaintenanceTicketDoc
): MachineMaintenanceTicket {
  const { primary: technicianName, meta } = unpackMeta(
    doc.assignedTechnician,
    ''
  );
  const reverseTypeMap: Record<
    FirestoreMaintenanceTicketDoc['maintenanceType'],
    MachineMaintenanceTicket['maintenanceType']
  > = {
    Breakdown: 'Breakdown',
    Preventive: 'Preventive (PM)',
    'Hydraulic Seal': 'Breakdown',
    'Die Change': 'Die Changeover',
    Calibration: 'Calibration',
  };

  return {
    id: doc.id,
    ticketDate: doc.reportedAt.split('T')[0],
    machineId: doc.machineId,
    machineName: doc.machineName,
    maintenanceType:
      (meta.mt as MachineMaintenanceTicket['maintenanceType']) ||
      reverseTypeMap[doc.maintenanceType] ||
      'Breakdown',
    issueDescription: doc.issueDescription,
    rootCause: meta.rc || '',
    replacementParts: meta.rp || '',
    downtimeMinutes:
      meta.dm !== undefined
        ? Number(meta.dm)
        : Math.round((doc.estimatedDowntimeHours ?? 0) * 60),
    maintenanceCostInr: meta.cost !== undefined ? Number(meta.cost) : 0,
    technicianName,
    status:
      (meta.st as MachineMaintenanceTicket['status']) ||
      MAINT_FS_TO_UI_STATUS[doc.status] ||
      'in_repair',
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

// ============================================================================
// 7. REGISTER #7: POWER CONSUMPTION LOGS (/powerLogs/{logId})
// ============================================================================

export function mapPowerLogToFirestoreDoc(
  p: PowerConsumptionLog,
  dataOrigin: DataRecordOrigin = 'production'
): FirestorePowerLogDoc {
  const nowIso = new Date().toISOString();
  const loggedBy = packMeta(
    'HT Substation',
    {
      kvah: p.totalKvah,
      tgt: p.targetKwhPerMt,
      cost: p.electricityCostInr,
      fs: p.furnaceSharePercent,
      ps: p.pressHammerSharePercent,
    },
    120
  );

  return {
    id: p.id,
    logDate: (p.date || nowIso.split('T')[0]).slice(0, 40),
    shift: 'Full Day',
    electricityKwh: Math.max(0, p.totalKwh || 0),
    pngGasSCM: 0,
    productionOutputMT: Math.max(0, p.forgedOutputMt || 0),
    kwhPerMT: Math.max(0, p.specificEnergyKwhPerMt || 0),
    powerFactor: p.powerFactor ? Math.min(1, Math.max(0, p.powerFactor)) : undefined,
    peakDemandKva: p.peakDemandKva ? Math.max(0, p.peakDemandKva) : undefined,
    loggedBy,
    createdAt: p.date && p.date.length >= 4 ? p.date : nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToPowerLog(doc: FirestorePowerLogDoc): PowerConsumptionLog {
  const { meta } = unpackMeta(doc.loggedBy, '');
  const n = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
  return {
    id: doc.id,
    date: doc.logDate,
    totalKwh: doc.electricityKwh,
    totalKvah: n(meta.kvah),
    powerFactor: doc.powerFactor || undefined,
    peakDemandKva: doc.peakDemandKva || undefined,
    forgedOutputMt: doc.productionOutputMT,
    specificEnergyKwhPerMt: doc.kwhPerMT,
    targetKwhPerMt: n(meta.tgt),
    electricityCostInr: n(meta.cost),
    furnaceSharePercent: n(meta.fs),
    pressHammerSharePercent: n(meta.ps),
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

// ============================================================================
// 8. REGISTER #8: DIMENSIONAL INSPECTION REPORTS (/dimensionalReports/{reportId})
// ============================================================================

/** Dimension names as stored: one observed value each for OD, bore and height. */
export const DIR_DIMENSIONS = ['Outer diameter (OD)', 'Bore (ID)', 'Height / thickness'] as const;

const mm = (v?: string) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export function mapDimensionalReportToFirestoreDoc(
  dir: DimensionalInspectionReport,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreDimensionalReportDoc {
  const nowIso = new Date().toISOString();
  const [od, bore, height] = dir.parameters || [];
  const odNominal = mm(od?.nominalMm);
  const odObserved = mm(od?.measuredMaxMm || od?.measuredMinMm);
  if (!dir.jobNumber) throw new RecordValidationError('Choose the job this report belongs to.');
  if (!odNominal || !odObserved) throw new RecordValidationError('Enter the nominal and measured outer diameter.');

  const toleranceResult: FirestoreDimensionalReportDoc['toleranceResult'] =
    dir.offeringStatus === 'rework_advised'
      ? 'Out of Tolerance'
      : dir.parameters?.some((p) => p.result === 'DEVIATION')
      ? 'Minor Deviation'
      : 'Within Tolerance';

  const inspectorName = packMeta(
    dir.inspectorName,
    {
      tpi: dir.tpiAgency || undefined,
      st: dir.offeringStatus,
      ss: dir.sampleSizePcs,
      po: dir.orderNo || undefined,
      cn: dir.customerName ? dir.customerName.slice(0, 20) : undefined,
      pn: dir.productName ? dir.productName.slice(0, 20) : undefined,
    },
    120
  );

  return {
    id: dir.id,
    reportNo: dir.id.slice(0, 64),
    orderId: dir.jobNumber.slice(0, 128),
    batchId: optionalText(dir.orderNo, 80),
    drawingNo: optionalText(dir.drawingNo, 80),
    outerDiaNominalMm: odNominal,
    outerDiaObservedMm: odObserved,
    innerDiaNominalMm: mm(bore?.nominalMm),
    innerDiaObservedMm: mm(bore?.measuredMaxMm || bore?.measuredMinMm),
    heightNominalMm: mm(height?.nominalMm),
    heightObservedMm: mm(height?.measuredMaxMm || height?.measuredMinMm),
    deviationMm: Number((odObserved - odNominal).toFixed(2)),
    toleranceResult,
    inspectorName,
    inspectedAt: dir.inspectionDate && dir.inspectionDate.length >= 4 ? dir.inspectionDate : nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToDimensionalReport(
  doc: FirestoreDimensionalReportDoc
): DimensionalInspectionReport {
  const { primary: inspectorName, meta } = unpackMeta(doc.inspectorName, '');
  const offeringStatus: DimensionalInspectionReport['offeringStatus'] =
    (meta.st as DimensionalInspectionReport['offeringStatus']) ||
    (doc.toleranceResult === 'Out of Tolerance'
      ? 'rework_advised'
      : doc.toleranceResult === 'Minor Deviation'
      ? 'offered_to_tpi'
      : 'witnessed_cleared');
  const result: 'OK' | 'DEVIATION' = doc.toleranceResult === 'Within Tolerance' ? 'OK' : 'DEVIATION';
  const rows: [string, number | undefined, number | undefined][] = [
    [DIR_DIMENSIONS[0], doc.outerDiaNominalMm, doc.outerDiaObservedMm],
    [DIR_DIMENSIONS[1], doc.innerDiaNominalMm, doc.innerDiaObservedMm],
    [DIR_DIMENSIONS[2], doc.heightNominalMm, doc.heightObservedMm],
  ];

  return {
    id: doc.id,
    jobNumber: doc.orderId,
    orderNo: meta.po || doc.batchId || '',
    customerName: meta.cn || '',
    drawingNo: doc.drawingNo || '',
    productName: meta.pn || '',
    sampleSizePcs: meta.ss ? Number(meta.ss) : 0,
    inspectorName,
    tpiAgency: meta.tpi || '',
    inspectionDate: doc.inspectedAt.split('T')[0],
    // Tolerance and instrument are not stored, so they are left blank rather than invented.
    parameters: rows
      .filter(([, nominal, observed]) => nominal || observed)
      .map(([dimensionName, nominal, observed]) => ({
        dimensionName,
        nominalMm: nominal ? String(nominal) : '',
        toleranceMm: '',
        measuredMinMm: observed ? String(observed) : '',
        measuredMaxMm: observed ? String(observed) : '',
        instrumentUsed: '',
        result,
      })),
    offeringStatus,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

// ============================================================================
// 9. CORE BUSINESS COLLECTIONS MAPPERS
// ============================================================================

const ORDER_STATUS_UI_TO_FS: Record<
  OrderStatus,
  {
    currentStage: FirestoreSalesOrderDoc['currentStage'];
    overallStatus: FirestoreSalesOrderDoc['overallStatus'];
  }
> = {
  po_registered: { currentStage: 'Order Confirmed', overallStatus: 'On Track' },
  job_assigned: { currentStage: 'Order Confirmed', overallStatus: 'On Track' },
  material_pending: { currentStage: 'Order Confirmed', overallStatus: 'On Track' },
  material_allocated: { currentStage: 'Raw Material Allocated', overallStatus: 'On Track' },
  in_production: { currentStage: 'Forging', overallStatus: 'On Track' },
  quality_pending: { currentStage: 'Quality Inspection', overallStatus: 'On Track' },
  quality_cleared: { currentStage: 'Quality Inspection', overallStatus: 'On Track' },
  clearance_pending: { currentStage: 'Quality Inspection', overallStatus: 'At Risk' },
  clearance_approved: { currentStage: 'Ready for Dispatch', overallStatus: 'On Track' },
  ready_for_dispatch: { currentStage: 'Ready for Dispatch', overallStatus: 'On Track' },
  partially_dispatched: { currentStage: 'Dispatched', overallStatus: 'On Track' },
  completed: { currentStage: 'Invoiced', overallStatus: 'Completed' },
  on_hold: { currentStage: 'Forging', overallStatus: 'Delayed' },
};

function omitKeys<T extends Record<string, any>>(value: T, keys: string[]): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k))) as Partial<T>;
}

/** Order value, rate and invoice amounts, kept apart from the order so only commercial roles can read them. */
export function mapOrderCommercialToFirestoreDoc(
  o: OrderJourney,
  updatedBy: string,
  createdAt: string | undefined,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreOrderCommercialDoc {
  const nowIso = new Date().toISOString();
  const li = o.lineItems?.[0];
  const doc: FirestoreOrderCommercialDoc = {
    orderId: o.id,
    totalValueINR: Math.max(0, o.totalValue || 0),
    updatedBy: updatedBy.slice(0, 128),
    createdAt: createdAt || nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
  if (li && typeof li.ratePerUnit === 'number') doc.ratePerUnitINR = Math.max(0, li.ratePerUnit);
  if (li && typeof li.totalAmount === 'number') doc.lineTotalINR = Math.max(0, li.totalAmount);
  const inv = o.invoiceStatus;
  if (inv && typeof inv.invoiceAmount === 'number') doc.invoiceAmountINR = Math.max(0, inv.invoiceAmount);
  if (inv && typeof inv.paidAmount === 'number') doc.paidAmountINR = Math.max(0, inv.paidAmount);
  if (inv && typeof inv.outstandingAmount === 'number') doc.outstandingAmountINR = Math.max(0, inv.outstandingAmount);
  return doc;
}

/** Puts the commercial figures back on an order; without them the order is marked restricted. */
export function applyOrderCommercial(
  order: OrderJourney,
  commercial: FirestoreOrderCommercialDoc | undefined
): OrderJourney {
  if (!commercial) return { ...order, commercialRestricted: true };
  const [first, ...rest] = order.lineItems || [];
  return {
    ...order,
    commercialRestricted: false,
    totalValue: commercial.totalValueINR,
    lineItems: first
      ? [
          {
            ...first,
            ratePerUnit: commercial.ratePerUnitINR ?? first.ratePerUnit,
            totalAmount: commercial.lineTotalINR ?? first.totalAmount,
          },
          ...rest,
        ]
      : order.lineItems,
    invoiceStatus: order.invoiceStatus
      ? {
          ...order.invoiceStatus,
          invoiceAmount: commercial.invoiceAmountINR ?? order.invoiceStatus.invoiceAmount,
          paidAmount: commercial.paidAmountINR ?? order.invoiceStatus.paidAmount,
          outstandingAmount: commercial.outstandingAmountINR ?? order.invoiceStatus.outstandingAmount,
        }
      : order.invoiceStatus,
  };
}

export function mapSalesOrderToFirestoreDoc(
  o: OrderJourney,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreSalesOrderDoc {
  const nowIso = new Date().toISOString();
  const li = o.lineItems?.[0];
  const orderedQty = (o.lineItems || []).reduce((acc, c) => acc + c.orderedQty, 0) || 1;
  const reqKg = o.materialStatus?.requiredKg || orderedQty * 25;
  const quantityMT = Math.max(0.01, Number((reqKg / 1000).toFixed(3)));
  const stageMapping = ORDER_STATUS_UI_TO_FS[o.status] || {
    currentStage: 'Order Confirmed',
    overallStatus: 'On Track',
  };

  return {
    orderId: o.id,
    customerId: o.customerId ? o.customerId.slice(0, 128) : undefined,
    customerName: (o.customerName || 'Montex Customer').slice(0, 160),
    productId: li?.productId ? li.productId.slice(0, 128) : undefined,
    productName: (li?.productName || 'Forged Component').slice(0, 160),
    steelGrade: (li?.materialGrade || o.materialStatus?.materialGrade || 'ASTM A105').slice(0, 64),
    quantityMT,
    orderDate: (o.poDate || nowIso.split('T')[0]).slice(0, 40),
    committedDeliveryDate: (o.expectedDeliveryDate || nowIso.split('T')[0]).slice(0, 40),
    currentStage: stageMapping.currentStage,
    overallStatus: stageMapping.overallStatus,
    // Delay and heat number are written only when actually known (never estimated).
    heatNo: optionalText(o.materialStatus?.heatNumber, 64),
    mtcStatus:
      o.qualityStatus?.mtcStatus === 'verified' || o.qualityStatus?.mtcStatus === 'issued'
        ? 'Verified'
        : o.qualityStatus?.mtcNumber && o.qualityStatus.mtcNumber !== '-'
        ? 'Generated'
        : 'Pending',
    dispatchStatus:
      o.dispatchStatus?.state === 'completed'
        ? 'Delivered'
        : o.dispatchStatus?.state === 'partial'
        ? 'Partial'
        : 'Not Started',
    invoiceNo: o.invoiceStatus?.invoiceNumber && o.invoiceStatus.invoiceNumber !== '-' ? o.invoiceStatus.invoiceNumber.slice(0, 64) : undefined,
    paymentStatus:
      o.invoiceStatus?.state === 'settled'
        ? 'Paid'
        : o.invoiceStatus?.state === 'partial'
        ? 'Partially Paid'
        : o.invoiceStatus?.state === 'invoiced'
        ? 'Pending'
        : 'Unbilled',
    stages: [
      {
        poNumber: o.poNumber,
        jobNumber: o.jobNumber,
        status: o.status,
        statusLabel: o.statusLabel,
        targetDeliveryDate: o.targetDeliveryDate,
        // Rates and amounts are stored in /orderCommercials, never on the order itself.
        lineItem: li ? omitKeys(li, ['ratePerUnit', 'totalAmount']) : null,
        materialStatus: o.materialStatus,
        qualityStatus: o.qualityStatus,
        clearanceStatus: o.clearanceStatus,
        dispatchStatus: o.dispatchStatus,
        invoiceStatus: o.invoiceStatus
          ? omitKeys(o.invoiceStatus, ['invoiceAmount', 'paidAmount', 'outstandingAmount'])
          : o.invoiceStatus,
      },
    ],
    fprUid: o.fprUid ? o.fprUid.slice(0, 128) : undefined,
    fprName: o.fprName ? o.fprName.slice(0, 120) : undefined,
    fprDepartment: o.fprDepartment ? o.fprDepartment.slice(0, 80) : undefined,
    handoverStage: o.handoverStage as any,
    documentChecklistStatus: o.documentChecklistStatus as any,
    creditHoldOverrideBy: o.creditHoldOverrideBy ? o.creditHoldOverrideBy.slice(0, 120) : undefined,
    creditHoldOverrideReason: o.creditHoldOverrideReason ? o.creditHoldOverrideReason.slice(0, 400) : undefined,
    qualityClearedBy: o.qualityClearedBy ?? undefined,
    qualityClearedAt: o.qualityClearedAt ?? undefined,
    financeClearedBy: o.financeClearedBy ?? undefined,
    financeClearedAt: o.financeClearedAt ?? undefined,
    createdAt: o.poDate && o.poDate.length >= 4 ? o.poDate : nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToSalesOrder(doc: FirestoreSalesOrderDoc): OrderJourney {
  const stageMeta = (doc.stages?.[0] || {}) as Record<string, any>;
  // Legacy docs without a stored line item: piece count is unknown, never estimated from tonnage.
  const orderedQty: number = stageMeta.lineItem?.orderedQty || 0;
  const ratePerUnit =
    stageMeta.lineItem?.ratePerUnit ?? (doc.totalValueINR ? Math.round(doc.totalValueINR / Math.max(1, orderedQty)) : 0);

  const fallbackStatus: OrderStatus =
    doc.overallStatus === 'Delayed'
      ? 'on_hold'
      : doc.overallStatus === 'Completed'
      ? 'completed'
      : doc.currentStage === 'Ready for Dispatch'
      ? 'ready_for_dispatch'
      : doc.currentStage === 'Dispatched'
      ? 'partially_dispatched'
      : doc.currentStage === 'Quality Inspection'
      ? 'quality_pending'
      : doc.currentStage === 'Forging'
      ? 'in_production'
      : 'material_pending';

  return {
    id: doc.orderId,
    poNumber: stageMeta.poNumber || `PO-${doc.orderId}`,
    poDate: doc.orderDate,
    jobNumber: stageMeta.jobNumber || `JOB-MF-${doc.orderId}`,
    customerId: doc.customerId || '',
    customerName: doc.customerName,
    // Filled from /orderCommercials for roles allowed to see order value.
    totalValue: doc.totalValueINR ?? 0,
    currency: 'INR',
    expectedDeliveryDate: doc.committedDeliveryDate,
    targetDeliveryDate: stageMeta.targetDeliveryDate || doc.committedDeliveryDate,
    status: (stageMeta.status as OrderStatus) || fallbackStatus,
    statusLabel:
      stageMeta.statusLabel || doc.delayReason || `${doc.currentStage} (${doc.overallStatus})`,
    fprUid: doc.fprUid,
    fprName: doc.fprName,
    fprDepartment: doc.fprDepartment,
    handoverStage: doc.handoverStage,
    documentChecklistStatus: doc.documentChecklistStatus,
    creditHoldOverrideBy: doc.creditHoldOverrideBy,
    creditHoldOverrideReason: doc.creditHoldOverrideReason,
    qualityClearedBy: doc.qualityClearedBy ?? null,
    qualityClearedAt: doc.qualityClearedAt ?? null,
    financeClearedBy: doc.financeClearedBy ?? null,
    financeClearedAt: doc.financeClearedAt ?? null,
    lineItems: stageMeta.lineItem
      ? [stageMeta.lineItem]
      : [
          {
            id: `LI-${doc.orderId}`,
            salesOrderId: doc.orderId,
            productId: doc.productId || '',
            productCode: '',
            productName: doc.productName,
            materialGrade: doc.steelGrade,
            size: '',
            orderedQty,
            uom: 'PCS',
            ratePerUnit,
            totalAmount: doc.totalValueINR,
            producedQty: 0,
            inspectedOkQty: 0,
            rejectedQty: 0,
            dispatchedQty: 0,
            pendingQty: orderedQty,
          },
        ],
    materialStatus: stageMeta.materialStatus || {
      state: 'allocated',
      materialGrade: doc.steelGrade,
      heatNumber: doc.heatNo || '',
      requiredKg: Math.round(doc.quantityMT * 1000),
      allocatedKg: Math.round(doc.quantityMT * 1000),
      supplierName: '',
      lastUpdated: doc.updatedAt.split('T')[0],
    },
    qualityStatus: stageMeta.qualityStatus || {
      state: doc.mtcStatus === 'Verified' ? 'cleared' : 'pending',
      inspectorName: '',
      inspectionDate: '',
      mtcNumber: '',
      mtcStatus: doc.mtcStatus === 'Verified' ? 'verified' : 'draft',
      testTypes: [],
    },
    clearanceStatus: stageMeta.clearanceStatus || {
      state: 'pending',
      agency: '',
      inspectorName: '',
      clearanceDate: '',
      clearanceRefNo: '',
      remarks: '',
    },
    dispatchStatus: stageMeta.dispatchStatus || {
      state: doc.dispatchStatus === 'Delivered' ? 'completed' : 'pending',
      totalShippedQty: 0,
      balanceQty: orderedQty,
      transporterName: '',
      vehicleNo: '',
      lrNumber: '',
      dispatchDate: '',
      destinationCity: '',
    },
    invoiceStatus: stageMeta.invoiceStatus || {
      state: doc.paymentStatus === 'Paid' ? 'settled' : 'pending',
      invoiceNumber: doc.invoiceNo || '',
      invoiceDate: '',
      invoiceAmount: doc.totalValueINR,
      paidAmount: 0,
      paymentDueDate: doc.committedDeliveryDate,
      tallySyncStatus: 'synced',
      outstandingAmount: doc.totalValueINR,
    },
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

export function mapRawMaterialToFirestoreDoc(
  m: RawMaterialStock,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreRawMaterialDoc {
  const nowIso = new Date().toISOString();
  const statusMap: Record<RawMaterialStock['status'], FirestoreRawMaterialDoc['status']> = {
    adequate: 'Healthy',
    warning: 'Low Stock',
    critical: 'Critical',
  };
  const updatedBy = packMeta(
    'Stores Yard',
    {
      cd: m.code,
      nm: m.name ? m.name.slice(0, 26) : undefined,
      dm: m.dimensionsMm ? m.dimensionsMm.slice(0, 22) : undefined,
      cur: m.currentStockMt,
      min: m.minimumStockMt,
      rt: m.standardRatePerMt,
    },
    128
  );

  return {
    gradeId: m.id,
    steelGrade: (m.grade || 'ASTM A105').slice(0, 64),
    category: m.grade.includes('316') || m.grade.includes('304') ? 'Stainless Steel' : 'Carbon Steel',
    availableMT: Math.max(0, Number((m.availableStockMt ?? m.currentStockMt).toFixed(2))),
    allocatedMT: Math.max(0, Number((m.reservedStockMt || 0).toFixed(2))),
    reorderLevelMT: Math.max(0, Number((m.reorderLevelMt || 0).toFixed(2))),
    unitCostPerMT: Math.max(0, m.standardRatePerMt || 0),
    supplierName: (m.supplier || 'Approved Steel Mill').slice(0, 160),
    locationYard: (m.locationBay || 'Bay A').slice(0, 80),
    status: statusMap[m.status] || 'Healthy',
    lastUpdated: nowIso,
    updatedBy,
    dataOrigin,
  };
}

export function mapFirestoreDocToRawMaterial(doc: FirestoreRawMaterialDoc): RawMaterialStock {
  const { meta } = unpackMeta(doc.updatedBy, 'Stores Yard');
  const availableStockMt = doc.availableMT;
  const reservedStockMt = doc.allocatedMT ?? 0;
  const currentStockMt =
    meta.cur !== undefined
      ? Number(meta.cur)
      : Number((availableStockMt + reservedStockMt).toFixed(2));
  // 0 = no minimum recorded (never estimated from the reorder level).
  const minimumStockMt = meta.min !== undefined ? Number(meta.min) : 0;

  const statusMap: Record<FirestoreRawMaterialDoc['status'], RawMaterialStock['status']> = {
    Healthy: 'adequate',
    'Low Stock': 'warning',
    Critical: 'critical',
  };

  return {
    id: doc.gradeId,
    code: meta.cd || doc.gradeId,
    name: meta.nm || `${doc.steelGrade} Forging Billet`,
    grade: doc.steelGrade,
    sectionShape: 'Round Billet',
    dimensionsMm: meta.dm || '',
    currentStockMt,
    reservedStockMt,
    availableStockMt,
    minimumStockMt,
    reorderLevelMt: doc.reorderLevelMT,
    standardRatePerMt: doc.unitCostPerMT ?? (meta.rt ? Number(meta.rt) : 0),
    supplier: doc.supplierName || '',
    locationBay: doc.locationYard || '',
    status: statusMap[doc.status] || 'adequate',
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

export function mapStockMovementToFirestoreDoc(
  mov: StockMovement,
  materialId?: string,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreStockMovementDoc {
  const typeMap: Record<StockMovement['movementType'], FirestoreStockMovementDoc['type']> = {
    'Receipt (GRN)': 'INWARD',
    'Production Issue': 'ISSUE',
    'Scrap Return': 'RETURN',
    Adjustment: 'ADJUSTMENT',
  };

  return {
    id: mov.id,
    gradeId: (materialId || mov.materialCode || 'RM-001').slice(0, 128),
    steelGrade: (mov.materialGrade || 'ASTM A105').slice(0, 64),
    type: typeMap[mov.movementType] || 'INWARD',
    quantityTons: Math.max(0.01, Math.abs(mov.quantityMt)),
    heatNumber: (mov.heatNumber || 'HEAT-VERIFIED').slice(0, 64),
    referenceDocument: (mov.referenceDoc || 'MANUAL-ENTRY').slice(0, 120),
    performedBy: (mov.performedBy || 'Stores Officer').slice(0, 160),
    timestamp: mov.timestamp && mov.timestamp.length >= 4 ? mov.timestamp : new Date().toISOString(),
    remarks: packMeta(mov.movementType, { mc: mov.materialCode, sq: mov.quantityMt }, 400),
    balanceAfterMT: Math.max(0, mov.balanceAfterMt || 0),
    dataOrigin,
  };
}

export function mapFirestoreDocToStockMovement(doc: FirestoreStockMovementDoc): StockMovement {
  const { primary, meta } = unpackMeta(doc.remarks, '');
  const reverseTypeMap: Record<FirestoreStockMovementDoc['type'], StockMovement['movementType']> = {
    INWARD: 'Receipt (GRN)',
    ISSUE: 'Production Issue',
    RETURN: 'Scrap Return',
    ADJUSTMENT: 'Adjustment',
  };
  const movementType =
    (['Receipt (GRN)', 'Production Issue', 'Scrap Return', 'Adjustment'].includes(primary)
      ? (primary as StockMovement['movementType'])
      : reverseTypeMap[doc.type]) || 'Receipt (GRN)';
  const signedQty =
    meta.sq !== undefined
      ? Number(meta.sq)
      : movementType === 'Production Issue'
      ? -Math.abs(doc.quantityTons)
      : Math.abs(doc.quantityTons);

  return {
    id: doc.id,
    timestamp: doc.timestamp,
    materialCode: meta.mc || doc.gradeId,
    materialGrade: doc.steelGrade,
    heatNumber: doc.heatNumber || '',
    movementType,
    quantityMt: signedQty,
    balanceAfterMt: doc.balanceAfterMT ?? 0,
    referenceDoc: doc.referenceDocument || '',
    performedBy: doc.performedBy,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

/** Thrown when a record is missing data that must come from the user, never a default. */
export class RecordValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';
}

const optionalText = (value: string | undefined, max: number) => {
  const clean = String(value ?? '').trim();
  return clean ? clean.slice(0, max) : undefined;
};

/** Required free text: trimmed, length-capped, and refused (not invented) when blank. */
function requiredText(v: string | undefined | null, max: number, message: string): string {
  const t = String(v ?? '').trim();
  if (t.length < 2) throw new RecordValidationError(message);
  return t.slice(0, max);
}

export function mapQualityInspectionToFirestoreDoc(
  q: QualityInspectionRecord,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreQualityInspectionDoc {
  const nowIso = new Date().toISOString();
  const statusMap: Record<string, FirestoreQualityInspectionDoc['status']> = {
    cleared: 'Approved',
    in_progress: 'Hold',
    pending: 'Hold',
    rejected: 'Rejected',
  };

  // Quality records are traceability evidence: never invent a job, heat, grade,
  // MTC number, inspector or result. Missing optional fields stay empty.
  const jobNumber = optionalText(q.jobNumber, 128);
  if (!jobNumber) {
    throw new RecordValidationError('Enter the job number this inspection belongs to.');
  }
  const status = statusMap[q.status];
  if (!status) {
    throw new RecordValidationError(`"${q.status}" is not a recognised inspection result.`);
  }

  const doc: FirestoreQualityInspectionDoc = {
    id: q.id,
    batchId: packMeta(jobNumber, { cust: q.customer, st: q.status }, 80),
    orderId: jobNumber,
    inspectedQtyMT: q.inspectedQty,
    acceptedQtyMT: q.passedQty,
    rejectedQtyMT: q.rejectedQty,
    inspectionDate: (q.date || nowIso.split('T')[0]).slice(0, 40),
    status,
    createdAt: nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
  const productName = optionalText(q.product, 160);
  const steelGrade = optionalText(q.grade, 64);
  const heatNo = optionalText(q.heatNo, 64);
  const mtcNumber = optionalText(q.mtcNumber, 80);
  const inspectorName = optionalText(q.inspector, 120);
  if (productName) doc.productName = productName;
  if (steelGrade) doc.steelGrade = steelGrade;
  if (heatNo) doc.heatNo = heatNo;
  if (mtcNumber) doc.mtcNumber = mtcNumber;
  if (inspectorName) doc.inspectorName = inspectorName;
  return doc;
}

export function mapFirestoreDocToQualityInspection(
  doc: FirestoreQualityInspectionDoc
): QualityInspectionRecord {
  const { primary: jobNo, meta } = unpackMeta(doc.batchId, doc.orderId);
  const reverseStatus: Record<
    FirestoreQualityInspectionDoc['status'],
    QualityInspectionRecord['status']
  > = {
    Approved: 'cleared',
    Hold: 'in_progress',
    Rework: 'in_progress',
    Rejected: 'rejected',
  };

  // Show exactly what was recorded; blanks stay blank.
  return {
    id: doc.id,
    jobNumber: doc.orderId || jobNo,
    customer: meta.cust || '',
    product: doc.productName || '',
    grade: doc.steelGrade || '',
    heatNo: doc.heatNo || '',
    inspectedQty: doc.inspectedQtyMT,
    passedQty: doc.acceptedQtyMT,
    rejectedQty: doc.rejectedQtyMT,
    status: meta.st || reverseStatus[doc.status],
    inspector: doc.inspectorName || '',
    date: doc.inspectionDate,
    mtcNumber: doc.mtcNumber || '',
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

export function mapDispatchToFirestoreDoc(
  d: DispatchConsignmentRecord,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreDispatchDoc {
  const nowIso = new Date().toISOString();
  const statusMap: Record<string, FirestoreDispatchDoc['status']> = {
    ready_for_dispatch: 'Scheduled',
    dispatched: 'In Transit',
    partially_dispatched: 'In Transit',
    in_transit: 'In Transit',
    completed: 'Delivered',
    delivered: 'Delivered',
  };

  // Consignment records are shipping evidence: never invent a vehicle, LR, weight or order.
  const orderRef = optionalText(d.jobNumber || d.orderNo, 128);
  if (!orderRef) throw new RecordValidationError('Choose the order this consignment belongs to.');
  if (!(d.weightMt > 0)) throw new RecordValidationError('Enter the consignment weight in tonnes.');
  const customerName = optionalText(d.customer, 160);
  if (!customerName || customerName.length < 2) throw new RecordValidationError('The order has no customer name.');
  const status = statusMap[d.status];
  if (!status) throw new RecordValidationError(`"${d.status}" is not a recognised dispatch status.`);

  const optional = {
    salesOrderId: optionalText(d.salesOrderId, 128),
    productName: optionalText(d.product, 160),
    transporterName: optionalText(d.transporter, 120),
    vehicleNo: optionalText(d.vehicleNo, 40),
    lrNo: optionalText(d.lrNumber, 64),
    invoiceNo: optionalText(d.invoiceRef, 64),
    destination: optionalText(d.destination, 160),
  };

  return {
    id: d.id,
    orderId: orderRef,
    customerName,
    quantityTons: d.weightMt,
    dispatchDate: (d.date || nowIso.split('T')[0]).slice(0, 40),
    status,
    ...(Object.fromEntries(Object.entries(optional).filter(([, v]) => v)) as Partial<FirestoreDispatchDoc>),
    createdBy: packMeta(
      'Dispatch Desk',
      {
        po: d.orderNo,
        job: d.jobNumber,
        qty: d.quantity,
        bal: d.balanceQty,
        clr: d.clearanceRef,
        st: d.status,
      },
      128
    ),
    createdAt: nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToDispatch(
  doc: FirestoreDispatchDoc
): DispatchConsignmentRecord {
  const { meta } = unpackMeta(doc.createdBy, 'Dispatch Desk');
  const reverseStatus: Record<
    FirestoreDispatchDoc['status'],
    DispatchConsignmentRecord['status']
  > = {
    Scheduled: 'ready_for_dispatch',
    Loading: 'ready_for_dispatch',
    'In Transit': 'dispatched',
    Delivered: 'completed',
    Delayed: 'dispatched',
  };

  return {
    id: doc.id,
    orderNo: meta.po || doc.orderId,
    jobNumber: meta.job || doc.orderId,
    salesOrderId: doc.salesOrderId,
    customer: doc.customerName,
    product: doc.productName || '',
    // Piece count is only known if it was recorded; never estimate it from weight.
    quantity: meta.qty !== undefined ? Number(meta.qty) : 0,
    balanceQty: meta.bal !== undefined ? Number(meta.bal) : 0,
    weightMt: doc.quantityTons,
    transporter: doc.transporterName || '',
    vehicleNo: doc.vehicleNo || '',
    lrNumber: doc.lrNo || '',
    destination: doc.destination || '',
    date: doc.dispatchDate,
    invoiceRef: doc.invoiceNo || '',
    clearanceRef: meta.clr || '',
    status: meta.st || reverseStatus[doc.status],
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

export function mapOutstandingToFirestoreDoc(
  rec: OutstandingAgeingRecord,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreOutstandingPaymentDoc {
  const nowIso = new Date().toISOString();
  const ageingBucket: FirestoreOutstandingPaymentDoc['ageingBucket'] =
    rec.bucket90Plus > 0
      ? '90+ Days'
      : rec.bucket61to90 > 0
      ? '61-90 Days'
      : rec.bucket31to60 > 0
      ? '31-60 Days'
      : '0-30 Days';

  const status: FirestoreOutstandingPaymentDoc['status'] =
    rec.totalOutstanding === 0
      ? 'Paid'
      : rec.bucket90Plus > 0
      ? 'Critical Overdue'
      : rec.bucket61to90 > 0 || rec.bucket31to60 > 0
      ? 'Overdue'
      : 'Current';

  return {
    invoiceId: rec.customerId,
    customerId: rec.customerId,
    customerName: (rec.customerName || 'Montex Customer').slice(0, 160),
    invoiceDate: (rec.oldestInvoiceDate || nowIso.split('T')[0]).slice(0, 40),
    dueDate: nowIso.split('T')[0],
    invoiceAmountINR: Math.max(0, rec.creditLimit || rec.totalOutstanding),
    receivedAmountINR: 0,
    balanceAmountINR: Math.max(0, rec.totalOutstanding || 0),
    ageingBucket,
    status,
    remarks: packMeta(
      'Ageing Schedule',
      {
        b0: rec.bucket0to30,
        b31: rec.bucket31to60,
        b61: rec.bucket61to90,
        b90: rec.bucket90Plus,
        cl: rec.creditLimit,
      },
      400
    ),
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToOutstanding(
  doc: FirestoreOutstandingPaymentDoc
): OutstandingAgeingRecord {
  const { meta } = unpackMeta(doc.remarks, 'Ageing Schedule');
  const totalOutstanding = doc.balanceAmountINR;
  const creditLimit = meta.cl !== undefined ? Number(meta.cl) : doc.invoiceAmountINR;

  return {
    customerId: doc.customerId || doc.invoiceId,
    customerName: doc.customerName,
    totalOutstanding,
    bucket0to30: meta.b0 !== undefined ? Number(meta.b0) : totalOutstanding,
    bucket31to60: meta.b31 !== undefined ? Number(meta.b31) : 0,
    bucket61to90: meta.b61 !== undefined ? Number(meta.b61) : 0,
    bucket90Plus: meta.b90 !== undefined ? Number(meta.b90) : 0,
    creditLimit,
    creditExceeded: totalOutstanding > creditLimit,
    oldestInvoiceDate: doc.invoiceDate,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

export function mapActionQueueToFirestoreDoc(
  a: ActionQueueItem,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreActionQueueDoc {
  const nowIso = new Date().toISOString();
  const catMap: Record<ActionQueueItem['type'], FirestoreActionQueueDoc['category']> = {
    overdue_order: 'Production',
    material_shortage: 'Inventory',
    qc_rejection: 'Quality',
    quality_hold: 'Quality',
    clearance_pending: 'Quality',
    payment_ageing: 'Finance',
  };

  return {
    id: a.id,
    category: catMap[a.type] || 'Production',
    severity: a.severity === 'critical' ? 'CRITICAL' : a.severity === 'high' ? 'HIGH' : a.severity === 'low' ? 'LOW' : 'MEDIUM',
    title: (a.title || 'Operational Alert').slice(0, 200),
    description: packMeta(
      a.description || '',
      {
        tp: a.type,
        cs: a.customerOrSupplier,
        dp: a.daysPending,
        sa: a.suggestedAction ? a.suggestedAction.slice(0, 220) : undefined,
        dept: a.assignedToDepartment,
      },
      600
    ),
    entityRef: (a.associatedRef || '-').slice(0, 128),
    status: a.acknowledged ? 'ACKNOWLEDGED' : 'OPEN',
    acknowledgedBy: a.acknowledgedBy ? a.acknowledgedBy.slice(0, 160) : undefined,
    acknowledgedAt: a.acknowledgedAt ? a.acknowledgedAt.slice(0, 40) : undefined,
    createdAt: nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToActionQueue(doc: FirestoreActionQueueDoc): ActionQueueItem {
  const { primary: description, meta } = unpackMeta(doc.description, doc.title);
  const reverseCat: Record<FirestoreActionQueueDoc['category'], ActionQueueItem['type']> = {
    Inventory: 'material_shortage',
    Production: 'overdue_order',
    Quality: 'qc_rejection',
    Finance: 'payment_ageing',
    Dispatch: 'overdue_order',
    Maintenance: 'overdue_order',
  };

  return {
    id: doc.id,
    type: (meta.tp as ActionQueueItem['type']) || reverseCat[doc.category] || 'overdue_order',
    severity:
      doc.severity === 'CRITICAL'
        ? 'critical'
        : doc.severity === 'HIGH'
        ? 'high'
        : doc.severity === 'LOW'
        ? 'low'
        : 'medium',
    title: doc.title,
    description,
    associatedRef: doc.entityRef || '-',
    customerOrSupplier: meta.cs || 'Montex Operations',
    daysPending: meta.dp !== undefined ? Number(meta.dp) : 1,
    suggestedAction: meta.sa || '',
    assignedToDepartment: meta.dept || doc.category,
    acknowledged: doc.status === 'ACKNOWLEDGED' || doc.status === 'RESOLVED',
    acknowledgedBy: doc.acknowledgedBy,
    acknowledgedAt: doc.acknowledgedAt,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

export function mapCustomerToFirestoreDoc(
  c: Customer,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreCustomerDoc {
  const nowIso = new Date().toISOString();
  return {
    id: c.id,
    code: (c.code || c.id).slice(0, 64),
    name: requiredText(c.name, 160, 'Enter the customer name.'),
    contactPerson: requiredText(c.contactPerson, 120, 'Enter the contact person.'),
    email: requiredText(c.email, 160, 'Enter the contact email.'),
    phone: optionalText(c.phone, 40),
    creditLimit: Math.max(0, c.creditLimit || 0),
    paymentTermsDays: Math.max(0, c.creditDays || 0),
    location: optionalText(c.location, 160),
    industry: optionalText(c.industry, 120),
    assignedSalesPerson: optionalText(c.assignedSalesPerson, 120),
    totalOrders: Math.max(0, c.totalOrders || 0),
    totalOutstanding: Math.max(0, c.totalOutstanding || 0),
    address: optionalText(c.location, 400),
    status: c.active ? 'Active' : 'Inactive',
    createdAt: nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToCustomer(doc: FirestoreCustomerDoc): Customer {
  const { primary: packedLocation, meta } = unpackMeta(doc.address, '');
  return {
    id: doc.id,
    code: doc.code || meta.cd || `MF-${doc.id}`,
    name: doc.name,
    contactPerson: doc.contactPerson,
    phone: doc.phone || '',
    email: doc.email,
    location: doc.location || packedLocation,
    industry: doc.industry || meta.ind || '',
    creditLimit: doc.creditLimit,
    creditDays: doc.paymentTermsDays ?? 0,
    assignedSalesPerson: doc.assignedSalesPerson || meta.sp || '',
    active: doc.status === 'Active',
    totalOrders:
      doc.totalOrders !== undefined
        ? doc.totalOrders
        : meta.to !== undefined
        ? Number(meta.to)
        : 0,
    totalOutstanding:
      doc.totalOutstanding !== undefined
        ? doc.totalOutstanding
        : meta.os !== undefined
        ? Number(meta.os)
        : 0,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

export function mapProductToFirestoreDoc(
  p: Product,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreProductDoc {
  const nowIso = new Date().toISOString();
  const catMap: Record<Product['category'], FirestoreProductDoc['category']> = {
    Flange: 'Flanges',
    'Forged Ring': 'Rolled Rings',
    Shaft: 'Forged Shafts',
    'Custom Forging': 'Custom Forgings',
    'Blind Flange': 'Flanges',
  };

  return {
    id: p.id,
    code: (p.code || p.id).slice(0, 64),
    name: requiredText(p.name, 160, 'Enter the product name.'),
    category: catMap[p.category] || 'Flanges',
    steelGrade: requiredText(p.materialGrade, 64, 'Enter the material grade.'),
    size: optionalText(p.size, 120),
    standard: optionalText(p.standard, 120),
    standardWeightKg: p.standardWeightKg > 0 ? p.standardWeightKg : (() => { throw new RecordValidationError('Enter the forged weight per piece.'); })(),
    unitPrice: Math.max(0, p.standardSellingPrice || 0),
    hsnCode: optionalText(p.hsnCode, 32),
    uom: (p.uom || 'PCS').slice(0, 24),
    drawingNo: (p.code || p.id).slice(0, 80),
    heatTreatmentReq: packMeta(
      p.standard || '',
      {
        sz: p.size,
        hsn: p.hsnCode,
        cat: p.category,
      },
      120
    ),
    status: 'Active',
    createdAt: nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToProduct(doc: FirestoreProductDoc): Product {
  const { primary: packedStandard, meta } = unpackMeta(doc.heatTreatmentReq, '');
  const reverseCat: Record<FirestoreProductDoc['category'], Product['category']> = {
    Flanges: 'Flange',
    'Rolled Rings': 'Forged Ring',
    'Forged Shafts': 'Shaft',
    'Gear Blanks': 'Custom Forging',
    'Custom Forgings': 'Custom Forging',
  };

  return {
    id: doc.id,
    code: doc.code || doc.drawingNo || doc.id,
    name: doc.name,
    category: (meta.cat as Product['category']) || reverseCat[doc.category] || 'Flange',
    size: doc.size || meta.sz || '',
    materialGrade: doc.steelGrade,
    standard: doc.standard || (packedStandard === '-' ? '' : packedStandard),
    uom: (doc.uom as Product['uom']) || 'PCS',
    standardWeightKg: doc.standardWeightKg,
    hsnCode: doc.hsnCode || meta.hsn || '',
    standardSellingPrice: doc.unitPrice,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

export function mapSupplierToFirestoreDoc(
  s: SteelMillSupplier,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreSupplierDoc {
  const nowIso = new Date().toISOString();
  return {
    id: s.id,
    name: (s.name || 'Steel Mill Supplier').slice(0, 160),
    location: packMeta(
      s.location || 'India',
      {
        cd: s.code,
        cp: s.contactPerson,
        ph: s.phone,
        cert: s.certification,
        ct: s.creditTermsDays,
        qr: s.qualityRatingPercent,
      },
      120
    ),
    primaryGrades: (s.approvedGrades || []).slice(0, 20),
    leadTimeDays: Math.max(0, s.leadTimeDays || 14),
    qualityRating: Math.min(5, Math.max(0, Number(((s.qualityRatingPercent || 95) / 20).toFixed(2)))),
    onTimeDeliveryPct: 95,
    approvalStatus: 'Approved',
    contactEmail: 'dispatch@steelmill.com',
    createdAt: nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToSupplier(doc: FirestoreSupplierDoc): SteelMillSupplier {
  const { primary: location, meta } = unpackMeta(doc.location, 'India');
  return {
    id: doc.id,
    code: meta.cd || `SUP-${doc.id}`,
    name: doc.name,
    location,
    approvedGrades: doc.primaryGrades || ['ASTM A105'],
    certification: meta.cert || '',
    leadTimeDays: doc.leadTimeDays,
    creditTermsDays: meta.ct !== undefined ? Number(meta.ct) : 0,
    qualityRatingPercent:
      meta.qr !== undefined ? Number(meta.qr) : doc.qualityRating !== undefined ? Math.round(doc.qualityRating * 20) : 0,
    contactPerson: meta.cp || '',
    phone: meta.ph || '',
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

export function mapJobCostSheetToFirestoreDoc(
  j: JobCostSheet,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreJobCostSheetDoc {
  const nowIso = new Date().toISOString();
  const netMat = Math.max(0, j.materialCostInr - j.scrapRecoveryCreditInr);
  const totalActualCostINR = Math.max(
    0,
    netMat +
      j.labourCostInr +
      j.powerCostInr +
      j.fuelHeatTreatmentCostInr +
      j.machiningProcessingCostInr +
      j.testingTpiCostInr +
      j.packingCostInr +
      j.transportFreightCostInr +
      j.overheadCostInr
  );
  const grossMarginINR = j.totalRevenueInr - totalActualCostINR;
  const grossMarginPct =
    j.totalRevenueInr > 0
      ? Number(((grossMarginINR / j.totalRevenueInr) * 100).toFixed(2))
      : 0;

  return {
    id: j.jobNumber,
    orderId: (j.orderId || j.jobNumber).slice(0, 128),
    customerName: (j.customerName || 'Montex Customer').slice(0, 160),
    productName: (j.productName || 'Forged Component').slice(0, 160),
    rawMaterialCostINR: netMat,
    forgingConversionCostINR: Math.max(0, j.labourCostInr + j.powerCostInr),
    heatTreatmentCostINR: Math.max(0, j.fuelHeatTreatmentCostInr),
    machiningCostINR: Math.max(0, j.machiningProcessingCostInr),
    testingAndMtcCostINR: Math.max(0, j.testingTpiCostInr),
    totalActualCostINR,
    salesRealizationINR: Math.max(0, j.totalRevenueInr),
    grossMarginINR,
    grossMarginPct,
    costStatus: 'Finalized',
    updatedBy: packMeta(
      'Finance Costing',
      {
        po: j.poNumber,
        gr: j.materialGrade,
        qty: j.orderedQty,
        qm: j.quotedMarginPercent,
      },
      128
    ),
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToJobCostSheet(doc: FirestoreJobCostSheetDoc): JobCostSheet {
  const { meta } = unpackMeta(doc.updatedBy, 'Finance Costing');
  return {
    jobNumber: doc.id,
    orderId: doc.orderId,
    poNumber: meta.po || `PO-${doc.orderId}`,
    customerName: doc.customerName,
    productName: doc.productName || 'Forged Component',
    materialGrade: meta.gr || 'ASTM A105',
    orderedQty: meta.qty ? Number(meta.qty) : 25,
    cutWeightKgPerPc: 48,
    finishedWeightKgPerPc: 42,
    materialCostInr: doc.rawMaterialCostINR,
    scrapRecoveryCreditInr: 0,
    labourCostInr: Math.round(doc.forgingConversionCostINR * 0.45),
    powerCostInr: Math.round(doc.forgingConversionCostINR * 0.55),
    fuelHeatTreatmentCostInr: doc.heatTreatmentCostINR ?? 0,
    machiningProcessingCostInr: doc.machiningCostINR ?? 0,
    testingTpiCostInr: doc.testingAndMtcCostINR ?? 0,
    packingCostInr: 0,
    transportFreightCostInr: 0,
    overheadCostInr: 0,
    totalRevenueInr: doc.salesRealizationINR,
    quotedMarginPercent: meta.qm ? Number(meta.qm) : doc.grossMarginPct,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

export function mapFirestoreDocToDashboardKpis(
  doc: FirestoreSystemConfigDoc | undefined,
  fallback: RtdbDashboardKpis
): RtdbDashboardKpis {
  if (!doc) return fallback;
  return {
    todaysDispatchValue: fallback.todaysDispatchValue,
    todaysDispatchQty: doc.monthlyDispatchMT ?? fallback.todaysDispatchQty,
    openOrdersValue: doc.totalOrderBookValue ?? fallback.openOrdersValue,
    openOrdersCount: doc.activeOrdersCount ?? fallback.openOrdersCount,
    materialShortagesCount: doc.lowStockAlertsCount ?? fallback.materialShortagesCount,
    qualityPendingCount: fallback.qualityPendingCount,
    dispatchPendingQty: fallback.dispatchPendingQty,
    monthlySalesTarget: doc.monthlySalesTarget ?? fallback.monthlySalesTarget,
    monthlySalesAchieved: doc.totalOrderBookValue ?? fallback.monthlySalesAchieved,
    totalOutstanding: doc.totalOutstandingINR ?? fallback.totalOutstanding,
    overdueOrdersCount: doc.delayedOrdersCount ?? fallback.overdueOrdersCount,
    lastUpdated: doc.updatedAt || fallback.lastUpdated,
  };
}

export function mapFirestoreDocToProductionSummary(
  doc: FirestoreSystemConfigDoc | undefined,
  fallback: RtdbProductionSummary
): RtdbProductionSummary {
  if (!doc) return fallback;
  return {
    ...fallback,
    totalRejectionPercent: doc.scrapPct ?? fallback.totalRejectionPercent,
  };
}

export function mapFirestoreDocToAlertThresholds(
  doc: FirestoreSystemConfigDoc | undefined,
  fallback: RtdbAlertThresholds
): RtdbAlertThresholds {
  if (!doc) return fallback;
  return {
    rejectionPercent:
      doc.Rejection_Rate_Max_Pct ?? doc.maxRejectionThresholdPct ?? fallback.rejectionPercent,
    furnaceTemp: fallback.furnaceTemp,
    machineDowntimeMinutes: fallback.machineDowntimeMinutes,
    criticalAgeingDays: doc.Payment_Overdue_Days ?? fallback.criticalAgeingDays,
    deliveryDelayDays: doc.Delay_Threshold_Days ?? fallback.deliveryDelayDays,
    lowStockDays: doc.Low_Stock_Threshold_Tons ?? fallback.lowStockDays,
  };
}

export function mapFirestoreDocToUserProfile(doc: Record<string, any>): UserProfile {
  const uid = String(doc.uid || doc.id || '');
  const displayName = String(doc.displayName || doc.name || doc.email || 'Montex Employee');
  const resolvedRole = resolveGranularRoleFromGroupOrLegacy(
    doc.role || doc.legacyRole || 'sales',
    doc.role || doc.legacyRole
  );
  const rbacGroup = getOrganizationalGroupForRole(resolvedRole);
  // A profile without a status is never treated as approved.
  const accountStatus = doc.accountStatus || 'pending_approval';
  const isActive = accountStatus === 'active';
  const initials =
    doc.avatarInitials ||
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p: string) => p[0]?.toUpperCase() || '')
      .join('') ||
    'MF';

  return {
    id: uid,
    uid,
    name: displayName,
    displayName,
    email: String(doc.email || ''),
    role: resolvedRole,
    legacyRole: resolvedRole,
    requestedRole: doc.requestedRole
      ? resolveGranularRoleFromGroupOrLegacy(doc.requestedRole)
      : !isActive
      ? resolvedRole
      : undefined,
    requestedDepartment: doc.requestedDepartment ? String(doc.requestedDepartment) : undefined,
    rbacGroup,
    roleTitle: String(doc.roleTitle || doc.designation || resolvedRole),
    designation: String(doc.designation || doc.roleTitle || resolvedRole),
    department: String(doc.department || 'Operations'),
    avatarInitials: initials,
    status:
      accountStatus === 'active'
        ? 'Active'
        : accountStatus === 'rejected'
        ? 'Rejected'
        : accountStatus === 'pending_approval' ||
          accountStatus === 'pending_invitation' ||
          accountStatus === 'pending_setup'
        ? 'Pending'
        : 'Inactive',
    accountStatus,
    mustChangePassword: Boolean(doc.mustChangePassword),
    provisionedBy: doc.provisionedBy,
    provisionedAt: doc.provisionedAt,
    approvedByUid: doc.approvedByUid ?? null,
    approvedByEmail: doc.approvedByEmail ?? null,
    approvedByName: doc.approvedByName ?? null,
    approvedAt: doc.approvedAt ?? null,
    rejectedByUid: doc.rejectedByUid ?? null,
    rejectedByEmail: doc.rejectedByEmail ?? null,
    rejectedByName: doc.rejectedByName ?? null,
    rejectedAt: doc.rejectedAt ?? null,
    rejectionReason: doc.rejectionReason ?? null,
    approvalHistory: Array.isArray(doc.approvalHistory) ? doc.approvalHistory : undefined,
    createdAt: String(doc.createdAt || new Date().toISOString()),
    updatedAt: doc.updatedAt,
    lastLoginAt: doc.lastLoginAt || doc.lastLogin,
    lastLogin: doc.lastLogin || doc.lastLoginAt || 'Provisioned',
    disabledAt: doc.disabledAt ?? null,
    deactivatedBy: doc.deactivatedBy ?? null,
    deactivationReason: doc.deactivationReason ?? null,
    isDepartmentHead: isActive ? Boolean(doc.isDepartmentHead) : false,
    managedDepartment:
      isActive && doc.managedDepartment && String(doc.managedDepartment).trim().length > 0
        ? String(doc.managedDepartment).trim()
        : undefined,
    reportingManagerUid:
      doc.reportingManagerUid && String(doc.reportingManagerUid).trim().length > 0
        ? String(doc.reportingManagerUid).trim()
        : undefined,
    permissions: isActive
      ? Array.isArray(doc.permissions) && doc.permissions.length > 0
        ? doc.permissions
        : ROLE_PERMISSION_DEFAULTS[resolvedRole] || []
      : [],
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

export function mapUserProfileToFirestoreDoc(
  u: UserProfile,
  dataOrigin: DataRecordOrigin = 'production'
): Record<string, any> {
  const uid = String(u.uid || u.id || '').trim().slice(0, 128);
  const rawDisplayName = String(u.displayName || u.name || u.email?.split('@')[0] || 'Montex Employee').trim();
  const displayName = (rawDisplayName.length >= 2 ? rawDisplayName : 'Montex Employee').slice(0, 120);
  const rawEmail = String(u.email || '').trim().toLowerCase();
  const email = (rawEmail.length >= 3 ? rawEmail : `${uid || 'employee'}@montexforge.com`).slice(0, 160);
  const resolvedRole = resolveGranularRoleFromGroupOrLegacy(
    // `role` is canonical; legacyRole is only a mirror and must never override it.
    u.role || u.legacyRole || u.requestedRole || 'sales',
    u.role || u.legacyRole
  );
  // Always derived from the role, so a stale group can never outlive a role change.
  const rbacGroup = getOrganizationalGroupForRole(resolvedRole);
  const nowIso = new Date().toISOString();
  const accountStatus = u.accountStatus || 'pending_approval';
  const rawDept = String(u.department || u.requestedDepartment || 'Operations').trim();
  const department = (rawDept.length >= 2 ? rawDept : 'Operations').slice(0, 80);
  const rawRoleTitle = String(u.roleTitle || u.designation || resolvedRole).trim();
  const roleTitle = (rawRoleTitle.length >= 2 ? rawRoleTitle : resolvedRole).slice(0, 100);
  const rawDesignation = String(u.designation || u.roleTitle || resolvedRole).trim();
  const designation = (rawDesignation.length >= 2 ? rawDesignation : roleTitle).slice(0, 100);
  const statusLabel =
    accountStatus === 'active'
      ? 'Active'
      : accountStatus === 'rejected'
      ? 'Rejected'
      : accountStatus === 'pending_approval' ||
        accountStatus === 'pending_invitation' ||
        accountStatus === 'pending_setup'
      ? 'Pending'
      : 'Inactive';

  const doc: Record<string, any> = {
    id: uid,
    uid,
    name: displayName,
    displayName,
    email,
    role: resolvedRole,
    legacyRole: resolvedRole,
    rbacGroup,
    roleTitle,
    designation,
    department,
    avatarInitials: String(u.avatarInitials || displayName.slice(0, 2).toUpperCase() || 'MF').slice(0, 8),
    accountStatus,
    status: statusLabel,
    mustChangePassword: Boolean(u.mustChangePassword),
    createdAt: u.createdAt && String(u.createdAt).length >= 4 ? String(u.createdAt).slice(0, 40) : nowIso,
    updatedAt: String(u.updatedAt || nowIso).slice(0, 40),
    permissions:
      accountStatus === 'active'
        ? Array.isArray(u.permissions) && u.permissions.length <= 20
          ? u.permissions
          : (ROLE_PERMISSION_DEFAULTS[resolvedRole] || []).slice(0, 20)
        : [],
    dataOrigin,
  };

  if (u.requestedRole) {
    doc.requestedRole = resolveGranularRoleFromGroupOrLegacy(u.requestedRole);
  }
  if (u.requestedDepartment && String(u.requestedDepartment).trim().length > 0) {
    doc.requestedDepartment = String(u.requestedDepartment).trim().slice(0, 80);
  }
  if (u.provisionedBy) doc.provisionedBy = String(u.provisionedBy).slice(0, 160);
  if (u.provisionedAt) doc.provisionedAt = String(u.provisionedAt).slice(0, 40);

  if (accountStatus === 'rejected') {
    doc.approvedByUid = null;
    doc.approvedByEmail = null;
    doc.approvedByName = null;
    doc.approvedAt = null;
    doc.isDepartmentHead = false;
  } else {
    if (u.approvedByUid !== undefined) {
      doc.approvedByUid = u.approvedByUid ? String(u.approvedByUid).slice(0, 128) : null;
    }
    if (u.approvedByEmail !== undefined) {
      doc.approvedByEmail = u.approvedByEmail ? String(u.approvedByEmail).slice(0, 160) : null;
    }
    if (u.approvedByName !== undefined) {
      doc.approvedByName = u.approvedByName ? String(u.approvedByName).slice(0, 160) : null;
    }
    if (u.approvedAt !== undefined) {
      doc.approvedAt = u.approvedAt ? String(u.approvedAt).slice(0, 40) : null;
    }
  }

  if (accountStatus === 'active') {
    doc.rejectedByUid = null;
    doc.rejectedByEmail = null;
    doc.rejectedByName = null;
    doc.rejectedAt = null;
    doc.rejectionReason = null;
    doc.disabledAt = null;
    doc.deactivatedBy = null;
    doc.deactivationReason = null;
  } else {
    if (u.rejectedByUid !== undefined) {
      doc.rejectedByUid = u.rejectedByUid ? String(u.rejectedByUid).slice(0, 128) : null;
    }
    if (u.rejectedByEmail !== undefined) {
      doc.rejectedByEmail = u.rejectedByEmail ? String(u.rejectedByEmail).slice(0, 160) : null;
    }
    if (u.rejectedByName !== undefined) {
      doc.rejectedByName = u.rejectedByName ? String(u.rejectedByName).slice(0, 160) : null;
    }
    if (u.rejectedAt !== undefined) {
      doc.rejectedAt = u.rejectedAt ? String(u.rejectedAt).slice(0, 40) : null;
    }
    if (u.rejectionReason !== undefined) {
      doc.rejectionReason = u.rejectionReason ? String(u.rejectionReason).slice(0, 500) : null;
    }
    if (u.disabledAt !== undefined) {
      doc.disabledAt = u.disabledAt ? String(u.disabledAt).slice(0, 40) : null;
    }
    if (u.deactivatedBy !== undefined) {
      doc.deactivatedBy = u.deactivatedBy ? String(u.deactivatedBy).slice(0, 160) : null;
    }
    if (u.deactivationReason !== undefined) {
      doc.deactivationReason = u.deactivationReason ? String(u.deactivationReason).slice(0, 300) : null;
    }
  }

  if (Array.isArray(u.approvalHistory)) {
    doc.approvalHistory = u.approvalHistory.slice(-50);
  }
  if (u.isDepartmentHead !== undefined && accountStatus !== 'rejected') {
    doc.isDepartmentHead = Boolean(u.isDepartmentHead);
  }
  if (
    accountStatus === 'active' &&
    u.isDepartmentHead &&
    u.managedDepartment &&
    String(u.managedDepartment).trim().length > 0
  ) {
    doc.managedDepartment = String(u.managedDepartment).trim().slice(0, 80);
  }
  if (u.reportingManagerUid && String(u.reportingManagerUid).trim().length > 0) {
    doc.reportingManagerUid = String(u.reportingManagerUid).trim().slice(0, 128);
  }
  if (u.lastLoginAt) doc.lastLoginAt = String(u.lastLoginAt).slice(0, 40);
  if (u.lastLogin) doc.lastLogin = String(u.lastLogin).slice(0, 40);

  return doc;
}

export function mapFirestoreDocToAuditLog(doc: FirestoreAuditLogDoc | Record<string, any>): AuditLogEntry {
  const actorUid = String(doc.actorUid || doc.userId || 'system');
  const actorName = String(doc.actorName || doc.userName || doc.actorEmail || actorUid);
  const collectionName = String(doc.collectionName || doc.module || 'system');
  const documentId = String(doc.documentId || doc.entityId || doc.targetUid || doc.id || '-');
  const detailsStr =
    typeof doc.details === 'string'
      ? doc.details
      : doc.newValueSummary || JSON.stringify(doc.details || {});

  return {
    id: String(doc.id || `AUD-${Date.now()}`),
    timestamp: String(doc.timestamp || new Date().toISOString()),
    userId: actorUid,
    actorUid,
    userName: actorName,
    actorName,
    actorEmail: doc.actorEmail,
    actorRole: doc.actorRole,
    targetUid: doc.targetUid,
    action: String(doc.action || 'SYSTEM_EVENT'),
    collectionName,
    module: String(doc.module || collectionName),
    documentId,
    entityId: String(doc.entityId || documentId),
    oldValueSummary: doc.oldValueSummary,
    newValueSummary: String(doc.newValueSummary || detailsStr),
    details: doc.details || detailsStr,
    severity: doc.severity || 'INFO',
    outcome: doc.outcome || 'SUCCESS',
    ipAddress: doc.ipAddress,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

// ============================================================================
// 10. ENTERPRISE GOVERNANCE & ACCOUNTABILITY COLLECTIONS (COLLECTIONS 23-27)
// ============================================================================

/** Roles that act for each department (production entries are made by Stores). */
const ROLE_BY_DEPARTMENT: Record<string, TaskRecord['assignedRole'] & string> = {
  Sales: 'sales',
  Stores: 'stores',
  Production: 'stores',
  Purchase: 'purchase',
  Quality: 'quality',
  Dispatch: 'dispatch',
  Finance: 'finance',
};
const TASK_STATUS_TO_FS: Record<string, string> = {
  pending: 'Pending',
  not_started: 'Pending',
  waiting_dependency: 'Pending',
  in_progress: 'In Progress',
  blocked: 'In Progress',
  submitted_for_verification: 'Submitted for Verification',
  verified_approved: 'Verified & Approved',
  approved: 'Verified & Approved',
  rejected_rework: 'Rejected / Rework',
  rejected_reopened: 'Rejected / Rework',
  escalated: 'Escalated',
};
const TASK_STATUS_FROM_FS: Record<string, TaskRecord['status']> = {
  Pending: 'pending',
  'In Progress': 'in_progress',
  'Submitted for Verification': 'submitted_for_verification',
  'Verified & Approved': 'verified_approved',
  'Rejected / Rework': 'rejected_rework',
  Escalated: 'escalated',
};
const TASK_PRIORITY_TO_FS: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const ESCALATION_TO_FS = (v: unknown) => {
  const s = String(v ?? '');
  if (['None', 'L1_DeptHead', 'L2_CEO'].includes(s)) return s;
  const n = Number(v) || 0;
  return n >= 2 ? 'L2_CEO' : n === 1 ? 'L1_DeptHead' : 'None';
};
const HANDOVER_STATUS_TO_FS: Record<string, string> = {
  initiated: 'Pending Acceptance',
  pending_acceptance: 'Pending Acceptance',
  accepted: 'Accepted',
  rejected: 'Rejected',
  'Rejected / Returned': 'Rejected',
};
const HANDOVER_STATUS_FROM_FS: Record<string, HandoverRecord['status']> = {
  'Pending Acceptance': 'pending_acceptance',
  Accepted: 'accepted',
  Rejected: 'rejected',
  Escalated: 'pending_acceptance',
};

export function mapTaskToFirestoreDoc(
  t: TaskRecord,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreTaskDoc {
  const nowIso = new Date().toISOString();
  return {
    id: t.id,
    taskNo: (t.taskNo || t.taskNumber || t.id).slice(0, 64),
    title: requiredText(t.title, 240, 'Say what the task is.'),
    description: t.description ? t.description.slice(0, 1000) : undefined,
    department: requiredText(t.department, 80, 'Choose the department.'),
    assignedRole: (t.assignedRole || t.departmentRole || ROLE_BY_DEPARTMENT[t.department] || 'sales') as any,
    assignedToUid: requiredText(t.assignedToUid, 128, 'Choose who the task is for.'),
    assignedToName: requiredText(t.assignedToName, 160, 'Choose who the task is for.'),
    assignedByUid: t.assignedByUid ? t.assignedByUid.slice(0, 128) : undefined,
    assignedByName: t.assignedByName ? t.assignedByName.slice(0, 160) : undefined,
    orderId: (t.orderId || t.linkedOrderId) ? (t.orderId || t.linkedOrderId)!.slice(0, 128) : undefined,
    customerName: t.customerName ? t.customerName.slice(0, 160) : undefined,
    priority: (TASK_PRIORITY_TO_FS[String(t.priority).toLowerCase()] || 'Medium') as any,
    status: (TASK_STATUS_TO_FS[t.status] || t.status || 'Pending') as any,
    dueDate: requiredText(t.dueDate, 40, 'Set a due date.'),
    slaHours: t.slaHours !== undefined ? Math.max(0, t.slaHours) : undefined,
    submittedAt: t.submittedAt ? t.submittedAt.slice(0, 40) : undefined,
    submissionRemarks: (t.submissionRemarks || t.submissionNotes)
      ? (t.submissionRemarks || t.submissionNotes)!.slice(0, 600)
      : undefined,
    verifiedByUid: t.verifiedByUid ? t.verifiedByUid.slice(0, 128) : undefined,
    verifiedByName: t.verifiedByName ? t.verifiedByName.slice(0, 160) : undefined,
    verifiedAt: t.verifiedAt ? t.verifiedAt.slice(0, 40) : undefined,
    verificationRemarks: t.verificationRemarks ? t.verificationRemarks.slice(0, 600) : undefined,
    rejectionReason: t.rejectionReason ? t.rejectionReason.slice(0, 600) : undefined,
    escalationLevel: ESCALATION_TO_FS(t.escalationLevel) as any,
    escalatedAt: t.escalatedAt ? t.escalatedAt.slice(0, 40) : undefined,
    isSopDailyDuty: Boolean(t.isSopDailyDuty),
    sopClauseRef: t.sopClauseRef ? t.sopClauseRef.slice(0, 80) : undefined,
    createdAt: t.createdAt && t.createdAt.length >= 4 ? t.createdAt : nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToTask(doc: FirestoreTaskDoc): TaskRecord {
  const escRaw = String(doc.escalationLevel || 'None');
  const escNum =
    typeof doc.escalationLevel === 'number'
      ? doc.escalationLevel
      : escRaw.includes('CEO') || escRaw.includes('L2')
      ? 2
      : escRaw.includes('DeptHead') || escRaw.includes('L1')
      ? 1
      : 0;
  return {
    ...doc,
    taskNumber: doc.taskNo || doc.id,
    taskNo: doc.taskNo || doc.id,
    description: doc.description || '',
    status: TASK_STATUS_FROM_FS[doc.status as string] || (doc.status as TaskRecord['status']),
    priority: String(doc.priority || 'Medium').toLowerCase() as TaskRecord['priority'],
    assignedByUid: doc.assignedByUid || '',
    assignedByName: doc.assignedByName || '',
    linkedOrderId: doc.orderId,
    submissionNotes: doc.submissionRemarks,
    slaHours: doc.slaHours,
    escalationLevel: escNum as any,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

export function mapHandoverToFirestoreDoc(
  h: HandoverRecord,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreHandoverDoc {
  const nowIso = new Date().toISOString();
  return {
    id: h.id,
    handoverCode: String(h.handoverCode || h.stageCode || '').slice(0, 3) as any,
    orderId: requiredText(h.orderId, 128, 'Choose the job being handed over.'),
    jobNumber: optionalText(h.jobNumber, 64),
    customerName: requiredText(h.customerName, 160, 'The job has no customer name.'),
    productName: requiredText(h.productName, 160, 'The job has no product.'),
    fromDepartment: requiredText(h.fromDepartment, 80, 'Choose the handover stage.'),
    fromRole: (h.fromRole || ROLE_BY_DEPARTMENT[h.fromDepartment] || 'sales') as any,
    fromUid: requiredText(h.fromUid || h.initiatedByUid, 128, 'The handover must name the sender.'),
    fromUserName: requiredText(h.fromUserName || h.initiatedByName, 160, 'The handover must name the sender.'),
    toDepartment: requiredText(h.toDepartment, 80, 'Choose the handover stage.'),
    toRole: (h.toRole || ROLE_BY_DEPARTMENT[h.toDepartment] || 'stores') as any,
    toUid: (h.toUid || h.receivedByUid) ? (h.toUid || h.receivedByUid)!.slice(0, 128) : undefined,
    toUserName: (h.toUserName || h.receivedByName)
      ? (h.toUserName || h.receivedByName)!.slice(0, 160)
      : undefined,
    quantityMT:
      (h.quantityMT ?? h.weightMt) !== undefined ? Math.max(0, (h.quantityMT ?? h.weightMt)!) : undefined,
    quantityPcs: h.quantityPcs && h.quantityPcs > 0 ? h.quantityPcs : undefined,
    heatNo: optionalText(h.heatNo || h.heatNumber, 64),
    checklistSummary: h.checklistSummary ? h.checklistSummary.slice(0, 600) : undefined,
    status: (HANDOVER_STATUS_TO_FS[String(h.status)] || h.status || 'Pending Acceptance') as any,
    initiatedAt: h.initiatedAt && h.initiatedAt.length >= 4 ? h.initiatedAt : nowIso,
    respondedAt: h.respondedAt ? h.respondedAt.slice(0, 40) : undefined,
    remarks: (h.remarks || h.responseRemarks)
      ? (h.remarks || h.responseRemarks)!.slice(0, 600)
      : undefined,
    rejectionReason: h.rejectionReason ? h.rejectionReason.slice(0, 600) : undefined,
    slaDeadline: h.slaDeadline ? h.slaDeadline.slice(0, 40) : undefined,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToHandover(doc: FirestoreHandoverDoc): HandoverRecord {
  return {
    ...doc,
    jobNumber: doc.jobNumber || '',
    status: HANDOVER_STATUS_FROM_FS[doc.status as string] || (doc.status as HandoverRecord['status']),
    stageLabel: `${doc.handoverCode}: ${doc.fromDepartment} → ${doc.toDepartment}`,
    initiatedByUid: doc.fromUid,
    initiatedByName: doc.fromUserName,
    receivedByUid: doc.toUid,
    receivedByName: doc.toUserName,
    quantityPcs: doc.quantityPcs,
    weightMt: doc.quantityMT,
    heatNumber: doc.heatNo || '',
    checklistSummary: doc.checklistSummary || '',
    responseRemarks: doc.remarks,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

const PR_STATUS_TO_FS: Record<string, FirestorePurchaseRequisitionDoc['status']> = {
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  converted_to_po: 'Converted to PO',
  po_issued: 'Converted to PO',
};
const PR_STATUS_FROM_FS: Record<string, PurchaseRequisitionRecord['status']> = {
  Draft: 'pending_approval',
  'Pending Approval': 'pending_approval',
  Approved: 'approved',
  Rejected: 'rejected',
  'Converted to PO': 'converted_to_po',
};
const PR_PRIORITY_BY_URGENCY: Record<string, FirestorePurchaseRequisitionDoc['priority']> = {
  critical: 'Urgent',
  urgent: 'Urgent',
  high: 'High',
  standard: 'Normal',
};

export function mapPurchaseRequisitionToFirestoreDoc(
  pr: PurchaseRequisitionRecord,
  dataOrigin: DataRecordOrigin = 'production'
): FirestorePurchaseRequisitionDoc {
  const nowIso = new Date().toISOString();
  const grade = pr.steelGrade || pr.materialGrade;
  const mt = pr.requiredMT ?? pr.requiredMt ?? pr.requiredQtyMt;
  if (!grade) throw new RecordValidationError('Choose the steel grade needed.');
  if (!(typeof mt === 'number' && mt > 0)) throw new RecordValidationError('Enter the quantity needed in MT.');
  if (!pr.requestedByUid || !pr.requestedByName) throw new RecordValidationError('The requisition must name who raised it.');
  const priority = (['Urgent', 'High', 'Normal'].includes(pr.priority as string) ? pr.priority : PR_PRIORITY_BY_URGENCY[pr.urgency]) || 'Normal';
  return {
    id: pr.id,
    prNumber: (pr.prNumber || pr.id).slice(0, 64),
    orderId: optionalText(pr.orderId || pr.linkedJobNumber, 128),
    steelGrade: grade.slice(0, 64),
    requiredMT: mt,
    estimatedCostINR:
      (pr.estimatedCostINR ?? pr.estimatedTotalInr) ? Math.max(0, (pr.estimatedCostINR ?? pr.estimatedTotalInr)!) : undefined,
    requiredByDate: (pr.requiredByDate || nowIso.split('T')[0]).slice(0, 40),
    requestedByUid: pr.requestedByUid.slice(0, 128),
    requestedByName: pr.requestedByName.slice(0, 160),
    requestedByRole: pr.requestedByRole as any,
    justification: optionalText(pr.justification, 600),
    priority: priority as any,
    status: (PR_STATUS_TO_FS[pr.status as string] || pr.status || 'Pending Approval') as any,
    approvedByUid: optionalText(pr.approvedByUid, 128),
    approvedByName: optionalText(pr.approvedByName, 160),
    approvedAt: optionalText(pr.approvedAt, 40),
    rejectionReason: optionalText(pr.rejectionReason, 600),
    convertedPoNumber: optionalText(pr.convertedPoNumber || pr.convertedPoId, 64),
    createdAt: pr.createdAt && pr.createdAt.length >= 4 ? pr.createdAt : nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToPurchaseRequisition(
  doc: FirestorePurchaseRequisitionDoc
): PurchaseRequisitionRecord {
  const reqMt = doc.requiredMT ?? 0;
  const estTotal = doc.estimatedCostINR ?? 0;
  return {
    ...doc,
    status: PR_STATUS_FROM_FS[doc.status] || (doc.status as PurchaseRequisitionRecord['status']),
    requestDate: doc.createdAt.split('T')[0],
    materialGrade: doc.steelGrade,
    sectionMm: '',
    requiredQtyMt: reqMt,
    requiredMt: reqMt,
    estimatedRatePerMt: estTotal && reqMt ? Math.round(estTotal / reqMt) : 0,
    estimatedTotalInr: estTotal,
    linkedJobNumber: doc.orderId || '',
    urgency: doc.priority === 'Urgent' ? 'urgent' : doc.priority === 'High' ? 'high' : 'standard',
    justification: doc.justification || '',
    convertedPoId: doc.convertedPoNumber,
    convertedPoNumber: doc.convertedPoNumber,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

const NCR_STATUS_TO_FS: Record<string, FirestoreNcrCapaDoc['status']> = {
  open: 'Open',
  root_cause_identified: 'Root Cause Analysis',
  capa_in_progress: 'Root Cause Analysis',
  capa_implemented: 'CAPA Implemented',
  verified_closed: 'Verified & Closed',
};
const NCR_DISPOSITION_TO_FS: Record<string, FirestoreNcrCapaDoc['disposition']> = {
  rework_forging: 'Rework',
  re_heat_treat: 'Rework',
  scrap_and_reforge: 'Scrap',
  concession_tpi: 'Use As Is (Concession)',
};

export function mapNcrCapaToFirestoreDoc(
  ncr: NcrCapaRecord,
  dataOrigin: DataRecordOrigin = 'production'
): FirestoreNcrCapaDoc {
  const nowIso = new Date().toISOString();
  const orderId = ncr.orderId || ncr.jobNumber;
  const batchId = ncr.batchId || ncr.inspectionId || ncr.heatNumber;
  const affected = ncr.affectedQtyMT;
  // Required facts are never invented: the form must supply them.
  if (!orderId) throw new RecordValidationError('Choose the order this NCR belongs to.');
  if (!batchId) throw new RecordValidationError('Enter the lot, batch or heat number.');
  if (!ncr.defectDescription || ncr.defectDescription.trim().length < 3) throw new RecordValidationError('Describe the defect.');
  if (!(typeof affected === 'number' && affected > 0)) throw new RecordValidationError('Enter the affected quantity in MT.');
  if (!ncr.raisedByUid || !ncr.raisedByName) throw new RecordValidationError('The NCR must name who raised it.');
  const rootCause = ncr.rootCause || ncr.rootCause5Why || ncr.rootCauseAnalysis;
  return {
    id: ncr.id,
    ncrNumber: (ncr.ncrNumber || ncr.id).slice(0, 64),
    orderId: orderId.slice(0, 128),
    batchId: batchId.slice(0, 80),
    productName: optionalText(ncr.productName, 160),
    steelGrade: optionalText(ncr.steelGrade || ncr.materialGrade, 64),
    heatNo: optionalText(ncr.heatNo || ncr.heatNumber, 64),
    defectCategory: ncr.defectCategory as any,
    defectDescription: ncr.defectDescription.trim().slice(0, 600),
    affectedQtyMT: affected,
    rootCause: optionalText(rootCause, 600),
    correctiveAction: optionalText(ncr.correctiveAction, 600),
    preventiveAction: optionalText(ncr.preventiveAction, 600),
    disposition: (NCR_DISPOSITION_TO_FS[ncr.disposition || ''] || ncr.disposition || 'Hold') as any,
    status: (NCR_STATUS_TO_FS[ncr.status] || ncr.status || 'Open') as any,
    raisedByUid: ncr.raisedByUid.slice(0, 128),
    raisedByName: ncr.raisedByName.slice(0, 160),
    verifiedByName: optionalText(ncr.verifiedByName, 160),
    closedAt: optionalText(ncr.closedAt, 40),
    createdAt: ncr.createdAt && ncr.createdAt.length >= 4 ? ncr.createdAt : nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToNcrCapa(doc: FirestoreNcrCapaDoc): NcrCapaRecord {
  return {
    ...doc,
    dateRaised: doc.createdAt.split('T')[0],
    jobNumber: doc.orderId,
    customerName: '',
    productName: doc.productName || '',
    materialGrade: doc.steelGrade,
    heatNumber: doc.heatNo || '',
    rejectedQtyPcs: 0,
    rootCause5Why: doc.rootCause,
    rootCauseAnalysis: doc.rootCause || '',
    correctiveAction: doc.correctiveAction || '',
    preventiveAction: doc.preventiveAction || '',
    responsibleOwnerName: doc.raisedByName,
    targetClosureDate: doc.closedAt,
    costOfPoorQualityInr: 0,
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}

const FOLLOW_UP_OUTCOME_BY_STATUS: Record<string, FirestorePaymentFollowUpDoc['outcome']> = {
  promised: 'Payment Promised',
  part_received: 'Part Payment Released',
  received: 'Cleared',
  settled: 'Cleared',
  contacted: 'No Response',
  scheduled: 'No Response',
  escalated_credit_hold: 'Dispute Raised',
};
const FOLLOW_UP_STATUS_BY_OUTCOME: Record<string, PaymentFollowUpRecord['status']> = {
  'Payment Promised': 'promised',
  'Part Payment Released': 'part_received',
  Cleared: 'received',
  'Dispute Raised': 'escalated_credit_hold',
  'No Response': 'contacted',
};

export function mapPaymentFollowUpToFirestoreDoc(
  pf: PaymentFollowUpRecord,
  dataOrigin: DataRecordOrigin = 'production'
): FirestorePaymentFollowUpDoc {
  const nowIso = new Date().toISOString();
  const invoiceId = pf.invoiceId || pf.invoiceNumber;
  const contact = pf.contactPerson || pf.contactedPerson;
  if (!invoiceId) throw new RecordValidationError('Enter the invoice number being followed up.');
  if (!pf.customerName) throw new RecordValidationError('Choose the customer.');
  if (!contact || contact.trim().length < 2) throw new RecordValidationError('Enter who you spoke to.');
  if (!pf.nextFollowUpDate) throw new RecordValidationError('Enter the next follow-up date.');
  if (!pf.loggedByUid || !pf.loggedByName || !pf.loggedByRole) throw new RecordValidationError('The follow-up must name who logged it.');
  const promisedAmount = pf.promisedAmountINR ?? pf.promisedAmountInr;
  const promisedDate = pf.promisedDate || pf.promisedPaymentDate;
  return {
    id: pf.id,
    invoiceId: invoiceId.slice(0, 128),
    orderId: optionalText(pf.orderId, 128),
    customerId: optionalText(pf.customerId, 128),
    customerName: pf.customerName.slice(0, 160),
    contactPerson: contact.trim().slice(0, 120),
    followUpDate: (pf.followUpDate || nowIso.split('T')[0]).slice(0, 40),
    nextFollowUpDate: pf.nextFollowUpDate.slice(0, 40),
    promisedAmountINR: promisedAmount !== undefined && promisedAmount > 0 ? promisedAmount : undefined,
    promisedDate: optionalText(promisedDate, 40),
    followUpMode: (pf.followUpMode || pf.modeOfCommunication || 'Phone Call') as any,
    outcome: (pf.outcome || FOLLOW_UP_OUTCOME_BY_STATUS[pf.status] || 'No Response') as any,
    notes: optionalText(pf.notes || pf.remarks, 600),
    loggedByUid: pf.loggedByUid.slice(0, 128),
    loggedByName: pf.loggedByName.slice(0, 160),
    loggedByRole: pf.loggedByRole as any,
    createdAt: pf.createdAt && pf.createdAt.length >= 4 ? pf.createdAt : nowIso,
    updatedAt: nowIso,
    dataOrigin,
  };
}

export function mapFirestoreDocToPaymentFollowUp(
  doc: FirestorePaymentFollowUpDoc
): PaymentFollowUpRecord {
  const promised = doc.promisedAmountINR ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  const due = doc.promisedDate || '';
  return {
    ...doc,
    customerId: doc.customerId || '',
    invoiceNumber: doc.invoiceId,
    // Invoice and outstanding amounts are not stored on a follow-up; they come from receivables.
    invoiceAmountInr: 0,
    outstandingAmountInr: 0,
    dueDate: due,
    overdueDays: due && due < today ? Math.floor((Date.parse(today) - Date.parse(due)) / 86_400_000) : 0,
    contactedPerson: doc.contactPerson,
    promisedPaymentDate: due,
    promisedAmountInr: promised,
    modeOfCommunication: doc.followUpMode,
    remarks: doc.notes || '',
    status: FOLLOW_UP_STATUS_BY_OUTCOME[doc.outcome] || 'contacted',
    dataOrigin: doc.dataOrigin === 'demo_sandbox' ? 'demo_sandbox' : 'production',
  };
}


