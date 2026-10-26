import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import {
  ActionQueueItem,
  AuditLogEntry,
  ClientRequirementEntry,
  Customer,
  DimensionalInspectionReport,
  FurnaceBatchLog,
  JobCostSheet,
  MachineMaintenanceTicket,
  OrderJourney,
  OutstandingAgeingRecord,
  PowerConsumptionLog,
  Product,
  PurchaseOrderRecord,
  QuotationRecord,
  RawMaterialStock,
  RbacRoleGroup,
  RtdbDashboardKpis,
  RtdbProductionSummary,
  ShopMachineLog,
  SteelMillSupplier,
  StockMovement,
  TenderRecord,
  UserProfile,
} from '../types/mis';
import {
  QualityInspectionRecord,
  validateQualityInspectionQuantities,
  validateSalesOrderQuantities,
} from './misDataValidator';
import {
  MONTEX_PDF_BRAND_TOKENS,
  preloadMontexLogoForPdf,
  applyMontexPdfHeader,
  getMontexPdfTableTheme,
  applyMontexPdfFooterAllPages,
} from '../utils/pdfBrandingUtility';

export {
  MONTEX_PDF_BRAND_TOKENS,
  preloadMontexLogoForPdf,
  applyMontexPdfHeader,
  getMontexPdfTableTheme,
  applyMontexPdfFooterAllPages,
};

export type DocumentReadinessStatus =
  | 'ready'
  | 'draft_missing_fields'
  | 'not_supported_yet';

export interface DocumentStatusClassification {
  documentTypeId: string;
  title: string;
  category:
    | 'Finance & Billing'
    | 'Sales, Quotations & Tenders'
    | 'Procurement & Inventory'
    | 'Production, Quality & Dispatch'
    | 'Management Reports & Master Data';
  readiness: DocumentReadinessStatus;
  readinessLabel:
    | 'Ready to Generate'
    | 'Draft — Missing Required Fields'
    | 'Not Supported Yet';
  supportedFormats: ('PDF' | 'XLSX' | 'CSV' | 'PRINT')[];
  availableSourceFields: string[];
  missingSourceFields: string[];
  authorizedRoles: RbacRoleGroup[];
  disclaimer: string;
}

export interface PdfKeyValueField {
  label: string;
  value: string | number;
}

export interface PdfTableSection {
  sectionTitle?: string;
  headers: string[];
  rows: (string | number)[][];
  foot?: (string | number)[][];
}

export interface MontexPdfDocumentPayload {
  filename: string;
  documentCode: string;
  documentTitle: string;
  documentSubtitle: string;
  readiness: DocumentReadinessStatus;
  readinessBannerText: string;
  missingFieldsList?: string[];
  integrityWarnings?: string[];
  metadataGrid: PdfKeyValueField[];
  tables: PdfTableSection[];
  notesAndTerms?: string[];
  footerDisclaimer: string;
  generatedBy: string;
  generatedRole: string;
}

export interface ExcelWorksheetSpec {
  sheetName: string;
  reportTitle: string;
  reportSubtitle: string;
  metadataRows?: [string, string | number][];
  headers: string[];
  rows: (string | number)[][];
  totalsRow?: (string | number)[];
}

/**
 * Authoritative Catalog of all Document & Export Types in Montex Forge MIS
 * Classified per Section 7 (Ready to Generate / Draft — Missing Required Fields / Not Supported Yet)
 */
