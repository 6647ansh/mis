import React, { useState } from 'react';
import {
  Plus,
  Search,
  CheckCircle2,
  ShieldAlert,
  ArrowRight,
  Calendar,
  FileText,
  Award,
  PhoneCall,
  Download,
  FileSpreadsheet,
  Printer,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import { OrderJourney, QuotationRecord, TenderRecord } from '../../types/mis';
import { StatusBadge } from '../common/StatusBadge';
import {
  MontexPdfDocumentPayload,
  buildQuotationPdfPayload,
  buildTenderSummaryPdfPayload,
  exportMontexExcelWorkbook,
  generateMontexPdfDocument,
  verifyExportPermission,
} from '../../services/documentExportService';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';

interface QuotationsViewProps {
  onSelectOrder?: (orderId: string) => void;
}

export const QuotationsView: React.FC<QuotationsViewProps> = ({ onSelectOrder }) => {
  const {
    customers,
    products,
    activeRbacGroup,
    currentUser,
    quotations,
    tenders,
    preRfqLeads,
    setPreRfqLeads,
    salesOrders,
    createQuotationRecord,
    updateQuotationRecord,
    convertQuotationToOrderRecord,
    createTenderRecord,
  } = useRtdb();
  const [activeTab, setActiveTab] = useState<'quotations' | 'follow_ups' | 'tenders' | 'leads_enquiries'>('quotations');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [showNewQuoteModal, setShowNewQuoteModal] = useState(false);
  const [showFollowUpModal, setShowFollowUpModal] = useState<QuotationRecord | null>(null);
  const [showNewTenderModal, setShowNewTenderModal] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<MontexPdfDocumentPayload | null>(null);

  // New Quote Form State
  const [rfqReference, setRfqReference] = useState('BHEL/TRICHY/RFQ/2026/512');
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id || 'CUST-001');
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id || 'PROD-001');
  const [inquiryQtyPcs, setInquiryQtyPcs] = useState<number>(150);
  const [quotedRatePerKg, setQuotedRatePerKg] = useState<number>(134);
  const [estimatedMarginPercent, setEstimatedMarginPercent] = useState<number>(18.5);
  const [deliveryLeadWeeks, setDeliveryLeadWeeks] = useState<number>(5);
  const [isRepeatOrder, setIsRepeatOrder] = useState<boolean>(true);
  const [nextFollowUpDate, setNextFollowUpDate] = useState<string>('2026-10-28');
  const [followUpNotes, setFollowUpNotes] = useState<string>(
    'Initial commercial offer with EN 10204 3.1 MTC and ultrasonic testing included.'
  );

  // Follow-up Edit State
  const [editFollowUpStatus, setEditFollowUpStatus] =
    useState<QuotationRecord['status']>('follow_up');
  const [editNextFollowUpDate, setEditNextFollowUpDate] = useState('');
  const [editFollowUpNotes, setEditFollowUpNotes] = useState('');

  // New Tender State
  const [tenderNumber, setTenderNumber] = useState('NTPC/KORBA/TND/2026/902');
  const [issuingAuthority, setIssuingAuthority] = useState('NTPC Limited — Korba Super Thermal');
  const [projectTitle, setProjectTitle] = useState(
    'Supply of High-Pressure Alloy Steel Forged Pipe Fittings & Flanges'
  );
  const [itemSummary, setItemSummary] = useState('ASTM A182 F22 Cl.3 WN Flanges 14" to 24"');
  const [estimatedValueLakhs, setEstimatedValueLakhs] = useState<number>(84.0);
  const [emdAmount, setEmdAmount] = useState<number>(168000);
  const [bidSubmissionDate, setBidSubmissionDate] = useState('2026-10-30');
  const [priceBidOpeningDate, setPriceBidOpeningDate] = useState('2026-11-10');

  const [convertingQuoteId, setConvertingQuoteId] = useState<string | null>(null);
  const [savingQuote, setSavingQuote] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const canWriteSales =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo', 'sales'].includes(currentUser.role);

  const selectedProduct =
    products.find((p) => p.id === selectedProductId) || products[0];
  const calculatedRatePerPc = Math.round(
    (selectedProduct?.standardWeightKg || 64.5) * quotedRatePerKg
  );
  const calculatedTotalQuoteValue = calculatedRatePerPc * inquiryQtyPcs;

  const filteredQuotations = quotations.filter((q) => {
    const matchesSearch =
      q.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.rfqReference.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || q.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleQuotationPdf = (quote: QuotationRecord, mode: 'download' | 'preview') => {
    const perm = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Sales',
      'Finance',
    ]);
    if (!perm.allowed) {
      setFeedback({ type: 'error', message: perm.error || 'Export not permitted.' });
      return;
    }
    const cust = customers.find((c) => c.id === quote.customerId);
    const prod = products.find((p) => p.id === quote.productId);
    const payload = buildQuotationPdfPayload(
      quote,
      cust,
      prod,
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
          message: `Downloaded Commercial Quotation PDF: ${res.filename}`,
        });
      }
    }
  };

  const handleExportQuotationsExcel = () => {
    const perm = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Sales',
      'Finance',
    ]);
    if (!perm.allowed) {
      setFeedback({ type: 'error', message: perm.error || 'Export not permitted.' });
      return;
    }

    const totalVal = filteredQuotations.reduce((s, q) => s + q.totalQuotedValue, 0);
    const totalPcs = filteredQuotations.reduce((s, q) => s + q.inquiryQtyPcs, 0);

    const res = exportMontexExcelWorkbook(
      'Montex_Quotations_FollowUps_2026-10-22.xlsx',
      [
        {
          sheetName: 'Quotations_And_FollowUps',
          reportTitle: 'Commercial Quotations & Sales Follow-Up Register',
          reportSubtitle: `Filter: Status=${statusFilter} | Search="${searchTerm || 'All'}" | ${filteredQuotations.length} Quotations`,
          headers: [
            'Quotation ID',
            'RFQ Reference',
            'Quote Date',
            'Valid Until',
            'Customer Name',
            'Contact Person',
            'Product Name',
            'Material Grade',
            'Standard',
            'Unit Weight (KG)',
            'Inquiry Qty (PCS)',
            'Quoted Rate/KG (INR)',
            'Quoted Rate/PC (INR)',
            'Total Quoted Value (INR)',
            'Est. Margin (%)',
            'Lead Time (Weeks)',
            'Repeat Order',
            'Status',
            'Next Follow-Up Date',
            'Follow-Up Notes',
            'Converted Order ID',
          ],
          rows: filteredQuotations.map((q) => [
            q.id,
            q.rfqReference,
            q.quoteDate,
            q.validUntil,
            q.customerName,
            q.contactPerson,
            q.productName,
            q.materialGrade,
            q.standard,
            q.unitWeightKg,
            q.inquiryQtyPcs,
            q.quotedRatePerKg,
            q.quotedRatePerPc,
            q.totalQuotedValue,
            q.estimatedMarginPercent,
            q.deliveryLeadWeeks,
            q.isRepeatOrder ? 'YES' : 'NO',
            q.status.toUpperCase(),
            q.nextFollowUpDate,
            q.followUpNotes,
            q.convertedOrderId || '—',
          ]),
          totalsRow: [
            'TOTAL',
            `${filteredQuotations.length} Quotes`,
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            totalPcs,
            '',
            '',
            totalVal,
            '',
            '',
            '',
            '',
            '',
            '',
            '',
          ],
        },
      ],
      currentUser.name
    );

    if (res.success) {
      setFeedback({
        type: 'success',
        message: `Exported Quotations & Follow-Ups Excel file: ${res.filename}`,
      });
    }
  };

  const handleExportTendersExcel = () => {
    const perm = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Sales',
      'Finance',
    ]);
    if (!perm.allowed) {
      setFeedback({ type: 'error', message: perm.error || 'Export not permitted.' });
      return;
    }

    const totalLakhs = tenders.reduce((s, t) => s + t.estimatedValueLakhs, 0);
    const totalEmd = tenders.reduce((s, t) => s + t.emdAmount, 0);

    const res = exportMontexExcelWorkbook(
      'Montex_Tender_Register_2026-10-22.xlsx',
      [
        {
          sheetName: 'PSU_EPC_Tenders',
          reportTitle: 'Institutional PSU & EPC Tender Bid Register',
          reportSubtitle: `${tenders.length} Active Bids | Total Estimated Value: INR ${totalLakhs.toFixed(2)} Lakhs`,
          headers: [
            'Tender ID',
            'Tender Number',
            'Issuing Authority',
            'Project Title',
            'Item Summary',
            'Estimated Value (Lakhs INR)',
            'EMD Deposit (INR)',
            'Bid Submission Date',
            'Price Bid Opening Date',
            'Technical Bid Status',
            'Assigned Owner',
          ],
          rows: tenders.map((t) => [
            t.id,
            t.tenderNumber,
            t.issuingAuthority,
            t.projectTitle,
            t.itemSummary,
            t.estimatedValueLakhs,
            t.emdAmount,
            t.bidSubmissionDate,
            t.priceBidOpeningDate,
            t.technicalBidStatus.toUpperCase(),
            t.assignedOwner,
          ]),
          totalsRow: [
            'TOTAL',
            `${tenders.length} Tenders`,
            '',
            '',
            '',
            Number(totalLakhs.toFixed(2)),
            totalEmd,
            '',
            '',
            '',
            '',
          ],
        },
      ],
      currentUser.name
    );

    if (res.success) {
      setFeedback({
        type: 'success',
        message: `Exported Tender Register Excel file: ${res.filename}`,
      });
    }
  };

  const handleTenderSummaryPdf = (mode: 'download' | 'preview') => {
    const perm = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Sales',
      'Finance',
    ]);
    if (!perm.allowed) {
      setFeedback({ type: 'error', message: perm.error || 'Export not permitted.' });
      return;
    }
    const payload = buildTenderSummaryPdfPayload(tenders, currentUser, activeRbacGroup);
    if (mode === 'preview') {
      setPreviewPayload(payload);
    } else {
      const res = generateMontexPdfDocument(payload, 'download');
      if (res.success) {
        setFeedback({
          type: 'success',
          message: `Downloaded Printable Tender Summary PDF: ${res.filename}`,
        });
      }
    }
  };

  const handleCreateQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingQuote) return;
    if (!canWriteSales) {
      setFeedback({
        type: 'error',
        message:
          currentUser.accountStatus !== 'active'
            ? `Access Restricted: Account '${currentUser.email}' is ${currentUser.accountStatus}. Only active accounts can create commercial quotations.`
            : `Access Restricted: Role '${currentUser.role}' (${activeRbacGroup}) cannot create commercial quotations. Only Sales or Super Admin can create quotations.`,
      });
      return;
    }
    if (inquiryQtyPcs <= 0 || quotedRatePerKg <= 0) {
      setFeedback({
        type: 'error',
        message: 'Inquiry quantity and quoted rate per kg must be greater than zero.',
      });
      return;
    }

    const cust = customers.find((c) => c.id === selectedCustomerId) || customers[0];
    const prod = products.find((p) => p.id === selectedProductId) || products[0];
    const quoteId = `QTN-2026-0${Math.floor(130 + Math.random() * 850)}`;
    const stdWt = prod?.standardWeightKg || 64.5;
    const ratePc = Math.round(stdWt * quotedRatePerKg);

    const newQuote: QuotationRecord = {
      id: quoteId,
      rfqReference: rfqReference.trim(),
      quoteDate: new Date().toISOString().split('T')[0],
      validUntil: '2026-11-22',
      customerId: cust?.id || 'CUST-001',
      customerName: cust?.name || 'Montex Customer',
      contactPerson: cust?.contactPerson || 'Procurement Head',
      productId: prod?.id || 'PROD-001',
      productName: prod?.name || 'Forged Component',
      materialGrade: prod?.materialGrade || 'ASTM A105',
      standard: prod?.standard || 'ASME B16.5',
      unitWeightKg: stdWt,
      inquiryQtyPcs,
      quotedRatePerKg,
      quotedRatePerPc: ratePc,
      totalQuotedValue: ratePc * inquiryQtyPcs,
      estimatedMarginPercent,
      deliveryLeadWeeks,
      isRepeatOrder,
      status: 'submitted',
      nextFollowUpDate,
      followUpNotes: followUpNotes.trim(),
    };

    setSavingQuote(true);
    setFeedback(null);
    const res = await createQuotationRecord(newQuote);
    setSavingQuote(false);

    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to persist quotation in Cloud Firestore.',
      });
      return;
    }

    setShowNewQuoteModal(false);
    setFeedback({
      type: 'success',
      message: res.persistedToFirestore
        ? `Persisted to Cloud Firestore (/quotations/${newQuote.id}): Created Quotation ${newQuote.rfqReference} for ${newQuote.customerName} at ₹${ratePc.toLocaleString()}/pc.`
        : `[Preview Session Only] Created Quotation ${newQuote.id} (${newQuote.rfqReference}) for ${newQuote.customerName} in session pipeline.`,
    });
  };

  const handleSaveFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showFollowUpModal || savingQuote) return;
    if (!canWriteSales) {
      setFeedback({
        type: 'error',
        message: `Access Restricted: Role '${currentUser.role}' (${currentUser.accountStatus}) cannot update quotation follow-ups.`,
      });
      return;
    }

    const updated: QuotationRecord = {
      ...showFollowUpModal,
      status: editFollowUpStatus,
      nextFollowUpDate: editNextFollowUpDate || showFollowUpModal.nextFollowUpDate,
      followUpNotes: editFollowUpNotes.trim() || showFollowUpModal.followUpNotes,
    };

    setSavingQuote(true);
    setFeedback(null);
    const res = await updateQuotationRecord(updated);
    setSavingQuote(false);

    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to update quotation follow-up in Cloud Firestore.',
      });
      return;
    }

    setShowFollowUpModal(null);
    setFeedback({
      type: 'success',
      message: res.persistedToFirestore
        ? `Persisted to Cloud Firestore (/quotations/${updated.id}): Updated follow-up status to ${updated.status.toUpperCase()}.`
        : `[Preview Session Only] Updated follow-up log for ${updated.id} (${updated.customerName}) — Status: ${updated.status.toUpperCase()}.`,
    });
  };

  const handleConvertQuoteToSalesOrder = async (quote: QuotationRecord) => {
    if (convertingQuoteId) return;
    if (!canWriteSales) {
      setFeedback({
        type: 'error',
        message: `Access Restricted: Role '${currentUser.role}' (${currentUser.accountStatus}) cannot convert quotations into Sales Orders.`,
      });
      return;
    }

    setConvertingQuoteId(quote.id);
    setFeedback(null);

    const cust = customers.find((c) => c.id === quote.customerId) || customers[0];
    const prod = products.find((p) => p.id === quote.productId) || products[0];
    const orderId = `ORD-2026-${Math.floor(100 + Math.random() * 899)}`;
    const jobNumber = `JOB-MF-2026-0${Math.floor(500 + Math.random() * 499)}`;
    const targetDate = new Date(Date.now() + quote.deliveryLeadWeeks * 7 * 86400000)
      .toISOString()
      .split('T')[0];

    const newOrder: OrderJourney = {
      id: orderId,
      poNumber: `PO/${quote.rfqReference.replace('/RFQ/', '/ORD/')}`,
      poDate: new Date().toISOString().split('T')[0],
      customerName: quote.customerName,
      customerId: quote.customerId,
      jobNumber,
      status: 'material_pending',
      statusLabel: 'Converted from Won Quotation — Pending Billet Allocation',
      totalValue: quote.totalQuotedValue,
      currency: 'INR',
      expectedDeliveryDate: targetDate,
      targetDeliveryDate: targetDate,
      lineItems: [
        {
          id: `LI-${Date.now().toString().slice(-4)}`,
          salesOrderId: orderId,
          productId: prod?.id || quote.productId,
          productCode: prod?.code || 'FG-FLG-001',
          productName: quote.productName,
          materialGrade: quote.materialGrade,
          size: prod?.size || 'Standard',
          orderedQty: quote.inquiryQtyPcs,
          ratePerUnit: quote.quotedRatePerPc,
          totalAmount: quote.totalQuotedValue,
          producedQty: 0,
          inspectedOkQty: 0,
          rejectedQty: 0,
          dispatchedQty: 0,
          pendingQty: quote.inquiryQtyPcs,
          uom: 'PCS',
        },
      ],
      materialStatus: {
        state: 'shortage',
        materialGrade: `${quote.materialGrade} Forging Billet`,
        heatNumber: 'PENDING-YARD-ALLOCATION',
        supplierName: 'Pending Stores Allocation',
        requiredKg: Math.round(quote.inquiryQtyPcs * quote.unitWeightKg * 1.12),
        allocatedKg: 0,
        lastUpdated: new Date().toISOString().split('T')[0],
        notes: `Converted from Quotation ${quote.id} (${quote.rfqReference}).`,
      },
      qualityStatus: {
        state: 'pending',
        testTypes: ['Chemical Analysis', 'Ultrasonic Test (UT)', 'Brinell Hardness'],
        inspectorName: 'Dr. Praveen Kale',
        inspectionDate: '-',
        mtcNumber: '-',
        mtcStatus: 'draft',
      },
      clearanceStatus: {
        state: 'pending',
        agency: 'Customer / TPI Witness',
        inspectorName: 'To Be Nominated',
        clearanceRefNo: '-',
        clearanceDate: '-',
        remarks: 'Awaiting forging completion.',
      },
      dispatchStatus: {
        state: 'pending',
        totalShippedQty: 0,
        balanceQty: quote.inquiryQtyPcs,
        transporterName: '-',
        vehicleNo: '-',
        lrNumber: '-',
        dispatchDate: '-',
        destinationCity: cust?.location || 'Customer Site',
      },
      invoiceStatus: {
        state: 'pending',
        invoiceNumber: '-',
        invoiceDate: '-',
        invoiceAmount: 0,
        paidAmount: 0,
        outstandingAmount: 0,
        paymentDueDate: '-',
        tallySyncStatus: 'pending_import',
      },
    };

    const updatedQuote: QuotationRecord = {
      ...quote,
      status: 'won',
      convertedOrderId: orderId,
    };

    const res = await convertQuotationToOrderRecord(updatedQuote, newOrder);
    setConvertingQuoteId(null);

    if (!res.success) {
      setFeedback({
        type: 'error',
        message: `Conversion Blocked: ${res.error || 'Could not create Sales Order in /salesOrders.'}`,
      });
      return;
    }

    setFeedback({
      type: 'success',
      message: res.persistedToFirestore
        ? `Persisted to Cloud Firestore (/quotations/${quote.id} & /salesOrders/${orderId}): Converted Quotation ${quote.id} into Sales Order ${orderId} (Job ${jobNumber}).`
        : `[Preview Session Only] Converted Quotation ${quote.id} into Sales Order ${orderId} (Job ${jobNumber}) in session state.`,
    });
  };

  const handleCreateTender = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingQuote) return;
    if (!canWriteSales) {
      setFeedback({
        type: 'error',
        message: `Access Restricted: Role '${currentUser.role}' (${currentUser.accountStatus}) cannot register PSU/EPC tenders.`,
      });
      return;
    }
    const newTender: TenderRecord = {
      id: `TND-2026-0${Math.floor(25 + Math.random() * 70)}`,
      tenderNumber: tenderNumber.trim(),
      issuingAuthority: issuingAuthority.trim(),
      projectTitle: projectTitle.trim(),
      itemSummary: itemSummary.trim(),
      estimatedValueLakhs,
      emdAmount,
      bidSubmissionDate,
      priceBidOpeningDate,
      technicalBidStatus: 'under_preparation',
      assignedOwner: currentUser.name || 'Anil Verma (VP Commercial)',
    };

    setSavingQuote(true);
    setFeedback(null);
    const res = await createTenderRecord(newTender);
    setSavingQuote(false);

    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to register tender in Cloud Firestore.',
      });
      return;
    }

    setShowNewTenderModal(false);
    setFeedback({
      type: 'success',
      message: res.persistedToFirestore
        ? `Persisted to Cloud Firestore (/tenders/${newTender.id}): Registered PSU/EPC Tender ${newTender.tenderNumber} (${newTender.issuingAuthority}).`
        : `[Preview Session Only] Registered PSU/EPC Tender ${newTender.tenderNumber} (${newTender.issuingAuthority}) in session pipeline.`,
    });
  };

  const totalPipelineValueLakhs =
    quotations.reduce((acc, q) => acc + q.totalQuotedValue, 0) / 100000;

  return (
    <div className="space-y-6 text-xs">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-slate-500 mb-1">
            <span>Commercial &amp; Pre-Sales</span>
            <span aria-hidden="true">·</span>
            <span>RFQs, Repeat Orders &amp; Tenders</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-700">Quotation Pipeline</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
            Quotations, Follow-Ups &amp; PSU Tender Tracker
          </h1>
          <p className="text-slate-500 mt-0.5">
            Weight-based forging cost estimation, repeat-order tracking, customer follow-up schedules, PDF offers, and one-click PO conversion.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportQuotationsExcel}
            className="px-3 py-2 text-xs font-semibold bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Export Quotes &amp; Follow-Ups (.xlsx)</span>
          </button>
          <button
            onClick={handleExportTendersExcel}
            className="px-3 py-2 text-xs font-semibold bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-700" />
            <span>Tender Register (.xlsx)</span>
          </button>
          <button
            onClick={() => setShowNewTenderModal(true)}
            className="px-3 py-2 text-xs font-semibold bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Award className="w-3.5 h-3.5 text-indigo-600" />
            <span>Log PSU / EPC Tender</span>
          </button>
          <button
            onClick={() => setShowNewQuoteModal(true)}
            className="px-3.5 py-2 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 rounded-md transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Forging Quotation</span>
          </button>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-slate-200">
          <span className="text-slate-500 block">Active RFQ Pipeline</span>
          <span className="text-lg font-bold font-mono text-slate-900 mt-0.5 block">
            ₹{totalPipelineValueLakhs.toFixed(2)} Lakhs
          </span>
          <span className="text-[11px] text-slate-500">{quotations.length} Active Quotations</span>
        </div>
        <div className="bg-white p-4 rounded-lg border border-slate-200">
          <span className="text-slate-500 block">Repeat Order Inquiries</span>
          <span className="text-lg font-bold font-mono text-indigo-700 mt-0.5 block">
            {quotations.filter((q) => q.isRepeatOrder).length} of {quotations.length}
          </span>
          <span className="text-[11px] text-slate-500">Existing Die &amp; Tooling Qualified</span>
        </div>
        <div className="bg-white p-4 rounded-lg border border-slate-200">
          <span className="text-slate-500 block">Won / Ready for PO</span>
          <span className="text-lg font-bold font-mono text-emerald-700 mt-0.5 block">
            {quotations.filter((q) => q.status === 'won').length} Quote(s)
          </span>
          <span className="text-[11px] text-slate-500">One-Click Conversion to /salesOrders</span>
        </div>
        <div className="bg-white p-4 rounded-lg border border-slate-200">
          <span className="text-slate-500 block">PSU / EPC Tenders</span>
          <span className="text-lg font-bold font-mono text-slate-900 mt-0.5 block">
            ₹{tenders.reduce((acc, t) => acc + t.estimatedValueLakhs, 0).toFixed(1)} Lakhs
          </span>
          <span className="text-[11px] text-slate-500">{tenders.length} Active Bids (BHEL, IOCL, NTPC)</span>
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

      {/* Sub-navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          onClick={() => setActiveTab('quotations')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'quotations'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Customer Quotations &amp; Repeat Orders ({quotations.length})
        </button>
        <button
          onClick={() => setActiveTab('follow_ups')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'follow_ups'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Sales Follow-Up Schedule ({quotations.filter((q) => q.status !== 'lost').length})
        </button>
        <button
          onClick={() => setActiveTab('tenders')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'tenders'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          PSU &amp; EPC Tender Pipeline ({tenders.length})
        </button>
        <button
          onClick={() => setActiveTab('leads_enquiries')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'leads_enquiries'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Pre-RFQ Leads &amp; Sales Rep Targets ({preRfqLeads.length})
        </button>
      </div>

      {/* TAB 1: QUOTATIONS REGISTER */}
      {activeTab === 'quotations' && (
        <div className="space-y-4">
          <div className="bg-white p-3.5 rounded-lg border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by RFQ #, Customer, or Forged Product..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto">
              {['all', 'submitted', 'follow_up', 'negotiation', 'won'].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded capitalize transition-colors cursor-pointer ${
                    statusFilter === st
                      ? 'bg-slate-900 text-white font-semibold'
                      : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Quote ID &amp; RFQ Ref</th>
                    <th className="py-3 px-3.5">Customer &amp; Repeat Status</th>
                    <th className="py-3 px-3.5">Product, Grade &amp; Wt</th>
                    <th className="py-3 px-3.5 text-right">Qty (PCS)</th>
                    <th className="py-3 px-3.5 text-right">Rate/kg &amp; Rate/Pc</th>
                    <th className="py-3 px-3.5 text-right">Total Value &amp; Margin</th>
                    <th className="py-3 px-3.5">Status</th>
                    <th className="py-3 px-3.5 text-right">PDF Offer &amp; Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredQuotations.map((q) => (
                    <tr key={q.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3.5">
                        <div className="font-mono font-bold text-slate-900">{q.id}</div>
                        <div className="font-mono text-[11px] text-slate-500">{q.rfqReference}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900">{q.customerName}</div>
                        <div className="text-[11px] text-slate-500">
                          {q.contactPerson} ·{' '}
                          <span className={q.isRepeatOrder ? 'text-indigo-700 font-semibold' : ''}>
                            {q.isRepeatOrder ? 'Repeat Order (Die Ready)' : 'New Tooling Inquiry'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-semibold text-slate-800">{q.productName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {q.materialGrade} · {q.unitWeightKg} kg/pc
                        </div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900">
                        {q.inquiryQtyPcs} PCS
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums">
                        <div className="font-semibold text-slate-900">₹{q.quotedRatePerPc.toLocaleString()}/pc</div>
                        <div className="text-[11px] text-slate-500">₹{q.quotedRatePerKg}/kg</div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums">
                        <div className="font-bold text-slate-900">
                          ₹{(q.totalQuotedValue / 100000).toFixed(2)} Lakhs
                        </div>
                        <div className="text-[11px] text-emerald-700 font-semibold">
                          Est. Margin: {q.estimatedMarginPercent}%
                        </div>
                      </td>
                      <td className="py-3 px-3.5">
                        <StatusBadge
                          status={q.status === 'won' ? 'completed' : q.status === 'negotiation' ? 'warning' : 'in_progress'}
                          label={q.status.replace('_', ' ').toUpperCase()}
                        />
                        <div className="text-[10px] text-slate-500 font-mono mt-1">
                          Follow-up: {q.nextFollowUpDate}
                        </div>
                      </td>
                      <td className="py-3 px-3.5 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          onClick={() => handleQuotationPdf(q, 'preview')}
                          className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                          title="Preview / Print Quotation PDF"
                        >
                          <Printer className="w-3 h-3" />
                          <span>Preview</span>
                        </button>
                        <button
                          onClick={() => handleQuotationPdf(q, 'download')}
                          className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                          title="Download Quotation PDF"
                        >
                          <Download className="w-3 h-3 text-emerald-700" />
                          <span>Quote PDF</span>
                        </button>
                        <button
                          onClick={() => {
                            setShowFollowUpModal(q);
                            setEditFollowUpStatus(q.status);
                            setEditNextFollowUpDate(q.nextFollowUpDate);
                            setEditFollowUpNotes(q.followUpNotes);
                          }}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold text-[11px] transition-colors cursor-pointer"
                        >
                          Follow-Up
                        </button>
                        {q.convertedOrderId ? (
                          <button
                            onClick={() => onSelectOrder?.(q.convertedOrderId!)}
                            className="px-2.5 py-1 bg-emerald-100 text-emerald-900 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <span>PO: {q.convertedOrderId}</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleConvertQuoteToSalesOrder(q)}
                            disabled={convertingQuoteId === q.id}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold text-[11px] transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {convertingQuoteId === q.id ? 'Converting...' : 'Convert to PO'}
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

      {/* TAB 2: SALES FOLLOW-UPS */}
      {activeTab === 'follow_ups' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {quotations.map((q) => (
            <div key={q.id} className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
              <div className="flex items-start justify-between border-b border-slate-100 pb-2.5">
                <div>
                  <span className="font-mono font-bold text-slate-900">{q.id}</span>
                  <span className="mx-1.5 text-slate-400">·</span>
                  <span className="font-semibold text-slate-800">{q.customerName}</span>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Contact: {q.contactPerson} · RFQ: {q.rfqReference}
                  </div>
                </div>
                <div className="text-right font-mono">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700">
                    <Calendar className="w-3 h-3" />
                    <span>Next: {q.nextFollowUpDate}</span>
                  </span>
                </div>
              </div>

              <div className="text-slate-700 bg-slate-50 p-3 rounded border border-slate-200/80 leading-relaxed">
                <strong className="text-slate-900 block mb-0.5">Latest Follow-Up Note:</strong>
                {q.followUpNotes}
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-slate-500 font-mono">
                  Quote Value: ₹{(q.totalQuotedValue / 100000).toFixed(2)}L ({q.inquiryQtyPcs} PCS)
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleQuotationPdf(q, 'download')}
                    className="px-2.5 py-1 bg-white border border-slate-300 text-slate-800 rounded font-semibold text-[11px] hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3 h-3 text-emerald-700" />
                    <span>Quote PDF</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowFollowUpModal(q);
                      setEditFollowUpStatus(q.status);
                      setEditNextFollowUpDate(q.nextFollowUpDate);
                      setEditFollowUpNotes(q.followUpNotes);
                    }}
                    className="px-3 py-1 bg-slate-900 text-white rounded font-semibold text-[11px] hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <PhoneCall className="w-3 h-3" />
                    <span>Log Customer Call / Update</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 3: PSU & EPC TENDER PIPELINE */}
      {activeTab === 'tenders' && (
        <div className="space-y-4">
          <div className="bg-white p-3.5 rounded-lg border border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-bold text-slate-900">
                Institutional PSU &amp; EPC Tender Bid Register
              </span>
              <span className="text-slate-500 ml-2">
                ({tenders.length} Active Bids · Exportable to Excel or Printable Executive Summary PDF)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleTenderSummaryPdf('preview')}
                className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Printable Tender Summary</span>
              </button>
              <button
                onClick={() => handleTenderSummaryPdf('download')}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Tender PDF</span>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Tender No. &amp; Authority</th>
                    <th className="py-3 px-3.5">Project &amp; Scope of Supply</th>
                    <th className="py-3 px-3.5 text-right">Est. Contract Value</th>
                    <th className="py-3 px-3.5 text-right">EMD Deposit</th>
                    <th className="py-3 px-3.5">Submission / Price Opening</th>
                    <th className="py-3 px-3.5">Technical Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tenders.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3.5">
                        <div className="font-mono font-bold text-slate-900">{t.tenderNumber}</div>
                        <div className="text-[11px] text-slate-600 font-medium">{t.issuingAuthority}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900">{t.projectTitle}</div>
                        <div className="text-[11px] text-slate-500">{t.itemSummary}</div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900">
                        ₹{t.estimatedValueLakhs.toFixed(2)} Lakhs
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono text-slate-700">
                        ₹{t.emdAmount.toLocaleString()}
                      </td>
                      <td className="py-3 px-3.5 font-mono text-[11px]">
                        <div>Bid Due: <strong className="text-slate-900">{t.bidSubmissionDate}</strong></div>
                        <div className="text-slate-500">Price Open: {t.priceBidOpeningDate}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <StatusBadge
                          status={
                            t.technicalBidStatus === 'awarded' || t.technicalBidStatus === 'qualified'
                              ? 'completed'
                              : 'in_progress'
                          }
                          label={t.technicalBidStatus.replace('_', ' ').toUpperCase()}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PRE-RFQ LEADS & SALES REP TARGET VS ACHIEVEMENT */}
      {activeTab === 'leads_enquiries' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <div className="text-[11px] font-bold uppercase text-slate-500">
                Plant Monthly Target (FY 2026-27)
              </div>
              <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                ₹{(4.5).toFixed(2)} Cr
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Booked Order Value: ₹
                {(
                  salesOrders.reduce((s, o) => s + (o.totalOrderValue ?? o.totalValue ?? 0), 0) /
                  10000000
                ).toFixed(2)}{' '}
                Cr
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <div className="text-[11px] font-bold uppercase text-slate-500">
                Vikram Kulkarni (Sales Head)
              </div>
              <div className="text-xl font-bold font-mono text-indigo-700 mt-1">
                Target: ₹{(4.5 * 0.65).toFixed(2)} Cr
              </div>
              <div className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                Active Pipeline: ₹{(totalPipelineValueLakhs / 100).toFixed(2)} Cr · Quote Win Rate: 33%
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <div className="text-[11px] font-bold uppercase text-slate-500">
                Pre-RFQ Feasibility &amp; Die Checks
              </div>
              <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                {preRfqLeads.length} Active Enquiries
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {preRfqLeads.filter((l) => l.feasibilityStatus === 'feasible').length} Feasible ·{' '}
                {preRfqLeads.filter((l) => l.feasibilityStatus === 'tooling_required').length} New Die Required
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="font-bold text-slate-900">
                  Pre-RFQ Customer Enquiry &amp; Forging Feasibility Register
                </h3>
                <p className="text-[11px] text-slate-500">
                  Early-stage technical enquiries tracked prior to formal RFQ cost estimation.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3.5">Lead ID &amp; Date</th>
                    <th className="py-2.5 px-3.5">Company &amp; Sector</th>
                    <th className="py-2.5 px-3.5">Contact Person</th>
                    <th className="py-2.5 px-3.5">Forging Requirement &amp; Grade</th>
                    <th className="py-2.5 px-3.5 text-right">Est. Tonnage / Value</th>
                    <th className="py-2.5 px-3.5">Die Feasibility</th>
                    <th className="py-2.5 px-3.5">Sales Owner</th>
                    <th className="py-2.5 px-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preRfqLeads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3.5 font-mono">
                        <div className="font-bold text-slate-900">{lead.id}</div>
                        <div className="text-[11px] text-slate-500">Next: {lead.nextActionDate}</div>
                      </td>
                      <td className="py-2.5 px-3.5">
                        <div className="font-bold text-slate-900">{lead.companyName}</div>
                        <div className="text-[11px] text-slate-500">{lead.industry} · {lead.source}</div>
                      </td>
                      <td className="py-2.5 px-3.5">
                        <div className="font-semibold text-slate-800">{lead.contactPerson}</div>
                        <div className="font-mono text-[11px] text-slate-500">{lead.phone}</div>
                      </td>
                      <td className="py-2.5 px-3.5">
                        <div className="font-medium text-slate-900">{lead.productInterest}</div>
                        <div className="font-mono text-[11px] text-indigo-700">{lead.materialGrade}</div>
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono">
                        <div className="font-bold text-slate-900">
                          ₹{(lead.estimatedValueLakhs ?? lead.estimatedAnnualPotentialLakhs ?? 0).toFixed(1)}L
                        </div>
                        <div className="text-[11px] text-slate-500">{lead.estimatedMonthlyMt} MT/mo</div>
                      </td>
                      <td className="py-2.5 px-3.5">
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase ${
                            lead.feasibilityStatus === 'feasible'
                              ? 'bg-emerald-100 text-emerald-800'
                              : lead.feasibilityStatus === 'tooling_required'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {(lead.feasibilityStatus || 'feasible').replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-2.5 px-3.5 text-slate-700 font-medium">
                        {lead.assignedSalesPerson}
                      </td>
                      <td className="py-2.5 px-3.5 text-right">
                        <button
                          onClick={() => {
                            setRfqReference(`RFQ/${lead.companyName.split(' ')[0].toUpperCase()}/2026`);
                            setFollowUpNotes(`Converted from Pre-RFQ Lead ${lead.id}: ${lead.notes || ''}`);
                            setPreRfqLeads((prev) =>
                              prev.map((l) =>
                                l.id === lead.id ? { ...l, status: 'converted_to_rfq' } : l
                              )
                            );
                            setShowNewQuoteModal(true);
                          }}
                          className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold text-[11px] cursor-pointer"
                        >
                          Prepare Quote
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE NEW FORGING QUOTATION */}
      {showNewQuoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleCreateQuotation}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-700" />
                  <span>Prepare Forging Quotation</span>
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Calculates piece rate automatically from product standard forging weight and rate per kg.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewQuoteModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Customer Account</label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Customer RFQ Reference</label>
                  <input
                    type="text"
                    required
                    value={rfqReference}
                    onChange={(e) => setRfqReference(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Forged Product & Standard Weight</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-white"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.materialGrade} · {p.standardWeightKg} kg/pc)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Inquiry Qty (PCS)</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={inquiryQtyPcs}
                    onChange={(e) => setInquiryQtyPcs(Number(e.target.value) || 1)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Quoted Rate (₹/kg)</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={quotedRatePerKg}
                    onChange={(e) => setQuotedRatePerKg(Number(e.target.value) || 1)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Est. Margin (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    min={1}
                    required
                    value={estimatedMarginPercent}
                    onChange={(e) => setEstimatedMarginPercent(Number(e.target.value) || 15)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Lead Time (Weeks)</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={deliveryLeadWeeks}
                    onChange={(e) => setDeliveryLeadWeeks(Number(e.target.value) || 4)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Next Follow-Up</label>
                  <input
                    type="date"
                    required
                    value={nextFollowUpDate}
                    onChange={(e) => setNextFollowUpDate(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={isRepeatOrder}
                      onChange={(e) => setIsRepeatOrder(e.target.checked)}
                    />
                    <span>Repeat Order</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Commercial & Technical Notes</label>
                <textarea
                  rows={2}
                  value={followUpNotes}
                  onChange={(e) => setFollowUpNotes(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded flex items-center justify-between font-mono">
              <span>
                Unit Price: <strong>₹{calculatedRatePerPc.toLocaleString()}/pc</strong>
              </span>
              <span>
                Total Quote: <strong className="text-slate-900">₹{(calculatedTotalQuoteValue / 100000).toFixed(2)} Lakhs</strong>
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowNewQuoteModal(false)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 cursor-pointer"
              >
                Save Quotation
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: FOLLOW-UP UPDATE */}
      {showFollowUpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleSaveFollowUp}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-md w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Update Sales Follow-Up ({showFollowUpModal.id})
                </h3>
                <p className="text-slate-500 mt-0.5">{showFollowUpModal.customerName}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowFollowUpModal(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Quotation Stage</label>
                <select
                  value={editFollowUpStatus}
                  onChange={(e) => setEditFollowUpStatus(e.target.value as QuotationRecord['status'])}
                  className="w-full p-2 border border-slate-300 rounded bg-white"
                >
                  <option value="submitted">Submitted</option>
                  <option value="follow_up">Follow-Up Active</option>
                  <option value="negotiation">Commercial Negotiation</option>
                  <option value="won">Won (LOI / Ready for PO)</option>
                  <option value="lost">Lost / Regretted</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Next Follow-Up Date</label>
                <input
                  type="date"
                  required
                  value={editNextFollowUpDate}
                  onChange={(e) => setEditNextFollowUpDate(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded font-mono"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Customer Discussion Summary</label>
                <textarea
                  rows={3}
                  required
                  value={editFollowUpNotes}
                  onChange={(e) => setEditFollowUpNotes(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowFollowUpModal(null)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 cursor-pointer"
              >
                Save Follow-Up
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: LOG PSU / EPC TENDER */}
      {showNewTenderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleCreateTender}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Register PSU / EPC Tender Bid</h3>
                <p className="text-slate-500 mt-0.5">
                  Track tender number, EMD deposit, and technical/price bid opening schedule.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewTenderModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Tender Reference No.</label>
                  <input
                    type="text"
                    required
                    value={tenderNumber}
                    onChange={(e) => setTenderNumber(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Issuing PSU / Authority</label>
                  <input
                    type="text"
                    required
                    value={issuingAuthority}
                    onChange={(e) => setIssuingAuthority(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Project / Package Title</label>
                <input
                  type="text"
                  required
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Forging Scope Summary</label>
                <input
                  type="text"
                  required
                  value={itemSummary}
                  onChange={(e) => setItemSummary(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Est. Tender Value (₹ Lakhs)</label>
                  <input
                    type="number"
                    step="0.5"
                    min={1}
                    required
                    value={estimatedValueLakhs}
                    onChange={(e) => setEstimatedValueLakhs(Number(e.target.value) || 10)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">EMD Amount (₹)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={emdAmount}
                    onChange={(e) => setEmdAmount(Number(e.target.value) || 0)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Bid Submission Deadline</label>
                  <input
                    type="date"
                    required
                    value={bidSubmissionDate}
                    onChange={(e) => setBidSubmissionDate(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Price Bid Opening Date</label>
                  <input
                    type="date"
                    required
                    value={priceBidOpeningDate}
                    onChange={(e) => setPriceBidOpeningDate(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowNewTenderModal(false)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 cursor-pointer"
              >
                Register Tender Bid
              </button>
            </div>
          </form>
        </div>
      )}

      <DocumentPreviewModal
        payload={previewPayload}
        onClose={() => setPreviewPayload(null)}
      />
    </div>
  );
};

