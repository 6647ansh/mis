import React, { useState } from 'react';
import {
  Plus,
  ShoppingCart,
  CheckCircle2,
  ShieldAlert,
  AlertTriangle,
  Truck,
  Factory,
  FileSpreadsheet,
  FileText,
  Download,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import { PurchaseOrderRecord } from '../../types/mis';
import { StatusBadge } from '../common/StatusBadge';
import {
  MontexPdfDocumentPayload,
  buildMillPurchaseOrderPdfPayload,
  exportMontexExcelWorkbook,
  generateMontexPdfDocument,
  verifyExportPermission,
} from '../../services/documentExportService';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';

export const ProcurementView: React.FC = () => {
  const {
    rawMaterials,
    salesOrders,
    purchaseOrders,
    purchaseRequisitions,
    suppliers,
    activeRbacGroup,
    currentUser,
    createPurchaseOrderRecord,
    receivePurchaseOrderGrnRecord,
    createPurchaseRequisitionRecord,
    approvePurchaseRequisitionRecord,
  } = useRtdb();
  const [activeTab, setActiveTab] = useState<
    'purchase_orders' | 'purchase_requisitions' | 'shortage_indents' | 'suppliers'
  >('purchase_orders');
  const [previewPayload, setPreviewPayload] = useState<MontexPdfDocumentPayload | null>(null);

  const [showNewPoModal, setShowNewPoModal] = useState(false);
  const [receivingPo, setReceivingPo] = useState<PurchaseOrderRecord | null>(null);
  const [grnQtyMt, setGrnQtyMt] = useState<number>(12.0);
  const [grnHeatNumber, setGrnHeatNumber] = useState<string>('HEAT-KAL-2026-9104');
  const [grnDocRef, setGrnDocRef] = useState<string>('GRN/26-27/0540');

  // New Mill PO Form State
  const [selectedSupplierId, setSelectedSupplierId] = useState(suppliers[0]?.id || 'SUP-001');
  const [selectedMaterialId, setSelectedMaterialId] = useState(rawMaterials[0]?.id || 'RM-003');
  const [linkedJobNumber, setLinkedJobNumber] = useState('JOB-MF-2026-0435');
  const [orderedMt, setOrderedMt] = useState<number>(15.0);
  const [ratePerMt, setRatePerMt] = useState<number>(96000);
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('2026-10-30');
  const [showNewPrModal, setShowNewPrModal] = useState(false);
  const [prRequiredMt, setPrRequiredMt] = useState<number>(12.5);
  const [prEstimatedRate, setPrEstimatedRate] = useState<number>(96000);
  const [prJustification, setPrJustification] = useState<string>(
    'Urgent billet shortage against confirmed customer schedule.'
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const canWriteProcurement =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo', 'purchase', 'stores'].includes(currentUser.role);

  const criticalMaterials = rawMaterials.filter((m) => m.status === 'critical' || m.availableStockMt < m.reorderLevelMt);

  const checkExportAuth = () => {
    const check = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Production',
      'Finance',
      'Sales',
    ]);
    if (!check.allowed) {
      setFeedback({ type: 'error', message: check.error || 'Export restricted.' });
      return false;
    }
    return true;
  };

  const handleMillPoPdf = (po: PurchaseOrderRecord, action: 'preview' | 'download') => {
    if (!checkExportAuth()) return;
    const sup = suppliers.find((s) => s.id === po.supplierId);
    const payload = buildMillPurchaseOrderPdfPayload(
      po,
      sup,
      'mill_po',
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
          message: `Downloaded ${res.filename} (Internal Steel Mill Purchase Order Summary).`,
        });
      }
    }
  };

  const handleExportProcurementWorkbook = () => {
    if (!checkExportAuth()) return;
    const totalPoVal = purchaseOrders.reduce((s, p) => s + p.totalValue, 0);
    const totalOrdMt = purchaseOrders.reduce((s, p) => s + p.orderedMt, 0);
    const totalRecMt = purchaseOrders.reduce((s, p) => s + p.receivedMt, 0);
    const totalPendMt = purchaseOrders.reduce((s, p) => s + p.pendingMt, 0);

    const res = exportMontexExcelWorkbook(
      'Montex_Procurement_MillPOs_Suppliers_2026-10-22.xlsx',
      [
        {
          sheetName: 'Steel_Mill_POs',
          reportTitle: 'Internal Steel Mill Purchase Order Register',
          reportSubtitle: `${purchaseOrders.length} Active Mill POs | Total Value: INR ${totalPoVal.toLocaleString('en-IN')}`,
          headers: [
            'PO ID',
            'Mill PO Number',
            'PO Date',
            'Supplier Name',
            'Material Code',
            'Alloy / Steel Grade',
            'Section (mm)',
            'Linked Job No.',
            'Ordered (MT)',
            'Received via GRN (MT)',
            'Pending (MT)',
            'Rate per MT (INR)',
            'Total PO Value (INR)',
            'Expected Delivery Date',
            'Mill Heat Number',
            'Status',
          ],
          rows: purchaseOrders.map((po) => [
            po.id,
            po.poNumber,
            po.poDate,
            po.supplierName,
            po.materialCode,
            po.materialGrade,
            po.sectionMm,
            po.linkedJobNumber,
            po.orderedMt,
            po.receivedMt,
            po.pendingMt,
            po.ratePerMt,
            po.totalValue,
            po.expectedDeliveryDate,
            po.millHeatNumber,
            po.status,
          ]),
          totalsRow: [
            'TOTAL',
            `${purchaseOrders.length} POs`,
            '',
            '',
            '',
            '',
            '',
            '',
            Number(totalOrdMt.toFixed(2)),
            Number(totalRecMt.toFixed(2)),
            Number(totalPendMt.toFixed(2)),
            '',
            totalPoVal,
            '',
            '',
            '',
          ],
        },
        {
          sheetName: 'Material_Shortage_Indents',
          reportTitle: 'Raw Material Availability & Reorder Shortage Indents',
          reportSubtitle: 'Free Available Stock = Physical Stock (MT) - Reserved Job Stock (MT)',
          headers: [
            'Material Code',
            'Material Name',
            'Grade',
            'Dimensions (mm)',
            'Physical Stock (MT)',
            'Reserved for Jobs (MT)',
            'Free Available (MT)',
            'Minimum Stock (MT)',
            'Reorder Level (MT)',
            'Suggested Indent Qty (MT)',
            'Primary Supplier',
            'Yard Bay',
            'Status',
          ],
          rows: rawMaterials.map((m) => [
            m.code,
            m.name,
            m.grade,
            m.dimensionsMm,
            m.currentStockMt,
            m.reservedStockMt,
            m.availableStockMt,
            m.minimumStockMt,
            m.reorderLevelMt,
            Math.max(0, Number((m.reorderLevelMt - m.availableStockMt).toFixed(1))),
            m.supplier,
            m.locationBay,
            m.status,
          ]),
        },
        {
          sheetName: 'Approved_Steel_Mills',
          reportTitle: 'Approved Steel Mill Supplier Directory',
          reportSubtitle: `${suppliers.length} IBR / EIL / PED Qualified Mills`,
          headers: [
            'Supplier ID',
            'Mill Code',
            'Steel Mill Name',
            'Location',
            'Approved Grades',
            'Certifications',
            'Lead Time (Days)',
            'Credit Terms (Days)',
            'QA Rating (%)',
            'Contact Person',
            'Phone',
          ],
          rows: suppliers.map((s) => [
            s.id,
            s.code,
            s.name,
            s.location,
            s.approvedGrades.join('; '),
            s.certification,
            s.leadTimeDays,
            s.creditTermsDays,
            s.qualityRatingPercent,
            s.contactPerson,
            s.phone,
          ]),
        },
      ],
      currentUser.name
    );

    if (res.success) {
      setFeedback({
        type: 'success',
        message: `Exported 3-sheet Procurement Excel workbook (${res.filename}: Steel_Mill_POs, Material_Shortage_Indents, Approved_Steel_Mills).`,
      });
    } else {
      setFeedback({ type: 'error', message: res.error || 'Excel export failed.' });
    }
  };

  const handleExportSuppliersOnlyExcel = () => {
    if (!checkExportAuth()) return;
    const res = exportMontexExcelWorkbook(
      'Montex_Approved_Steel_Mill_Suppliers_2026-10-22.xlsx',
      [
        {
          sheetName: 'Supplier_Register',
          reportTitle: 'Approved Steel Mill Vendor Directory',
          reportSubtitle: `${suppliers.length} Approved Raw Material Suppliers`,
          headers: [
            'Supplier ID',
            'Vendor Code',
            'Mill Name',
            'Location',
            'Approved Forging Grades',
            'Statutory & Quality Certifications',
            'Standard Lead Time (Days)',
            'Credit Terms (Days)',
            'Quality Rating (%)',
            'Contact Person',
            'Phone',
          ],
          rows: suppliers.map((s) => [
            s.id,
            s.code,
            s.name,
            s.location,
            s.approvedGrades.join(', '),
            s.certification,
            s.leadTimeDays,
            s.creditTermsDays,
            s.qualityRatingPercent,
            s.contactPerson,
            s.phone,
          ]),
        },
      ],
      currentUser.name
    );

    if (res.success) {
      setFeedback({
        type: 'success',
        message: `Exported Approved Steel Mill Supplier Register: ${res.filename}`,
      });
    }
  };

  const handleCreateMillPo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!canWriteProcurement) {
      setFeedback({
        type: 'error',
        message:
          currentUser.accountStatus !== 'active'
            ? `Access Restricted: Account '${currentUser.email}' is ${currentUser.accountStatus}. Only active accounts can issue Steel Mill Purchase Orders.`
            : `Access Restricted: Role '${currentUser.role}' (${activeRbacGroup}) cannot issue Steel Mill Purchase Orders. Switch to Super Admin or Purchase.`,
      });
      return;
    }
    if (orderedMt <= 0 || ratePerMt <= 0) {
      setFeedback({
        type: 'error',
        message: 'Ordered tonnage (MT) and rate per MT must be greater than zero.',
      });
      return;
    }

    const sup = suppliers.find((s) => s.id === selectedSupplierId) || suppliers[0];
    const mat = rawMaterials.find((m) => m.id === selectedMaterialId) || rawMaterials[0];
    const poId = `PO-MILL-2026-0${Math.floor(85 + Math.random() * 90)}`;
    const poNum = `MF/PUR/26-27/0${Math.floor(85 + Math.random() * 90)}`;

    const newPo: PurchaseOrderRecord = {
      id: poId,
      poNumber: poNum,
      poDate: new Date().toISOString().split('T')[0],
      supplierId: sup?.id || 'SUP-001',
      supplierName: sup?.name || 'Approved Steel Mill',
      materialId: mat?.id || 'RM-001',
      materialCode: mat?.code || 'RM-CS-A105-160',
      materialGrade: mat?.grade || 'ASTM A105',
      sectionMm: mat?.dimensionsMm || '160x160 RCS',
      linkedJobNumber,
      orderedMt,
      receivedMt: 0,
      pendingMt: orderedMt,
      ratePerMt,
      totalValue: Math.round(orderedMt * ratePerMt),
      expectedDeliveryDate,
      millHeatNumber: 'PENDING-MILL-CAST',
      status: 'issued',
    };

    setSaving(true);
    setFeedback(null);
    const res = await createPurchaseOrderRecord(newPo);
    setSaving(false);

    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to persist Steel Mill Purchase Order.',
      });
      return;
    }

    setShowNewPoModal(false);
    setFeedback({
      type: 'success',
      message: res.persistedToFirestore
        ? `Saved to Cloud Firestore (/purchaseOrders/${newPo.id}): Issued Steel Mill PO ${newPo.poNumber} (${newPo.orderedMt} MT of ${newPo.materialGrade}) to ${newPo.supplierName}.`
        : `[Demo Preview Mode] Issued Steel Mill PO ${newPo.poNumber} (${newPo.orderedMt} MT of ${newPo.materialGrade}) to ${newPo.supplierName} in session register.`,
    });
  };

  const handleReceiveMillGrn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receivingPo || saving) return;
    if (!canWriteProcurement) {
      setFeedback({
        type: 'error',
        message: `Access Restricted: Role '${currentUser.role}' (${currentUser.accountStatus}) cannot record Mill GRN receipts.`,
      });
      return;
    }
    if (grnQtyMt <= 0 || grnQtyMt > receivingPo.pendingMt) {
      setFeedback({
        type: 'error',
        message: `GRN quantity (${grnQtyMt} MT) must be between 0.1 MT and pending PO balance (${receivingPo.pendingMt} MT).`,
      });
      return;
    }

    const material = rawMaterials.find((m) => m.id === receivingPo.materialId);
    if (!material) return;

    setSaving(true);
    setFeedback(null);

    const res = await receivePurchaseOrderGrnRecord({
      po: receivingPo,
      material,
      receiptQtyMt: grnQtyMt,
      heatNumber: grnHeatNumber.trim() || receivingPo.millHeatNumber,
      grnNumber: grnDocRef.trim(),
    });

    setSaving(false);

    if (!res.success) {
      setFeedback({
        type: 'error',
        message: `GRN Receipt Blocked: ${res.error || 'Could not record Mill GRN receipt.'}`,
      });
      return;
    }

    setReceivingPo(null);
    setFeedback({
      type: 'success',
      message: res.persistedToFirestore
        ? `Saved atomically to Cloud Firestore (/purchaseOrders/${receivingPo.id}, /rawMaterials/${material.id} & /stockMovements): Recorded Mill GRN ${grnDocRef} (+${grnQtyMt} MT of ${receivingPo.materialGrade}, Heat ${grnHeatNumber}) against ${receivingPo.poNumber}.`
        : `[Demo Preview Mode] Recorded Mill GRN ${grnDocRef} (+${grnQtyMt} MT of ${receivingPo.materialGrade}, Heat ${grnHeatNumber}) against ${receivingPo.poNumber} and updated yard stock in session state.`,
    });
  };

  return (
    <div className="space-y-6 text-xs">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-slate-500 mb-1">
            <span>Supply Chain & Procurement</span>
            <span aria-hidden="true">·</span>
            <span>Steel Mills & Billet Indents</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-700">Procurement Desk</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
            Purchase Orders, Steel Mills & Material Availability
          </h1>
          <p className="text-slate-500 mt-0.5">
            Billet procurement against job shortages, approved IBR/EIL steel mill suppliers, Mill PO PDF summaries, and direct GRN receipt into yard stock.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportProcurementWorkbook}
            className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 rounded-md font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Export POs &amp; Shortages (.xlsx)</span>
          </button>
          <button
            onClick={handleExportSuppliersOnlyExcel}
            className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-indigo-700" />
            <span>Supplier Register (.xlsx)</span>
          </button>
          <button
            onClick={() => setShowNewPrModal(true)}
            className="px-3 py-2 text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-amber-700" />
            <span>Raise Purchase Requisition (PR)</span>
          </button>
          <button
            onClick={() => setShowNewPoModal(true)}
            className="px-3.5 py-2 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 rounded-md transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Issue Steel Mill PO</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-slate-200">
          <span className="text-slate-500 block">Open Steel Mill POs</span>
          <span className="text-lg font-bold font-mono text-slate-900 mt-0.5 block">
            {purchaseOrders.filter((p) => p.status !== 'completed').length} Active POs
          </span>
          <span className="text-[11px] text-slate-500">
            {purchaseOrders.reduce((acc, p) => acc + p.pendingMt, 0).toFixed(1)} MT In-Transit / Rolling
          </span>
        </div>
        <div className="bg-white p-4 rounded-lg border border-slate-200">
          <span className="text-slate-500 block">Grades Below Minimum Stock</span>
          <span className="text-lg font-bold font-mono text-rose-700 mt-0.5 block">
            {rawMaterials.filter((m) => m.status === 'critical').length} Grades
          </span>
          <span className="text-[11px] text-slate-500">Based on Free Available Stock (MT)</span>
        </div>
        <div className="bg-white p-4 rounded-lg border border-slate-200">
          <span className="text-slate-500 block">Blocked Sales Orders</span>
          <span className="text-lg font-bold font-mono text-amber-700 mt-0.5 block">
            {salesOrders.filter((o) => o.materialStatus.state === 'shortage').length} Job (Thermax)
          </span>
          <span className="text-[11px] text-slate-500">12.3 MT 42CrMo4 Deficit</span>
        </div>
        <div className="bg-white p-4 rounded-lg border border-slate-200">
          <span className="text-slate-500 block">Approved Steel Mills</span>
          <span className="text-lg font-bold font-mono text-slate-900 mt-0.5 block">
            {suppliers.length} Mills
          </span>
          <span className="text-[11px] text-slate-500">IBR, EIL & PED Qualified</span>
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

      {/* Sub-tabs */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          onClick={() => setActiveTab('purchase_orders')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'purchase_orders'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Steel Mill Purchase Orders ({purchaseOrders.length})
        </button>
        <button
          onClick={() => setActiveTab('purchase_requisitions')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'purchase_requisitions'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Purchase Requisitions &amp; Approvals ({purchaseRequisitions.length})
        </button>
        <button
          onClick={() => setActiveTab('shortage_indents')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'shortage_indents'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Material Availability &amp; Shortage Indents ({criticalMaterials.length})
        </button>
        <button
          onClick={() => setActiveTab('suppliers')}
          className={`py-2 px-4 font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'suppliers'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Approved Steel Mill Vendors ({suppliers.length})
        </button>
      </div>

      {/* TAB 1: PURCHASE ORDERS */}
      {activeTab === 'purchase_orders' && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-3.5">Mill PO # & Date</th>
                  <th className="py-3 px-3.5">Steel Mill Supplier</th>
                  <th className="py-3 px-3.5">Grade & Section</th>
                  <th className="py-3 px-3.5">Linked Job / Purpose</th>
                  <th className="py-3 px-3.5 text-right">Ord / Rec / Pend (MT)</th>
                  <th className="py-3 px-3.5 text-right">PO Value</th>
                  <th className="py-3 px-3.5">Expected Delivery</th>
                  <th className="py-3 px-3.5">Status</th>
                  <th className="py-3 px-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {purchaseOrders.map((po) => (
                  <tr key={po.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-3.5">
                      <div className="font-mono font-bold text-slate-900">{po.poNumber}</div>
                      <div className="font-mono text-[11px] text-slate-500">{po.poDate}</div>
                    </td>
                    <td className="py-3 px-3.5">
                      <div className="font-bold text-slate-900">{po.supplierName}</div>
                      <div className="font-mono text-[11px] text-slate-500">Heat: {po.millHeatNumber}</div>
                    </td>
                    <td className="py-3 px-3.5">
                      <div className="font-semibold text-indigo-700">{po.materialGrade}</div>
                      <div className="text-[11px] text-slate-500">{po.sectionMm}</div>
                    </td>
                    <td className="py-3 px-3.5 font-mono text-slate-800">{po.linkedJobNumber}</td>
                    <td className="py-3 px-3.5 text-right font-mono tabular-nums">
                      <span className="font-bold text-slate-900">{po.orderedMt}</span>
                      <span className="text-slate-400"> / </span>
                      <span className="text-emerald-700 font-semibold">{po.receivedMt}</span>
                      <span className="text-slate-400"> / </span>
                      <span className="text-rose-700 font-bold">{po.pendingMt} MT</span>
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-slate-900">
                      ₹{(po.totalValue / 100000).toFixed(2)}L
                    </td>
                    <td className="py-3 px-3.5 font-mono text-slate-700">{po.expectedDeliveryDate}</td>
                    <td className="py-3 px-3.5">
                      <StatusBadge
                        status={
                          po.status === 'completed'
                            ? 'completed'
                            : po.status === 'partially_received'
                            ? 'warning'
                            : 'in_progress'
                        }
                        label={po.status.replace('_', ' ').toUpperCase()}
                      />
                    </td>
                    <td className="py-3 px-3.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => handleMillPoPdf(po, 'preview')}
                          className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                          title="Preview / Print Internal Steel Mill PO Summary"
                        >
                          <FileText className="w-3 h-3" />
                          <span>PO PDF</span>
                        </button>
                        {po.pendingMt > 0 ? (
                          <button
                            onClick={() => {
                              setReceivingPo(po);
                              setGrnQtyMt(po.pendingMt);
                              setGrnHeatNumber(po.millHeatNumber);
                            }}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Truck className="w-3 h-3" />
                            <span>Receive GRN</span>
                          </button>
                        ) : (
                          <span className="text-[11px] font-mono text-emerald-700 font-semibold px-1.5">
                            Full GRN Posted
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: SHORTAGE INDENTS */}
      {activeTab === 'shortage_indents' && (
        <div className="space-y-4">
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-950 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Job-Linked Material Availability & Reorder Indents</span>
              </div>
              <p className="text-amber-900 leading-relaxed">
                Free Available Stock is calculated as <code className="font-mono">Physical Stock (MT) - Reserved Job Stock (MT)</code>. Any grade where Free Available Stock falls below Minimum Stock is flagged for immediate mill replenishment.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Material Code & Grade</th>
                    <th className="py-3 px-3.5 text-right">Physical Stock</th>
                    <th className="py-3 px-3.5 text-right">Reserved for Jobs</th>
                    <th className="py-3 px-3.5 text-right">Free Available</th>
                    <th className="py-3 px-3.5 text-right">Min / Reorder Level</th>
                    <th className="py-3 px-3.5 text-right">Suggested Indent Qty</th>
                    <th className="py-3 px-3.5">Primary Mill</th>
                    <th className="py-3 px-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rawMaterials.map((m) => {
                    const suggestedIndentMt = Math.max(
                      0,
                      Number((m.reorderLevelMt - m.availableStockMt).toFixed(1))
                    );
                    return (
                      <tr key={m.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-3.5">
                          <div className="font-bold text-slate-900">{m.name}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {m.code} · {m.grade} ({m.dimensionsMm})
                          </div>
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono font-semibold text-slate-900">
                          {m.currentStockMt.toFixed(1)} MT
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono text-slate-700">
                          {m.reservedStockMt.toFixed(1)} MT
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono font-bold text-rose-700">
                          {m.availableStockMt.toFixed(1)} MT
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono text-slate-600">
                          {m.minimumStockMt} / {m.reorderLevelMt} MT
                        </td>
                        <td className="py-3 px-3.5 text-right font-mono font-bold text-indigo-700">
                          +{suggestedIndentMt.toFixed(1)} MT
                        </td>
                        <td className="py-3 px-3.5 text-slate-700">{m.supplier}</td>
                        <td className="py-3 px-3.5 text-right">
                          <button
                            onClick={() => {
                              setSelectedMaterialId(m.id);
                              setOrderedMt(Math.max(10, suggestedIndentMt));
                              setRatePerMt(m.standardRatePerMt);
                              setShowNewPoModal(true);
                            }}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold text-[11px] cursor-pointer"
                          >
                            Raise Mill PO
                          </button>
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

      {/* TAB 3: APPROVED STEEL MILLS */}
      {activeTab === 'suppliers' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {suppliers.map((sup) => (
            <div key={sup.id} className="bg-white rounded-lg border border-slate-200 p-5 space-y-3">
              <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Factory className="w-4 h-4 text-slate-700" />
                    <h3 className="text-sm font-bold text-slate-900">{sup.name}</h3>
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 mt-0.5">
                    Code: {sup.code} · {sup.location}
                  </div>
                </div>
                <span className="font-mono font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-[11px]">
                  QA Rating: {sup.qualityRatingPercent}%
                </span>
              </div>

              <div className="space-y-1.5 text-slate-600">
                <div>
                  <strong className="text-slate-800">Approved Forging Grades:</strong>{' '}
                  {sup.approvedGrades.join(' · ')}
                </div>
                <div>
                  <strong className="text-slate-800">Mill Approvals:</strong> {sup.certification}
                </div>
                <div className="flex flex-wrap gap-4 pt-1 text-[11px] text-slate-500 font-mono">
                  <span>Lead Time: {sup.leadTimeDays} Days</span>
                  <span>·</span>
                  <span>Credit Terms: {sup.creditTermsDays} Days LC/Net</span>
                  <span>·</span>
                  <span>Contact: {sup.contactPerson}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB: PURCHASE REQUISITIONS & MAKER!=CHECKER APPROVAL */}
      {activeTab === 'purchase_requisitions' && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-lg bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="font-bold text-amber-400 uppercase tracking-wider text-[11px]">
                Maker ≠ Checker Procurement Governance (/purchaseRequisitions)
              </span>
              <p className="text-slate-300 text-[11px] mt-0.5">
                Stores / PPC / Purchase raises a Material Indent (PR). Commercial / Executive authority (CEO, Super Admin, Finance, or Purchase Head ≠ Requester) must approve before Mill PO issuance.
              </p>
            </div>
            <button
              onClick={() => setShowNewPrModal(true)}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded font-bold text-xs shrink-0 cursor-pointer"
            >
              + Raise Material Indent (PR)
            </button>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">PR Number &amp; Date</th>
                    <th className="py-3 px-3.5">Material &amp; Section</th>
                    <th className="py-3 px-3.5">Linked Job &amp; Supplier</th>
                    <th className="py-3 px-3.5 text-right">Req Qty &amp; Est. Value</th>
                    <th className="py-3 px-3.5">Requested By (Maker)</th>
                    <th className="py-3 px-3.5">Approval Status (Checker)</th>
                    <th className="py-3 px-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseRequisitions.map((pr) => (
                    <tr key={pr.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3.5 font-mono">
                        <div className="font-bold text-slate-900">{pr.prNumber}</div>
                        <div className="text-[11px] text-slate-500">{pr.requestDate}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-indigo-700">{pr.materialGrade}</div>
                        <div className="text-[11px] text-slate-500">{pr.sectionMm} ({pr.materialCode})</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-mono font-semibold text-slate-900">{pr.linkedJobNumber}</div>
                        <div className="text-[11px] text-slate-500">{pr.suggestedSupplierName}</div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono">
                        <div className="font-bold text-slate-900">{pr.requiredMt} MT</div>
                        <div className="text-[11px] text-slate-500">
                          ₹{(pr.estimatedTotalInr / 100000).toFixed(2)}L (@₹{pr.estimatedRatePerMt.toLocaleString()}/MT)
                        </div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-semibold text-slate-800">{pr.requestedByName}</div>
                        <div className="text-[11px] text-slate-500 uppercase font-mono">{pr.requestedByRole}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <StatusBadge
                          status={
                            pr.status === 'approved' || pr.status === 'converted_to_po'
                              ? 'approved'
                              : pr.status === 'rejected'
                              ? 'rejected'
                              : 'pending'
                          }
                          label={pr.status.replace(/_/g, ' ').toUpperCase()}
                        />
                        {pr.approvedByName && (
                          <div className="text-[10px] text-emerald-700 font-semibold mt-1">
                            By {pr.approvedByName}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-right space-x-1.5 whitespace-nowrap">
                        {pr.status === 'pending_approval' && (
                          <>
                            <button
                              onClick={async () => {
                                const res = await approvePurchaseRequisitionRecord(
                                  pr,
                                  true,
                                  'Approved after verifying yard stock shortage and customer PO schedule.'
                                );
                                setFeedback({
                                  type: res.success ? 'success' : 'error',
                                  message: res.success
                                    ? `PR ${pr.prNumber} Approved under Maker≠Checker control.`
                                    : res.error || 'PR Approval blocked.',
                                });
                              }}
                              className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded font-semibold text-[11px] cursor-pointer"
                            >
                              Approve PR
                            </button>
                            <button
                              onClick={async () => {
                                const res = await approvePurchaseRequisitionRecord(
                                  pr,
                                  false,
                                  'Returned for alternate stock check.'
                                );
                                setFeedback({
                                  type: res.success ? 'success' : 'error',
                                  message: res.success
                                    ? `PR ${pr.prNumber} Rejected.`
                                    : res.error || 'PR Rejection blocked.',
                                });
                              }}
                              className="px-2 py-1 bg-rose-100 hover:bg-rose-200 text-rose-800 rounded font-semibold text-[11px] cursor-pointer"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {pr.status === 'approved' && (
                          <button
                            onClick={() => {
                              setSelectedMaterialId(pr.materialId || 'RM-001');
                              setSelectedSupplierId(pr.suggestedSupplierId || 'SUP-001');
                              setLinkedJobNumber(pr.linkedJobNumber);
                              setOrderedMt(pr.requiredMt ?? pr.requiredQtyMt ?? 10);
                              setRatePerMt(pr.estimatedRatePerMt);
                              setShowNewPoModal(true);
                            }}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold text-[11px] cursor-pointer"
                          >
                            Convert to Mill PO
                          </button>
                        )}
                        {pr.convertedPoId && (
                          <span className="font-mono text-[11px] text-indigo-700 font-semibold">
                            PO: {pr.convertedPoId}
                          </span>
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

      {/* MODAL: RAISE PURCHASE REQUISITION (PR) */}
      {showNewPrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const mat = rawMaterials.find((m) => m.id === selectedMaterialId) || rawMaterials[0];
              const sup = suppliers.find((s) => s.id === selectedSupplierId) || suppliers[0];
              const prId = `PR-2026-0${Math.floor(110 + Math.random() * 880)}`;
              const res = await createPurchaseRequisitionRecord({
                id: prId,
                prNumber: `MF/PR/26-27/${prId.slice(-4)}`,
                requestDate: new Date().toISOString().split('T')[0],
                requestedByUid: currentUser.id,
                requestedByName: currentUser.name,
                requestedByRole: currentUser.role,
                materialId: mat?.id || 'RM-001',
                materialCode: mat?.code || 'RM-CS-A105',
                materialGrade: mat?.grade || 'ASTM A105',
                sectionMm: mat?.dimensionsMm || '160x160 RCS',
                linkedJobNumber,
                requiredMt: prRequiredMt,
                estimatedRatePerMt: prEstimatedRate,
                estimatedTotalInr: Math.round(prRequiredMt * prEstimatedRate),
                suggestedSupplierId: sup?.id || 'SUP-001',
                suggestedSupplierName: sup?.name || 'Approved Steel Mill',
                urgency: 'urgent',
                justification: prJustification,
                status: 'pending_approval',
              });
              setShowNewPrModal(false);
              setFeedback({
                type: res.success ? 'success' : 'error',
                message: res.success
                  ? `Raised Purchase Requisition ${prId} for ${prRequiredMt} MT of ${mat?.grade}. Awaiting Maker≠Checker approval.`
                  : res.error || 'Failed to raise Purchase Requisition.',
              });
            }}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-md w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Raise Material Purchase Requisition (PR)
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Requires independent Maker≠Checker approval before Mill PO release.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewPrModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Raw Material Grade</label>
                <select
                  value={selectedMaterialId}
                  onChange={(e) => setSelectedMaterialId(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-white"
                >
                  {rawMaterials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.grade} · Free: {m.availableStockMt} MT)
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Required Qty (MT)</label>
                  <input
                    type="number"
                    step="0.5"
                    required
                    value={prRequiredMt}
                    onChange={(e) => setPrRequiredMt(Number(e.target.value) || 1)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Est. Rate/MT (₹)</label>
                  <input
                    type="number"
                    required
                    value={prEstimatedRate}
                    onChange={(e) => setPrEstimatedRate(Number(e.target.value) || 90000)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Linked Job Number</label>
                <input
                  type="text"
                  required
                  value={linkedJobNumber}
                  onChange={(e) => setLinkedJobNumber(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded font-mono"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Shortage Justification</label>
                <textarea
                  rows={2}
                  required
                  value={prJustification}
                  onChange={(e) => setPrJustification(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setShowNewPrModal(false)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 bg-slate-900 text-white rounded font-semibold cursor-pointer"
              >
                Submit PR for Approval
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: ISSUE STEEL MILL PO */}
      {showNewPoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleCreateMillPo}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-slate-700" />
                  <span>Issue Steel Mill Purchase Order</span>
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Procure forging billets or ingots from an approved steel mill vendor.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewPoModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Approved Steel Mill Vendor</label>
                <select
                  value={selectedSupplierId}
                  onChange={(e) => setSelectedSupplierId(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-white"
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.location})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Raw Material Grade & Section</label>
                <select
                  value={selectedMaterialId}
                  onChange={(e) => {
                    setSelectedMaterialId(e.target.value);
                    const mat = rawMaterials.find((m) => m.id === e.target.value);
                    if (mat) setRatePerMt(mat.standardRatePerMt);
                  }}
                  className="w-full p-2 border border-slate-300 rounded bg-white"
                >
                  {rawMaterials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {m.dimensionsMm} (Avail: {m.availableStockMt} MT)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Linked Job # / Indent</label>
                  <input
                    type="text"
                    required
                    value={linkedJobNumber}
                    onChange={(e) => setLinkedJobNumber(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Expected Mill Delivery</label>
                  <input
                    type="date"
                    required
                    value={expectedDeliveryDate}
                    onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Ordered Quantity (MT)</label>
                  <input
                    type="number"
                    step="0.5"
                    min={1}
                    required
                    value={orderedMt}
                    onChange={(e) => setOrderedMt(Number(e.target.value) || 1)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Mill Rate per MT (₹)</label>
                  <input
                    type="number"
                    min={1000}
                    required
                    value={ratePerMt}
                    onChange={(e) => setRatePerMt(Number(e.target.value) || 65000)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t">
              <div className="font-mono text-slate-600">
                Total Mill PO Value:{' '}
                <strong className="text-slate-900">
                  ₹{((orderedMt * ratePerMt) / 100000).toFixed(2)} Lakhs
                </strong>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewPoModal(false)}
                  className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 cursor-pointer"
                >
                  Issue Purchase Order
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: RECEIVE MILL GRN INTO RTDB INVENTORY */}
      {receivingPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleReceiveMillGrn}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-md w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Post Steel Mill GRN Receipt ({receivingPo.poNumber})
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Updates yard balance in <code className="font-mono">/inventory/rawMaterials</code> and appends heat movement to <code className="font-mono">/inventory/stockMovements</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReceivingPo(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded space-y-1">
                <div className="font-bold text-slate-900">{receivingPo.supplierName}</div>
                <div className="font-mono text-slate-600">
                  Grade: {receivingPo.materialGrade} · Pending Balance: {receivingPo.pendingMt} MT
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Received Tonnage (MT)</label>
                <input
                  type="number"
                  step="0.1"
                  min={0.1}
                  max={receivingPo.pendingMt}
                  required
                  value={grnQtyMt}
                  onChange={(e) => setGrnQtyMt(Number(e.target.value) || 0)}
                  className="w-full p-2 border border-slate-300 rounded font-mono font-bold"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Mill Cast / Heat Number</label>
                <input
                  type="text"
                  required
                  value={grnHeatNumber}
                  onChange={(e) => setGrnHeatNumber(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded font-mono"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">Weighbridge / GRN Voucher No.</label>
                <input
                  type="text"
                  required
                  value={grnDocRef}
                  onChange={(e) => setGrnDocRef(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setReceivingPo(null)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Posting GRN to RTDB...' : 'Post GRN & Update Stock'}
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
