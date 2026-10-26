import React, { useEffect, useState } from 'react';
import {
  FileText,
  Layers,
  CheckCircle2,
  ShieldCheck,
  Truck,
  Receipt,
  Printer,
  Download,
  Edit3,
  Database,
  ShieldAlert,
} from 'lucide-react';
import { OrderJourney, OrderStatus } from '../../types/mis';
import { MOCK_ORDER_JOURNEYS } from '../../data/mockData';
import { StatusBadge } from '../common/StatusBadge';
import { useRtdb } from '../../context/RtdbContext';
import {
  MontexPdfDocumentPayload,
  buildInvoicePdfPayload,
  buildMtcDraftPdfPayload,
  buildOrderProgressPdfPayload,
  generateMontexPdfDocument,
  verifyExportPermission,
} from '../../services/documentExportService';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
import { deriveQualityInspectionsFromOrders } from '../../services/misDataValidator';

interface OrderDetailJourneyProps {
  initialOrderId?: string;
  onNavigateToModule?: (moduleId: string) => void;
}

export const OrderDetailJourney: React.FC<OrderDetailJourneyProps> = ({
  initialOrderId = 'ORD-2026-001',
}) => {
  const {
    salesOrders,
    customers,
    products,
    qualityInspections,
    dimensionalReports,
    handovers,
    usersList,
    activeRbacGroup,
    currentUser,
    isDemoMode,
    updateSalesOrderRecord,
  } = useRtdb();
  const [selectedOrderId, setSelectedOrderId] = useState<string>(initialOrderId);
  const [activeTab, setActiveTab] = useState<
    'workflow' | 'items' | 'material' | 'quality' | 'clearance' | 'dispatch' | 'invoice'
  >('workflow');
  const [previewPayload, setPreviewPayload] = useState<MontexPdfDocumentPayload | null>(null);
  const [showStageModal, setShowStageModal] = useState<boolean>(false);
  const [savingStage, setSavingStage] = useState<boolean>(false);
  const [stageFeedback, setStageFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (initialOrderId) {
      setSelectedOrderId(initialOrderId);
    }
  }, [initialOrderId]);

  const ordersList = salesOrders.length > 0 ? salesOrders : isDemoMode ? MOCK_ORDER_JOURNEYS : [];
  const order = ordersList.find((o) => o.id === selectedOrderId) || ordersList[0];

  const [editStatus, setEditStatus] = useState<OrderStatus>(order?.status || 'po_registered');
  const [editStatusLabel, setEditStatusLabel] = useState<string>(order?.statusLabel || '');
  const [editClearanceState, setEditClearanceState] = useState<
    OrderJourney['clearanceStatus']['state']
  >(order?.clearanceStatus.state || 'pending');
  const [editClearanceRef, setEditClearanceRef] = useState<string>(
    order?.clearanceStatus.clearanceRefNo || '-'
  );
  const [editFprName, setEditFprName] = useState<string>(
    order?.fprName || 'Anil Verma (VP Commercial)'
  );
  const [editHandoverStage, setEditHandoverStage] = useState<
    NonNullable<OrderJourney['handoverStage']>
  >(order?.handoverStage || 'H-1');
  const [editDocChecklist, setEditDocChecklist] = useState<string>(
    order?.documentChecklistStatus || 'complete'
  );

  const canUpdateOrder =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo', 'sales', 'purchase', 'stores', 'quality', 'dispatch', 'finance'].includes(
      currentUser.role
    );

  if (!order) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-2">
        <FileText className="w-8 h-8 text-slate-400 mx-auto" />
        <h2 className="text-base font-bold text-slate-900">
          No Sales Orders Registered in Production Yet
        </h2>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          The Cloud Firestore <code className="font-mono">/salesOrders</code> collection is currently empty. Register a new Customer PO in the Sales Orders module or convert a Won Quotation to start tracking a 7-stage order journey.
        </p>
      </div>
    );
  }

  const checkExportAuth = () => {
    const check = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Sales',
      'Production',
      'Finance',
    ]);
    if (!check.allowed) {
      setStageFeedback({
        type: 'error',
        message: check.error || 'Document export restricted.',
      });
      return false;
    }
    return true;
  };

  const handleOpenOrderProgressPdf = (
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
        setStageFeedback({
          type: 'success',
          message: `Downloaded ${res.filename}.`,
        });
      }
    }
  };

  const handleOpenMtcDraftPdf = (action: 'preview' | 'download') => {
    if (!checkExportAuth()) return;
    const allQc =
      qualityInspections.length > 0
        ? qualityInspections
        : isDemoMode
        ? deriveQualityInspectionsFromOrders(ordersList)
        : [];
    const matchedQc = allQc.find((q) => q.jobNumber === order.jobNumber);
    const matchedDir = dimensionalReports.find((d) => d.jobNumber === order.jobNumber);
    const payload = buildMtcDraftPdfPayload(
      order,
      matchedQc,
      matchedDir,
      currentUser,
      activeRbacGroup
    );
    if (action === 'preview') {
      setPreviewPayload(payload);
    } else {
      const res = generateMontexPdfDocument(payload, 'download');
      if (res.success) {
        setStageFeedback({
          type: 'success',
          message: `Downloaded ${res.filename} (Draft MTC Data Summary — No fabricated chemical or mechanical lab numbers).`,
        });
      }
    }
  };

  const handleOpenInvoiceDraftPdf = (action: 'preview' | 'download') => {
    if (!checkExportAuth()) return;
    const cust = customers.find((c) => c.id === order.customerId);
    const payload = buildInvoicePdfPayload(
      order,
      cust,
      products,
      currentUser,
      activeRbacGroup
    );
    if (action === 'preview') {
      setPreviewPayload(payload);
    } else {
      const res = generateMontexPdfDocument(payload, 'download');
      if (res.success) {
        setStageFeedback({
          type: 'success',
          message: `Downloaded ${res.filename} (Draft Commercial Billing Summary).`,
        });
      }
    }
  };

  const openUpdateStageModal = () => {
    setEditStatus(order.status);
    setEditStatusLabel(order.statusLabel);
    setEditClearanceState(order.clearanceStatus.state);
    setEditClearanceRef(order.clearanceStatus.clearanceRefNo);
    setEditFprName(order.fprName || 'Anil Verma (VP Commercial)');
    setEditHandoverStage(order.handoverStage || 'H-1');
    setEditDocChecklist(order.documentChecklistStatus || 'complete');
    setShowStageModal(true);
  };

  const handleSaveOrderStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingStage) return;
    if (!canUpdateOrder) {
      setStageFeedback({
        type: 'error',
        message:
          currentUser.accountStatus !== 'active'
            ? `RBAC Policy: Account '${currentUser.email}' is ${currentUser.accountStatus}. Only active accounts can modify order lifecycle stages.`
            : `RBAC Policy: Role '${currentUser.role}' cannot modify order lifecycle stage.`,
      });
      return;
    }
    setSavingStage(true);
    setStageFeedback(null);

    const matchedFprUser = usersList.find((u) => u.name === editFprName);
    const updatedOrder: OrderJourney = {
      ...order,
      status: editStatus,
      statusLabel: editStatusLabel.trim() || order.statusLabel,
      fprUid: matchedFprUser?.id || order.fprUid || 'USR-002',
      fprName: editFprName.trim() || 'Anil Verma (VP Commercial)',
      handoverStage: editHandoverStage,
      documentChecklistStatus: editDocChecklist as any,
      clearanceStatus: {
        ...order.clearanceStatus,
        state: editClearanceState,
        clearanceRefNo: editClearanceRef.trim() || order.clearanceStatus.clearanceRefNo,
        clearanceDate:
          editClearanceState === 'approved' && order.clearanceStatus.clearanceDate === '-'
            ? new Date().toISOString().split('T')[0]
            : order.clearanceStatus.clearanceDate,
      },
    };

    const res = await updateSalesOrderRecord(
      updatedOrder,
      `stage=${editStatus}, fpr=${updatedOrder.fprName}, handover=${editHandoverStage}, tpiClearance=${editClearanceState}`
    );
    if (res.success) {
      setStageFeedback({
        type: 'success',
        message: res.persistedToFirestore
          ? `Saved to Cloud Firestore (/salesOrders/${order.id}): Updated ${order.poNumber} (${order.jobNumber}) stage to '${updatedOrder.statusLabel}', FPR='${updatedOrder.fprName}', Handover='${editHandoverStage}'.`
          : `[Demo Preview Mode] Updated ${order.poNumber} (${order.jobNumber}) stage to '${updatedOrder.statusLabel}', FPR='${updatedOrder.fprName}', Handover='${editHandoverStage}'.`,
      });
      setShowStageModal(false);
    } else {
      setStageFeedback({
        type: 'error',
        message: res.error || 'Failed to update order lifecycle stage',
      });
    }
    setSavingStage(false);
  };

  const milestones = [
    {
      id: 'po',
      number: '1',
      title: 'Customer PO',
      ref: order.poNumber,
      date: order.poDate,
      state: 'completed',
      summary: `${order.customerName}`,
    },
    {
      id: 'job',
      number: '2',
      title: 'Internal Job No.',
      ref: order.jobNumber,
      date: order.poDate,
      state: 'completed',
      summary: 'Assigned Shop-Floor Job',
    },
    {
      id: 'material',
      number: '3',
      title: 'Material Status',
      ref: order.materialStatus.heatNumber,
      date: order.materialStatus.lastUpdated,
      state:
        order.materialStatus.state === 'verified'
          ? 'completed'
          : order.materialStatus.state === 'allocated'
          ? 'in_progress'
          : 'warning',
      summary: `${order.materialStatus.allocatedKg.toLocaleString()} / ${order.materialStatus.requiredKg.toLocaleString()} KG`,
    },
    {
      id: 'quality',
      number: '4',
      title: 'Quality & MTC',
      ref: order.qualityStatus.mtcNumber,
      date: order.qualityStatus.inspectionDate,
      state:
        order.qualityStatus.state === 'cleared'
          ? 'completed'
          : order.qualityStatus.state === 'in_progress'
          ? 'in_progress'
          : order.qualityStatus.state === 'rejected'
          ? 'alert'
          : 'pending',
      summary: order.qualityStatus.state === 'cleared' ? 'MTC EN 10204 3.1 Issued' : 'QC Pending / In Progress',
    },
    {
      id: 'clearance',
      number: '5',
      title: 'Customer Clearance',
      ref: order.clearanceStatus.clearanceRefNo,
      date: order.clearanceStatus.clearanceDate,
      state:
        order.clearanceStatus.state === 'approved'
          ? 'completed'
          : order.clearanceStatus.state === 'not_required'
          ? 'neutral'
          : 'pending',
      summary: order.clearanceStatus.agency,
    },
    {
      id: 'dispatch',
      number: '6',
      title: 'Dispatch & LR',
      ref: order.dispatchStatus.lrNumber,
      date: order.dispatchStatus.dispatchDate,
      state:
        order.dispatchStatus.state === 'completed'
          ? 'completed'
          : order.dispatchStatus.state === 'partial'
          ? 'in_progress'
          : 'pending',
      summary: `${order.dispatchStatus.totalShippedQty} Shipped · ${order.dispatchStatus.balanceQty} Pending`,
    },
    {
      id: 'invoice',
      number: '7',
      title: 'Invoice Reference',
      ref: order.invoiceStatus.invoiceNumber,
      date: order.invoiceStatus.invoiceDate,
      state:
        order.invoiceStatus.state === 'invoiced' || order.invoiceStatus.state === 'partial'
          ? 'completed'
          : 'pending',
      summary: order.invoiceStatus.invoiceNumber !== '-' ? `₹${(order.invoiceStatus.invoiceAmount / 100000).toFixed(2)}L` : 'Awaiting Full Dispatch',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Order Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span>Commercial & Operations</span>
            <span aria-hidden="true">·</span>
            <span>Order Lifecycle Journey</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-700">{order.poNumber}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
              {order.customerName}
            </h1>
            <StatusBadge status={order.status} label={order.statusLabel} />
          </div>
        </div>

        {/* Order Selector & Stage Update */}
        <div className="flex flex-wrap items-center gap-2.5">
          <label htmlFor="order-select" className="text-xs font-medium text-slate-600">
            Select Customer Order:
          </label>
          <select
            id="order-select"
            value={selectedOrderId}
            onChange={(e) => setSelectedOrderId(e.target.value)}
            className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            {ordersList.map((o) => (
              <option key={o.id} value={o.id}>
                {o.poNumber} ({o.customerName.split(' ')[0]} - {o.statusLabel})
              </option>
            ))}
          </select>

          <button
            onClick={openUpdateStageModal}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>Update Stage / TPI</span>
          </button>

          <button
            onClick={() => handleOpenOrderProgressPdf('po_summary', 'preview')}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Preview / Download Customer PO Registration Summary PDF (Not a Tax Invoice)"
          >
            <FileText className="w-3.5 h-3.5 text-slate-600" />
            <span>PO Summary PDF</span>
          </button>

          <button
            onClick={() => handleOpenOrderProgressPdf('full_progress', 'preview')}
            className="px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Preview / Download 7-Stage Order & Job Progress Report PDF"
          >
            <Download className="w-3.5 h-3.5" />
            <span>7-Stage Progress PDF</span>
          </button>

          <button
            onClick={() => handleOpenMtcDraftPdf('preview')}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Preview / Download Draft MTC Recorded Data Summary PDF (No Fabricated Lab Values)"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Preview MTC Summary (Draft)</span>
          </button>
        </div>
      </div>

      {stageFeedback && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
            stageFeedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {stageFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-medium">{stageFeedback.message}</span>
          </div>
          <button
            onClick={() => setStageFeedback(null)}
            className="text-slate-500 hover:text-slate-800 font-bold px-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Primary Order Meta Bar */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
        <div>
          <span className="text-slate-500 block">Customer PO Number</span>
          <span className="font-semibold font-mono text-slate-900 text-sm">{order.poNumber}</span>
          <span className="text-slate-400 block text-[11px]">PO Date: {order.poDate}</span>
        </div>
        <div>
          <span className="text-slate-500 block">Internal Job Number</span>
          <span className="font-semibold font-mono text-indigo-700 text-sm">{order.jobNumber}</span>
          <span className="text-slate-400 block text-[11px]">Shop-Floor Control</span>
        </div>
        <div>
          <span className="text-slate-500 block">Total Order Value</span>
          <span className="font-semibold font-mono text-slate-900 text-sm">
            ₹{(order.totalValue / 100000).toFixed(2)} Lakhs
          </span>
          <span className="text-slate-400 block text-[11px]">GST Extra as Applicable</span>
        </div>
        <div>
          <span className="text-slate-500 block">Contractual Delivery</span>
          <span className="font-semibold font-mono text-slate-900 text-sm">
            {order.expectedDeliveryDate}
          </span>
          <span className="text-slate-400 block text-[11px]">Target: {order.targetDeliveryDate}</span>
        </div>
        <div>
          <span className="text-slate-500 block">Total Ordered Quantity</span>
          <span className="font-semibold font-mono text-slate-900 text-sm">
            {order.lineItems.reduce((acc, curr) => acc + curr.orderedQty, 0)} PCS
          </span>
          <span className="text-slate-400 block text-[11px]">
            {order.lineItems[0]?.productCode}
          </span>
        </div>
        <div>
          <span className="text-slate-500 block">Shipped / Balance</span>
          <span className="font-semibold font-mono text-slate-900 text-sm">
            {order.dispatchStatus.totalShippedQty} / {order.dispatchStatus.balanceQty} PCS
          </span>
          <span className="text-slate-400 block text-[11px]">
            {order.dispatchStatus.balanceQty === 0 ? 'Fully Delivered' : 'Pending Shipment'}
          </span>
        </div>
      </div>

      {/* FPR Accountability, H-1..H-5 Custody Handover & 12-Stage Lifecycle Bar */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="px-2.5 py-1 rounded bg-[#14283F] text-amber-300 font-mono font-bold text-[11px]">
              FPR (Focal Point of Responsibility):{' '}
              {order.fprName || 'Anil Verma (VP Commercial)'}
            </span>
            <span className="px-2.5 py-1 rounded bg-blue-50 text-blue-900 border border-blue-200 font-mono font-semibold text-[11px]">
              Active Handover Gate: {order.handoverStage || 'H-3'} (
              {
                handovers.filter(
                  (h) => h.orderId === order.id || h.jobNumber === order.jobNumber
                ).length
              }{' '}
              Custody Transfers Logged)
            </span>
            <span
              className={`px-2.5 py-1 rounded font-mono font-semibold text-[11px] border ${
                (order.documentChecklistStatus || 'complete') === 'complete'
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                  : 'bg-rose-50 text-rose-900 border-rose-200'
              }`}
            >
              5-Doc Customer Pack:{' '}
              {(order.documentChecklistStatus || 'complete') === 'complete'
                ? 'Verified Ready (PO + MTC + DIR + TPI + Invoice)'
                : 'Incomplete (Gate-Out Blocked)'}
            </span>
          </div>
          <button
            type="button"
            onClick={openUpdateStageModal}
            className="text-[11px] font-semibold text-[#14283F] underline cursor-pointer"
          >
            Assign FPR / Update H-1..H-5 Gate
          </button>
        </div>

        {/* 12-Stage Granular Lifecycle Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-12 gap-1.5 pt-1">
          {[
            '1. Lead/RFQ',
            '2. Quotation',
            '3. PO Reg (H-1)',
            '4. PPC Plan',
            '5. Billet Cut (H-2)',
            '6. Forging',
            '7. Heat Treat',
            '8. Machining (H-3)',
            '9. Lab & NDT',
            '10. TPI & MTC (H-4)',
            '11. Dispatch (H-5)',
            '12. GST Invoice',
          ].map((label, idx) => {
            const completedStages =
              order.status === 'completed'
                ? 12
                : order.status === 'partially_dispatched'
                ? 11
                : order.status === 'ready_for_dispatch'
                ? 10
                : order.status === 'quality_pending' || (order.status as string) === 'under_inspection'
                ? 9
                : order.status === 'in_production'
                ? 6
                : 3;
            const isDone = idx + 1 <= completedStages;
            return (
              <div
                key={label}
                className={`px-2 py-1.5 rounded border text-[10px] font-mono font-semibold text-center ${
                  isDone
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : 'bg-slate-50 border-slate-200 text-slate-500'
                }`}
              >
                {label}
              </div>
            );
          })}
        </div>
      </div>

      {/* 7-Step Interactive Visual Workflow Milestone Tracker */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-bold text-slate-900">7-Stage Montex Forging Workflow</h2>
            <p className="text-xs text-slate-500">
              End-to-end operational traceability from customer purchase order to final invoice reference.
            </p>
          </div>
          <span className="text-xs text-slate-400 font-mono">Stage 1 to 7</span>
        </div>

        {/* Milestone Steps Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 pt-2">
          {milestones.map((m) => {
            let bgClass = 'bg-slate-50 border-slate-200';
            let badgeBg = 'bg-slate-200 text-slate-700';

            if (m.state === 'completed') {
              bgClass = 'bg-emerald-50/40 border-emerald-200';
              badgeBg = 'bg-emerald-600 text-white';
            } else if (m.state === 'in_progress') {
              bgClass = 'bg-amber-50/40 border-amber-300';
              badgeBg = 'bg-amber-500 text-white';
            } else if (m.state === 'warning' || m.state === 'alert') {
              bgClass = 'bg-rose-50/40 border-rose-300';
              badgeBg = 'bg-rose-600 text-white';
            }

            return (
              <div
                key={m.id}
                className={`p-3 rounded-lg border ${bgClass} flex flex-col justify-between text-xs transition-colors`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-slate-800">{m.title}</span>
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${badgeBg}`}
                    >
                      {m.number}
                    </span>
                  </div>
                  <div className="font-mono text-slate-700 font-medium truncate mb-1" title={m.ref}>
                    {m.ref}
                  </div>
                  <div className="text-[11px] text-slate-500 line-clamp-2">{m.summary}</div>
                </div>

                <div className="mt-2 pt-1.5 border-t border-slate-200/60 text-[10px] text-slate-400 flex justify-between">
                  <span>Date:</span>
                  <span className="font-mono">{m.date}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Deep-Dive Interactive Tabs */}
      <div className="bg-white rounded-lg border border-slate-200">
        <div className="flex flex-wrap border-b border-slate-200 px-4 gap-1">
          {[
            { id: 'workflow', label: 'Overview & Specs', icon: FileText },
            { id: 'material', label: 'Material & Heat Traceability', icon: Layers },
            { id: 'quality', label: 'Quality & MTC (EN 10204)', icon: CheckCircle2 },
            { id: 'clearance', label: 'Customer Clearance (TPI)', icon: ShieldCheck },
            { id: 'dispatch', label: 'Dispatch & Vehicle LR', icon: Truck },
            { id: 'invoice', label: 'Invoice & Tally Sync', icon: Receipt },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 py-3 px-3.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="p-5">
          {/* TAB 1: OVERVIEW & ORDER LINE ITEMS */}
          {activeTab === 'workflow' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">Ordered Forged Products</h3>
                <span className="text-xs text-slate-500">
                  {order.lineItems.length} Product Line Item(s)
                </span>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Item Code</th>
                      <th className="py-2.5 px-3">Description & Rating</th>
                      <th className="py-2.5 px-3">Material Grade</th>
                      <th className="py-2.5 px-3 text-right">Ordered Qty</th>
                      <th className="py-2.5 px-3 text-right">Unit Rate</th>
                      <th className="py-2.5 px-3 text-right">Total Amount</th>
                      <th className="py-2.5 px-3 text-right">Dispatched</th>
                      <th className="py-2.5 px-3 text-right">Pending</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {order.lineItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-mono font-medium text-slate-900">
                          {item.productCode}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-800">{item.productName}</div>
                          <div className="text-[11px] text-slate-500">{item.size}</div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 font-medium">{item.materialGrade}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {item.orderedQty} {item.uom}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                          ₹{item.ratePerUnit.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                          ₹{item.totalAmount.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700 font-medium">
                          {item.dispatchedQty}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-rose-700 font-bold">
                          {item.pendingQty}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: RAW MATERIAL & HEAT NUMBER */}
          {activeTab === 'material' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Raw Material Allocation</h3>
                  <p className="text-xs text-slate-500">
                    Steel billet heat number allocation and chemistry verification.
                  </p>
                </div>
                <StatusBadge status={order.materialStatus.state} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-200">
                    <span className="text-slate-500">Grade & Form:</span>
                    <span className="font-bold text-slate-900">{order.materialStatus.materialGrade}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200">
                    <span className="text-slate-500">Allocated Heat No:</span>
                    <span className="font-mono font-bold text-indigo-700">{order.materialStatus.heatNumber}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200">
                    <span className="text-slate-500">Steel Manufacturer:</span>
                    <span className="font-medium text-slate-800">{order.materialStatus.supplierName}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200">
                    <span className="text-slate-500">Required Quantity:</span>
                    <span className="font-mono tabular-nums text-slate-900 font-semibold">
                      {order.materialStatus.requiredKg.toLocaleString()} KG ({(order.materialStatus.requiredKg / 1000).toFixed(2)} MT)
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Stock Allocated:</span>
                    <span className="font-mono tabular-nums font-bold text-emerald-700">
                      {order.materialStatus.allocatedKg.toLocaleString()} KG
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-3 text-xs">
                  <span className="font-semibold text-slate-800 block">Metallurgical Notes & Invariants:</span>
                  <p className="text-slate-600 leading-relaxed">{order.materialStatus.notes}</p>
                  <div className="p-3 bg-white border border-slate-200 rounded text-slate-700 space-y-1">
                    <div className="font-semibold text-slate-900">Traceability Rule Enforced:</div>
                    <div className="text-[11px] text-slate-500">
                      Stock is committed via StockReservation table. Once forging commences, the heat number is stamped directly on the outer rim of every finished piece.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: QUALITY & MTC */}
          {activeTab === 'quality' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Quality Inspection & Testing</h3>
                  <p className="text-xs text-slate-500">
                    Non-Destructive Testing (NDT), Hardness, Dimensional clearances, and recorded MTC metadata.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenMtcDraftPdf('preview')}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Preview Draft MTC Summary</span>
                  </button>
                  <button
                    onClick={() => handleOpenMtcDraftPdf('download')}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download MTC Summary PDF</span>
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-3 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-slate-500 block">Inspection Officer</span>
                    <span className="font-semibold text-slate-900">{order.qualityStatus.inspectorName}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">MTC Certificate Reference</span>
                    <span className="font-mono font-bold text-indigo-700">{order.qualityStatus.mtcNumber}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">QC Status</span>
                    <StatusBadge status={order.qualityStatus.state} />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200">
                  <span className="font-semibold text-slate-800 block mb-2">Prescribed Test Procedures Performed:</span>
                  <div className="space-y-1.5">
                    {order.qualityStatus.testTypes.map((t, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-slate-700">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>{t}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {order.qualityStatus.rejectionReason && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-800 text-xs">
                    <span className="font-bold block mb-1">Non-Conformance / Rejection Log:</span>
                    <span>{order.qualityStatus.rejectionReason}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: CUSTOMER CLEARANCE */}
          {activeTab === 'clearance' && (
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Customer & Third-Party Inspection (TPI)</h3>
                  <p className="text-slate-500">
                    Formal customer release notes required prior to vehicle loading.
                  </p>
                </div>
                <StatusBadge status={order.clearanceStatus.state} />
              </div>

              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2">
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Inspection Agency / Body:</span>
                  <span className="font-semibold text-slate-900">{order.clearanceStatus.agency}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Designated Inspector:</span>
                  <span className="font-medium text-slate-800">{order.clearanceStatus.inspectorName}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Inspection Release Note (IRN) No:</span>
                  <span className="font-mono font-bold text-slate-900">{order.clearanceStatus.clearanceRefNo}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Clearance Date:</span>
                  <span className="font-mono text-slate-700">{order.clearanceStatus.clearanceDate}</span>
                </div>
                <div className="pt-2">
                  <span className="text-slate-500 block mb-1">Inspector Endorsement Remarks:</span>
                  <p className="text-slate-700 bg-white p-2.5 border border-slate-200 rounded">
                    {order.clearanceStatus.remarks}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: DISPATCH & LR */}
          {activeTab === 'dispatch' && (
            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Logistics & Dispatch Consignment</h3>
                  <p className="text-slate-500">
                    Vehicle assignment, transporter LR number, and partial deliveries.
                  </p>
                </div>
                <StatusBadge status={order.dispatchStatus.state} />
              </div>

              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2">
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Transporter:</span>
                  <span className="font-semibold text-slate-900">{order.dispatchStatus.transporterName}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Assigned Vehicle Plate:</span>
                  <span className="font-mono font-bold text-slate-900">{order.dispatchStatus.vehicleNo}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Lorry Receipt (LR) No:</span>
                  <span className="font-mono font-bold text-indigo-700">{order.dispatchStatus.lrNumber}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Destination Yard:</span>
                  <span className="font-medium text-slate-800">{order.dispatchStatus.destinationCity}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Shipped Quantity This Lot:</span>
                  <span className="font-mono tabular-nums font-bold text-emerald-700">
                    {order.dispatchStatus.totalShippedQty} PCS
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Pending Balance on PO:</span>
                  <span className="font-mono tabular-nums font-bold text-rose-700">
                    {order.dispatchStatus.balanceQty} PCS
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: INVOICE & TALLY */}
          {activeTab === 'invoice' && (
            <div className="space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Commercial Billing & Tally Sync</h3>
                  <p className="text-slate-500">
                    Recorded billing reference against dispatched delivery challan (Draft Billing Summary available).
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={order.invoiceStatus.tallySyncStatus} label={`Tally: ${order.invoiceStatus.tallySyncStatus}`} />
                  <button
                    onClick={() => handleOpenInvoiceDraftPdf('preview')}
                    className="px-2.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Preview Billing PDF</span>
                  </button>
                  <button
                    onClick={() => handleOpenInvoiceDraftPdf('download')}
                    className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Draft Billing PDF</span>
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2">
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Tax Invoice Number:</span>
                  <span className="font-mono font-bold text-slate-900">{order.invoiceStatus.invoiceNumber}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Invoice Date:</span>
                  <span className="font-mono text-slate-700">{order.invoiceStatus.invoiceDate}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Invoiced Amount:</span>
                  <span className="font-mono tabular-nums font-bold text-slate-900">
                    ₹{order.invoiceStatus.invoiceAmount.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-500">Current Outstanding:</span>
                  <span className="font-mono tabular-nums font-bold text-rose-700">
                    ₹{order.invoiceStatus.outstandingAmount.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Commercial Payment Due Date:</span>
                  <span className="font-mono text-slate-700">{order.invoiceStatus.paymentDueDate}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Document Preview & Print Modal */}
      <DocumentPreviewModal
        payload={previewPayload}
        onClose={() => setPreviewPayload(null)}
      />

      {/* Update Order Stage & TPI Clearance Modal */}
      {showStageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleSaveOrderStage}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-md w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Update Order Lifecycle & TPI Clearance
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Updates <code>{order.poNumber}</code> ({order.jobNumber}) in{' '}
                  <code>/salesOrders/{order.id}</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowStageModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Lifecycle Stage Status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as OrderStatus)}
                  className="w-full p-2 border border-slate-300 rounded bg-white"
                >
                  <option value="material_pending">Material Pending</option>
                  <option value="in_production">In Production</option>
                  <option value="quality_pending">Quality Inspection Pending</option>
                  <option value="ready_for_dispatch">Ready for Dispatch</option>
                  <option value="partially_dispatched">Partially Dispatched</option>
                  <option value="completed">Completed & Closed</option>
                  <option value="delayed_alert">Delayed Alert</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Operational Status Description
                </label>
                <input
                  type="text"
                  required
                  value={editStatusLabel}
                  onChange={(e) => setEditStatusLabel(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    TPI Clearance State
                  </label>
                  <select
                    value={editClearanceState}
                    onChange={(e) => setEditClearanceState(e.target.value as any)}
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    <option value="pending">Pending Witness</option>
                    <option value="approved">Approved (IRN Issued)</option>
                    <option value="not_required">Not Required</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    IRN / Clearance Ref No.
                  </label>
                  <input
                    type="text"
                    value={editClearanceRef}
                    onChange={(e) => setEditClearanceRef(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Assigned FPR Officer
                  </label>
                  <input
                    type="text"
                    value={editFprName}
                    onChange={(e) => setEditFprName(e.target.value)}
                    placeholder="e.g. Vikram Kulkarni"
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Handover Gate (H-1..H-5)
                  </label>
                  <select
                    value={editHandoverStage}
                    onChange={(e) => setEditHandoverStage(e.target.value as any)}
                    className="w-full p-2 border border-slate-300 rounded bg-white font-mono"
                  >
                    <option value="H-1">H-1 (Sales → PPC)</option>
                    <option value="H-2">H-2 (Stores → Shop)</option>
                    <option value="H-3">H-3 (Shop → QC/MTC)</option>
                    <option value="H-4">H-4 (QC → Dispatch)</option>
                    <option value="H-5">H-5 (Dispatch → Billing)</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 pt-1 text-slate-700 font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={editDocChecklist === 'complete' || editDocChecklist === 'Verified'}
                  onChange={(e) =>
                    setEditDocChecklist(e.target.checked ? 'complete' : 'incomplete')
                  }
                  className="rounded border-slate-300"
                />
                <span>5-Doc Customer Pack Verified (Tax Inv + E-Way + Pack List + MTC + TPI IRN)</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setShowStageModal(false)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingStage || !canUpdateOrder}
                className="px-3.5 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                <span>{savingStage ? 'Saving...' : 'Save Order Stage'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
