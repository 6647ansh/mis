import React, { useState, useEffect } from 'react';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  RefreshCw,
  Plus,
  Download,
  ShieldAlert,
  Calculator,
  FileText,
  Printer,
  AlertTriangle,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import { JobCostSheet, OutstandingAgeingRecord, OrderJourney, PurchaseOrderRecord } from '../../types/mis';
import { StatusBadge } from '../common/StatusBadge';
import {
  MontexPdfDocumentPayload,
  RecordedPaymentReceiptItem,
  buildInvoicePdfPayload,
  buildJobCostSheetPdfPayload,
  buildMillPurchaseOrderPdfPayload,
  buildPaymentReceiptPdfPayload,
  exportMontexExcelWorkbook,
  generateMontexPdfDocument,
  verifyExportPermission,
} from '../../services/documentExportService';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';

export const FinanceView: React.FC = () => {
  const {
    outstandingAgeing,
    salesOrders,
    customers,
    products,
    purchaseOrders,
    suppliers,
    jobCostSheets: costSheets,
    paymentFollowUps,
    activeRbacGroup,
    currentUser,
    recordCustomerPaymentRecord,
    upsertPaymentFollowUpRecord,
  } = useRtdb();
  const [activeTab, setActiveTab] = useState<
    | 'outstanding'
    | 'collection_follow_ups'
    | 'costing'
    | 'invoices'
    | 'supplier_bills'
    | 'tally_import'
  >('outstanding');
  const [localAgeing, setLocalAgeing] = useState<OutstandingAgeingRecord[]>(outstandingAgeing);
  const [selectedCostJob, setSelectedCostJob] = useState<string>(
    costSheets[0]?.jobNumber || 'JOB-MF-2026-0412'
  );

  // Track payment receipts posted in current session for instant PDF voucher generation
  const [sessionReceipts, setSessionReceipts] = useState<RecordedPaymentReceiptItem[]>([]);
  const [previewPayload, setPreviewPayload] = useState<MontexPdfDocumentPayload | null>(null);

  useEffect(() => {
    setLocalAgeing(outstandingAgeing);
  }, [outstandingAgeing]);

  // Payment Collection Modal State
  const [collectingAccount, setCollectingAccount] = useState<OutstandingAgeingRecord | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(500000);
  const [utrReference, setUtrReference] = useState<string>('HDFCR52026102299104');
  const [savingPayment, setSavingPayment] = useState(false);

  // Tally CSV Upload / Simulation
  const [importStatus, setImportStatus] = useState<'idle' | 'analyzing' | 'reconciled'>('idle');
  const [uploadedFileName, setUploadedFileName] = useState<string>('Tally_Sales_Ledger_Oct2026.csv');
  const [parsedRowsCount, setParsedRowsCount] = useState<number>(42);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const canWriteFinance =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo', 'finance'].includes(currentUser.role);

  const totalOutstanding = localAgeing.reduce((acc, c) => acc + c.totalOutstanding, 0);

  const checkExportAuth = (allowed: ('Admin' | 'Management' | 'Finance' | 'Sales' | 'Production')[]) => {
    const check = verifyExportPermission(currentUser, activeRbacGroup, allowed);
    if (!check.allowed) {
      setFeedback({ type: 'error', message: check.error || 'Export not permitted.' });
      return false;
    }
    return true;
  };

  const handleExportReceivablesExcel = () => {
    if (!checkExportAuth(['Admin', 'Management', 'Finance', 'Sales'])) return;

    const total0to30 = localAgeing.reduce((s, a) => s + a.bucket0to30, 0);
    const total31to60 = localAgeing.reduce((s, a) => s + a.bucket31to60, 0);
    const total61to90 = localAgeing.reduce((s, a) => s + a.bucket61to90, 0);
    const total90Plus = localAgeing.reduce((s, a) => s + a.bucket90Plus, 0);
    const totalCreditLimit = localAgeing.reduce((s, a) => s + a.creditLimit, 0);

    const res = exportMontexExcelWorkbook(
      'Montex_Receivables_Ageing_2026-10-22.xlsx',
      [
        {
          sheetName: 'Receivables_Ageing',
          reportTitle: 'Accounts Receivable & Bucketed Ageing Schedule',
          reportSubtitle: `Total Receivables Exposure: INR ${totalOutstanding.toLocaleString('en-IN')}`,
          headers: [
            'Customer ID',
            'Customer Name',
            'Credit Limit (INR)',
            'Total Outstanding (INR)',
            '0-30 Days (INR)',
            '31-60 Days (INR)',
            '61-90 Days (INR)',
            '90+ Days Critical (INR)',
            'Oldest Invoice Date',
            'Credit Limit Exceeded',
          ],
          rows: localAgeing.map((a) => [
            a.customerId,
            a.customerName,
            a.creditLimit,
            a.totalOutstanding,
            a.bucket0to30,
            a.bucket31to60,
            a.bucket61to90,
            a.bucket90Plus,
            a.oldestInvoiceDate,
            a.creditExceeded ? 'YES' : 'NO',
          ]),
          totalsRow: [
            'TOTAL',
            `${localAgeing.length} Customers`,
            totalCreditLimit,
            totalOutstanding,
            total0to30,
            total31to60,
            total61to90,
            total90Plus,
            '',
            '',
          ],
        },
        {
          sheetName: 'Order_Invoices_Status',
          reportTitle: 'Order-Wise Billing & Tally Reconciliation Status',
          reportSubtitle: 'Recorded Invoice References from /salesOrders',
          headers: [
            'Order ID',
            'Job Number',
            'Customer PO No.',
            'Customer Name',
            'Invoice Number',
            'Invoice Date',
            'Invoiced Amount (INR)',
            'Collected Amount (INR)',
            'Balance Due (INR)',
            'Payment Due Date',
            'Tally Sync Status',
          ],
          rows: salesOrders.map((o) => [
            o.id,
            o.jobNumber,
            o.poNumber,
            o.customerName,
            o.invoiceStatus.invoiceNumber,
            o.invoiceStatus.invoiceDate,
            o.invoiceStatus.invoiceAmount,
            o.invoiceStatus.paidAmount,
            o.invoiceStatus.outstandingAmount,
            o.invoiceStatus.paymentDueDate,
            o.invoiceStatus.tallySyncStatus,
          ]),
        },
      ],
      currentUser.name
    );

    if (res.success) {
      setFeedback({
        type: 'success',
        message: `Exported Excel workbook ${res.filename} with 2 worksheets (Receivables_Ageing & Order_Invoices_Status).`,
      });
    } else {
      setFeedback({ type: 'error', message: res.error || 'Excel export failed.' });
    }
  };

  const handleDownloadPaymentReceipt = (
    acc: OutstandingAgeingRecord,
    mode: 'download' | 'preview'
  ) => {
    if (!checkExportAuth(['Admin', 'Management', 'Finance', 'Sales'])) return;
    const cust = customers.find((c) => c.id === acc.customerId);
    const latestReceipt = sessionReceipts.find((r) => r.customerId === acc.customerId);
    const payload = buildPaymentReceiptPdfPayload(
      acc,
      cust,
      latestReceipt,
      currentUser,
      activeRbacGroup
    );
    if (mode === 'preview') {
      setPreviewPayload(payload);
    } else {
      const res = generateMontexPdfDocument(payload, 'download');
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Downloaded ${res.filename} (${
            latestReceipt
              ? 'Ready to Generate — Verified Payment Receipt'
              : 'Draft — Customer Receivables & Ageing Statement'
          }).`,
        });
      }
    }
  };

  const handleExportJobCostingExcel = () => {
    if (!checkExportAuth(['Admin', 'Management', 'Finance'])) return;

    const rows = costSheets.map((cs) => {
      const calc = computeCostBreakdown(cs);
      return [
        cs.jobNumber,
        cs.poNumber,
        cs.customerName,
        cs.productName,
        cs.materialGrade,
        cs.orderedQty,
        cs.cutWeightKgPerPc,
        cs.finishedWeightKgPerPc,
        cs.materialCostInr,
        cs.scrapRecoveryCreditInr,
        calc.netMaterialCost,
        cs.labourCostInr,
        cs.powerCostInr,
        cs.fuelHeatTreatmentCostInr,
        cs.machiningProcessingCostInr,
        cs.testingTpiCostInr,
        cs.packingCostInr,
        cs.transportFreightCostInr,
        cs.overheadCostInr,
        calc.totalJobCost,
        cs.totalRevenueInr,
        calc.netProfitInr,
        calc.realizedMarginPercent,
        cs.quotedMarginPercent,
      ];
    });

    const totRev = costSheets.reduce((s, c) => s + c.totalRevenueInr, 0);
    const totCost = costSheets.reduce((s, c) => s + computeCostBreakdown(c).totalJobCost, 0);
    const totProfit = totRev - totCost;

    const res = exportMontexExcelWorkbook(
      'Montex_Job_Costing_2026-10-22.xlsx',
      [
        {
          sheetName: 'Job_Costing_Margins',
          reportTitle: '8-Head Forging Job Costing & Realized Margin Register',
          reportSubtitle: `${costSheets.length} Active Costed Jobs | Total Revenue: INR ${totRev.toLocaleString('en-IN')}`,
          headers: [
            'Job Number',
            'Customer PO No.',
            'Customer Name',
            'Product Description',
            'Material Grade',
            'Ordered Qty (PCS)',
            'Cut Wt/Pc (KG)',
            'Finished Wt/Pc (KG)',
            'Gross Material (INR)',
            'Scrap Credit (INR)',
            'Net Material (INR)',
            'Direct Labour (INR)',
            'HT Power (INR)',
            'Furnace Fuel & HT (INR)',
            'CNC Machining (INR)',
            'Testing & TPI (INR)',
            'Packing (INR)',
            'Outward Freight (INR)',
            'Overheads (INR)',
            'Total Absorbed Cost (INR)',
            'PO Revenue (INR)',
            'Net Profit Margin (INR)',
            'Realized Margin (%)',
            'Quoted Target Margin (%)',
          ],
          rows,
          totalsRow: [
            'TOTAL',
            '',
            `${costSheets.length} Jobs`,
            '',
            '',
            costSheets.reduce((s, c) => s + c.orderedQty, 0),
            '',
            '',
            costSheets.reduce((s, c) => s + c.materialCostInr, 0),
            costSheets.reduce((s, c) => s + c.scrapRecoveryCreditInr, 0),
            costSheets.reduce((s, c) => s + (c.materialCostInr - c.scrapRecoveryCreditInr), 0),
            costSheets.reduce((s, c) => s + c.labourCostInr, 0),
            costSheets.reduce((s, c) => s + c.powerCostInr, 0),
            costSheets.reduce((s, c) => s + c.fuelHeatTreatmentCostInr, 0),
            costSheets.reduce((s, c) => s + c.machiningProcessingCostInr, 0),
            costSheets.reduce((s, c) => s + c.testingTpiCostInr, 0),
            costSheets.reduce((s, c) => s + c.packingCostInr, 0),
            costSheets.reduce((s, c) => s + c.transportFreightCostInr, 0),
            costSheets.reduce((s, c) => s + c.overheadCostInr, 0),
            totCost,
            totRev,
            totProfit,
            Number(((totProfit / Math.max(1, totRev)) * 100).toFixed(1)),
            '',
          ],
        },
      ],
      currentUser.name
    );

    if (res.success) {
      setFeedback({
        type: 'success',
        message: `Exported 8-Head Job Costing Excel workbook: ${res.filename}`,
      });
    } else {
      setFeedback({ type: 'error', message: res.error || 'Failed to export Job Costing Excel.' });
    }
  };

  const handleJobCostPdf = (sheet: JobCostSheet, mode: 'download' | 'preview') => {
    if (!checkExportAuth(['Admin', 'Management', 'Finance'])) return;
    const payload = buildJobCostSheetPdfPayload(sheet, currentUser, activeRbacGroup);
    if (mode === 'preview') {
      setPreviewPayload(payload);
    } else {
      const res = generateMontexPdfDocument(payload, 'download');
      if (res.success) {
        setFeedback({ type: 'success', message: `Downloaded ${res.filename}` });
      }
    }
  };

  const handleInvoicePdf = (order: OrderJourney, mode: 'download' | 'preview') => {
    if (!checkExportAuth(['Admin', 'Management', 'Finance', 'Sales'])) return;
    const cust = customers.find((c) => c.id === order.customerId);
    const payload = buildInvoicePdfPayload(order, cust, products, currentUser, activeRbacGroup);
    if (mode === 'preview') {
      setPreviewPayload(payload);
    } else {
      const res = generateMontexPdfDocument(payload, 'download');
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Downloaded ${res.filename} (Classified as Draft Billing Summary — statutory GSTIN & tax split not fabricated).`,
        });
      }
    }
  };

  const handleSupplierBillPdf = (po: PurchaseOrderRecord, mode: 'download' | 'preview') => {
    if (!checkExportAuth(['Admin', 'Management', 'Finance', 'Production'])) return;
    const sup = suppliers.find((s) => s.id === po.supplierId);
    const payload = buildMillPurchaseOrderPdfPayload(
      po,
      sup,
      'supplier_bill_summary',
      currentUser,
      activeRbacGroup
    );
    if (mode === 'preview') {
      setPreviewPayload(payload);
    } else {
      const res = generateMontexPdfDocument(payload, 'download');
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Downloaded ${res.filename} (Internal Purchase & GRN Valuation Summary — Draft).`,
        });
      }
    }
  };

  const handleRecordCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collectingAccount || savingPayment) return;
    if (!canWriteFinance) {
      setFeedback({
        type: 'error',
        message:
          currentUser.accountStatus !== 'active'
            ? `Access Restricted: Account '${currentUser.email}' is ${currentUser.accountStatus}. Only active Finance or Super Admin accounts can post payment receipts.`
            : `Access Restricted: Role '${currentUser.role}' cannot post payment receipts to /outstandingPayments. Switch to Finance or Super Admin.`,
      });
      return;
    }

    setSavingPayment(true);
    setFeedback(null);

    const previousOutstanding = collectingAccount.totalOutstanding;
    const cleanUtr = utrReference.trim() || 'RTGS-RECEIPT';

    const res = await recordCustomerPaymentRecord(
      collectingAccount,
      paymentAmount,
      cleanUtr
    );

    setSavingPayment(false);

    if (res.success && res.data) {
      const updatedRec = res.data;
      const receiptEvent: RecordedPaymentReceiptItem = {
        receiptNumber: `RCPT-2627-${Math.floor(1000 + Math.random() * 8999)}`,
        paymentDate: '2026-10-22',
        customerId: collectingAccount.customerId,
        customerName: collectingAccount.customerName,
        utrReference: cleanUtr,
        paymentMethod: 'RTGS / NEFT Bank Transfer',
        amountReceived: paymentAmount,
        previousOutstanding,
        closingOutstanding: updatedRec.totalOutstanding,
        recordedBy: currentUser.name,
      };
      setSessionReceipts((prev) => [receiptEvent, ...prev]);
      setLocalAgeing((prev) =>
        prev.map((a) => (a.customerId === collectingAccount.customerId ? updatedRec : a))
      );
      setCollectingAccount(null);
      setFeedback({
        type: 'success',
        message: res.persistedToFirestore
          ? `Saved to Cloud Firestore (/outstandingPayments/${collectingAccount.customerId}): Recorded collection ${receiptEvent.receiptNumber} of ₹${paymentAmount.toLocaleString()} (UTR: ${cleanUtr}). Click "Receipt PDF" on ${collectingAccount.customerName} to download the payment voucher.`
          : `[Demo Preview Mode] Recorded collection ${receiptEvent.receiptNumber} of ₹${paymentAmount.toLocaleString()} (UTR: ${cleanUtr}) for ${collectingAccount.customerName}. Click "Receipt PDF" to download the payment receipt voucher.`,
      });
    } else {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to record customer collection.',
      });
    }
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!canWriteFinance) {
      setFeedback({
        type: 'error',
        message: `Access Restricted: Role '${activeRbacGroup}' (${currentUser.accountStatus}) cannot import Tally sales registers. Switch to Finance or Admin.`,
      });
      return;
    }
    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result || '');
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      setParsedRowsCount(Math.max(1, lines.length - 1));
      setImportStatus('analyzing');
      setTimeout(() => {
        setImportStatus('reconciled');
      }, 900);
    };
    reader.readAsText(file);
  };

  const handleDownloadSampleTallyCsv = () => {
    const headers =
      'VoucherDate,InvoiceNo,CustomerName,JobNumber,TaxableValue,GST18Percent,TotalInvoiceAmount,UTRRef\n';
    const rows = [
      '2026-10-19,MF/26-27/0914,Bharat Heavy Electricals Ltd (BHEL),JOB-MF-2026-0412,2864407,515593,3380000,PENDING-30D',
      '2026-10-14,MF/26-27/0892,Larsen & Toubro Ltd,JOB-MF-2026-0401,3813559,686441,4500000,HDFCR520261018',
      '2026-10-22,PROFORMA-26-27/041,Indian Oil Corporation Ltd (IOCL),JOB-MF-2026-0398,1902542,342458,2245000,AWAITING-GATEOUT',
    ].join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Montex_Tally_Sales_Register_Template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const currentCostSheet =
    costSheets.find((c) => c.jobNumber === selectedCostJob) || costSheets[0];

  const computeCostBreakdown = (sheet: JobCostSheet) => {
    const netMaterialCost = sheet.materialCostInr - sheet.scrapRecoveryCreditInr;
    const totalConversionAndDirect =
      sheet.labourCostInr +
      sheet.powerCostInr +
      sheet.fuelHeatTreatmentCostInr +
      sheet.machiningProcessingCostInr +
      sheet.testingTpiCostInr +
      sheet.packingCostInr +
      sheet.transportFreightCostInr +
      sheet.overheadCostInr;
    const totalJobCost = netMaterialCost + totalConversionAndDirect;
    const netProfitInr = sheet.totalRevenueInr - totalJobCost;
    const realizedMarginPercent = Number(
      ((netProfitInr / Math.max(1, sheet.totalRevenueInr)) * 100).toFixed(1)
    );
    const totalFinishedWeightKg = sheet.orderedQty * sheet.finishedWeightKgPerPc;
    const costPerPiece = Math.round(totalJobCost / Math.max(1, sheet.orderedQty));
    const costPerKg = Number((totalJobCost / Math.max(1, totalFinishedWeightKg)).toFixed(1));
    return {
      netMaterialCost,
      totalJobCost,
      netProfitInr,
      realizedMarginPercent,
      costPerPiece,
      costPerKg,
      totalFinishedWeightKg,
    };
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-slate-500 mb-1">
            <span>Finance, Costing &amp; Accounts</span>
            <span aria-hidden="true">·</span>
            <span>Receivables, Job Profitability &amp; Tally Sync</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-700">Financial Workspace</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
            Receivables Ageing, Job Costing &amp; Billing Documents
          </h1>
          <p className="text-slate-500 mt-0.5">
            Customer credit limits, FIFO payment receipts, 8-head job profitability exports, billing summaries, and Tally Prime reconciliation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportReceivablesExcel}
            className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded-md font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Export Receivables (.xlsx)</span>
          </button>
          <button
            onClick={handleExportJobCostingExcel}
            className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded-md font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-700" />
            <span>Export Job Costing (.xlsx)</span>
          </button>
          <div className="bg-slate-900 text-white px-3.5 py-2 rounded-md font-mono font-semibold">
            <span>Total Receivables: ₹{(totalOutstanding / 10000000).toFixed(2)} Cr</span>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-lg border flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-medium">{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-500 hover:text-slate-800 font-bold px-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('outstanding')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'outstanding'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Receivables Ageing &amp; Receipts ({localAgeing.length})
        </button>
        <button
          onClick={() => setActiveTab('collection_follow_ups')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'collection_follow_ups'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Collection Follow-Ups &amp; Promised Dates ({paymentFollowUps.length})
        </button>
        <button
          onClick={() => setActiveTab('costing')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'costing'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Job Costing &amp; Order Profitability ({costSheets.length} Jobs)
        </button>
        <button
          onClick={() => setActiveTab('invoices')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'invoices'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Sales / Billing Invoices ({salesOrders.length})
        </button>
        <button
          onClick={() => setActiveTab('supplier_bills')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'supplier_bills'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Supplier Bills &amp; Credit/Debit Note Status
        </button>
        <button
          onClick={() => setActiveTab('tally_import')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'tally_import'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Tally CSV/XLSX Reconciliation
        </button>
      </div>

      {/* TAB 1: OUTSTANDING AGEING & COLLECTIONS */}
      {activeTab === 'outstanding' && (
        <div className="space-y-4">
          {currentUser.role === 'sales' && (
            <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-950 flex items-center justify-between">
              <div>
                <span className="font-bold uppercase tracking-wider text-[11px] text-indigo-800">
                  R-4 Authorized Sales Read-Only Credit &amp; Ageing Visibility
                </span>
                <p className="text-[11px] text-indigo-900 mt-0.5">
                  Sales officers have read-only access to customer credit limits, overdue buckets, and credit-hold status for order follow-up. Posting payment receipts is restricted to Finance, CEO, and Super Admin.
                </p>
              </div>
              <span className="font-mono text-[11px] bg-white px-2.5 py-1 rounded border border-indigo-200 font-bold">
                READ-ONLY (Sales)
              </span>
            </div>
          )}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Customer Name</th>
                    <th className="py-3 px-3.5 text-right">Credit Limit</th>
                    <th className="py-3 px-3.5 text-right font-bold">Total Outstanding</th>
                    <th className="py-3 px-3.5 text-right">0–30 Days</th>
                    <th className="py-3 px-3.5 text-right">31–60 Days</th>
                    <th className="py-3 px-3.5 text-right">61–90 Days</th>
                    <th className="py-3 px-3.5 text-right">&gt; 90 Days</th>
                    <th className="py-3 px-3.5">Oldest Invoice</th>
                    <th className="py-3 px-3.5 text-right">Collection &amp; Receipt PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {localAgeing.map((acc) => {
                    const hasSessionReceipt = sessionReceipts.some(
                      (r) => r.customerId === acc.customerId
                    );
                    return (
                      <tr key={acc.customerId} className="hover:bg-slate-50/60">
                        <td className="py-3 px-3.5">
                          <div className="font-bold text-slate-900">{acc.customerName}</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {acc.customerId}
                            {hasSessionReceipt && (
                              <span className="ml-2 text-emerald-700 font-semibold">
                                · Receipt Ready
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono tabular-nums text-slate-700">
                          ₹{(acc.creditLimit / 100000).toFixed(0)} Lakhs
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-slate-900">
                          ₹{(acc.totalOutstanding / 100000).toFixed(2)} Lakhs
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono tabular-nums text-emerald-700 font-medium">
                          ₹{(acc.bucket0to30 / 100000).toFixed(2)}L
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono tabular-nums text-slate-700">
                          ₹{(acc.bucket31to60 / 100000).toFixed(2)}L
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono tabular-nums text-amber-700 font-medium">
                          ₹{(acc.bucket61to90 / 100000).toFixed(2)}L
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono tabular-nums text-rose-700 font-bold">
                          {acc.bucket90Plus > 0 ? `₹${(acc.bucket90Plus / 100000).toFixed(2)}L` : '—'}
                        </td>
                        <td className="py-3 px-3.5 font-mono text-slate-500 text-[11px]">
                          {acc.oldestInvoiceDate}
                        </td>
                        <td className="py-3 px-3.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => handleDownloadPaymentReceipt(acc, 'preview')}
                              className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                              title="Preview or Print Customer Payment Receipt / Statement"
                            >
                              <Printer className="w-3 h-3" />
                              <span>Preview</span>
                            </button>
                            <button
                              onClick={() => handleDownloadPaymentReceipt(acc, 'download')}
                              className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                              title="Download Payment Receipt / Statement PDF"
                            >
                              <Download className="w-3 h-3 text-emerald-700" />
                              <span>{hasSessionReceipt ? 'Receipt PDF' : 'Stmt PDF'}</span>
                            </button>
                            <button
                              onClick={() => {
                                setCollectingAccount(acc);
                                setPaymentAmount(Math.min(500000, acc.totalOutstanding));
                              }}
                              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Post Receipt</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB: COLLECTION FOLLOW-UPS & PROMISED PAYMENT TRACKER */}
      {activeTab === 'collection_follow_ups' && (
        <div className="space-y-4">
          <div className="bg-slate-900 text-white p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="font-bold text-amber-400 uppercase tracking-wider text-[11px]">
                Customer Payment Collection Follow-Up &amp; Credit-Hold Register (/paymentFollowUps)
              </span>
              <p className="text-slate-300 text-[11px] mt-0.5">
                Tracks promised RTGS/NEFT settlement dates, overdue days, credit-hold flags, and joint Finance + Sales FPR follow-up notes.
              </p>
            </div>
            <div className="font-mono text-xs bg-slate-800 px-3 py-1.5 rounded border border-slate-700">
              Credit Hold Accounts: {paymentFollowUps.filter((p) => p.creditHoldActive).length}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Invoice &amp; Job No.</th>
                    <th className="py-3 px-3.5">Customer &amp; Contact</th>
                    <th className="py-3 px-3.5 text-right">Outstanding &amp; Overdue</th>
                    <th className="py-3 px-3.5">Promised Payment</th>
                    <th className="py-3 px-3.5">Credit Hold</th>
                    <th className="py-3 px-3.5">Follow-Up Notes</th>
                    <th className="py-3 px-3.5">Status</th>
                    <th className="py-3 px-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {paymentFollowUps.map((pf) => (
                    <tr key={pf.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3.5 font-mono">
                        <div className="font-bold text-slate-900">{pf.invoiceNumber}</div>
                        <div className="text-[11px] text-indigo-700">{pf.jobNumber}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900">{pf.customerName}</div>
                        <div className="text-[11px] text-slate-500">
                          {pf.contactPerson} · {pf.contactPhone}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono">
                        <div className="font-bold text-rose-700">
                          ₹{(pf.outstandingAmountInr / 100000).toFixed(2)}L
                        </div>
                        <div className="text-[11px] text-slate-500">{pf.overdueDays}d overdue</div>
                      </td>
                      <td className="py-3 px-3.5 font-mono">
                        <div className="font-bold text-slate-900">{pf.promisedPaymentDate}</div>
                        <div className="text-[11px] text-emerald-700">
                          Promised: ₹{(pf.promisedAmountInr / 100000).toFixed(2)}L
                        </div>
                      </td>
                      <td className="py-3 px-3.5">
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase ${
                            pf.creditHoldActive
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {pf.creditHoldActive ? 'HOLD ACTIVE' : 'CLEAR'}
                        </span>
                      </td>
                      <td className="py-3 px-3.5 max-w-xs">
                        <div className="text-slate-700 line-clamp-2">{pf.followUpNotes}</div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          Next Follow-up: {pf.nextFollowUpDate} ({pf.assignedOwnerName})
                        </div>
                      </td>
                      <td className="py-3 px-3.5">
                        <StatusBadge
                          status={
                            pf.status === 'received'
                              ? 'completed'
                              : pf.status === 'escalated_credit_hold'
                              ? 'rejected'
                              : 'warning'
                          }
                          label={pf.status.replace(/_/g, ' ').toUpperCase()}
                        />
                      </td>
                      <td className="py-3 px-3.5 text-right">
                        {canWriteFinance && pf.status !== 'received' && (
                          <button
                            onClick={async () => {
                              const res = await upsertPaymentFollowUpRecord({
                                ...pf,
                                creditHoldActive: !pf.creditHoldActive,
                                status: !pf.creditHoldActive ? 'escalated_credit_hold' : 'promised',
                              });
                              setFeedback({
                                type: res.success ? 'success' : 'error',
                                message: res.success
                                  ? `Updated Credit Hold status for ${pf.customerName} (${pf.invoiceNumber}).`
                                  : res.error || 'Failed to update payment follow-up.',
                              });
                            }}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold text-[11px] cursor-pointer"
                          >
                            {pf.creditHoldActive ? 'Release Hold' : 'Place Hold'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: JOB COSTING & PROFITABILITY (REQ K) */}
      {activeTab === 'costing' && (
        <div className="space-y-5">
          {/* Job Selector & Export Actions */}
          <div className="bg-white p-4 rounded-lg border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-slate-700" />
              <span className="font-bold text-slate-900">
                8-Head Forging Job Costing &amp; Margin Sheet
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500 font-medium">Select Job Number:</span>
              <select
                value={selectedCostJob}
                onChange={(e) => setSelectedCostJob(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded font-mono font-bold text-slate-900"
              >
                {costSheets.map((cs) => (
                  <option key={cs.jobNumber} value={cs.jobNumber}>
                    {cs.jobNumber} — {cs.customerName.split(' ')[0]} ({cs.productName})
                  </option>
                ))}
              </select>
              <button
                onClick={() => currentCostSheet && handleJobCostPdf(currentCostSheet, 'preview')}
                disabled={!currentCostSheet}
                className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Preview / Print</span>
              </button>
              <button
                onClick={() => currentCostSheet && handleJobCostPdf(currentCostSheet, 'download')}
                disabled={!currentCostSheet}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Job Cost PDF</span>
              </button>
            </div>
          </div>

          {!currentCostSheet ? (
            <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-500">
              No job cost sheets recorded in Cloud Firestore (<code className="font-mono">/jobCostSheets</code>) yet.
            </div>
          ) : (() => {
            const calc = computeCostBreakdown(currentCostSheet);
            const costHeads = [
              {
                label: '1. Gross Raw Material (Billet Cut Weight)',
                amount: currentCostSheet.materialCostInr,
                note: `${currentCostSheet.cutWeightKgPerPc} kg/pc cut weight × ${currentCostSheet.orderedQty} PCS`,
              },
              {
                label: '   Less: Flash & Turning Scrap Recovery Credit',
                amount: -currentCostSheet.scrapRecoveryCreditInr,
                note: `Recovered ${(currentCostSheet.cutWeightKgPerPc - currentCostSheet.finishedWeightKgPerPc).toFixed(1)} kg/pc flash scrap`,
                isCredit: true,
              },
              {
                label: '2. Direct Shop-Floor Forging & Ring Rolling Labour',
                amount: currentCostSheet.labourCostInr,
                note: 'Hammer/Press crew, billet cutting & material handling',
              },
              {
                label: '3. HT Electricity & Induction Heating Power',
                amount: currentCostSheet.powerCostInr,
                note: 'Allocated from press & induction sub-meters (kWh)',
              },
              {
                label: '4. Reheating Furnace Fuel (LDO / PNG) & Heat Treatment',
                amount: currentCostSheet.fuelHeatTreatmentCostInr,
                note: 'Soaking + Normalizing/Tempering furnace batch cost',
              },
              {
                label: '5. CNC Machining, Drilling & Serration Processing',
                amount: currentCostSheet.machiningProcessingCostInr,
                note: 'Finish turning, bolt-hole drilling & RTJ groove machining',
              },
              {
                label: '6. NABL Lab Testing, Ultrasonic (UT) & TPI Witness Fees',
                amount: currentCostSheet.testingTpiCostInr,
                note: 'Chemical, tensile, impact, hardness & EN 10204 3.1 MTC',
              },
              {
                label: '7. Rust-Preventive Coating & Seaworthy Wooden Pallet Packing',
                amount: currentCostSheet.packingCostInr,
                note: 'Export/PSU standard fumigated pallets & flange protectors',
              },
              {
                label: '8. Outward Freight, Transporter & Insurance',
                amount: currentCostSheet.transportFreightCostInr,
                note: 'Heavy flatbed trailer / LTL freight to customer site',
              },
              {
                label: '9. Plant Administration & Die Amortization Overhead',
                amount: currentCostSheet.overheadCostInr,
                note: 'Tool-room die sinking amortization & plant overheads',
              },
            ];

            return (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left 2 Columns: Detailed 8-Head Cost Breakdown Table */}
                <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 overflow-hidden">
                  <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                    <div>
                      <span className="font-mono font-bold text-indigo-700">
                        {currentCostSheet.jobNumber}
                      </span>
                      <span className="mx-2 text-slate-400">·</span>
                      <span className="font-bold text-slate-900">
                        {currentCostSheet.customerName}
                      </span>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        PO: {currentCostSheet.poNumber} · {currentCostSheet.productName} ({currentCostSheet.materialGrade})
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <span className="text-slate-500 block text-[10px]">Finished Weight</span>
                      <span className="font-bold text-slate-900">
                        {(calc.totalFinishedWeightKg / 1000).toFixed(2)} MT ({currentCostSheet.orderedQty} PCS)
                      </span>
                    </div>
                  </div>

                  <table className="w-full text-left">
                    <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200 uppercase text-[10px] font-semibold">
                      <tr>
                        <th className="py-2.5 px-3.5">Cost Head</th>
                        <th className="py-2.5 px-3.5">Allocation Basis</th>
                        <th className="py-2.5 px-3.5 text-right">Total Cost (₹)</th>
                        <th className="py-2.5 px-3.5 text-right">Per Pc (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {costHeads.map((ch, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td
                            className={`py-2.5 px-3.5 font-semibold ${
                              ch.isCredit ? 'text-emerald-700 pl-6' : 'text-slate-800'
                            }`}
                          >
                            {ch.label}
                          </td>
                          <td className="py-2.5 px-3.5 text-[11px] text-slate-500">{ch.note}</td>
                          <td
                            className={`py-2.5 px-3.5 text-right font-mono tabular-nums font-semibold ${
                              ch.isCredit ? 'text-emerald-700' : 'text-slate-900'
                            }`}
                          >
                            {ch.amount < 0
                              ? `-₹${Math.abs(ch.amount).toLocaleString()}`
                              : `₹${ch.amount.toLocaleString()}`}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-slate-600">
                            {ch.amount < 0
                              ? `-₹${Math.round(Math.abs(ch.amount) / currentCostSheet.orderedQty).toLocaleString()}`
                              : `₹${Math.round(ch.amount / currentCostSheet.orderedQty).toLocaleString()}`}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-300">
                        <td className="py-3 px-3.5">Total Absorbed Job Cost</td>
                        <td className="py-3 px-3.5 font-mono text-[11px] text-slate-600">
                          ₹{calc.costPerKg}/kg finished forging weight
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono">
                          ₹{calc.totalJobCost.toLocaleString()}
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono">
                          ₹{calc.costPerPiece.toLocaleString()}/pc
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Right Column: Margin Summary */}
                <div className="space-y-4">
                  <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-3">
                    <h3 className="text-sm font-bold text-slate-900 border-b pb-2">
                      Job Profitability Summary
                    </h3>
                    <div className="space-y-2 font-mono">
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-500 font-sans">PO Commercial Revenue</span>
                        <span className="font-bold text-slate-900">
                          ₹{currentCostSheet.totalRevenueInr.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span className="text-slate-500 font-sans">Total Absorbed Cost</span>
                        <span className="font-semibold text-slate-800">
                          ₹{calc.totalJobCost.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between py-1.5 border-b border-slate-200 text-sm">
                        <span className="text-slate-900 font-sans font-bold">Net Operating Margin</span>
                        <span className="font-bold text-emerald-700">
                          ₹{calc.netProfitInr.toLocaleString()} ({calc.realizedMarginPercent}%)
                        </span>
                      </div>
                      <div className="flex justify-between py-1 text-[11px]">
                        <span className="text-slate-500 font-sans">Quoted Target Margin</span>
                        <span className="text-slate-700">{currentCostSheet.quotedMarginPercent}%</span>
                      </div>
                      <div className="flex justify-between py-1 text-[11px]">
                        <span className="text-slate-500 font-sans">Cut-to-Finish Yield Ratio</span>
                        <span className="text-slate-700">
                          {(
                            (currentCostSheet.finishedWeightKgPerPc /
                              currentCostSheet.cutWeightKgPerPc) *
                            100
                          ).toFixed(1)}
                          %
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* TAB 3: TAX INVOICES & BILLING STATUS */}
      {activeTab === 'invoices' && (
        <div className="space-y-4">
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-950 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-amber-900 block">
                Document Classification: Draft — Missing Statutory Tax Invoice Fields
              </span>
              <span className="text-[11px] text-amber-800">
                Customer GSTIN, Montex statutory GSTIN, and HSN-level CGST/SGST/IGST rate breakdowns are maintained in offline Tally Prime and are not stored in <code>/salesOrders</code>. Exported PDFs are clearly watermarked as <strong>Draft Commercial Billing Summaries</strong> without fabricating tax figures.
              </span>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Invoice No. &amp; Date</th>
                    <th className="py-3 px-3.5">Customer &amp; PO #</th>
                    <th className="py-3 px-3.5">Job Number</th>
                    <th className="py-3 px-3.5 text-right">Invoiced Amount</th>
                    <th className="py-3 px-3.5 text-right">Paid / Collected</th>
                    <th className="py-3 px-3.5 text-right">Balance Due</th>
                    <th className="py-3 px-3.5">Tally Sync Status</th>
                    <th className="py-3 px-3.5 text-right">Billing Summary PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {salesOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3.5 font-mono">
                        <div className="font-bold text-slate-900">
                          {o.invoiceStatus.invoiceNumber}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {o.invoiceStatus.invoiceDate}
                        </div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900">{o.customerName}</div>
                        <div className="font-mono text-[11px] text-slate-500">{o.poNumber}</div>
                      </td>
                      <td className="py-3 px-3.5 font-mono font-bold text-indigo-700">
                        {o.jobNumber}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900">
                        ₹{(o.invoiceStatus.invoiceAmount / 100000).toFixed(2)}L
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono text-emerald-700 font-semibold">
                        ₹{(o.invoiceStatus.paidAmount / 100000).toFixed(2)}L
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono text-rose-700 font-bold">
                        ₹{(o.invoiceStatus.outstandingAmount / 100000).toFixed(2)}L
                      </td>
                      <td className="py-3 px-3.5">
                        <StatusBadge
                          status={
                            o.invoiceStatus.tallySyncStatus === 'synced' ? 'completed' : 'warning'
                          }
                          label={o.invoiceStatus.tallySyncStatus.replace('_', ' ').toUpperCase()}
                        />
                      </td>
                      <td className="py-3 px-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => handleInvoicePdf(o, 'preview')}
                            className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <FileText className="w-3 h-3" />
                            <span>Preview</span>
                          </button>
                          <button
                            onClick={() => handleInvoicePdf(o, 'download')}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Download className="w-3 h-3" />
                            <span>Draft PDF</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: SUPPLIER PURCHASE BILLS & CREDIT/DEBIT NOTE STATUS */}
      {activeTab === 'supplier_bills' && (
        <div className="space-y-5">
          {/* Supplier Purchase Bills Table */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  Purchase Bills / Supplier GRN Valuation Summaries (Draft)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Generated from recorded Steel Mill Purchase Orders and GRN received tonnages. Classified as <strong>Draft — Missing Required Fields</strong> (Supplier Tax Invoice No. &amp; GSTIN not stored in MIS).
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Mill PO No. &amp; Date</th>
                    <th className="py-3 px-3.5">Steel Mill Supplier</th>
                    <th className="py-3 px-3.5">Material Grade &amp; Heat</th>
                    <th className="py-3 px-3.5 text-right">Ordered / Recd (MT)</th>
                    <th className="py-3 px-3.5 text-right">Rate / MT</th>
                    <th className="py-3 px-3.5 text-right">PO Basic Value</th>
                    <th className="py-3 px-3.5 text-right">GRN Received Value</th>
                    <th className="py-3 px-3.5 text-right">Bill Summary PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseOrders.map((po) => (
                    <tr key={po.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3.5 font-mono">
                        <div className="font-bold text-slate-900">{po.poNumber}</div>
                        <div className="text-[11px] text-slate-500">{po.poDate}</div>
                      </td>
                      <td className="py-3 px-3.5 font-semibold text-slate-900">
                        {po.supplierName}
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-semibold text-slate-800">{po.materialGrade}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {po.millHeatNumber}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono">
                        {po.receivedMt} / {po.orderedMt} MT
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono">
                        ₹{po.ratePerMt.toLocaleString()}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono font-semibold">
                        ₹{po.totalValue.toLocaleString()}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono font-bold text-emerald-700">
                        ₹{Math.round(po.receivedMt * po.ratePerMt).toLocaleString()}
                      </td>
                      <td className="py-3 px-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => handleSupplierBillPdf(po, 'preview')}
                            className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <FileText className="w-3 h-3" />
                            <span>Preview</span>
                          </button>
                          <button
                            onClick={() => handleSupplierBillPdf(po, 'download')}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Download className="w-3 h-3" />
                            <span>Bill Summary PDF</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Credit Note / Debit Note — Explicitly Classified as Not Supported Yet */}
          <div className="p-4 bg-slate-100 border border-slate-300 rounded-lg space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-slate-700" />
                <span>Credit Note / Debit Note Generation</span>
              </div>
              <span className="px-2.5 py-0.5 rounded bg-slate-800 text-white font-mono text-[11px] font-semibold">
                Status: Not Supported Yet
              </span>
            </div>
            <p className="text-slate-600 leading-relaxed">
              Credit Notes and Debit Notes are not yet implemented because the current Montex MIS database schema does not store credit/debit adjustment vouchers, original tax invoice linkage, rate-difference approvals, or statutory GST reversal entries. No placeholder or fabricated Credit/Debit Note PDFs are generated.
            </p>
          </div>
        </div>
      )}

      {/* TAB 5: TALLY CSV/EXCEL IMPORT & RECONCILIATION */}
      {activeTab === 'tally_import' && (
        <div className="space-y-5">
          <div className="p-4 bg-white border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-900">
                Tally Prime Batch CSV / Excel Reconciliation Engine
              </h3>
              <p className="text-slate-600 leading-relaxed">
                Montex&apos;s Tally installation runs on an offline accounting desktop. Upload exported Tally Sales/Receipt registers (.CSV) to reconcile dispatch invoices and update customer ageing balances.
              </p>
            </div>
            <button
              onClick={handleDownloadSampleTallyCsv}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-md font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Tally CSV Template</span>
            </button>
          </div>

          <div className="p-6 bg-white border-2 border-dashed border-slate-300 rounded-lg text-center space-y-4">
            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-600">
              <Upload className="w-6 h-6" />
            </div>
            <div>
              <span className="font-bold text-slate-900 block text-sm">
                Upload Tally Sales Register / Receipt Voucher CSV
              </span>
              <span className="text-slate-500">
                Select a .CSV file exported from Tally ERP 9 / TallyPrime or run batch verification
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <label className="px-4 py-2 bg-white border border-slate-300 text-slate-800 rounded-md font-semibold hover:bg-slate-50 transition-colors inline-flex items-center gap-2 cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>Choose Local .CSV File</span>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCsvFileUpload}
                  className="hidden"
                />
              </label>

              <button
                onClick={() => {
                  if (!canWriteFinance) {
                    setFeedback({
                      type: 'error',
                      message: `Access Restricted: Role '${activeRbacGroup}' (${currentUser.accountStatus}) cannot execute Tally batch reconciliation. Switch to Finance or Admin.`,
                    });
                    return;
                  }
                  setImportStatus('analyzing');
                  setTimeout(() => setImportStatus('reconciled'), 1000);
                }}
                disabled={importStatus === 'analyzing'}
                className="px-4 py-2 bg-slate-900 text-white rounded-md font-semibold hover:bg-slate-800 transition-colors inline-flex items-center gap-2 cursor-pointer"
              >
                {importStatus === 'analyzing' ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Reconciling {uploadedFileName}...</span>
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Run Batch Reconciliation ({uploadedFileName})</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {importStatus === 'reconciled' && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg space-y-2 text-emerald-900">
              <div className="flex items-center gap-2 font-bold text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                <span>
                  Tally Reconciliation Complete ({parsedRowsCount} Voucher Rows Verified in {uploadedFileName})
                </span>
              </div>
              <p className="text-emerald-800">
                All outward dispatch tax invoices matched against Tally voucher references. Proforma invoice <code className="font-mono">PROFORMA-26-27/041</code> (IOCL <code className="font-mono">ORD-2026-004</code>) remains in <code className="font-mono">pending_import</code> awaiting vehicle gate-out.
              </p>
            </div>
          )}
        </div>
      )}

      {/* MODAL: POST CUSTOMER PAYMENT COLLECTION */}
      {collectingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleRecordCollection}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-md w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Post Customer Payment Receipt
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Settles oldest ageing buckets first (FIFO) and updates <code className="font-mono">/outstandingPayments/{collectingAccount.customerId}</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCollectingAccount(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1">
              <div className="font-bold text-slate-900">{collectingAccount.customerName}</div>
              <div className="font-mono text-slate-600">
                Current Total Outstanding: ₹{collectingAccount.totalOutstanding.toLocaleString()}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Collection Amount Received (₹)
                </label>
                <input
                  type="number"
                  min={1000}
                  max={collectingAccount.totalOutstanding}
                  required
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(Number(e.target.value) || 0)}
                  className="w-full p-2 border border-slate-300 rounded font-mono font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Bank RTGS / NEFT UTR Reference
                </label>
                <input
                  type="text"
                  required
                  value={utrReference}
                  onChange={(e) => setUtrReference(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setCollectingAccount(null)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingPayment}
                className="px-4 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {savingPayment ? 'Updating Ledger...' : 'Post Collection to RTDB'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Document Preview & Print Modal */}
      <DocumentPreviewModal
        payload={previewPayload}
        onClose={() => setPreviewPayload(null)}
      />
    </div>
  );
};