export const MONTEX_DOCUMENT_CLASSIFICATION_CATALOG: DocumentStatusClassification[] = [
  // 1. FINANCE & BILLING
  {
    documentTypeId: 'tax_invoice_summary',
    title: 'Sales / Billing Invoice Summary (Draft)',
    category: 'Finance & Billing',
    readiness: 'draft_missing_fields',
    readinessLabel: 'Draft — Missing Required Fields',
    supportedFormats: ['PDF', 'PRINT'],
    availableSourceFields: [
      'invoiceStatus.invoiceNumber',
      'invoiceStatus.invoiceDate',
      'poNumber',
      'jobNumber',
      'customerName',
      'lineItems (productCode, productName, orderedQty, dispatchedQty, ratePerUnit)',
      'invoiceStatus.invoiceAmount',
      'invoiceStatus.paidAmount',
      'invoiceStatus.outstandingAmount',
      'invoiceStatus.paymentDueDate',
      'invoiceStatus.tallySyncStatus',
    ],
    missingSourceFields: [
      'Customer GSTIN & State Code',
      'Montex Statutory GSTIN / PAN / CIN',
      'Statutory Tax Rate Split (CGST / SGST / IGST % & Amount)',
      'Billing & Consignee Registered Street Addresses',
      'E-Invoice IRN / Ack No.',
    ],
    authorizedRoles: ['Admin', 'Management', 'Finance', 'Sales'],
    disclaimer:
      'Generated strictly as a Draft Commercial Billing Summary from recorded MIS fields. Statutory GST rates, GSTINs, and tax breakdowns are not invented.',
  },
  {
    documentTypeId: 'supplier_purchase_bill_summary',
    title: 'Supplier / Mill Purchase Bill Summary (Draft)',
    category: 'Finance & Billing',
    readiness: 'draft_missing_fields',
    readinessLabel: 'Draft — Missing Required Fields',
    supportedFormats: ['PDF', 'PRINT'],
    availableSourceFields: [
      'poNumber',
      'poDate',
      'supplierName',
      'materialCode',
      'materialGrade',
      'orderedMt',
      'receivedMt',
      'ratePerMt',
      'totalValue',
      'millHeatNumber',
    ],
    missingSourceFields: [
      'Supplier Tax Invoice Number & Bill Date',
      'Supplier GSTIN',
      'Input Tax Credit (ITC) GST Breakdown',
      'Weighbridge Net Weight Slip Reference',
    ],
    authorizedRoles: ['Admin', 'Management', 'Finance', 'Production'],
    disclaimer:
      'Internal Purchase & GRN Valuation Summary based on recorded Steel Mill PO and received MT. Not a supplier-issued tax bill.',
  },
  {
    documentTypeId: 'payment_receipt_voucher',
    title: 'Customer Payment Receipt / Collection Advice',
    category: 'Finance & Billing',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['PDF', 'PRINT'],
    availableSourceFields: [
      'receiptReference / utrReference',
      'paymentDate',
      'customerId',
      'customerName',
      'amountReceivedInr',
      'previousOutstandingInr',
      'closingOutstandingInr',
      'ageingBuckets (0-30, 31-60, 61-90, 90+)',
    ],
    missingSourceFields: [
      'Historical bank voucher ledger for collections prior to current session (marked Draft if generating statement without session UTR)',
    ],
    authorizedRoles: ['Admin', 'Management', 'Finance'],
    disclaimer:
      'Internal Customer Collection Receipt Advice reflecting FIFO bucket settlement.',
  },
  {
    documentTypeId: 'credit_debit_note',
    title: 'Credit Note / Debit Note',
    category: 'Finance & Billing',
    readiness: 'not_supported_yet',
    readinessLabel: 'Not Supported Yet',
    supportedFormats: [],
    availableSourceFields: [],
    missingSourceFields: [
      'Credit / Debit Note Voucher Register (/creditNotes, /debitNotes)',
      'Original Tax Invoice Reference & Adjustment Reason Code',
      'Rejected / Returned Quantity Financial Valuation Workflow',
      'GST Tax Reversal / Rate Difference Approval Fields',
    ],
    authorizedRoles: ['Admin', 'Finance'],
    disclaimer:
      'Not Supported Yet: Existing RTDB schema and workflows do not store Credit Note or Debit Note records.',
  },
  {
    documentTypeId: 'job_costing_report',
    title: '8-Head Job Costing & Margin Report',
    category: 'Finance & Billing',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['XLSX', 'PDF', 'CSV', 'PRINT'],
    availableSourceFields: [
      'jobNumber',
      'poNumber',
      'customerName',
      'productName',
      'orderedQty',
      'cutWeightKgPerPc',
      'finishedWeightKgPerPc',
      'materialCostInr',
      'scrapRecoveryCreditInr',
      'labourCostInr',
      'powerCostInr',
      'fuelHeatTreatmentCostInr',
      'machiningProcessingCostInr',
      'testingTpiCostInr',
      'packingCostInr',
      'transportFreightCostInr',
      'overheadCostInr',
      'totalRevenueInr',
      'quotedMarginPercent',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Finance'],
    disclaimer: 'Complete 8-head job profitability and cost-per-kg sheet from recorded costing inputs.',
  },
  {
    documentTypeId: 'receivables_ageing_export',
    title: 'Receivables & Ageing Buckets Register',
    category: 'Finance & Billing',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['XLSX', 'PDF', 'CSV'],
    availableSourceFields: [
      'customerId',
      'customerName',
      'creditLimit',
      'totalOutstanding',
      'bucket0to30',
      'bucket31to60',
      'bucket61to90',
      'bucket90Plus',
      'oldestInvoiceDate',
      'creditExceeded',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Finance', 'Sales'],
    disclaimer: 'Exported directly from /outstandingPayments and order invoice balances.',
  },

  // 2. SALES, QUOTATIONS & TENDERS
  {
    documentTypeId: 'commercial_quotation_pdf',
    title: 'Commercial Quotation & Offer Sheet',
    category: 'Sales, Quotations & Tenders',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['PDF', 'PRINT', 'XLSX'],
    availableSourceFields: [
      'id',
      'rfqReference',
      'quoteDate',
      'validUntil',
      'customerName',
      'contactPerson',
      'productName',
      'materialGrade',
      'standard',
      'unitWeightKg',
      'inquiryQtyPcs',
      'quotedRatePerKg',
      'quotedRatePerPc',
      'totalQuotedValue',
      'deliveryLeadWeeks',
      'followUpNotes',
    ],
    missingSourceFields: [
      'Itemized statutory GST rate % (noted as extra as applicable per RFQ terms)',
    ],
    authorizedRoles: ['Admin', 'Management', 'Sales', 'Finance'],
    disclaimer:
      'Commercial Forging Offer generated from recorded RFQ & quotation parameters. Draft quotes are watermarked Draft.',
  },
  {
    documentTypeId: 'tender_register_export',
    title: 'PSU / EPC Tender Pipeline & Summary',
    category: 'Sales, Quotations & Tenders',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['XLSX', 'PDF', 'PRINT'],
    availableSourceFields: [
      'id',
      'tenderNumber',
      'issuingAuthority',
      'projectTitle',
      'itemSummary',
      'estimatedValueLakhs',
      'emdAmount',
      'bidSubmissionDate',
      'priceBidOpeningDate',
      'technicalBidStatus',
      'assignedOwner',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Sales'],
    disclaimer: 'Complete tender bid register and printable executive tender summary.',
  },
  {
    documentTypeId: 'customer_po_summary',
    title: 'Customer PO Registration Summary & Order Register',
    category: 'Sales, Quotations & Tenders',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['PDF', 'XLSX', 'CSV', 'PRINT'],
    availableSourceFields: [
      'id',
      'poNumber',
      'poDate',
      'jobNumber',
      'customerName',
      'expectedDeliveryDate',
      'targetDeliveryDate',
      'totalValue',
      'lineItems',
      'status',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Sales', 'Production', 'Finance'],
    disclaimer:
      'Internal Customer PO Registration & Order Backlog Summary. Explicitly distinguished from a company-issued Tax Invoice.',
  },
  {
    documentTypeId: 'order_job_progress_pdf',
    title: '7-Stage Order & Job Lifecycle Progress Report',
    category: 'Sales, Quotations & Tenders',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['PDF', 'PRINT'],
    availableSourceFields: [
      'poNumber',
      'jobNumber',
      'lineItems',
      'materialStatus',
      'qualityStatus',
      'clearanceStatus',
      'dispatchStatus',
      'invoiceStatus',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Sales', 'Production', 'Finance'],
    disclaimer:
      'End-to-end order dossier across Material, Production, Quality, TPI Clearance, Dispatch, and Billing stages.',
  },

  // 3. PROCUREMENT & INVENTORY
  {
    documentTypeId: 'steel_mill_po_pdf',
    title: 'Internal Steel Mill Purchase Order Summary',
    category: 'Procurement & Inventory',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['PDF', 'PRINT', 'XLSX'],
    availableSourceFields: [
      'id',
      'poNumber',
      'poDate',
      'supplierName',
      'materialCode',
      'materialGrade',
      'sectionMm',
      'linkedJobNumber',
      'orderedMt',
      'receivedMt',
      'pendingMt',
      'ratePerMt',
      'totalValue',
      'expectedDeliveryDate',
      'millHeatNumber',
      'status',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Production', 'Finance'],
    disclaimer:
      'Internal MIS Steel Mill Purchase Order Summary. Clearly distinguished from a legally executed supplier contract.',
  },
  {
    documentTypeId: 'grn_receipt_pdf',
    title: 'Goods Receipt Note (GRN) & Yard Movement Voucher',
    category: 'Procurement & Inventory',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['PDF', 'PRINT'],
    availableSourceFields: [
      'id',
      'timestamp',
      'materialCode',
      'materialGrade',
      'movementType',
      'heatNumber',
      'quantityMt',
      'balanceAfterMt',
      'referenceDoc',
      'performedBy',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Production', 'Finance'],
    disclaimer:
      'Internal Yard GRN / Stock Movement Voucher generated from /inventory/stockMovements and linked Mill POs.',
  },
  {
    documentTypeId: 'stock_ledger_and_shortages_xlsx',
    title: 'Raw Material Stock Ledger, Balances & Shortage Report',
    category: 'Procurement & Inventory',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['XLSX', 'PDF', 'CSV'],
    availableSourceFields: [
      'code',
      'name',
      'grade',
      'sectionShape',
      'dimensionsMm',
      'currentStockMt',
      'reservedStockMt',
      'availableStockMt',
      'minimumStockMt',
      'reorderLevelMt',
      'supplier',
      'locationBay',
      'status',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Production', 'Sales', 'Finance'],
    disclaimer: 'Authoritative yard stock balance, shortage indent, and double-entry movement ledger.',
  },
  {
    documentTypeId: 'supplier_register_xlsx',
    title: 'Approved Steel Mill Supplier Register',
    category: 'Procurement & Inventory',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['XLSX', 'PDF'],
    availableSourceFields: [
      'code',
      'name',
      'location',
      'approvedGrades',
      'certification',
      'leadTimeDays',
      'creditTermsDays',
      'qualityRatingPercent',
      'contactPerson',
      'phone',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Production', 'Finance'],
    disclaimer: 'Approved IBR/PED/NABL steel mill vendor directory.',
  },

  // 4. PRODUCTION, QUALITY & DISPATCH
  {
    documentTypeId: 'daily_shift_production_export',
    title: 'Daily / Shift Production, Furnace, Maintenance & Power Logs',
    category: 'Production, Quality & Dispatch',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['XLSX', 'PDF', 'CSV', 'PRINT'],
    availableSourceFields: [
      'shifts (shiftA, shiftB, shiftC)',
      'machineLogs',
      'furnaceLogs',
      'maintenanceTickets',
      'powerLogs',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Production'],
    disclaimer: 'Shop-floor forging output, furnace charge batches, breakdown tickets, and HT power logs.',
  },
  {
    documentTypeId: 'quality_inspection_pdf',
    title: 'Quality Inspection Lot Report & Rejection Register',
    category: 'Production, Quality & Dispatch',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['PDF', 'XLSX', 'CSV', 'PRINT'],
    availableSourceFields: [
      'id',
      'jobNumber',
      'customer',
      'product',
      'grade',
      'heatNo',
      'inspectedQty',
      'passedQty',
      'rejectedQty',
      'status',
      'inspector',
      'date',
      'mtcNumber',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Production', 'Sales'],
    disclaimer: 'Quality inspection lot summary with automatic quantity consistency audit flags.',
  },
  {
    documentTypeId: 'dimensional_inspection_dir_pdf',
    title: 'Dimensional Inspection Report (DIR)',
    category: 'Production, Quality & Dispatch',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['PDF', 'PRINT', 'XLSX'],
    availableSourceFields: [
      'id',
      'jobNumber',
      'orderNo',
      'customerName',
      'drawingNo',
      'productName',
      'sampleSizePcs',
      'inspectorName',
      'tpiAgency',
      'inspectionDate',
      'offeringStatus',
      'parameters (dimensionName, nominalMm, toleranceMm, measuredMinMm, measuredMaxMm, instrumentUsed, result)',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Production', 'Sales'],
    disclaimer: 'Recorded CMM/vernier dimensional measurements and TPI witness status.',
  },
  {
    documentTypeId: 'mtc_certificate_draft_pdf',
    title: 'Material Test Certificate (MTC) Summary (Draft)',
    category: 'Production, Quality & Dispatch',
    readiness: 'draft_missing_fields',
    readinessLabel: 'Draft — Missing Required Fields',
    supportedFormats: ['PDF', 'PRINT'],
    availableSourceFields: [
      'mtcNumber',
      'mtcStatus',
      'heatNumber',
      'materialGrade',
      'testTypes',
      'inspectorName',
      'inspectionDate',
      'passedQty / rejectedQty',
      'clearanceStatus',
    ],
    missingSourceFields: [
      'Heat-specific Ladle & Check Chemical Analysis Percentages (C, Mn, Si, P, S, Cr, Ni, Mo %)',
      'Actual NABL Lab Mechanical Test Values (Yield MPa, UTS MPa, Elongation %, Impact Joules, HBW)',
      'Heat Treatment Time-Temperature Chart Attachment & Authorized Metallurgist Signature',
    ],
    authorizedRoles: ['Admin', 'Management', 'Production', 'Sales'],
    disclaimer:
      'Strictly uses actual recorded MTC metadata. Does NOT fabricate EN 10204 3.1 chemical percentages, mechanical MPa figures, or lab signatures.',
  },
  {
    documentTypeId: 'dispatch_delivery_challan_pdf',
    title: 'Dispatch Challan / Delivery Challan & Gate Pass',
    category: 'Production, Quality & Dispatch',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['PDF', 'PRINT', 'XLSX'],
    availableSourceFields: [
      'id',
      'date',
      'orderNo',
      'jobNumber',
      'customer',
      'product',
      'quantity',
      'balanceQty',
      'weightMt',
      'transporter',
      'vehicleNo',
      'lrNumber',
      'destination',
      'clearanceRef',
      'invoiceRef',
      'status',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Production', 'Sales', 'Finance'],
    disclaimer:
      'Outward Delivery Challan / Gate Pass. Explicitly labelled NOT A TAX INVOICE. Staged consignments awaiting vehicle/LR are watermarked Draft.',
  },

  // 5. MANAGEMENT REPORTS & MASTER DATA
  {
    documentTypeId: 'ceo_executive_report',
    title: 'CEO Command Center KPI Summary & Management Pack',
    category: 'Management Reports & Master Data',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['PDF', 'XLSX', 'PRINT'],
    availableSourceFields: [
      'dashboardKpis',
      'computedKpis & reconciliationNotes',
      'productionSummary',
      'salesOrders backlog',
      'actionQueue alerts',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Finance', 'Sales', 'Production'],
    disclaimer: 'Executive summary respecting selected date range and KPI calculation mode.',
  },
  {
    documentTypeId: 'master_data_exports',
    title: 'Customer & Product Master Directories',
    category: 'Management Reports & Master Data',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['XLSX', 'PDF', 'CSV'],
    availableSourceFields: [
      'customers (code, name, contactPerson, phone, email, location, industry, creditLimit, creditDays, totalOutstanding)',
      'products (code, name, category, size, materialGrade, standard, uom, standardWeightKg, hsnCode, standardSellingPrice)',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management', 'Sales', 'Finance', 'Production'],
    disclaimer: 'Exported from /customers and /products respecting current search filters.',
  },
  {
    documentTypeId: 'security_audit_logs_export',
    title: 'Security & Operational Audit Trail',
    category: 'Management Reports & Master Data',
    readiness: 'ready',
    readinessLabel: 'Ready to Generate',
    supportedFormats: ['XLSX', 'PDF', 'CSV'],
    availableSourceFields: [
      'id',
      'timestamp',
      'userName',
      'action',
      'collectionName',
      'documentId',
      'oldValueSummary',
      'newValueSummary',
    ],
    missingSourceFields: [],
    authorizedRoles: ['Admin', 'Management'],
    disclaimer:
      'Restricted strictly to active Admin & Management roles. Exposes no credentials, tokens, or private configuration.',
  },
];

/**
 * Verifies whether the current user is permitted to export a given document category
 */
export function verifyExportPermission(
  currentUser: UserProfile,
  activeRbacGroup: RbacRoleGroup,
  allowedRoles: RbacRoleGroup[] = ['Admin', 'Management', 'Sales', 'Production', 'Finance']
): { allowed: boolean; error?: string; reason?: string } {
  if (currentUser.accountStatus !== 'active') {
    const msg = `Export Blocked: Account "${currentUser.email}" has status "${currentUser.accountStatus}". Only active accounts can generate or download business documents.`;
    return {
      allowed: false,
      error: msg,
      reason: msg,
    };
  }
  if (!allowedRoles.includes(activeRbacGroup)) {
    const msg = `RBAC Export Restriction: Role group "${activeRbacGroup}" is not authorized to export this document. Authorized roles: ${allowedRoles.join(', ')}.`;
    return {
      allowed: false,
      error: msg,
      reason: msg,
    };
  }
  return { allowed: true };
}

export function sanitizeFilenamePart(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function formatInrForDoc(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || Number.isNaN(amount)) return '—';
  return `INR ${Number(amount).toLocaleString('en-IN')}`;
}

/**
 * Generates and downloads (or opens for printing) a professionally formatted Montex Forge PDF document
 * with repeating table headers, multi-page pagination, page numbers, readiness banner, and unclipped totals.
 */
export function generateMontexPdfDocument(
  payload: MontexPdfDocumentPayload,
  mode: 'download' | 'print' = 'download'
): { success: boolean; filename: string; error?: string } {
  try {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const { colors } = MONTEX_PDF_BRAND_TOKENS;
    const tableTheme = getMontexPdfTableTheme(pageWidth, margin);

    // 1 & 2. Shared Branded Header (Official Montex Forge Logo, #14283F Navy Banner, #F28C28 Orange Accent, & Readiness Classification Bar)
    let cursorY = applyMontexPdfHeader(doc, {
      documentCode: payload.documentCode,
      documentTitle: payload.documentTitle,
      documentSubtitle: payload.documentSubtitle,
      readiness: payload.readiness,
      readinessBannerText: payload.readinessBannerText,
      reportDate: '2026-10-22',
      margin,
      startY: 12,
    });

    // 3. Missing Fields / Draft Notice Box (if Draft or Integrity Warnings exist)
    if (
      (payload.missingFieldsList && payload.missingFieldsList.length > 0) ||
      (payload.integrityWarnings && payload.integrityWarnings.length > 0)
    ) {
      const lines: string[] = [];
      if (payload.missingFieldsList && payload.missingFieldsList.length > 0) {
        lines.push(
          `MISSING SOURCE FIELDS (NOT INVENTED): ${payload.missingFieldsList.join(' | ')}`
        );
      }
      if (payload.integrityWarnings && payload.integrityWarnings.length > 0) {
        payload.integrityWarnings.forEach((w) => lines.push(`DATA INTEGRITY NOTE: ${w}`));
      }

      const wrappedLines = doc.splitTextToSize(lines.join('\n'), pageWidth - margin * 2 - 6);
      const boxHeight = Math.max(10, wrappedLines.length * 4 + 4);

      doc.setFillColor(255, 251, 235);
      doc.setDrawColor(...colors.draftBorder);
      doc.rect(margin, cursorY, pageWidth - margin * 2, boxHeight, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(146, 64, 14);
      doc.text(wrappedLines, margin + 3, cursorY + 4.5);

      cursorY += boxHeight + 3;
    }

    // 4. Key-Value Metadata Grid (Rendered via clean 4-column table with Montex Navy/Surface tokens)
    if (payload.metadataGrid.length > 0) {
      const metaRows: string[][] = [];
      for (let i = 0; i < payload.metadataGrid.length; i += 2) {
        const left = payload.metadataGrid[i];
        const right = payload.metadataGrid[i + 1];
        metaRows.push([
          left ? left.label : '',
          left ? String(left.value) : '',
          right ? right.label : '',
          right ? String(right.value) : '',
        ]);
      }

      autoTable(doc, {
        startY: cursorY,
        margin: { left: margin, right: margin },
        body: metaRows,
        theme: 'grid',
        styles: tableTheme.metadataTableStyles.styles,
        columnStyles: tableTheme.metadataTableStyles.columnStyles,
      });

      cursorY = (doc as any).lastAutoTable.finalY + 5;
    }

    // 5. Data Tables with Repeating Headers, Montex Navy Header Theme & Unclipped Totals
    for (const section of payload.tables) {
      if (cursorY > pageHeight - 38) {
        doc.addPage();
        cursorY = 16;
      }

      if (section.sectionTitle) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...colors.primaryNavy);
        doc.text(section.sectionTitle, margin, cursorY);
        cursorY += 2;
      }

      autoTable(doc, {
        startY: cursorY,
        margin: { left: margin, right: margin, bottom: 22 },
        head: [section.headers],
        body: section.rows.map((r) => r.map((cell) => String(cell ?? '—'))),
        foot: section.foot
          ? section.foot.map((r) => r.map((cell) => String(cell ?? '')))
          : undefined,
        showHead: 'everyPage',
        showFoot: 'lastPage',
        rowPageBreak: 'avoid',
        theme: 'grid',
        headStyles: tableTheme.dataTableStyles.headStyles,
        bodyStyles: tableTheme.dataTableStyles.bodyStyles,
        alternateRowStyles: tableTheme.dataTableStyles.alternateRowStyles,
        footStyles: tableTheme.dataTableStyles.footStyles,
      });

      cursorY = (doc as any).lastAutoTable.finalY + 6;
    }

    // 6. Notes, Commercial Terms & Sign-off Block (Kept together without clipping)
    if (payload.notesAndTerms && payload.notesAndTerms.length > 0) {
      if (cursorY > pageHeight - 42) {
        doc.addPage();
        cursorY = 16;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...colors.primaryNavy);
      doc.text('Recorded Remarks, Commercial Notes & Conditions:', margin, cursorY);
      cursorY += 4;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...colors.textMain);
      for (const note of payload.notesAndTerms) {
        const split = doc.splitTextToSize(`• ${note}`, pageWidth - margin * 2);
        if (cursorY + split.length * 3.8 > pageHeight - 24) {
          doc.addPage();
          cursorY = 16;
        }
        doc.text(split, margin, cursorY);
        cursorY += split.length * 3.8 + 1;
      }
    }

    // 7. Page Numbers & Standardized Branded Footer Across All Pages
    applyMontexPdfFooterAllPages(doc, {
      footerDisclaimer: payload.footerDisclaimer,
      generatedBy: payload.generatedBy,
      generatedRole: payload.generatedRole,
      margin,
    });

    const cleanFilename = payload.filename.endsWith('.pdf')
      ? payload.filename
      : `${payload.filename}.pdf`;

    if (mode === 'print') {
      doc.autoPrint();
      const blob = doc.output('blob');
      const blobUrl = URL.createObjectURL(blob);
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.src = blobUrl;
      document.body.appendChild(iframe);
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          doc.save(cleanFilename);
        }
      };
    } else {
      doc.save(cleanFilename);
    }

    return { success: true, filename: cleanFilename };
  } catch (err: any) {
    return {
      success: false,
      filename: payload.filename,
      error: err?.message || 'Failed to generate PDF document.',
    };
  }
}

/**
 * Generates and downloads a multi-worksheet or single-worksheet Excel (.xlsx) workbook
 * with column auto-widths, auto-filters, metadata headers, and totals row.
 */
export function exportMontexExcelWorkbook(
  filename: string,
  worksheets: ExcelWorksheetSpec[],
  generatedBy: string = 'MIS Authenticated User'
): { success: boolean; filename: string; error?: string } {
  try {
    if (!worksheets || worksheets.length === 0) {
      return {
        success: false,
        filename,
        error: 'Export Blocked: No worksheet data provided.',
      };
    }

    const wb = XLSX.utils.book_new();

    for (const sheetSpec of worksheets) {
      const aoa: (string | number)[][] = [];

      // Header Banner Rows
      aoa.push(['MONTEX FORGE INDUSTRIES — MANAGEMENT INFORMATION SYSTEM']);
      aoa.push([sheetSpec.reportTitle]);
      aoa.push([
        `${sheetSpec.reportSubtitle} | Generated: 2026-10-22 | By: ${generatedBy}`,
      ]);
      aoa.push([]);

      if (sheetSpec.metadataRows && sheetSpec.metadataRows.length > 0) {
        for (const [k, v] of sheetSpec.metadataRows) {
          aoa.push([k, v]);
        }
        aoa.push([]);
      }

      const headerRowIndex = aoa.length;
      aoa.push(sheetSpec.headers);

      for (const row of sheetSpec.rows) {
        aoa.push(row);
      }

      if (sheetSpec.totalsRow && sheetSpec.totalsRow.length > 0) {
        aoa.push(sheetSpec.totalsRow);
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // Compute Column Widths
      const colWidths = sheetSpec.headers.map((header, colIdx) => {
        let maxLen = String(header || '').length;
        for (const row of sheetSpec.rows) {
          const cellStr = String(row[colIdx] ?? '');
          if (cellStr.length > maxLen) maxLen = cellStr.length;
        }
        if (sheetSpec.totalsRow && sheetSpec.totalsRow[colIdx] !== undefined) {
          const totStr = String(sheetSpec.totalsRow[colIdx]);
          if (totStr.length > maxLen) maxLen = totStr.length;
        }
        return { wch: Math.min(44, Math.max(12, maxLen + 3)) };
      });
      ws['!cols'] = colWidths;

      // Enable AutoFilter on the data table header row
      if (sheetSpec.headers.length > 0 && sheetSpec.rows.length > 0) {
        const lastRowIndex = headerRowIndex + sheetSpec.rows.length;
        const lastColIndex = sheetSpec.headers.length - 1;
        ws['!autofilter'] = {
          ref: XLSX.utils.encode_range({
            s: { r: headerRowIndex, c: 0 },
            e: { r: lastRowIndex, c: lastColIndex },
          }),
        };
      }

      const safeSheetName =
        sheetSpec.sheetName.replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet1';
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
    }

    const cleanFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
    XLSX.writeFile(wb, cleanFilename);
    return { success: true, filename: cleanFilename };
  } catch (err: any) {
    return {
      success: false,
      filename,
      error: err?.message || 'Failed to generate Excel (.xlsx) file.',
    };
  }
}

/**
 * Generates and downloads a UTF-8 CSV file with proper escaping
 */
export function exportMontexCsvFile(
  filename: string,
  headers: string[],
  rows: (string | number)[][]
): { success: boolean; filename: string; error?: string } {
  try {
    const escapeCell = (val: string | number) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvLines = [
      headers.map(escapeCell).join(','),
      ...rows.map((r) => r.map(escapeCell).join(',')),
    ].join('\n');

    const blob = new Blob([`\uFEFF${csvLines}`], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const cleanFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    link.href = url;
    link.download = cleanFilename;
    link.click();
    URL.revokeObjectURL(url);
    return { success: true, filename: cleanFilename };
  } catch (err: any) {
    return {
      success: false,
      filename,
      error: err?.message || 'Failed to export CSV file.',
    };
  }
}

// ============================================================================
// DOMAIN-SPECIFIC PDF PAYLOAD BUILDERS (READ-ONLY, ZERO DATA FABRICATION)
// ============================================================================

/**
 * 1. Sales / Billing Invoice Summary PDF (Draft — Missing Statutory GST Fields)
 */
export function buildInvoicePdfPayload(
  order: OrderJourney,
  customer: Customer | undefined,
  products: Product[],
  currentUser: UserProfile,
  activeRbacGroup: RbacRoleGroup
): MontexPdfDocumentPayload {
  const invNo =
    order.invoiceStatus.invoiceNumber && order.invoiceStatus.invoiceNumber !== '-'
      ? order.invoiceStatus.invoiceNumber
      : `UNBILLED-${order.id}`;
  const isProformaOrPending =
    order.invoiceStatus.state === 'pending' ||
    order.invoiceStatus.invoiceNumber === '-' ||
    order.invoiceStatus.invoiceNumber.toUpperCase().includes('PROFORMA');

  const missingFields: string[] = [
    'Customer GSTIN',
    'Company Statutory GSTIN',
    'Statutory Tax Rate & CGST/SGST/IGST Breakdown',
  ];
  if (order.invoiceStatus.invoiceNumber === '-') {
    missingFields.unshift('Formal Invoice Number & Invoice Date (Order Not Yet Invoiced)');
  } else if (isProformaOrPending) {
    missingFields.unshift('Final Tax Invoice Number (Currently Proforma / Pending Gate-Out)');
  }

  const lineRows = (order.lineItems || []).map((li, idx) => {
    const prod = products.find((p) => p.id === li.productId || p.code === li.productCode);
    const billedQty = li.dispatchedQty > 0 ? li.dispatchedQty : li.orderedQty;
    const lineTaxableValue = billedQty * li.ratePerUnit;
    return [
      idx + 1,
      `${li.productName} (${li.productCode})`,
      li.materialGrade,
      prod?.hsnCode || 'Not Recorded',
      `${li.orderedQty} ${li.uom}`,
      `${li.dispatchedQty} ${li.uom}`,
      formatInrForDoc(li.ratePerUnit),
      formatInrForDoc(lineTaxableValue),
      'Not Recorded in MIS',
    ];
  });

  return {
    filename: `Montex_Invoice_${sanitizeFilenamePart(invNo)}.pdf`,
    documentCode: `DOC: BILLING-SUMMARY / ${invNo}`,
    documentTitle: 'Draft Commercial Billing & Invoice Summary',
    documentSubtitle:
      'Internal MIS Billing Record — Not a Final Statutory GST Tax Invoice',
    readiness: 'draft_missing_fields',
    readinessBannerText: 'DRAFT — MISSING STATUTORY GST FIELDS',
    missingFieldsList: missingFields,
    metadataGrid: [
      { label: 'Invoice / Ref No.', value: order.invoiceStatus.invoiceNumber || 'Not Issued' },
      { label: 'Invoice Date', value: order.invoiceStatus.invoiceDate || '—' },
      { label: 'Customer Name', value: order.customerName },
      { label: 'Customer Location', value: customer?.location || order.dispatchStatus.destinationCity || '—' },
      { label: 'Customer GSTIN', value: 'Not Recorded in Customer Master' },
      { label: 'Customer PO No.', value: `${order.poNumber} (${order.poDate})` },
      { label: 'Internal Job No.', value: order.jobNumber },
      { label: 'Payment Due Date', value: order.invoiceStatus.paymentDueDate || '—' },
      { label: 'Billing Status', value: order.invoiceStatus.state.toUpperCase() },
      { label: 'Tally Sync Status', value: order.invoiceStatus.tallySyncStatus.toUpperCase() },
    ],
    tables: [
      {
        sectionTitle: '1. Itemized Commercial Line Items & Recorded Valuation',
        headers: [
          '#',
          'Product Description & Code',
          'Material Grade',
          'HSN Code',
          'PO Qty',
          'Shipped Qty',
          'Unit Rate',
          'Computed Base Value',
          'Statutory Tax (GST)',
        ],
        rows: lineRows,
      },
      {
        sectionTitle: '2. Recorded Invoice & Settlement Balance Summary',
        headers: [
          'Recorded Invoice Amount',
          'Paid / Collected Amount',
          'Outstanding Balance Due',
          'Transporter & LR Ref',
          'TPI / Clearance Ref',
        ],
        rows: [
          [
            formatInrForDoc(order.invoiceStatus.invoiceAmount),
            formatInrForDoc(order.invoiceStatus.paidAmount),
            formatInrForDoc(order.invoiceStatus.outstandingAmount),
            `${order.dispatchStatus.transporterName} (LR: ${order.dispatchStatus.lrNumber})`,
            order.clearanceStatus.clearanceRefNo || '—',
          ],
        ],
      },
    ],
    notesAndTerms: [
      'This document is a read-only Billing Summary generated from Montex MIS /salesOrders records.',
      'Statutory GSTINs, HSN-level CGST/SGST/IGST rates, and E-Invoice IRN details are maintained in offline Tally Prime and are not fabricated here.',
    ],
    footerDisclaimer:
      'DRAFT BILLING SUMMARY — Not a legally issued GST Tax Invoice. Verify final tax invoice in Tally Prime.',
    generatedBy: currentUser.name,
    generatedRole: activeRbacGroup,
  };
}

/**
 * 2. Customer Payment Receipt / Collection Statement PDF
 */
export interface RecordedPaymentReceiptItem {
  receiptNumber: string;
  paymentDate: string;
  customerId: string;
  customerName: string;
  utrReference: string;
  paymentMethod: string;
  amountReceived: number;
  previousOutstanding: number;
  closingOutstanding: number;
  recordedBy: string;
}

export function buildPaymentReceiptPdfPayload(
  ageing: OutstandingAgeingRecord,
  customer: Customer | undefined,
  receiptEvent: RecordedPaymentReceiptItem | undefined,
  currentUser: UserProfile,
  activeRbacGroup: RbacRoleGroup
): MontexPdfDocumentPayload {
  const hasSessionReceipt = Boolean(receiptEvent);
  const receiptId = receiptEvent?.receiptNumber || `STMT-${ageing.customerId}-20261022`;

  return {
    filename: hasSessionReceipt
      ? `Montex_Payment_Receipt_${sanitizeFilenamePart(receiptId)}.pdf`
      : `Montex_Receivables_Statement_${sanitizeFilenamePart(ageing.customerId)}.pdf`,
    documentCode: `DOC: ${receiptId}`,
    documentTitle: hasSessionReceipt
      ? 'Customer Payment Receipt & FIFO Settlement Advice'
      : 'Customer Receivables & Ageing Statement (Draft Receipt Summary)',
    documentSubtitle: hasSessionReceipt
      ? `Official MIS Receipt for Collection against ${ageing.customerName}`
      : 'No individual bank receipt selected — Showing current customer ageing & settlement balance',
    readiness: hasSessionReceipt ? 'ready' : 'draft_missing_fields',
    readinessBannerText: hasSessionReceipt
      ? 'READY TO GENERATE — VERIFIED COLLECTION'
      : 'DRAFT — HISTORICAL BANK UTR NOT IN RECORD',
    missingFieldsList: hasSessionReceipt
      ? undefined
      : [
          'Specific Bank UTR / Payment Voucher Reference (Post a collection first to generate a specific Payment Receipt Voucher)',
        ],
    metadataGrid: [
      { label: 'Receipt / Statement No.', value: receiptId },
      { label: 'Document Date', value: receiptEvent?.paymentDate || '2026-10-22' },
      { label: 'Customer Name', value: ageing.customerName },
      { label: 'Customer ID / Code', value: `${ageing.customerId} (${customer?.code || '—'})` },
      { label: 'Payment Method / Mode', value: receiptEvent?.paymentMethod || 'RTGS / NEFT' },
      { label: 'Bank UTR Reference', value: receiptEvent?.utrReference || 'Not Specified (Statement View)' },
      { label: 'Sanctioned Credit Limit', value: formatInrForDoc(ageing.creditLimit) },
      { label: 'Oldest Open Invoice Date', value: ageing.oldestInvoiceDate },
    ],
    tables: [
      ...(receiptEvent
        ? [
            {
              sectionTitle: '1. Payment Collection Voucher Details',
              headers: [
                'Receipt No.',
                'Payment Date',
                'UTR / Bank Reference',
                'Opening Outstanding',
                'Amount Received',
                'Closing Outstanding Balance',
              ],
              rows: [
                [
                  receiptEvent.receiptNumber,
                  receiptEvent.paymentDate,
                  receiptEvent.utrReference,
                  formatInrForDoc(receiptEvent.previousOutstanding),
                  formatInrForDoc(receiptEvent.amountReceived),
                  formatInrForDoc(receiptEvent.closingOutstanding),
                ],
              ],
            },
          ]
        : []),
      {
        sectionTitle: `${receiptEvent ? '2' : '1'}. Current Bucketed Ageing Breakdown (Post-FIFO Settlement)`,
        headers: [
          '0–30 Days (Current)',
          '31–60 Days',
          '61–90 Days',
          '90+ Days (Critical)',
          'Total Current Outstanding',
          'Credit Limit Status',
        ],
        rows: [
          [
            formatInrForDoc(ageing.bucket0to30),
            formatInrForDoc(ageing.bucket31to60),
            formatInrForDoc(ageing.bucket61to90),
            formatInrForDoc(ageing.bucket90Plus),
            formatInrForDoc(ageing.totalOutstanding),
            ageing.creditExceeded ? 'CREDIT LIMIT EXCEEDED' : 'WITHIN LIMIT',
          ],
        ],
      },
    ],
    notesAndTerms: [
      'Collections recorded in Montex MIS are applied to the oldest outstanding ageing buckets first (90+ Days -> 61-90 -> 31-60 -> 0-30).',
      'Subject to bank realization and reconciliation with Tally Prime Accounts Receivable ledger.',
    ],
    footerDisclaimer:
      'Internal MIS Payment Receipt & Receivables Statement — Subject to Tally Prime bank reconciliation.',
    generatedBy: currentUser.name,
    generatedRole: activeRbacGroup,
  };
}

/**
 * 3. Commercial Quotation PDF
 */
export function buildQuotationPdfPayload(
  quote: QuotationRecord,
  customer: Customer | undefined,
  product: Product | undefined,
  currentUser: UserProfile,
  activeRbacGroup: RbacRoleGroup
): MontexPdfDocumentPayload {
  const isDraft = quote.status === 'draft';
  const totalWeightKg = Number((quote.unitWeightKg * quote.inquiryQtyPcs).toFixed(1));

  return {
    filename: `Montex_Quotation_${sanitizeFilenamePart(quote.id)}.pdf`,
    documentCode: `QUOTATION: ${quote.id}`,
    documentTitle: isDraft
      ? 'Draft Commercial Forging Quotation'
      : 'Commercial Forging Quotation & Technical Offer',
    documentSubtitle: `Customer RFQ Ref: ${quote.rfqReference} | Valid Until: ${quote.validUntil}`,
    readiness: isDraft ? 'draft_missing_fields' : 'ready',
    readinessBannerText: isDraft
      ? 'DRAFT QUOTATION'
      : 'READY TO GENERATE — COMMERCIAL OFFER',
    missingFieldsList: [
      'Statutory GST Rate % & Freight Amount (Noted as Extra / Per RFQ Commercial Terms in Follow-Up Notes)',
    ],
    metadataGrid: [
      { label: 'Quotation Number', value: quote.id },
      { label: 'Quotation Date', value: quote.quoteDate },
      { label: 'Customer RFQ Ref', value: quote.rfqReference },
      { label: 'Offer Validity Date', value: quote.validUntil },
      { label: 'Customer Name', value: quote.customerName },
      { label: 'Kind Attention', value: quote.contactPerson },
      { label: 'Customer Location', value: customer?.location || '—' },
      { label: 'Payment Credit Terms', value: customer ? `${customer.creditDays} Days` : 'As per RFQ' },
      { label: 'Delivery Lead Time', value: `${quote.deliveryLeadWeeks} Weeks from PO / Drawing Approval` },
      { label: 'Quotation Status', value: quote.status.toUpperCase() },
    ],
    tables: [
      {
        sectionTitle: '1. Quoted Forged Item Specification & Commercial Schedule',
        headers: [
          'Item Code & Description',
          'Material Grade & Standard',
          'HSN Code',
          'Unit Weight (KG)',
          'Inquiry Qty (PCS)',
          'Total Lot Weight (KG)',
          'Rate / KG',
          'Unit Rate / PC',
          'Total Basic Value',
        ],
        rows: [
          [
            `${quote.productName} (${product?.code || quote.productId})`,
            `${quote.materialGrade} / ${quote.standard}`,
            product?.hsnCode || '—',
            `${quote.unitWeightKg} kg`,
            `${quote.inquiryQtyPcs} PCS`,
            `${totalWeightKg.toLocaleString()} kg`,
            formatInrForDoc(quote.quotedRatePerKg),
            formatInrForDoc(quote.quotedRatePerPc),
            formatInrForDoc(quote.totalQuotedValue),
          ],
        ],
        foot: [
          [
            'TOTAL QUOTED BASIC VALUE (EXCLUDING TAXES)',
            '',
            '',
            '',
            `${quote.inquiryQtyPcs} PCS`,
            `${(totalWeightKg / 1000).toFixed(2)} MT`,
            '',
            '',
            formatInrForDoc(quote.totalQuotedValue),
          ],
        ],
      },
    ],
    notesAndTerms: [
      `Recorded Commercial & Follow-Up Notes: ${quote.followUpNotes || 'None'}`,
      `Next Scheduled Follow-Up Date: ${quote.nextFollowUpDate}`,
      'Taxes & Duties: Applicable GST extra as per statutory HSN tariff at the time of dispatch (not fabricated in basic total).',
      `Delivery Schedule: ${quote.deliveryLeadWeeks} Weeks from receipt of technically & commercially clear Purchase Order.`,
    ],
    footerDisclaimer:
      'Montex Forge Industries — Commercial Offer generated from MIS Quotation Register.',
    generatedBy: currentUser.name,
    generatedRole: activeRbacGroup,
  };
}

/**
 * 4. Printable PSU / EPC Tender Summary PDF
 */
export function buildTenderSummaryPdfPayload(
  tenders: TenderRecord[],
  currentUser: UserProfile,
  activeRbacGroup: RbacRoleGroup
): MontexPdfDocumentPayload {
  const totalEstLakhs = tenders.reduce((s, t) => s + t.estimatedValueLakhs, 0);
  const totalEmd = tenders.reduce((s, t) => s + t.emdAmount, 0);

  return {
    filename: `Montex_Tender_Summary_2026-10-22.pdf`,
    documentCode: `DOC: TENDER-REGISTER-2026`,
    documentTitle: 'PSU & EPC Tender Bid Pipeline Summary',
    documentSubtitle: `Active Institutional & Rate-Contract Tenders (${tenders.length} Tenders)`,
    readiness: 'ready',
    readinessBannerText: 'READY TO GENERATE',
    metadataGrid: [
      { label: 'Total Active Tenders', value: tenders.length },
      { label: 'Total Estimated Bid Value', value: `INR ${totalEstLakhs.toFixed(2)} Lakhs` },
      { label: 'Total EMD Blocked', value: formatInrForDoc(totalEmd) },
      { label: 'Awarded / Qualified Bids', value: tenders.filter((t) => t.technicalBidStatus === 'awarded' || t.technicalBidStatus === 'qualified').length },
    ],
    tables: [
      {
        sectionTitle: 'Institutional Tender Register',
        headers: [
          'Tender ID & Number',
          'Issuing Authority',
          'Project Title & Scope',
          'Est. Value (Lakhs)',
          'EMD Amount',
          'Bid Submission',
          'Price Bid Opening',
          'Technical Status',
          'Owner',
        ],
        rows: tenders.map((t) => [
          `${t.id}\n${t.tenderNumber}`,
          t.issuingAuthority,
          `${t.projectTitle}\n(${t.itemSummary})`,
          `INR ${t.estimatedValueLakhs.toFixed(2)}L`,
          formatInrForDoc(t.emdAmount),
          t.bidSubmissionDate,
          t.priceBidOpeningDate,
          t.technicalBidStatus.toUpperCase(),
          t.assignedOwner,
        ]),
        foot: [
          [
            'TOTAL PIPELINE',
            '',
            '',
            `INR ${totalEstLakhs.toFixed(2)}L`,
            formatInrForDoc(totalEmd),
            '',
            '',
            '',
            '',
          ],
        ],
      },
    ],
    footerDisclaimer: 'Montex Forge Industries — Internal Commercial Tender Pipeline Summary.',
    generatedBy: currentUser.name,
    generatedRole: activeRbacGroup,
  };
}

/**
 * 5. Individual Order / Job 7-Stage Lifecycle Progress Report PDF (and Customer PO Summary PDF)
 */
export function buildOrderProgressPdfPayload(
  order: OrderJourney,
  mode: 'po_summary' | 'full_progress',
  currentUser: UserProfile,
  activeRbacGroup: RbacRoleGroup
): MontexPdfDocumentPayload {
  const validation = validateSalesOrderQuantities(order);
  const warnings = [...validation.errors, ...validation.warnings];

  const isPoSummary = mode === 'po_summary';

  return {
    filename: isPoSummary
      ? `Montex_Customer_PO_Summary_${sanitizeFilenamePart(order.id)}.pdf`
      : `Montex_Order_Journey_${sanitizeFilenamePart(order.jobNumber)}.pdf`,
    documentCode: isPoSummary ? `PO-REG: ${order.id}` : `JOB-DOSSIER: ${order.jobNumber}`,
    documentTitle: isPoSummary
      ? 'Internal Customer PO Registration Summary (Not a Tax Invoice)'
      : '7-Stage Order & Job Lifecycle Progress Report',
    documentSubtitle: `Customer PO: ${order.poNumber} | Internal Job No: ${order.jobNumber} | Customer: ${order.customerName}`,
    readiness: 'ready',
    readinessBannerText: 'READY TO GENERATE — INTERNAL ORDER RECORD',
    integrityWarnings: warnings.length > 0 ? warnings : undefined,
    metadataGrid: [
      { label: 'Internal Order ID', value: order.id },
      { label: 'Internal Job Number', value: order.jobNumber },
      { label: 'Customer PO Number', value: order.poNumber },
      { label: 'Customer PO Date', value: order.poDate },
      { label: 'Customer Name', value: order.customerName },
      { label: 'Current Lifecycle Stage', value: `${order.statusLabel} (${order.status})` },
      { label: 'Target Delivery Date', value: order.targetDeliveryDate },
      { label: 'Expected Delivery Date', value: order.expectedDeliveryDate },
      { label: 'Total PO Basic Value', value: formatInrForDoc(order.totalValue) },
      { label: 'Destination Location', value: order.dispatchStatus.destinationCity || '—' },
    ],
    tables: [
      {
        sectionTitle: '1. Ordered Forging Line Items & Quantity Progression',
        headers: [
          'Item Code',
          'Product Description & Size',
          'Material Grade',
          'Ordered Qty',
          'Produced Qty',
          'QC Passed Qty',
          'Rejected Qty',
          'Dispatched Qty',
          'Pending Qty',
          'Unit Rate',
          'Line Total',
        ],
        rows: (order.lineItems || []).map((li) => [
          li.productCode,
          `${li.productName} (${li.size})`,
          li.materialGrade,
          `${li.orderedQty} ${li.uom}`,
          `${li.producedQty} ${li.uom}`,
          `${li.inspectedOkQty} ${li.uom}`,
          `${li.rejectedQty} ${li.uom}`,
          `${li.dispatchedQty} ${li.uom}`,
          `${li.pendingQty} ${li.uom}`,
          formatInrForDoc(li.ratePerUnit),
          formatInrForDoc(li.totalAmount),
        ]),
      },
      ...(isPoSummary
        ? []
        : [
            {
              sectionTitle: '2. Stage-by-Stage Operational Traceability Matrix',
              headers: [
                'Lifecycle Stage',
                'Current State',
                'Primary Reference / Certificate',
                'Date',
                'Recorded Operational Details',
              ],
              rows: [
                [
                  'Stage 1: Customer PO',
                  'REGISTERED',
                  order.poNumber,
                  order.poDate,
                  `Customer: ${order.customerName} | PO Value: ${formatInrForDoc(order.totalValue)}`,
                ],
                [
                  'Stage 2: Job Card',
                  order.status.toUpperCase(),
                  order.jobNumber,
                  order.poDate,
                  order.statusLabel,
                ],
                [
                  'Stage 3: Raw Material',
                  order.materialStatus.state.toUpperCase(),
                  `Heat: ${order.materialStatus.heatNumber}`,
                  order.materialStatus.lastUpdated,
                  `${order.materialStatus.materialGrade} | Supplier: ${order.materialStatus.supplierName} | Allocated: ${order.materialStatus.allocatedKg} / ${order.materialStatus.requiredKg} KG`,
                ],
                [
                  'Stage 4: Quality & NDT',
                  order.qualityStatus.state.toUpperCase(),
                  `MTC: ${order.qualityStatus.mtcNumber} (${order.qualityStatus.mtcStatus})`,
                  order.qualityStatus.inspectionDate,
                  `Inspector: ${order.qualityStatus.inspectorName} | Tests: ${(order.qualityStatus.testTypes || []).join(', ')}${order.qualityStatus.rejectionReason ? ` | Note: ${order.qualityStatus.rejectionReason}` : ''}`,
                ],
                [
                  'Stage 5: TPI Clearance',
                  order.clearanceStatus.state.toUpperCase(),
                  `IRN: ${order.clearanceStatus.clearanceRefNo}`,
                  order.clearanceStatus.clearanceDate,
                  `Agency: ${order.clearanceStatus.agency} (${order.clearanceStatus.inspectorName}) | ${order.clearanceStatus.remarks}`,
                ],
                [
                  'Stage 6: Dispatch & LR',
                  order.dispatchStatus.state.toUpperCase(),
                  `LR: ${order.dispatchStatus.lrNumber}`,
                  order.dispatchStatus.dispatchDate,
                  `Shipped: ${order.dispatchStatus.totalShippedQty} PCS | Balance: ${order.dispatchStatus.balanceQty} PCS | Transporter: ${order.dispatchStatus.transporterName} (${order.dispatchStatus.vehicleNo})`,
                ],
                [
                  'Stage 7: Billing & Tally',
                  order.invoiceStatus.state.toUpperCase(),
                  `Inv: ${order.invoiceStatus.invoiceNumber}`,
                  order.invoiceStatus.invoiceDate,
                  `Invoiced: ${formatInrForDoc(order.invoiceStatus.invoiceAmount)} | Paid: ${formatInrForDoc(order.invoiceStatus.paidAmount)} | Due: ${formatInrForDoc(order.invoiceStatus.outstandingAmount)} | Tally: ${order.invoiceStatus.tallySyncStatus}`,
                ],
              ],
            },
          ]),
    ],
    notesAndTerms: [
      'This document is an internal Customer Purchase Order & Job Progress record and MUST NOT be used as a Tax Invoice.',
      ...(order.materialStatus.notes ? [`Material Allocation Note: ${order.materialStatus.notes}`] : []),
    ],
    footerDisclaimer:
      'Internal Customer PO & Job Progress Dossier — Not a company-issued Tax Invoice.',
    generatedBy: currentUser.name,
    generatedRole: activeRbacGroup,
  };
}

/**
 * 6. Internal Steel Mill Purchase Order / Supplier Bill Summary PDF
 */
export function buildMillPurchaseOrderPdfPayload(
  po: PurchaseOrderRecord,
  supplier: SteelMillSupplier | undefined,
  mode: 'mill_po' | 'supplier_bill_summary',
  currentUser: UserProfile,
  activeRbacGroup: RbacRoleGroup
): MontexPdfDocumentPayload {
  const isBillSummary = mode === 'supplier_bill_summary';
  const receivedValuation = Math.round(po.receivedMt * po.ratePerMt);

  return {
    filename: isBillSummary
      ? `Montex_Supplier_Bill_Summary_${sanitizeFilenamePart(po.id)}.pdf`
      : `Montex_Mill_PO_${sanitizeFilenamePart(po.id)}.pdf`,
    documentCode: isBillSummary ? `BILL-SUM: ${po.poNumber}` : `MILL-PO: ${po.poNumber}`,
    documentTitle: isBillSummary
      ? 'Internal Purchase & GRN Bill Valuation Summary (Draft)'
      : 'Internal Steel Mill Purchase Order Summary',
    documentSubtitle: `Steel Mill Supplier: ${po.supplierName} | Linked Job: ${po.linkedJobNumber}`,
    readiness: isBillSummary ? 'draft_missing_fields' : 'ready',
    readinessBannerText: isBillSummary
      ? 'DRAFT — MISSING SUPPLIER TAX INVOICE & GSTIN'
      : 'READY TO GENERATE — INTERNAL MILL PO',
    missingFieldsList: isBillSummary
      ? [
          'Supplier Tax Invoice Number & Bill Date',
          'Supplier GSTIN',
          'Statutory GST / TCS Tax Breakdown on Steel Billets',
        ]
      : [
          'Statutory GST % & Formal Commercial Annexures (Internal Procurement Summary Only)',
        ],
    metadataGrid: [
      { label: 'Internal PO ID', value: po.id },
      { label: 'Purchase Order No.', value: po.poNumber },
      { label: 'PO Issue Date', value: po.poDate },
      { label: 'Expected Delivery', value: po.expectedDeliveryDate },
      { label: 'Steel Mill Supplier', value: po.supplierName },
      { label: 'Mill Location', value: supplier?.location || '—' },
      { label: 'Mill Contact Person', value: supplier ? `${supplier.contactPerson} (${supplier.phone})` : '—' },
      { label: 'Credit Terms', value: supplier ? `${supplier.creditTermsDays} Days` : '—' },
      { label: 'Linked Job Reference', value: po.linkedJobNumber },
      { label: 'Mill Heat Number', value: po.millHeatNumber },
    ],
    tables: [
      {
        sectionTitle: 'Steel Billet / Ingot Specification & Tonnage Schedule',
        headers: [
          'Material Code',
          'Alloy / Steel Grade',
          'Billet Section',
          'Ordered (MT)',
          'Received via GRN (MT)',
          'Pending (MT)',
          'Rate / MT',
          'Total PO Basic Value',
          'Received GRN Basic Value',
        ],
        rows: [
          [
            po.materialCode,
            po.materialGrade,
            po.sectionMm,
            `${po.orderedMt.toFixed(2)} MT`,
            `${po.receivedMt.toFixed(2)} MT`,
            `${po.pendingMt.toFixed(2)} MT`,
            formatInrForDoc(po.ratePerMt),
            formatInrForDoc(po.totalValue),
            formatInrForDoc(receivedValuation),
          ],
        ],
      },
    ],
    notesAndTerms: [
      'Internal Montex Forge MIS procurement summary — Clearly distinguished from a legally issued supplier tax invoice or external contract.',
      `Mill Approvals on File: ${supplier?.certification || 'Standard Approved Mill'}`,
    ],
    footerDisclaimer:
      'Internal MIS Steel Mill PO / GRN Valuation Summary — Not a supplier-issued statutory invoice.',
    generatedBy: currentUser.name,
    generatedRole: activeRbacGroup,
  };
}

/**
 * 7. Goods Receipt Note (GRN) / Material Stock Movement PDF Voucher
 */
export function buildStockMovementGrnPdfPayload(
  movement: StockMovement,
  material: RawMaterialStock | undefined,
  linkedPo: PurchaseOrderRecord | undefined,
  currentUser: UserProfile,
  activeRbacGroup: RbacRoleGroup
): MontexPdfDocumentPayload {
  const isGrn = movement.movementType === 'Receipt (GRN)';

  return {
    filename: isGrn
      ? `Montex_GRN_${sanitizeFilenamePart(movement.id)}.pdf`
      : `Montex_Stock_Movement_${sanitizeFilenamePart(movement.id)}.pdf`,
    documentCode: `VOUCHER: ${movement.id}`,
    documentTitle: isGrn
      ? 'Internal Goods Receipt Note (GRN) Summary Voucher'
      : `Raw Material Yard Movement Voucher — ${movement.movementType}`,
    documentSubtitle: `Reference Document: ${movement.referenceDoc} | Recorded Timestamp: ${movement.timestamp}`,
    readiness: 'ready',
    readinessBannerText: 'READY TO GENERATE — INTERNAL YARD VOUCHER',
    metadataGrid: [
      { label: 'Movement Voucher ID', value: movement.id },
      { label: 'Movement Type', value: movement.movementType },
      { label: 'Timestamp', value: movement.timestamp },
      { label: 'Reference Document', value: movement.referenceDoc },
      { label: 'Material Code', value: movement.materialCode },
      { label: 'Material Grade', value: movement.materialGrade },
      { label: 'Mill Heat Number', value: movement.heatNumber },
      { label: 'Supplier / Mill', value: linkedPo?.supplierName || material?.supplier || '—' },
      { label: 'Linked Mill PO No.', value: linkedPo?.poNumber || '—' },
      { label: 'Recorded / Verified By', value: movement.performedBy },
    ],
    tables: [
      {
        sectionTitle: 'Recorded Yard Tonnage & Ledger Balance Impact',
        headers: [
          'Material Code',
          'Grade & Section',
          'Storage Bay',
          'Heat Number',
          'Movement Type',
          'Movement Qty (MT)',
          'Closing Yard Balance After (MT)',
        ],
        rows: [
          [
            movement.materialCode,
            `${movement.materialGrade} (${material?.dimensionsMm || '—'})`,
            material?.locationBay || '—',
            movement.heatNumber,
            movement.movementType,
            `${movement.quantityMt > 0 ? `+${movement.quantityMt}` : movement.quantityMt} MT`,
            `${movement.balanceAfterMt} MT`,
          ],
        ],
      },
    ],
    notesAndTerms: [
      'This voucher is an internally generated Montex Stores & Yard ledger record from /inventory/stockMovements.',
      'Clearly distinguished from an external steel mill delivery challan or weighbridge certificate.',
    ],
    footerDisclaimer:
      'Internal Yard GRN / Stock Movement Summary Voucher — Read-Only MIS Export.',
    generatedBy: currentUser.name,
    generatedRole: activeRbacGroup,
  };
}

/**
 * 8. Quality Inspection Lot Report PDF
 */
export function buildQualityInspectionPdfPayload(
  qc: QualityInspectionRecord,
  linkedOrder: OrderJourney | undefined,
  currentUser: UserProfile,
  activeRbacGroup: RbacRoleGroup
): MontexPdfDocumentPayload {
  const valCheck = validateQualityInspectionQuantities(qc);
  const warnings = [...valCheck.errors, ...valCheck.warnings];
  const uninspectedOrRework = Math.max(0, qc.inspectedQty - (qc.passedQty + qc.rejectedQty));

  return {
    filename: `Montex_Quality_Inspection_${sanitizeFilenamePart(qc.id)}.pdf`,
    documentCode: `QC-LOT: ${qc.id}`,
    documentTitle: 'Quality Assurance Lot Inspection Report',
    documentSubtitle: `Job Number: ${qc.jobNumber} | Customer: ${qc.customer} | Date: ${qc.date}`,
    readiness: 'ready',
    readinessBannerText:
      warnings.length > 0
        ? 'READY — INCLUDES QUANTITY AUDIT WARNING'
        : 'READY TO GENERATE — VERIFIED QC LOT',
    integrityWarnings: warnings.length > 0 ? warnings : undefined,
    metadataGrid: [
      { label: 'Inspection Lot ID', value: qc.id },
      { label: 'Inspection Date', value: qc.date },
      { label: 'Internal Job Number', value: qc.jobNumber },
      { label: 'Customer Name', value: qc.customer },
      { label: 'Component Description', value: qc.product },
      { label: 'Material Grade', value: qc.grade },
      { label: 'Mill Heat Number', value: qc.heatNo },
      { label: 'MTC Reference No.', value: qc.mtcNumber },
      { label: 'QA Inspector', value: qc.inspector },
      { label: 'Lot Disposition Status', value: qc.status.toUpperCase() },
    ],
    tables: [
      {
        sectionTitle: '1. Lot Quantity Disposition Summary',
        headers: [
          'Inspected Lot Qty (PCS)',
          'Passed / Accepted Qty (PCS)',
          'Rejected Qty (PCS)',
          'In-Progress / Hold / Rework Balance (PCS)',
          'Pass Yield (%)',
          'Lot Status',
        ],
        rows: [
          [
            `${qc.inspectedQty} PCS`,
            `${qc.passedQty} PCS`,
            `${qc.rejectedQty} PCS`,
            `${uninspectedOrRework} PCS`,
            qc.passedQty + qc.rejectedQty > 0
              ? `${((qc.passedQty / (qc.passedQty + qc.rejectedQty)) * 100).toFixed(1)}%`
              : '—',
            qc.status.toUpperCase(),
          ],
        ],
      },
      ...(linkedOrder
        ? [
            {
              sectionTitle: '2. Linked Order NDT Scope & Non-Conformance Remarks',
              headers: ['Required Test Scope', 'TPI Agency', 'TPI Clearance Ref', 'Recorded Rejection / QA Remarks'],
              rows: [
                [
                  (linkedOrder.qualityStatus.testTypes || []).join('; ') || 'Standard Visual & Dimensional',
                  linkedOrder.clearanceStatus.agency || '—',
                  linkedOrder.clearanceStatus.clearanceRefNo || '—',
                  linkedOrder.qualityStatus.rejectionReason || linkedOrder.clearanceStatus.remarks || 'No non-conformance remarks recorded',
                ],
              ],
            },
          ]
        : []),
    ],
    footerDisclaimer:
      'Montex Forge Quality Assurance Department — Internal Lot Inspection Record (/quality/inspections).',
    generatedBy: currentUser.name,
    generatedRole: activeRbacGroup,
  };
}

/**
 * 9. Dimensional Inspection Report (DIR) PDF
 */
export function buildDimensionalReportPdfPayload(
  dir: DimensionalInspectionReport,
  currentUser: UserProfile,
  activeRbacGroup: RbacRoleGroup
): MontexPdfDocumentPayload {
  return {
    filename: `Montex_DIR_${sanitizeFilenamePart(dir.id)}.pdf`,
    documentCode: `DIR: ${dir.id}`,
    documentTitle: 'Dimensional Inspection Report (DIR)',
    documentSubtitle: `Drawing No: ${dir.drawingNo} | Job No: ${dir.jobNumber} | TPI: ${dir.tpiAgency}`,
    readiness: 'ready',
    readinessBannerText: 'READY TO GENERATE — DIMENSIONAL QC REPORT',
    metadataGrid: [
      { label: 'DIR Report ID', value: dir.id },
      { label: 'Inspection Date', value: dir.inspectionDate },
      { label: 'Job Number', value: dir.jobNumber },
      { label: 'Customer PO No.', value: dir.orderNo },
      { label: 'Customer Name', value: dir.customerName },
      { label: 'Product Description', value: dir.productName },
      { label: 'Approved Drawing No.', value: dir.drawingNo },
      { label: 'Sample Size Inspected', value: `${dir.sampleSizePcs} PCS` },
      { label: 'QA Inspector', value: dir.inspectorName },
      { label: 'TPI Agency & Status', value: `${dir.tpiAgency} (${dir.offeringStatus.toUpperCase()})` },
    ],
    tables: [
      {
        sectionTitle: 'Recorded Dimensional Metrology Observations',
        headers: [
          '#',
          'Dimension Parameter',
          'Nominal (mm)',
          'Tolerance (mm)',
          'Measured Min (mm)',
          'Measured Max (mm)',
          'Measuring Instrument Used',
          'Observation Result',
        ],
        rows: dir.parameters.map((p, idx) => [
          idx + 1,
          p.dimensionName,
          p.nominalMm,
          p.toleranceMm,
          p.measuredMinMm,
          p.measuredMaxMm,
          p.instrumentUsed,
          p.result,
        ]),
      },
    ],
    notesAndTerms: [
      `TPI Offering Status: ${dir.offeringStatus.replace(/_/g, ' ').toUpperCase()}`,
      'All measurements recorded in millimeters (mm) using calibrated metrology instruments.',
    ],
    footerDisclaimer:
      'Montex Forge Quality Assurance — Dimensional Inspection Report generated from recorded metrology parameters.',
    generatedBy: currentUser.name,
    generatedRole: activeRbacGroup,
  };
}

/**
 * 10. Material Test Certificate (MTC) Summary PDF (Strictly Non-Fabricated Draft)
 */
export function buildMtcDraftPdfPayload(
  order: OrderJourney,
  qcRecord: QualityInspectionRecord | undefined,
  dirRecord: DimensionalInspectionReport | undefined,
  currentUser: UserProfile,
  activeRbacGroup: RbacRoleGroup
): MontexPdfDocumentPayload {
  const mtcNo =
    order.qualityStatus.mtcNumber && order.qualityStatus.mtcNumber !== '-'
      ? order.qualityStatus.mtcNumber
      : qcRecord?.mtcNumber || `MTC-DRAFT-${order.jobNumber}`;

  const missingLabFields = [
    'Ladle & Check Chemical Analysis Percentages (C%, Mn%, Si%, P%, S%, Cr%, Ni%, Mo%)',
    'Mechanical Tensile Test Lab Readings (Yield MPa, UTS MPa, Elongation %, Reduction of Area %)',
    'Charpy V-Notch Impact Energy Values (Joules) & Exact Brinell Hardness Readings (HBW)',
    'Heat Treatment Furnace Time-Temperature Chart & Authorized Metallurgist Wet Signature',
  ];

  return {
    filename: `Montex_MTC_Summary_${sanitizeFilenamePart(mtcNo)}.pdf`,
    documentCode: `MTC-SUMMARY: ${mtcNo}`,
    documentTitle: 'Material Test Certificate (MTC) Recorded Data Summary (Draft)',
    documentSubtitle:
      'Strictly Generated from Recorded MIS Metadata — Not a Statutory EN 10204 3.1 Lab Certificate',
    readiness: 'draft_missing_fields',
    readinessBannerText: 'DRAFT — MISSING NABL LAB CHEMICAL & MECHANICAL VALUES',
    missingFieldsList: missingLabFields,
    metadataGrid: [
      { label: 'MTC Reference No.', value: mtcNo },
      { label: 'Recorded MTC Status', value: order.qualityStatus.mtcStatus.toUpperCase() },
      { label: 'Internal Job Number', value: order.jobNumber },
      { label: 'Customer PO Number', value: order.poNumber },
      { label: 'Customer Name', value: order.customerName },
      { label: 'Material Grade', value: order.lineItems[0]?.materialGrade || order.materialStatus.materialGrade },
      { label: 'Mill Heat Number', value: order.materialStatus.heatNumber },
      { label: 'Raw Material Mill', value: order.materialStatus.supplierName },
      { label: 'QA Inspector', value: order.qualityStatus.inspectorName },
      { label: 'Inspection Date', value: order.qualityStatus.inspectionDate },
    ],
    tables: [
      {
        sectionTitle: '1. Recorded Lot Traceability & Quantity Summary',
        headers: [
          'Product Description',
          'Size',
          'Heat Number',
          'PO Ordered Qty',
          'Produced Qty',
          'QC Passed Qty',
          'Rejected Qty',
          'Material Allocation Notes',
        ],
        rows: (order.lineItems || []).map((li) => [
          li.productName,
          li.size,
          order.materialStatus.heatNumber,
          `${li.orderedQty} ${li.uom}`,
          `${li.producedQty} ${li.uom}`,
          `${li.inspectedOkQty} ${li.uom}`,
          `${li.rejectedQty} ${li.uom}`,
          order.materialStatus.notes || '—',
        ]),
      },
      {
        sectionTitle: '2. Recorded Non-Destructive & Quality Test Scope',
        headers: [
          'Recorded Test Scope in MIS',
          'Chemical & Mechanical Numerical Lab Values',
          'TPI Agency',
          'TPI Release Note (IRN)',
          'TPI Clearance Status',
        ],
        rows: [
          [
            (order.qualityStatus.testTypes || []).join(', ') || 'Not Specified',
            'NOT RECORDED IN MIS SCHEMA (Do Not Fabricate — Attach NABL Lab Sheet)',
            order.clearanceStatus.agency || '—',
            order.clearanceStatus.clearanceRefNo || '—',
            order.clearanceStatus.state.toUpperCase(),
          ],
        ],
      },
      ...(dirRecord
        ? [
            {
              sectionTitle: `3. Linked Dimensional Inspection Report (${dirRecord.id} — Drawing ${dirRecord.drawingNo})`,
              headers: [
                'Dimension Parameter',
                'Nominal (mm)',
                'Tolerance (mm)',
                'Measured Min (mm)',
                'Measured Max (mm)',
                'Instrument',
                'Result',
              ],
              rows: dirRecord.parameters.map((p) => [
                p.dimensionName,
                p.nominalMm,
                p.toleranceMm,
                p.measuredMinMm,
                p.measuredMaxMm,
                p.instrumentUsed,
                p.result,
              ]),
            },
          ]
        : []),
    ],
    notesAndTerms: [
      'DATA INTEGRITY POLICY: Chemical element percentages and mechanical MPa test figures are not stored in the current RTDB schema and are intentionally omitted rather than fabricated.',
      'To issue a legally compliant EN 10204 Type 3.1 Certificate, attach the signed NABL laboratory spectro/tensile report for Heat ' +
        order.materialStatus.heatNumber +
        '.',
    ],
    footerDisclaimer:
      'DRAFT MTC DATA SUMMARY — Not an EN 10204 3.1 Certificate until NABL lab values & signatures are attached.',
    generatedBy: currentUser.name,
    generatedRole: activeRbacGroup,
  };
}

/**
 * 11. Dispatch Challan / Delivery Challan PDF (Explicitly NOT a Tax Invoice)
 */
export function buildDispatchChallanPdfPayload(
  dispatch: {
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
  linkedOrder: OrderJourney | undefined,
  currentUser: UserProfile,
  activeRbacGroup: RbacRoleGroup
): MontexPdfDocumentPayload {
  const isStagedPending =
    dispatch.status === 'ready_for_dispatch' ||
    dispatch.status === 'pending' ||
    dispatch.lrNumber.includes('PENDING');

  const hasBalanceMismatch =
    linkedOrder !== undefined &&
    isStagedPending &&
    dispatch.balanceQty === 0 &&
    linkedOrder.dispatchStatus.balanceQty > 0;

  return {
    filename: `Montex_Dispatch_Challan_${sanitizeFilenamePart(dispatch.id)}.pdf`,
    documentCode: `CHALLAN: ${dispatch.id}`,
    documentTitle: isStagedPending
      ? 'Draft Outward Delivery Challan / Gate Staging Slip (Not a Tax Invoice)'
      : 'Outward Delivery Challan & Gate Pass (Not a Tax Invoice)',
    documentSubtitle: `Consignment Ref: ${dispatch.id} | Customer PO: ${dispatch.orderNo} | Job: ${dispatch.jobNumber}`,
    readiness: isStagedPending ? 'draft_missing_fields' : 'ready',
    readinessBannerText: isStagedPending
      ? 'DRAFT — STAGED FOR PICKUP (LR PENDING)'
      : 'READY TO GENERATE — DELIVERY CHALLAN',
    missingFieldsList: isStagedPending
      ? ['Final Vehicle Registration Number at Gate-Out', 'Confirmed Transporter Lorry Receipt (LR) Number']
      : undefined,
    integrityWarnings: hasBalanceMismatch
      ? [
          `Staging record ${dispatch.id} shows balanceQty=0 PCS while parent order ${linkedOrder?.id} has balanceQty=${linkedOrder?.dispatchStatus.balanceQty} PCS awaiting gate-out.`,
        ]
      : undefined,
    metadataGrid: [
      { label: 'Delivery Challan No.', value: dispatch.id },
      { label: 'Challan / Dispatch Date', value: dispatch.date },
      { label: 'Customer Name', value: dispatch.customer },
      { label: 'Destination Location', value: dispatch.destination },
      { label: 'Customer PO Reference', value: dispatch.orderNo },
      { label: 'Internal Job Number', value: dispatch.jobNumber },
      { label: 'Transporter Name', value: dispatch.transporter },
      { label: 'Vehicle Registration No.', value: dispatch.vehicleNo },
      { label: 'Lorry Receipt (LR) No.', value: dispatch.lrNumber },
      { label: 'TPI Clearance Ref', value: dispatch.clearanceRef || '—' },
      { label: 'Linked Billing Ref', value: dispatch.invoiceRef || '—' },
      { label: 'Consignment Status', value: dispatch.status.toUpperCase() },
    ],
    tables: [
      {
        sectionTitle: 'Consignment Item & Tonnage Details',
        headers: [
          'Job Number',
          'Product / Forging Description',
          'Heat Number',
          'Consignment Qty (PCS)',
          'Remaining PO Balance (PCS)',
          'Net Consignment Weight (MT)',
          'Clearance / IRN Ref',
        ],
        rows: [
          [
            dispatch.jobNumber,
            dispatch.product,
            linkedOrder?.materialStatus.heatNumber || 'Verified on Job Card',
            `${dispatch.quantity} PCS`,
            `${dispatch.balanceQty} PCS`,
            `${dispatch.weightMt} MT`,
            dispatch.clearanceRef || '—',
          ],
        ],
      },
    ],
    notesAndTerms: [
      'IMPORTANT NOTICE: This document is an Outward Delivery Challan / Gate Pass for movement of goods and is NOT a Tax Invoice.',
      'Please verify package count and flange/ring heat markings against the attached inspection release note upon unloading.',
    ],
    footerDisclaimer:
      'DELIVERY CHALLAN / GATE PASS ONLY — Not a statutory Tax Invoice.',
    generatedBy: currentUser.name,
    generatedRole: activeRbacGroup,
  };
}

/**
 * 12. Job Cost Sheet PDF Builder
 */
export function buildJobCostSheetPdfPayload(
  sheet: JobCostSheet,
  currentUser: UserProfile,
  activeRbacGroup: RbacRoleGroup
): MontexPdfDocumentPayload {
  const netMaterialCost = sheet.materialCostInr - sheet.scrapRecoveryCreditInr;
  const totalJobCost =
    netMaterialCost +
    sheet.labourCostInr +
    sheet.powerCostInr +
    sheet.fuelHeatTreatmentCostInr +
    sheet.machiningProcessingCostInr +
    sheet.testingTpiCostInr +
    sheet.packingCostInr +
    sheet.transportFreightCostInr +
    sheet.overheadCostInr;
  const netProfitInr = sheet.totalRevenueInr - totalJobCost;
  const realizedMarginPercent = Number(
    ((netProfitInr / Math.max(1, sheet.totalRevenueInr)) * 100).toFixed(1)
  );
  const totalFinishedWeightKg = sheet.orderedQty * sheet.finishedWeightKgPerPc;
  const costPerPiece = Math.round(totalJobCost / Math.max(1, sheet.orderedQty));
  const costPerKg = Number((totalJobCost / Math.max(1, totalFinishedWeightKg)).toFixed(1));

  return {
    filename: `Montex_Job_Cost_Sheet_${sanitizeFilenamePart(sheet.jobNumber)}.pdf`,
    documentCode: `COST-SHEET: ${sheet.jobNumber}`,
    documentTitle: '8-Head Forging Job Costing & Margin Analysis Sheet',
    documentSubtitle: `Job: ${sheet.jobNumber} | PO: ${sheet.poNumber} | Customer: ${sheet.customerName}`,
    readiness: 'ready',
    readinessBannerText: 'READY TO GENERATE — INTERNAL COST SHEET',
    metadataGrid: [
      { label: 'Job Number', value: sheet.jobNumber },
      { label: 'Customer PO No.', value: sheet.poNumber },
      { label: 'Customer Name', value: sheet.customerName },
      { label: 'Product Description', value: `${sheet.productName} (${sheet.materialGrade})` },
      { label: 'Ordered Quantity', value: `${sheet.orderedQty} PCS` },
      { label: 'Cut vs Finished Weight', value: `${sheet.cutWeightKgPerPc} kg cut -> ${sheet.finishedWeightKgPerPc} kg fin` },
      { label: 'PO Commercial Revenue', value: formatInrForDoc(sheet.totalRevenueInr) },
      { label: 'Total Absorbed Cost', value: formatInrForDoc(totalJobCost) },
      { label: 'Realized Net Margin', value: `${formatInrForDoc(netProfitInr)} (${realizedMarginPercent}%)` },
      { label: 'Quoted Target Margin', value: `${sheet.quotedMarginPercent}%` },
    ],
    tables: [
      {
        sectionTitle: 'Itemized Cost Heads & Per-Piece / Per-KG Absorption',
        headers: ['Cost Head', 'Basis / Allocation Note', 'Total Cost (INR)', 'Cost per Piece (INR)'],
        rows: [
          [
            '1. Gross Raw Material (Billet Cut Weight)',
            `${sheet.cutWeightKgPerPc} kg/pc × ${sheet.orderedQty} PCS`,
            formatInrForDoc(sheet.materialCostInr),
            formatInrForDoc(Math.round(sheet.materialCostInr / sheet.orderedQty)),
          ],
          [
            '   Less: Flash & Turning Scrap Recovery Credit',
            `Recovered ${(sheet.cutWeightKgPerPc - sheet.finishedWeightKgPerPc).toFixed(1)} kg/pc`,
            `-${formatInrForDoc(sheet.scrapRecoveryCreditInr)}`,
            `-${formatInrForDoc(Math.round(sheet.scrapRecoveryCreditInr / sheet.orderedQty))}`,
          ],
          [
            '2. Direct Shop-Floor Forging & Rolling Labour',
            'Hammer/Press crew & billet cutting',
            formatInrForDoc(sheet.labourCostInr),
            formatInrForDoc(Math.round(sheet.labourCostInr / sheet.orderedQty)),
          ],
          [
            '3. HT Electricity & Induction Heating Power',
            'Allocated from press & furnace sub-meters',
            formatInrForDoc(sheet.powerCostInr),
            formatInrForDoc(Math.round(sheet.powerCostInr / sheet.orderedQty)),
          ],
          [
            '4. Reheating Furnace Fuel & Heat Treatment',
            'LDO / PNG soaking + Normalizing/Tempering',
            formatInrForDoc(sheet.fuelHeatTreatmentCostInr),
            formatInrForDoc(Math.round(sheet.fuelHeatTreatmentCostInr / sheet.orderedQty)),
          ],
          [
            '5. CNC Machining, Drilling & Serration',
            'Finish turning & bolt-hole drilling',
            formatInrForDoc(sheet.machiningProcessingCostInr),
            formatInrForDoc(Math.round(sheet.machiningProcessingCostInr / sheet.orderedQty)),
          ],
          [
            '6. NABL Lab Testing, UT & TPI Witness Fees',
            'Chemical, mechanical, UT & TPI inspection',
            formatInrForDoc(sheet.testingTpiCostInr),
            formatInrForDoc(Math.round(sheet.testingTpiCostInr / sheet.orderedQty)),
          ],
          [
            '7. Rust-Preventive Coating & Seaworthy Packing',
            'Fumigated pallets & flange protectors',
            formatInrForDoc(sheet.packingCostInr),
            formatInrForDoc(Math.round(sheet.packingCostInr / sheet.orderedQty)),
          ],
          [
            '8. Outward Freight, Transporter & Insurance',
            'Trailer / LTL freight to customer site',
            formatInrForDoc(sheet.transportFreightCostInr),
            formatInrForDoc(Math.round(sheet.transportFreightCostInr / sheet.orderedQty)),
          ],
          [
            '9. Plant Administration & Die Amortization',
            'Die sinking amortization & plant overheads',
            formatInrForDoc(sheet.overheadCostInr),
            formatInrForDoc(Math.round(sheet.overheadCostInr / sheet.orderedQty)),
          ],
        ],
        foot: [
          [
            'TOTAL ABSORBED JOB COST',
            `INR ${costPerKg}/kg finished weight`,
            formatInrForDoc(totalJobCost),
            formatInrForDoc(costPerPiece),
          ],
        ],
      },
    ],
    footerDisclaimer:
      'Confidential Internal Management Costing Sheet — Montex Forge Costing & Finance Desk.',
    generatedBy: currentUser.name,
    generatedRole: activeRbacGroup,
  };
}
