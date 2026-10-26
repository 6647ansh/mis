import React, { useState } from 'react';
import { StatusBadge } from '../common/StatusBadge';
import { PageHeader } from '../common/PageHeader';
import { AlertBanner } from '../common/AlertBanner';
import {
  Search,
  Plus,
  ArrowRight,
  Database,
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Download,
  ChevronDown,
  ChevronUp,
  Layers,
  CheckCircle2,
  Truck,
  Receipt,
  RotateCcw,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import { validateSalesOrderQuantities } from '../../services/misDataValidator';
import { OrderJourney } from '../../types/mis';
import {
  MontexPdfDocumentPayload,
  buildOrderProgressPdfPayload,
  exportMontexCsvFile,
  exportMontexExcelWorkbook,
  generateMontexPdfDocument,
  verifyExportPermission,
} from '../../services/documentExportService';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';

interface SalesOrdersViewProps {
  onSelectOrder: (orderId: string) => void;
}

export const SalesOrdersView: React.FC<SalesOrdersViewProps> = ({ onSelectOrder }) => {
  const {
    salesOrders,
    customers,
    products,
    activeRbacGroup,
    currentUser,
    createSalesOrderRecord,
  } = useRtdb();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [showNewOrderModal, setShowNewOrderModal] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<MontexPdfDocumentPayload | null>(null);

  // Form states for new Customer PO
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id || 'CUST-001');
  const [poNumber, setPoNumber] = useState('BHEL/PO/2026/9021');
  const [poDate, setPoDate] = useState('2026-10-21');
  const [deliveryDate, setDeliveryDate] = useState('2026-11-25');
  const [selectedProductId, setSelectedProductId] = useState(products[0]?.id || 'PROD-001');
  const [orderedQty, setOrderedQty] = useState<number>(250);
  const [ratePerUnit, setRatePerUnit] = useState<number>(8450);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    title: string;
    message: string;
    reference?: string;
  } | null>(null);

  const canWriteSales =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo', 'sales'].includes(currentUser.role);

  const filteredOrders = salesOrders.filter((o) => {
    const matchesSearch =
      o.poNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      o.jobNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (o.lineItems?.[0]?.productName || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || o.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalOrderValueLakhs =
    filteredOrders.reduce((s, o) => s + o.totalValue, 0) / 100000;
  const totalOrderedPcs = filteredOrders.reduce(
    (s, o) => s + (o.lineItems || []).reduce((acc, li) => acc + li.orderedQty, 0),
    0
  );
  const totalShippedPcs = filteredOrders.reduce(
    (s, o) => s + o.dispatchStatus.totalShippedQty,
    0
  );
  const totalPendingPcs = filteredOrders.reduce(
    (s, o) => s + o.dispatchStatus.balanceQty,
    0
  );

  const checkExportAuth = () => {
    const check = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Sales',
      'Production',
      'Finance',
    ]);
    if (!check.allowed) {
      setFeedback({
        type: 'error',
        title: 'Export Permission Required',
        message: check.error || 'Your current role does not have permission to export order reports.',
        reference: `Role: ${activeRbacGroup}`,
      });
      return false;
    }
    return true;
  };

  const handleExportOrdersExcel = () => {
    if (!checkExportAuth()) return;
    if (filteredOrders.length === 0) {
      setFeedback({
        type: 'error',
        title: 'No Orders to Export',
        message: 'No sales orders match your current search or status filter. Clear filters and try again.',
      });
      return;
    }

    const totalPoValue = filteredOrders.reduce((s, o) => s + o.totalValue, 0);

    const res = exportMontexExcelWorkbook(
      'Montex_Sales_Order_Register_2026-10-22.xlsx',
      [
        {
          sheetName: 'Sales_Order_Register',
          reportTitle: 'Customer Purchase Order & Internal Job Register',
          reportSubtitle: `Filter: ${statusFilter.toUpperCase()} | Search: "${searchTerm || 'All'}" | ${filteredOrders.length} Orders`,
          headers: [
            'Order ID',
            'Internal Job No.',
            'Customer PO No.',
            'PO Date',
            'Customer Name',
            'Primary Product',
            'Material Grade',
            'Ordered Qty (PCS)',
            'Produced Qty (PCS)',
            'QC Passed Qty (PCS)',
            'Rejected Qty (PCS)',
            'Dispatched Qty (PCS)',
            'Pending Balance (PCS)',
            'PO Basic Value (INR)',
            'Target Delivery',
            'Contractual Delivery',
            'Order Stage Status',
            'Material Heat No.',
            'MTC Reference',
            'TPI Clearance Ref',
            'Invoice Number',
          ],
          rows: filteredOrders.map((o) => {
            const li = o.lineItems?.[0];
            return [
              o.id,
              o.jobNumber,
              o.poNumber,
              o.poDate,
              o.customerName,
              li?.productName || '—',
              li?.materialGrade || o.materialStatus.materialGrade,
              (o.lineItems || []).reduce((acc, c) => acc + c.orderedQty, 0),
              (o.lineItems || []).reduce((acc, c) => acc + c.producedQty, 0),
              (o.lineItems || []).reduce((acc, c) => acc + c.inspectedOkQty, 0),
              (o.lineItems || []).reduce((acc, c) => acc + c.rejectedQty, 0),
              o.dispatchStatus.totalShippedQty,
              o.dispatchStatus.balanceQty,
              o.totalValue,
              o.targetDeliveryDate,
              o.expectedDeliveryDate,
              o.statusLabel,
              o.materialStatus.heatNumber,
              o.qualityStatus.mtcNumber,
              o.clearanceStatus.clearanceRefNo,
              o.invoiceStatus.invoiceNumber,
            ];
          }),
          totalsRow: [
            'TOTAL',
            `${filteredOrders.length} Jobs`,
            '',
            '',
            '',
            '',
            '',
            totalOrderedPcs,
            '',
            '',
            '',
            totalShippedPcs,
            totalPendingPcs,
            totalPoValue,
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
        title: 'Sales Order Register Exported (.xlsx)',
        message: `Downloaded ${filteredOrders.length} sales orders to Excel workbook.`,
        reference: res.filename,
      });
    } else {
      setFeedback({
        type: 'error',
        title: 'Excel Export Failed',
        message: res.error || 'Unable to generate Excel workbook.',
      });
    }
  };

  const handleExportOrdersCsv = () => {
    if (!checkExportAuth()) return;
    if (filteredOrders.length === 0) {
      setFeedback({
        type: 'error',
        title: 'No Orders to Export',
        message: 'No sales orders match your current search or status filter.',
      });
      return;
    }

    const res = exportMontexCsvFile(
      'Montex_Sales_Orders_2026-10-22.csv',
      [
        'Order ID',
        'Job Number',
        'PO Number',
        'PO Date',
        'Customer Name',
        'Product Name',
        'Material Grade',
        'Ordered Qty (PCS)',
        'Shipped Qty (PCS)',
        'Pending Balance (PCS)',
        'Total Value (INR)',
        'Expected Delivery Date',
        'Status',
      ],
      filteredOrders.map((o) => [
        o.id,
        o.jobNumber,
        o.poNumber,
        o.poDate,
        o.customerName,
        o.lineItems?.[0]?.productName || '—',
        o.lineItems?.[0]?.materialGrade || '—',
        (o.lineItems || []).reduce((acc, c) => acc + c.orderedQty, 0),
        o.dispatchStatus.totalShippedQty,
        o.dispatchStatus.balanceQty,
        o.totalValue,
        o.expectedDeliveryDate,
        o.status,
      ])
    );

    if (res.success) {
      setFeedback({
        type: 'success',
        title: 'Sales Orders CSV Exported',
        message: `Downloaded ${filteredOrders.length} sales orders to CSV file.`,
        reference: res.filename,
      });
    }
  };

  const handleOrderPdfDocument = (
    order: OrderJourney,
    docMode: 'po_summary' | 'full_progress',
    action: 'preview' | 'download'
  ) => {
    if (!checkExportAuth()) return;
    const payload = buildOrderProgressPdfPayload(
      order,
      docMode,
      currentUser,
      activeRbacGroup
    );
    if (action === 'preview') {
      setPreviewPayload(payload);
    } else {
      const res = generateMontexPdfDocument(payload, 'download');
      if (res.success) {
        setFeedback({
          type: 'success',
          title:
            docMode === 'po_summary'
              ? 'Customer PO Summary PDF Downloaded'
              : '7-Stage Progress Report PDF Downloaded',
          message: `Generated branded PDF report for ${order.customerName}.`,
          reference: `${order.poNumber} · ${order.jobNumber}`,
        });
      }
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!canWriteSales) {
      setFeedback({
        type: 'error',
        title: 'Role Permission Required',
        message:
          currentUser.accountStatus !== 'active'
            ? `Your account (${currentUser.email}) is currently ${currentUser.accountStatus}. Only active Sales or Super Admin accounts can register new customer purchase orders.`
            : `Your current role (${currentUser.role}) has view-only access to Sales Orders. Switch to Sales or Super Admin to register a new order.`,
        reference: `Role: ${currentUser.role}`,
      });
      return;
    }
    if (orderedQty <= 0 || ratePerUnit < 0) {
      setFeedback({
        type: 'error',
        title: 'Invalid Quantity or Unit Rate',
        message: 'Ordered quantity must be greater than zero and unit rate cannot be negative.',
      });
      return;
    }

    setSaving(true);
    setFeedback(null);

    const cust = customers.find((c) => c.id === selectedCustomerId) || customers[0];
    const prod = products.find((p) => p.id === selectedProductId) || products[0];
    const orderId = `ORD-2026-${Math.floor(100 + Math.random() * 899)}`;
    const jobNum = `JOB-MF-2026-0${Math.floor(500 + Math.random() * 499)}`;
    const totalAmount = orderedQty * ratePerUnit;

    const newOrder: OrderJourney = {
      id: orderId,
      poNumber: poNumber.trim() || `PO/2026/${Date.now().toString().slice(-4)}`,
      poDate,
      jobNumber: jobNum,
      customerId: cust?.id || 'CUST-001',
      customerName: cust?.name || 'Montex Customer',
      totalValue: totalAmount,
      currency: 'INR',
      expectedDeliveryDate: deliveryDate,
      targetDeliveryDate: deliveryDate,
      status: 'material_pending',
      statusLabel: 'New Order — Awaiting Billet Allocation',
      lineItems: [
        {
          id: `LI-${Date.now().toString().slice(-4)}`,
          salesOrderId: orderId,
          productId: prod?.id || 'PROD-001',
          productCode: prod?.code || 'FG-FLG-001',
          productName: prod?.name || 'Forged Component',
          materialGrade: prod?.materialGrade || 'ASTM A105',
          size: prod?.size || 'Standard',
          orderedQty,
          uom: 'PCS',
          ratePerUnit,
          totalAmount,
          producedQty: 0,
          inspectedOkQty: 0,
          rejectedQty: 0,
          dispatchedQty: 0,
          pendingQty: orderedQty,
        },
      ],
      materialStatus: {
        state: 'shortage',
        materialGrade: `${prod?.materialGrade || 'ASTM A105'} Round Billet`,
        heatNumber: 'PENDING-YARD-ALLOCATION',
        requiredKg: Math.round(orderedQty * (prod?.standardWeightKg || 28) * 1.12),
        allocatedKg: 0,
        supplierName: 'Pending Stores Allocation',
        lastUpdated: new Date().toISOString().split('T')[0],
        notes: 'Newly registered PO. Pending billet reservation.',
      },
      qualityStatus: {
        state: 'pending',
        inspectorName: 'Pending Assignment',
        inspectionDate: '-',
        mtcNumber: '-',
        mtcStatus: 'draft',
        testTypes: ['Chemical Analysis', 'Ultrasonic Test (UT)', 'Brinell Hardness'],
      },
      clearanceStatus: {
        state: 'pending',
        agency: 'Customer / TPI Review',
        inspectorName: 'To Be Nominated',
        clearanceDate: '-',
        clearanceRefNo: '-',
        remarks: 'Awaiting forging & heat treatment completion.',
      },
      dispatchStatus: {
        state: 'pending',
        totalShippedQty: 0,
        balanceQty: orderedQty,
        transporterName: '-',
        vehicleNo: '-',
        lrNumber: '-',
        dispatchDate: '-',
        destinationCity: cust?.location || 'Customer Works',
      },
      invoiceStatus: {
        state: 'pending',
        invoiceNumber: '-',
        invoiceDate: '-',
        invoiceAmount: 0,
        paidAmount: 0,
        paymentDueDate: '-',
        tallySyncStatus: 'pending_import',
        outstandingAmount: 0,
      },
    };

    const res = await createSalesOrderRecord(newOrder);
    if (res.success) {
      setFeedback({
        type: 'success',
        title: 'Customer Purchase Order Registered',
        message: res.persistedToFirestore
          ? `Persisted to Cloud Firestore (/salesOrders/${newOrder.id}): Registered PO for ${newOrder.customerName} and assigned internal Job Number ${newOrder.jobNumber}.`
          : `[Demo Preview Mode] Registered PO for ${newOrder.customerName} and assigned internal Job Number ${newOrder.jobNumber} in the current preview session.`,
        reference: `PO: ${newOrder.poNumber} · Job: ${newOrder.jobNumber}`,
      });
      setShowNewOrderModal(false);
    } else {
      setFeedback({
        type: 'error',
        title: 'Unable to Save Purchase Order',
        message: res.error || 'Could not save the order. Please verify your sign-in status and permissions.',
        reference: poNumber,
      });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-5">
      {/* Standardized Module Header */}
      <PageHeader
        category="Sales & Orders"
        title="Sales Orders & Job Numbers"
        description="Track customer purchase orders, internal shop-floor job numbers, delivery schedules, and 7-stage manufacturing progress."
        secondaryActions={
          <>
            <button
              onClick={handleExportOrdersExcel}
              className="px-3 py-2 text-xs font-semibold bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
              <span>Export Excel (.xlsx)</span>
            </button>
            <button
              onClick={handleExportOrdersCsv}
              className="px-3 py-2 text-xs font-semibold bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-600" />
              <span>Export CSV</span>
            </button>
          </>
        }
        primaryAction={
          <button
            onClick={() => setShowNewOrderModal(true)}
            className="px-4 py-2 text-xs font-semibold bg-[#14283F] text-white hover:bg-[#234765] rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-[#F28C28]" />
            <span>Register New Order</span>
          </button>
        }
      />

      {/* Quick Summary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 text-xs">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-slate-500 font-medium block">Matching Orders</span>
          <span className="text-lg font-bold font-mono tabular-nums text-[#14283F] mt-0.5 block">
            {filteredOrders.length} {filteredOrders.length === 1 ? 'Order' : 'Orders'}
          </span>
          <span className="text-[11px] text-slate-500">
            Status: {statusFilter === 'all' ? 'All Stages' : statusFilter.replace(/_/g, ' ')}
          </span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-slate-500 font-medium block">Total Order Value</span>
          <span className="text-lg font-bold font-mono tabular-nums text-[#14283F] mt-0.5 block">
            ₹{totalOrderValueLakhs.toFixed(2)} Lakhs
          </span>
          <span className="text-[11px] text-slate-500">Basic PO Value (Excl. GST)</span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-slate-500 font-medium block">Shipped vs Ordered Qty</span>
          <span className="text-lg font-bold font-mono tabular-nums text-emerald-700 mt-0.5 block">
            {totalShippedPcs} / {totalOrderedPcs} PCS
          </span>
          <span className="text-[11px] text-slate-500">
            {totalPendingPcs} PCS remaining to dispatch
          </span>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-slate-500 font-medium block">Ready for Dispatch</span>
          <span className="text-lg font-bold font-mono tabular-nums text-blue-700 mt-0.5 block">
            {salesOrders.filter((o) => o.status === 'ready_for_dispatch').length} Job(s)
          </span>
          <span className="text-[11px] text-slate-500">QC &amp; TPI Cleared</span>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <AlertBanner
          severity={feedback.type === 'success' ? 'success' : 'error'}
          title={feedback.title}
          message={feedback.message}
          reference={feedback.reference}
          onDismiss={() => setFeedback(null)}
          compact
        />
      )}

      {/* Search & Status Filter Toolbar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Customer, PO Number, Job Number, or Product..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#14283F]"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
          <span className="text-slate-500 font-medium whitespace-nowrap mr-1">Filter Status:</span>
          {[
            { id: 'all', label: 'All Orders' },
            { id: 'partially_dispatched', label: 'Partially Dispatched' },
            { id: 'quality_pending', label: 'Quality Pending' },
            { id: 'ready_for_dispatch', label: 'Ready for Dispatch' },
            { id: 'material_pending', label: 'Material Pending' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-[#14283F] text-white font-semibold shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Orders Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        {filteredOrders.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="text-sm font-bold text-slate-800">
              No sales orders match your current filter
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Try clearing your search term or switching the status filter back to &ldquo;All Orders&rdquo; to view all customer purchase orders.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setStatusFilter('all');
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-[#14283F] text-white rounded-lg hover:bg-[#234765] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                <tr>
                  <th className="py-3.5 px-4">Customer &amp; PO Reference</th>
                  <th className="py-3.5 px-4">Internal Job No.</th>
                  <th className="py-3.5 px-4">Product &amp; Grade</th>
                  <th className="py-3.5 px-4 text-right">Quantity (PCS)</th>
                  <th className="py-3.5 px-4 text-right">Order Value</th>
                  <th className="py-3.5 px-4">Delivery Date</th>
                  <th className="py-3.5 px-4">Order Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((o) => {
                  const validation = validateSalesOrderQuantities(o);
                  const isExpanded = expandedOrderId === o.id;
                  const orderedTotal = (o.lineItems || []).reduce(
                    (acc, curr) => acc + curr.orderedQty,
                    0
                  );
                  const hasAdvisory = !validation.valid || validation.warnings.length > 0;
                  const primaryItem = o.lineItems?.[0];

                  return (
                    <React.Fragment key={o.id}>
                      <tr
                        className={`hover:bg-slate-50/80 transition-colors ${
                          isExpanded ? 'bg-slate-50/90' : ''
                        }`}
                      >
                        {/* 1. Customer & PO */}
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900">{o.customerName}</div>
                          <div className="font-mono text-slate-500 text-[11px] mt-0.5">
                            PO: <span className="text-slate-700 font-semibold">{o.poNumber}</span> · {o.poDate}
                          </div>
                        </td>

                        {/* 2. Internal Job Number */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="font-mono font-bold text-[#14283F] bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
                            {o.jobNumber}
                          </span>
                        </td>

                        {/* 3. Product & Grade (Clean — no technical error dumps) */}
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-900">
                            {primaryItem?.productName || 'Forged Component'}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {primaryItem?.materialGrade}
                            {primaryItem?.size ? ` · ${primaryItem.size}` : ''}
                          </div>
                        </td>

                        {/* 4. Quantity */}
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="font-bold text-slate-900">{orderedTotal} PCS</div>
                          <div className="text-[11px] mt-0.5">
                            <span className="text-emerald-700 font-semibold">
                              {o.dispatchStatus.totalShippedQty} shipped
                            </span>
                            <span className="text-slate-400"> · </span>
                            <span className="text-amber-800 font-semibold">
                              {o.dispatchStatus.balanceQty} pending
                            </span>
                          </div>
                        </td>

                        {/* 5. Order Value */}
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="font-bold text-slate-900">
                            ₹{(o.totalValue / 100000).toFixed(2)} Lakhs
                          </div>
                          {primaryItem && (
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              @ ₹{primaryItem.ratePerUnit.toLocaleString()}/pc
                            </div>
                          )}
                        </td>

                        {/* 6. Delivery Date */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-mono font-semibold text-slate-900">
                            {o.expectedDeliveryDate}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                            Target: {o.targetDeliveryDate}
                          </div>
                        </td>

                        {/* 7. Order Status + Clean Advisory Pill */}
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col items-start gap-1">
                            <StatusBadge status={o.status} label={o.statusLabel} />
                            {hasAdvisory && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedOrderId(isExpanded ? null : o.id)
                                }
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer transition-colors ${
                                  !validation.valid
                                    ? 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'
                                    : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                                }`}
                                title="Click to view plain-English quantity advisory in order details"
                              >
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                <span>
                                  {!validation.valid
                                    ? 'Qty Review Needed'
                                    : 'Replacement Forging Note'}
                                </span>
                              </button>
                            )}
                          </div>
                        </td>

                        {/* 8. Grouped Order Actions */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedOrderId(isExpanded ? null : o.id)
                              }
                              className={`px-2.5 py-1.5 border rounded-md font-semibold text-[11px] inline-flex items-center gap-1 transition-colors cursor-pointer ${
                                isExpanded
                                  ? 'bg-slate-200 border-slate-300 text-slate-900'
                                  : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-700'
                              }`}
                              title="Expand line items, heat numbers, and operational advisories"
                            >
                              <span>Details</span>
                              {isExpanded ? (
                                <ChevronUp className="w-3 h-3" />
                              ) : (
                                <ChevronDown className="w-3 h-3" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOrderPdfDocument(o, 'po_summary', 'preview')}
                              className="px-2 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                              title="Preview Customer PO Summary PDF"
                            >
                              <FileText className="w-3 h-3 text-slate-600" />
                              <span className="hidden xl:inline">PO PDF</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => onSelectOrder(o.id)}
                              className="px-3 py-1.5 bg-[#14283F] hover:bg-[#234765] text-white rounded-md font-semibold text-[11px] transition-colors inline-flex items-center gap-1 cursor-pointer"
                              title="Open Full 7-Stage Order Lifecycle Tracker"
                            >
                              <span>Track Order</span>
                              <ArrowRight className="w-3 h-3 text-[#F28C28]" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Progressive Disclosure: Structured Order Detail & Line Items Panel */}
                      {isExpanded && (
                        <tr className="bg-slate-50/95 border-b border-slate-200">
                          <td colSpan={8} className="p-4 sm:p-5">
                            <div className="space-y-4">
                              {/* Header of Expanded Panel */}
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                                <div>
                                  <h3 className="text-xs font-bold text-[#14283F] uppercase tracking-wider">
                                    Order Breakdown &amp; Shop-Floor Traceability — {o.poNumber} ({o.jobNumber})
                                  </h3>
                                  <p className="text-[11px] text-slate-500">
                                    Line-item forging quantities, quality inspection status, raw material heat allocation, and dispatch references.
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOrderPdfDocument(o, 'po_summary', 'preview')
                                    }
                                    className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-md font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <FileText className="w-3 h-3" />
                                    <span>Preview PO Summary PDF</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOrderPdfDocument(o, 'full_progress', 'preview')
                                    }
                                    className="px-2.5 py-1 bg-white border border-slate-300 hover:bg-slate-100 text-[#14283F] rounded-md font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Download className="w-3 h-3 text-[#F28C28]" />
                                    <span>7-Stage Progress Dossier PDF</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onSelectOrder(o.id)}
                                    className="px-3 py-1 bg-[#14283F] hover:bg-[#234765] text-white rounded-md font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <span>Open 7-Stage Lifecycle View</span>
                                    <ArrowRight className="w-3 h-3 text-[#F28C28]" />
                                  </button>
                                </div>
                              </div>

                              {/* Structured Operational Advisories (Plain English) */}
                              {(!validation.valid || validation.warnings.length > 0) && (
                                <div className="space-y-2">
                                  {validation.errors.map((errMsg, i) => (
                                    <AlertBanner
                                      key={`err-${i}`}
                                      severity="warning"
                                      title="Quality & Forged Quantity Reconciliation Needed"
                                      message={errMsg}
                                      reference={`PO: ${o.poNumber} · Job: ${o.jobNumber}`}
                                      actionLabel="Review in Order Tracker"
                                      onAction={() => onSelectOrder(o.id)}
                                      compact
                                    />
                                  ))}
                                  {validation.warnings.map((warnMsg, i) => (
                                    <AlertBanner
                                      key={`warn-${i}`}
                                      severity="warning"
                                      title="Replacement Forging Required for Full PO Delivery"
                                      message={warnMsg}
                                      reference={`PO: ${o.poNumber} · Job: ${o.jobNumber}`}
                                      actionLabel="Open Quality & Forging Status"
                                      onAction={() => onSelectOrder(o.id)}
                                      compact
                                    />
                                  ))}
                                </div>
                              )}

                              {/* Line Items Breakdown Table */}
                              <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                <div className="px-3.5 py-2 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between text-[11px] font-bold text-slate-700">
                                  <span>Product Line Items</span>
                                  <span className="font-mono text-slate-500">
                                    {(o.lineItems || []).length} Item(s)
                                  </span>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-[11px] text-left">
                                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase font-semibold">
                                      <tr>
                                        <th className="py-2 px-3">Item #</th>
                                        <th className="py-2 px-3">Product Code &amp; Description</th>
                                        <th className="py-2 px-3">Material Grade &amp; Size</th>
                                        <th className="py-2 px-3 text-right">Ordered</th>
                                        <th className="py-2 px-3 text-right">Forged</th>
                                        <th className="py-2 px-3 text-right">QC Passed</th>
                                        <th className="py-2 px-3 text-right">Rejected</th>
                                        <th className="py-2 px-3 text-right">Shipped</th>
                                        <th className="py-2 px-3 text-right">Pending</th>
                                        <th className="py-2 px-3 text-right">Unit Rate</th>
                                        <th className="py-2 px-3 text-right">Line Amount</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {(o.lineItems || []).map((li, idx) => (
                                        <tr key={li.id || idx}>
                                          <td className="py-2 px-3 font-mono font-semibold text-slate-700">
                                            #{idx + 1}
                                          </td>
                                          <td className="py-2 px-3">
                                            <span className="font-semibold text-slate-900 block">
                                              {li.productName}
                                            </span>
                                            <span className="font-mono text-slate-500">
                                              {li.productCode}
                                            </span>
                                          </td>
                                          <td className="py-2 px-3 text-slate-700">
                                            <div>{li.materialGrade}</div>
                                            <div className="text-slate-500">{li.size}</div>
                                          </td>
                                          <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                                            {li.orderedQty} {li.uom}
                                          </td>
                                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800">
                                            {li.producedQty}
                                          </td>
                                          <td className="py-2 px-3 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                                            {li.inspectedOkQty}
                                          </td>
                                          <td className="py-2 px-3 text-right font-mono tabular-nums text-rose-700 font-semibold">
                                            {li.rejectedQty}
                                          </td>
                                          <td className="py-2 px-3 text-right font-mono tabular-nums text-emerald-700 font-bold">
                                            {li.dispatchedQty}
                                          </td>
                                          <td className="py-2 px-3 text-right font-mono tabular-nums text-amber-800 font-bold">
                                            {li.pendingQty}
                                          </td>
                                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                                            ₹{li.ratePerUnit.toLocaleString()}
                                          </td>
                                          <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                                            ₹{li.totalAmount.toLocaleString()}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>

                              {/* 4-Card Traceability Summary */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
                                <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                                  <div className="flex items-center justify-between font-bold text-slate-800">
                                    <span className="inline-flex items-center gap-1">
                                      <Layers className="w-3.5 h-3.5 text-[#234765]" />
                                      <span>Raw Material &amp; Heat</span>
                                    </span>
                                    <StatusBadge status={o.materialStatus.state} />
                                  </div>
                                  <div className="font-mono text-slate-900 font-semibold pt-1">
                                    Heat: {o.materialStatus.heatNumber}
                                  </div>
                                  <div className="text-slate-500">
                                    Allocated: {o.materialStatus.allocatedKg.toLocaleString()} /{' '}
                                    {o.materialStatus.requiredKg.toLocaleString()} KG
                                  </div>
                                  <div className="text-slate-500 truncate">
                                    Mill: {o.materialStatus.supplierName}
                                  </div>
                                </div>

                                <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                                  <div className="flex items-center justify-between font-bold text-slate-800">
                                    <span className="inline-flex items-center gap-1">
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                      <span>Quality &amp; TPI Clearance</span>
                                    </span>
                                    <StatusBadge status={o.qualityStatus.state} />
                                  </div>
                                  <div className="font-mono text-slate-900 font-semibold pt-1">
                                    MTC: {o.qualityStatus.mtcNumber}
                                  </div>
                                  <div className="text-slate-500 truncate">
                                    TPI: {o.clearanceStatus.agency}
                                  </div>
                                  <div className="font-mono text-slate-500 truncate">
                                    IRN: {o.clearanceStatus.clearanceRefNo}
                                  </div>
                                </div>

                                <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                                  <div className="flex items-center justify-between font-bold text-slate-800">
                                    <span className="inline-flex items-center gap-1">
                                      <Truck className="w-3.5 h-3.5 text-[#F28C28]" />
                                      <span>Dispatch &amp; Logistics</span>
                                    </span>
                                    <StatusBadge status={o.dispatchStatus.state} />
                                  </div>
                                  <div className="font-mono text-slate-900 font-semibold pt-1">
                                    LR: {o.dispatchStatus.lrNumber}
                                  </div>
                                  <div className="text-slate-500 truncate">
                                    Transporter: {o.dispatchStatus.transporterName}
                                  </div>
                                  <div className="text-slate-500 truncate">
                                    Dest: {o.dispatchStatus.destinationCity}
                                  </div>
                                </div>

                                <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                                  <div className="flex items-center justify-between font-bold text-slate-800">
                                    <span className="inline-flex items-center gap-1">
                                      <Receipt className="w-3.5 h-3.5 text-indigo-600" />
                                      <span>Billing &amp; Receivables</span>
                                    </span>
                                    <StatusBadge
                                      status={o.invoiceStatus.tallySyncStatus}
                                      label={o.invoiceStatus.tallySyncStatus}
                                    />
                                  </div>
                                  <div className="font-mono text-slate-900 font-semibold pt-1">
                                    Invoice: {o.invoiceStatus.invoiceNumber}
                                  </div>
                                  <div className="font-mono text-slate-600">
                                    Billed: ₹{(o.invoiceStatus.invoiceAmount / 100000).toFixed(2)}L
                                  </div>
                                  <div className="text-slate-500">
                                    Due Date: {o.invoiceStatus.paymentDueDate}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Register New Customer PO Modal */}
      {showNewOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleCreateOrder}
            className="bg-white rounded-xl border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-[#14283F]">
                  Register New Customer Purchase Order
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Creates a new Sales Order, assigns an internal shop-floor Job Number, and initializes 7-stage tracking.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewOrderModal(false)}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {!canWriteSales && (
              <AlertBanner
                severity="warning"
                title={`View-Only Role (${activeRbacGroup})`}
                message="Only Sales, Management, and Admin roles can register new customer purchase orders. Use the Role switcher in the top header to test order creation."
                compact
              />
            )}

            <div className="space-y-3.5">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Customer Account <span className="text-rose-600">*</span>
                </label>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-md bg-white text-slate-900"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.location})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Customer PO No. <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder="e.g. BHEL/PO/2026/9021"
                    className="w-full p-2 border border-slate-300 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    PO Date <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={poDate}
                    onChange={(e) => setPoDate(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Delivery Date <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={deliveryDate}
                    onChange={(e) => setDeliveryDate(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded-md font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Forged Product &amp; Specification <span className="text-rose-600">*</span>
                </label>
                <select
                  value={selectedProductId}
                  onChange={(e) => {
                    setSelectedProductId(e.target.value);
                    const p = products.find((item) => item.id === e.target.value);
                    if (p) setRatePerUnit(p.standardSellingPrice);
                  }}
                  className="w-full p-2 border border-slate-300 rounded-md bg-white text-slate-900"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.size} ({p.materialGrade})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Ordered Quantity (PCS) <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={orderedQty}
                    onChange={(e) => setOrderedQty(Number(e.target.value) || 1)}
                    className="w-full p-2 border border-slate-300 rounded-md font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Unit Rate (₹ / PC) <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={ratePerUnit}
                    onChange={(e) => setRatePerUnit(Number(e.target.value) || 1)}
                    className="w-full p-2 border border-slate-300 rounded-md font-mono font-bold"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-200">
              <div className="font-mono text-slate-600">
                Total Order Value:{' '}
                <strong className="text-[#14283F] text-sm">
                  ₹{((orderedQty * ratePerUnit) / 100000).toFixed(2)} Lakhs
                </strong>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewOrderModal(false)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !canWriteSales}
                  className="px-4 py-2 bg-[#14283F] text-white rounded-lg font-semibold hover:bg-[#234765] disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5 text-[#F28C28]" />
                  <span>{saving ? 'Saving Order...' : 'Save Order & Assign Job #'}</span>
                </button>
              </div>
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
