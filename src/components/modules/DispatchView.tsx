import React, { useState } from 'react';
import {
  Truck,
  AlertTriangle,
  Plus,
  CheckCircle2,
  ShieldAlert,
  Database,
  FileSpreadsheet,
  FileText,
  Download,
} from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';
import { useRtdb } from '../../context/RtdbContext';
import { deriveDispatchesFromOrders } from '../../services/misDataValidator';
import { DispatchConsignmentRecord } from '../../types/mis';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
import {
  buildDispatchChallanPdfPayload,
  exportMontexCsvFile,
  exportMontexExcelWorkbook,
  MontexPdfDocumentPayload,
  verifyExportPermission,
} from '../../services/documentExportService';

type DispatchRecord = DispatchConsignmentRecord;

export const DispatchView: React.FC = () => {
  const {
    salesOrders,
    products,
    outstandingAgeing,
    dispatches: rtdbDispatches,
    activeRbacGroup,
    currentUser,
    isDemoMode,
    recordDispatchRecord,
  } = useRtdb();

  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<MontexPdfDocumentPayload | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState(salesOrders[0]?.id || 'ORD-2026-001');
  const [shippedQtyInput, setShippedQtyInput] = useState<number>(80);
  const [transporterInput, setTransporterInput] = useState('VRL Logistics Ltd.');
  const [vehicleNoInput, setVehicleNoInput] = useState('MH-14-HG-4490');
  const [lrNumberInput, setLrNumberInput] = useState('VRL-LR-2026-88401');
  const [invoiceRefInput, setInvoiceRefInput] = useState('INV/MF/26-27/0899');
  const [dispatchStatusInput, setDispatchStatusInput] = useState<string>('in_transit');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const [executiveOverrideReason, setExecutiveOverrideReason] = useState('');

  const canWriteDispatch =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo', 'dispatch'].includes(currentUser.role);
  const canOverrideGate =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo'].includes(currentUser.role);

  const derivedDispatches = isDemoMode ? deriveDispatchesFromOrders(salesOrders, products) : [];
  const dispatches = rtdbDispatches.length > 0 ? rtdbDispatches : derivedDispatches;

  const selectedOrder =
    salesOrders.find((o) => o.id === selectedOrderId) || salesOrders[0];

  const selectedCustomerAgeing = outstandingAgeing.find(
    (a) =>
      a.customerId === selectedOrder?.customerId ||
      a.customerName.toLowerCase() === (selectedOrder?.customerName || '').toLowerCase()
  );
  const isQcCleared =
    selectedOrder?.qualityStatus.state === 'cleared' ||
    Boolean(selectedOrder?.qualityStatus.mtcGenerated);
  const isTpiCleared = selectedOrder?.clearanceStatus.state !== 'pending';
  const isCreditHold = Boolean(
    !selectedOrder?.creditHoldOverrideBy &&
      selectedCustomerAgeing &&
      (selectedCustomerAgeing.creditExceeded ||
        selectedCustomerAgeing.creditLimitExceeded ||
        selectedCustomerAgeing.bucket90Plus > 0)
  );
  const hasPreDispatchHold = !isQcCleared || !isTpiCleared || isCreditHold;

  const handleExportDispatchExcel = () => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Production',
      'Sales',
      'Finance',
    ]);
    if (!authCheck.allowed) {
      setFeedback({ type: 'error', message: authCheck.reason || 'Export restricted' });
      return;
    }

    exportMontexExcelWorkbook(
      `Montex_Dispatch_LR_Register_${new Date().toISOString().split('T')[0]}.xlsx`,
      [
        {
          sheetName: 'Dispatch_LR_Register',
          reportTitle: 'MONTEX FORGE — OUTWARD DISPATCH, GATE PASS & LR REGISTER',
          reportSubtitle: `Total Consignments: ${dispatches.length} | Exported by ${currentUser.name} (${activeRbacGroup})`,
          metadataRows: [
            ['Total Consignments', dispatches.length],
            [
              'Total Shipped Quantity (PCS)',
              dispatches.reduce((s, d) => s + d.quantity, 0),
            ],
            [
              'Total Shipped Weight (MT)',
              Number(dispatches.reduce((s, d) => s + d.weightMt, 0).toFixed(2)),
            ],
          ],
          headers: [
            'Dispatch ID',
            'Dispatch Date',
            'Customer PO No.',
            'Job Number',
            'Customer Name',
            'Product Description',
            'Consignment Qty (PCS)',
            'Remaining PO Balance (PCS)',
            'Consignment Weight (MT)',
            'Transporter Name',
            'Vehicle Reg No.',
            'Lorry Receipt (LR) No.',
            'Destination',
            'Invoice Ref',
            'Clearance / MTC Ref',
            'Status',
          ],
          rows: dispatches.map((d) => [
            d.id,
            d.date,
            d.orderNo,
            d.jobNumber,
            d.customer,
            d.product,
            d.quantity,
            d.balanceQty,
            d.weightMt,
            d.transporter,
            d.vehicleNo,
            d.lrNumber,
            d.destination,
            d.invoiceRef,
            d.clearanceRef,
            d.status.toUpperCase(),
          ]),
          totalsRow: [
            'TOTAL',
            '',
            '',
            '',
            `${dispatches.length} Consignments`,
            '',
            dispatches.reduce((s, d) => s + d.quantity, 0),
            dispatches.reduce((s, d) => s + d.balanceQty, 0),
            Number(dispatches.reduce((s, d) => s + d.weightMt, 0).toFixed(2)),
            '',
            '',
            '',
            '',
            '',
            '',
            '',
          ],
        },
      ]
    );

    setFeedback({
      type: 'success',
      message: `Downloaded Dispatch & LR Register Excel workbook (${dispatches.length} consignments).`,
    });
  };

  const handleExportDispatchCsv = () => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Production',
      'Sales',
      'Finance',
    ]);
    if (!authCheck.allowed) {
      setFeedback({ type: 'error', message: authCheck.reason || 'Export restricted' });
      return;
    }

    exportMontexCsvFile(
      `Montex_Dispatch_LR_Register_${new Date().toISOString().split('T')[0]}.csv`,
      [
        'Dispatch ID',
        'Date',
        'PO Number',
        'Job Number',
        'Customer',
        'Product',
        'Consignment Qty (PCS)',
        'Remaining PO Balance (PCS)',
        'Weight (MT)',
        'Transporter',
        'Vehicle No',
        'LR Number',
        'Destination',
        'Invoice Ref',
        'Clearance Ref',
        'Status',
      ],
      dispatches.map((d) => [
        d.id,
        d.date,
        d.orderNo,
        d.jobNumber,
        d.customer,
        d.product,
        d.quantity,
        d.balanceQty,
        d.weightMt,
        d.transporter,
        d.vehicleNo,
        d.lrNumber,
        d.destination,
        d.invoiceRef,
        d.clearanceRef,
        d.status,
      ])
    );

    setFeedback({
      type: 'success',
      message: `Exported ${dispatches.length} dispatch consignments to CSV.`,
    });
  };

  const handleOpenChallanPdf = (d: DispatchRecord) => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Production',
      'Sales',
      'Finance',
    ]);
    if (!authCheck.allowed) {
      setFeedback({ type: 'error', message: authCheck.reason || 'Export restricted' });
      return;
    }
    const linkedOrder = salesOrders.find(
      (o) => o.jobNumber === d.jobNumber || o.poNumber === d.orderNo
    );
    const payload = buildDispatchChallanPdfPayload(d, linkedOrder, currentUser, activeRbacGroup);
    setPreviewPayload(payload);
  };

  const handleRecordDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!canWriteDispatch) {
      setFeedback({
        type: 'error',
        message:
          currentUser.accountStatus !== 'active'
            ? `RBAC Policy: Account '${currentUser.email}' is ${currentUser.accountStatus}. Only active accounts can record outward dispatches.`
            : `RBAC Policy: Role '${currentUser.role}' (${activeRbacGroup}) cannot record outward dispatches. Switch to Super Admin or Dispatch.`,
      });
      return;
    }

    if (!selectedOrder) return;
    if (shippedQtyInput <= 0) {
      setFeedback({
        type: 'error',
        message: 'Validation Error: Shipped quantity (PCS) must be greater than zero.',
      });
      return;
    }

    if (dispatchStatusInput !== 'ready_for_dispatch' && hasPreDispatchHold) {
      if (!canOverrideGate) {
        setFeedback({
          type: 'error',
          message: `Pre-Dispatch Clearance Gate Blocked: ${
            !isQcCleared ? 'QC/MTC not cleared. ' : ''
          }${!isTpiCleared ? 'TPI Witness IRN pending. ' : ''}${
            isCreditHold ? 'Customer on Finance Credit Hold (>90d overdue or limit exceeded). ' : ''
          }Only CEO or Super Admin can authorize an Executive Gate Override.`,
        });
        return;
      }
      if (executiveOverrideReason.trim().length < 5) {
        setFeedback({
          type: 'error',
          message:
            'Executive Override Reason Required: Provide an audit justification (min 5 chars) to override the Pre-Dispatch Hold.',
        });
        return;
      }
    }

    const lineItem = selectedOrder.lineItems?.[0];
    const prod = products.find((p) => p.id === lineItem?.productId) || products[0];
    const unitWeightKg = prod?.standardWeightKg || 28.5;
    const weightMt = Number(((shippedQtyInput * unitWeightKg) / 1000).toFixed(2));
    const orderedQty = (selectedOrder.lineItems || []).reduce((s, li) => s + li.orderedQty, 0);
    const currentShipped = selectedOrder.dispatchStatus.totalShippedQty || 0;

    if (dispatchStatusInput !== 'ready_for_dispatch' && currentShipped + shippedQtyInput > orderedQty) {
      setFeedback({
        type: 'error',
        message: `Dispatch Quantity Guard: Cumulative shipped (${currentShipped + shippedQtyInput} PCS) cannot exceed PO Ordered Quantity (${orderedQty} PCS).`,
      });
      return;
    }

    const newTotalShipped =
      dispatchStatusInput === 'ready_for_dispatch'
        ? currentShipped
        : currentShipped + shippedQtyInput;

    const newBalanceQty =
      dispatchStatusInput === 'ready_for_dispatch'
        ? selectedOrder.dispatchStatus.balanceQty
        : Math.max(0, orderedQty - newTotalShipped);

    const dspId = `DSP-2026-0${Math.floor(100 + Math.random() * 899)}`;
    const record: DispatchRecord = {
      id: dspId,
      orderNo: selectedOrder.poNumber,
      jobNumber: selectedOrder.jobNumber,
      customer: selectedOrder.customerName,
      product: lineItem?.productName || 'Forged Component',
      quantity: shippedQtyInput,
      balanceQty: newBalanceQty,
      weightMt,
      transporter: transporterInput.trim() || 'Assigned Transporter',
      vehicleNo: vehicleNoInput.trim() || 'MH-12-XX-0000',
      lrNumber: lrNumberInput.trim() || `LR-${dspId}`,
      destination: selectedOrder.dispatchStatus.destinationCity || 'Customer Works',
      date: new Date().toISOString().split('T')[0],
      invoiceRef: invoiceRefInput.trim() || '-',
      clearanceRef: selectedOrder.clearanceStatus.clearanceRefNo || '-',
      status: dispatchStatusInput,
    };

    const updatedOrder =
      dispatchStatusInput === 'ready_for_dispatch'
        ? selectedOrder
        : {
            ...selectedOrder,
            status: (newBalanceQty === 0 ? 'completed' : 'partially_dispatched') as typeof selectedOrder.status,
            statusLabel:
              newBalanceQty === 0
                ? 'Completed — All Consignments Dispatched'
                : `Partially Dispatched (${newTotalShipped}/${orderedQty} PCS)`,
            lineItems: (selectedOrder.lineItems || []).map((li, idx) =>
              idx === 0
                ? {
                    ...li,
                    dispatchedQty: newTotalShipped,
                    pendingQty: newBalanceQty,
                  }
                : li
            ),
            dispatchStatus: {
              ...selectedOrder.dispatchStatus,
              state: (newBalanceQty === 0 ? 'completed' : 'partial') as typeof selectedOrder.dispatchStatus.state,
              totalShippedQty: newTotalShipped,
              balanceQty: newBalanceQty,
              transporterName: record.transporter,
              vehicleNo: record.vehicleNo,
              lrNumber: record.lrNumber,
              dispatchDate: record.date,
            },
            ...(hasPreDispatchHold && canOverrideGate && executiveOverrideReason.trim()
              ? {
                  creditHoldOverrideBy: currentUser.name,
                  creditHoldOverrideReason: executiveOverrideReason.trim(),
                }
              : {}),
          };

    setSaving(true);
    setFeedback(null);
    const res = await recordDispatchRecord(record, updatedOrder);
    if (res.success) {
      setFeedback({
        type: 'success',
        message: res.persistedToFirestore
          ? `Saved atomically to Cloud Firestore (/dispatches/${record.id} & /salesOrders/${updatedOrder.id}): Recorded consignment ${record.id} (${record.quantity} PCS, ${record.weightMt} MT) via ${record.transporter} (LR: ${record.lrNumber}). Remaining PO balance: ${newBalanceQty} PCS.`
          : `[Demo Preview Mode] Recorded consignment ${record.id} (${record.quantity} PCS, ${record.weightMt} MT) via ${record.transporter} (LR: ${record.lrNumber}) and updated PO balance to ${newBalanceQty} PCS in session state.`,
      });
      setShowDispatchModal(false);
    } else {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to record dispatch',
      });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span>Logistics & Outward Gate</span>
            <span aria-hidden="true">·</span>
            <span>Finished Goods Dispatch</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-700">Dispatch & LR Register</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
            Dispatch Register & Logistics Tracking
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Gate pass issuances, transporter Lorry Receipt (LR) records, partial delivery balances, and delivery challans.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportDispatchExcel}
            className="px-3 py-2 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Export Dispatch Register (.xlsx)</span>
          </button>
          <button
            onClick={handleExportDispatchCsv}
            className="px-3 py-2 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-600" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => setShowDispatchModal(true)}
            className="px-3.5 py-2 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 rounded-md transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Record Dispatch / Gate-Out</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
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

      {/* Dispatches Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
              <tr>
                <th className="py-3 px-3.5">Dispatch Ref & Date</th>
                <th className="py-3 px-3.5">Customer & PO Reference</th>
                <th className="py-3 px-3.5">Product & Tonnage</th>
                <th className="py-3 px-3.5 text-right">Consignment Qty</th>
                <th className="py-3 px-3.5 text-right">PO Balance Qty</th>
                <th className="py-3 px-3.5">Transporter & Vehicle</th>
                <th className="py-3 px-3.5">LR / Consignment No.</th>
                <th className="py-3 px-3.5">Invoice Ref</th>
                <th className="py-3 px-3.5">Status</th>
                <th className="py-3 px-3.5 text-right">Challan PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dispatches.map((d) => {
                const linkedOrder = salesOrders.find(
                  (o) => o.jobNumber === d.jobNumber || o.poNumber === d.orderNo
                );
                const isNotYetShipped =
                  d.status === 'ready_for_dispatch' || d.status === 'pending';
                const hasBalanceMismatch =
                  linkedOrder !== undefined &&
                  isNotYetShipped &&
                  d.balanceQty === 0 &&
                  linkedOrder.dispatchStatus.balanceQty > 0;

                return (
                  <tr key={d.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-3.5">
                      <div className="font-mono font-bold text-slate-900">{d.id}</div>
                      <div className="text-slate-500 text-[11px] font-mono">{d.date}</div>
                    </td>
                    <td className="py-3 px-3.5">
                      <div className="font-semibold text-slate-900">{d.customer}</div>
                      <div className="font-mono text-slate-500 text-[11px]">{d.orderNo}</div>
                    </td>
                    <td className="py-3 px-3.5">
                      <div className="font-medium text-slate-800">{d.product}</div>
                      <div className="text-slate-500 text-[11px] font-mono">{d.weightMt} MT</div>
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold">
                      <span className={isNotYetShipped ? 'text-amber-700' : 'text-emerald-700'}>
                        {d.quantity} PCS
                      </span>
                      <div className="text-[10px] font-normal text-slate-500">
                        {isNotYetShipped ? 'Staged (Awaiting Pickup)' : 'Shipped'}
                      </div>
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono tabular-nums font-semibold">
                      <span className="text-rose-700">{d.balanceQty} PCS</span>
                      {hasBalanceMismatch && (
                        <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded mt-1 inline-flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>Order balance: {linkedOrder?.dispatchStatus.balanceQty} PCS</span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3.5">
                      <div className="font-semibold text-slate-900">{d.transporter}</div>
                      <div className="font-mono text-slate-500 text-[11px]">{d.vehicleNo}</div>
                    </td>
                    <td className="py-3 px-3.5 font-mono text-indigo-700 font-medium">
                      {d.lrNumber}
                    </td>
                    <td className="py-3 px-3.5 font-mono text-slate-700">{d.invoiceRef}</td>
                    <td className="py-3 px-3.5">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="py-3 px-3.5 text-right">
                      <button
                        onClick={() => handleOpenChallanPdf(d)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <FileText className="w-3 h-3 text-indigo-700" />
                        <span>Challan PDF</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Record Dispatch / Gate-Out Consignment Modal */}
      {showDispatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleRecordDispatch}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Record Outward Dispatch & Gate Pass
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Creates a consignment entry in <code>/dispatch</code> and updates cumulative shipped & balance quantities on the linked Customer PO.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDispatchModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Customer Purchase Order / Job
                </label>
                <select
                  value={selectedOrderId}
                  onChange={(e) => setSelectedOrderId(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-white"
                >
                  {salesOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.poNumber} ({o.jobNumber}) — {o.customerName} [Balance: {o.dispatchStatus.balanceQty} PCS]
                    </option>
                  ))}
                </select>
              </div>

              {/* Pre-Dispatch 3-Point Clearance Gate Banner */}
              <div
                className={`p-3 rounded-md border text-[11px] space-y-1.5 ${
                  hasPreDispatchHold
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-950'
                }`}
              >
                <div className="font-bold uppercase tracking-wider flex items-center justify-between">
                  <span>Pre-Dispatch 3-Point Clearance Gate</span>
                  <span>{hasPreDispatchHold ? 'HOLD DETECTED' : 'ALL GATES CLEARED'}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
                  <div className={isQcCleared ? 'text-emerald-800 font-bold' : 'text-rose-700 font-bold'}>
                    1. QC/MTC: {isQcCleared ? 'CLEARED' : 'PENDING'}
                  </div>
                  <div className={isTpiCleared ? 'text-emerald-800 font-bold' : 'text-rose-700 font-bold'}>
                    2. TPI IRN: {isTpiCleared ? 'CLEARED' : 'PENDING'}
                  </div>
                  <div className={!isCreditHold ? 'text-emerald-800 font-bold' : 'text-rose-700 font-bold'}>
                    3. Credit: {!isCreditHold ? 'OK' : 'CREDIT HOLD'}
                  </div>
                </div>
                {hasPreDispatchHold && canOverrideGate && (
                  <div className="pt-1.5 border-t border-amber-200">
                    <label className="font-bold text-amber-900 block mb-1">
                      Executive Gate-Out Override Justification (CEO / Super Admin Only):
                    </label>
                    <input
                      type="text"
                      value={executiveOverrideReason}
                      onChange={(e) => setExecutiveOverrideReason(e.target.value)}
                      placeholder="Enter mandatory audit justification to release consignment..."
                      className="w-full p-1.5 bg-white border border-amber-300 rounded text-slate-900"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Consignment Qty (PCS)
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={shippedQtyInput}
                    onChange={(e) => setShippedQtyInput(Number(e.target.value) || 1)}
                    className="w-full p-2 border border-slate-300 rounded font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Consignment Status
                  </label>
                  <select
                    value={dispatchStatusInput}
                    onChange={(e) => setDispatchStatusInput(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    <option value="in_transit">In Transit (Gate-Out Completed)</option>
                    <option value="completed">Delivered to Customer</option>
                    <option value="ready_for_dispatch">Staged at Loading Bay</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Transporter Name
                  </label>
                  <input
                    type="text"
                    required
                    value={transporterInput}
                    onChange={(e) => setTransporterInput(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Vehicle Registration No.
                  </label>
                  <input
                    type="text"
                    required
                    value={vehicleNoInput}
                    onChange={(e) => setVehicleNoInput(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Lorry Receipt (LR) No.
                  </label>
                  <input
                    type="text"
                    required
                    value={lrNumberInput}
                    onChange={(e) => setLrNumberInput(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Commercial Invoice Reference
                  </label>
                  <input
                    type="text"
                    required
                    value={invoiceRefInput}
                    onChange={(e) => setInvoiceRefInput(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setShowDispatchModal(false)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !canWriteDispatch}
                className="px-3.5 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                <span>{saving ? 'Recording Dispatch...' : 'Save Consignment & Update PO'}</span>
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
