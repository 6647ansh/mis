import React, { useState } from 'react';
import { StatusBadge } from '../common/StatusBadge';
import { AlertBanner } from '../common/AlertBanner';
import {
  Plus,
  Search,
  ShieldCheck,
  Database,
  CheckCircle2,
  ShieldAlert,
  FileSpreadsheet,
  FileText,
  Download,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import { StockMovement } from '../../types/mis';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
import {
  buildStockMovementGrnPdfPayload,
  exportMontexCsvFile,
  exportMontexExcelWorkbook,
  MontexPdfDocumentPayload,
  verifyExportPermission,
} from '../../services/documentExportService';

export const InventoryView: React.FC = () => {
  const {
    rawMaterials,
    stockMovements,
    purchaseOrders,
    activeRbacGroup,
    dataSource,
    currentUser,
    recordStockMovementRecord,
  } = useRtdb();

  const [activeTab, setActiveTab] = useState<'balances' | 'movements'>('balances');
  const [searchTerm, setSearchTerm] = useState('');
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<MontexPdfDocumentPayload | null>(null);

  // Stock Movement Form State
  const [selectedMaterialId, setSelectedMaterialId] = useState(rawMaterials[0]?.id || 'RM-001');
  const [movementType, setMovementType] = useState<StockMovement['movementType']>('Receipt (GRN)');
  const [heatNumber, setHeatNumber] = useState('HEAT-JSW-9012-B');
  const [quantityDeltaMt, setQuantityDeltaMt] = useState<number>(12.5);
  const [referenceDoc, setReferenceDoc] = useState('GRN/26-27/0512');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const canWriteInventory =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo', 'stores'].includes(currentUser.role);

  const filteredMaterials = rawMaterials.filter(
    (m) =>
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.grade.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleRecordMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!canWriteInventory) {
      setFeedback({
        type: 'error',
        message:
          currentUser.accountStatus !== 'active'
            ? `RBAC Policy: Account '${currentUser.email}' is ${currentUser.accountStatus}. Only active accounts can record stock movements.`
            : `RBAC Policy: Role '${currentUser.role}' (${activeRbacGroup}) cannot record stock movements. Switch to Super Admin or Stores.`,
      });
      return;
    }

    const material = rawMaterials.find((m) => m.id === selectedMaterialId) || rawMaterials[0];
    if (!material) return;

    const signedDelta =
      movementType === 'Production Issue'
        ? -Math.abs(quantityDeltaMt)
        : Math.abs(quantityDeltaMt);

    const newStockMt = Number((material.currentStockMt + signedDelta).toFixed(2));
    if (newStockMt < 0) {
      setFeedback({
        type: 'error',
        message: `Inventory Invariant Violation: Cannot issue ${Math.abs(
          signedDelta
        )} MT from ${material.grade} (Current stock: ${material.currentStockMt} MT). Non-negative stock rule enforced.`,
      });
      return;
    }

    if (newStockMt < material.reservedStockMt) {
      setFeedback({
        type: 'error',
        message: `Reserved Stock Invariant Violation: Cannot issue ${Math.abs(
          signedDelta
        )} MT from ${material.grade} because ${material.reservedStockMt} MT is reserved for active jobs (Free available: ${material.availableStockMt} MT).`,
      });
      return;
    }

    setSaving(true);
    setFeedback(null);

    const res = await recordStockMovementRecord({
      material,
      quantityDeltaMt: signedDelta,
      movementType,
      heatNumber: heatNumber.trim() || 'HEAT-UNSPECIFIED',
      referenceDoc: referenceDoc.trim() || 'MANUAL-ENTRY',
    });

    if (res.success) {
      setFeedback({
        type: 'success',
        message: res.persistedToFirestore
          ? `Recorded ${movementType} (${
              signedDelta > 0 ? `+${signedDelta}` : signedDelta
            } MT) for ${material.grade} atomically in Cloud Firestore (/rawMaterials & /stockMovements).`
          : `[Demo Preview Mode] Recorded ${movementType} (${
              signedDelta > 0 ? `+${signedDelta}` : signedDelta
            } MT) for ${material.grade} in session state.`,
      });
      setShowMovementModal(false);
    } else {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to record stock movement',
      });
    }
    setSaving(false);
  };

  const handleExportInventoryWorkbook = () => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Production',
      'Finance',
      'Sales',
    ]);
    if (!authCheck.allowed) {
      setFeedback({ type: 'error', message: authCheck.reason || 'Export restricted' });
      return;
    }

    exportMontexExcelWorkbook(
      `Montex_Raw_Material_Stock_Ledger_${new Date().toISOString().split('T')[0]}.xlsx`,
      [
        {
          sheetName: 'Material_Balances_Shortages',
          reportTitle: 'MONTEX FORGE — RAW MATERIAL YARD STOCK BALANCES & SHORTAGE THRESHOLDS',
          reportSubtitle: `Filter: "${searchTerm || 'All Materials'}" | Exported by ${currentUser.name} (${activeRbacGroup})`,
          metadataRows: [
            ['Total Grades Shown', filteredMaterials.length],
            [
              'Critical Shortages (Available < Min)',
              filteredMaterials.filter((m) => m.status === 'critical').length,
            ],
            [
              'Total Physical Stock (MT)',
              Number(filteredMaterials.reduce((s, m) => s + m.currentStockMt, 0).toFixed(2)),
            ],
          ],
          headers: [
            'Material ID',
            'Material Code',
            'Name',
            'Grade',
            'Dimensions',
            'Physical Stock (MT)',
            'Reserved Jobs (MT)',
            'Free Available (MT)',
            'Min Stock (MT)',
            'Reorder Level (MT)',
            'Shortage vs Min (MT)',
            'Supplier',
            'Yard Bay',
            'Computed Status',
          ],
          rows: filteredMaterials.map((m) => [
            m.id,
            m.code,
            m.name,
            m.grade,
            m.dimensionsMm,
            m.currentStockMt,
            m.reservedStockMt,
            m.availableStockMt,
            m.minimumStockMt,
            m.reorderLevelMt,
            Number(Math.max(0, m.minimumStockMt - m.availableStockMt).toFixed(2)),
            m.supplier,
            m.locationBay,
            m.status.toUpperCase(),
          ]),
          totalsRow: [
            'TOTAL',
            '',
            `${filteredMaterials.length} Grades`,
            '',
            '',
            Number(filteredMaterials.reduce((s, m) => s + m.currentStockMt, 0).toFixed(2)),
            Number(filteredMaterials.reduce((s, m) => s + m.reservedStockMt, 0).toFixed(2)),
            Number(filteredMaterials.reduce((s, m) => s + m.availableStockMt, 0).toFixed(2)),
            Number(filteredMaterials.reduce((s, m) => s + m.minimumStockMt, 0).toFixed(2)),
            Number(filteredMaterials.reduce((s, m) => s + m.reorderLevelMt, 0).toFixed(2)),
            Number(
              filteredMaterials
                .reduce((s, m) => s + Math.max(0, m.minimumStockMt - m.availableStockMt), 0)
                .toFixed(2)
            ),
            '',
            '',
            '',
          ],
        },
        {
          sheetName: 'Stock_Movement_Ledger',
          reportTitle: 'MONTEX FORGE — DOUBLE-ENTRY STOCK MOVEMENT LEDGER (GRN & PRODUCTION ISSUES)',
          reportSubtitle: `Total Recorded Movements: ${stockMovements.length}`,
          headers: [
            'Movement ID',
            'Timestamp',
            'Material ID',
            'Material Grade',
            'Mill Heat Number',
            'Movement Type',
            'Delta Quantity (MT)',
            'Balance After (MT)',
            'Reference Document (GRN/Job)',
            'Performed By',
          ],
          rows: stockMovements.map((mov) => [
            mov.id,
            mov.timestamp,
            mov.materialCode,
            mov.materialGrade,
            mov.heatNumber,
            mov.movementType,
            mov.quantityMt,
            mov.balanceAfterMt,
            mov.referenceDoc,
            mov.performedBy,
          ]),
        },
      ]
    );

    setFeedback({
      type: 'success',
      message: `Downloaded 2-sheet Excel workbook (Material_Balances_Shortages & Stock_Movement_Ledger).`,
    });
  };

  const handleExportActiveTabCsv = () => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Production',
      'Finance',
      'Sales',
    ]);
    if (!authCheck.allowed) {
      setFeedback({ type: 'error', message: authCheck.reason || 'Export restricted' });
      return;
    }

    if (activeTab === 'balances') {
      exportMontexCsvFile(
        `Montex_Raw_Material_Balances_${new Date().toISOString().split('T')[0]}.csv`,
        [
          'Material Code',
          'Name',
          'Grade',
          'Dimensions',
          'Physical Stock (MT)',
          'Reserved (MT)',
          'Free Available (MT)',
          'Min Stock (MT)',
          'Reorder Level (MT)',
          'Supplier',
          'Yard Bay',
          'Status',
        ],
        filteredMaterials.map((m) => [
          m.code,
          m.name,
          m.grade,
          m.dimensionsMm,
          m.currentStockMt,
          m.reservedStockMt,
          m.availableStockMt,
          m.minimumStockMt,
          m.reorderLevelMt,
          m.supplier,
          m.locationBay,
          m.status,
        ])
      );
      setFeedback({
        type: 'success',
        message: `Exported ${filteredMaterials.length} raw material balance records to CSV.`,
      });
    } else {
      exportMontexCsvFile(
        `Montex_Stock_Movements_${new Date().toISOString().split('T')[0]}.csv`,
        [
          'Movement ID',
          'Timestamp',
          'Material Grade',
          'Heat Number',
          'Movement Type',
          'Delta Qty (MT)',
          'Balance After (MT)',
          'Reference Document',
          'Performed By',
        ],
        stockMovements.map((mov) => [
          mov.id,
          mov.timestamp,
          mov.materialGrade,
          mov.heatNumber,
          mov.movementType,
          mov.quantityMt,
          mov.balanceAfterMt,
          mov.referenceDoc,
          mov.performedBy,
        ])
      );
      setFeedback({
        type: 'success',
        message: `Exported ${stockMovements.length} stock movement ledger entries to CSV.`,
      });
    }
  };

  const handleOpenMovementPdf = (mov: StockMovement) => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Production',
      'Finance',
    ]);
    if (!authCheck.allowed) {
      setFeedback({ type: 'error', message: authCheck.reason || 'Export restricted' });
      return;
    }
    const material = rawMaterials.find(
      (m) => m.code === mov.materialCode || m.grade === mov.materialGrade
    );
    const linkedPo = purchaseOrders.find(
      (po) =>
        po.poNumber === mov.referenceDoc ||
        po.millHeatNumber === mov.heatNumber
    );
    const payload = buildStockMovementGrnPdfPayload(
      mov,
      material,
      linkedPo,
      currentUser,
      activeRbacGroup
    );
    setPreviewPayload(payload);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span>Stores & Yard Management</span>
            <span aria-hidden="true">·</span>
            <span>Raw Material Billet Yard</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-700">Stock Ledger</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
            Raw Material Inventory & Stock Ledger
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Traceable stock movements, steel mill heats, non-negative stock invariants, and job reservations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportInventoryWorkbook}
            className="px-3 py-2 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Export Stock & Shortages (.xlsx)</span>
          </button>
          <button
            onClick={handleExportActiveTabCsv}
            className="px-3 py-2 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-600" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => setShowMovementModal(true)}
            className="px-3.5 py-2 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 rounded-md transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Record Stock Movement</span>
          </button>
        </div>
      </div>

      {feedback && (
        <AlertBanner
          severity={feedback.type}
          title={feedback.type === 'success' ? 'Stock Movement Recorded' : 'Inventory Action Notice'}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-slate-200">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('balances')}
            className={`py-2 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'balances'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Material Balances & Thresholds ({rawMaterials.length})
          </button>
          <button
            onClick={() => setActiveTab('movements')}
            className={`py-2 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'movements'
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Stock Movement History Log ({stockMovements.length})
          </button>
        </div>

        <div className="text-xs text-slate-500 hidden sm:block">
          All values in Metric Tons (MT)
        </div>
      </div>

      {/* TAB 1: MATERIAL BALANCES */}
      {activeTab === 'balances' && (
        <div className="space-y-4">
          <div className="bg-white p-3.5 rounded-lg border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search raw materials by grade, section shape, or code..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-600 inline-block"></span>
              <span>
                {rawMaterials.filter((m) => m.status === 'critical').length} Critical Shortage(s)
              </span>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Material Code & Name</th>
                    <th className="py-3 px-3.5">Grade & Section</th>
                    <th className="py-3 px-3.5 text-right">Physical Stock</th>
                    <th className="py-3 px-3.5 text-right">Reserved (Jobs)</th>
                    <th className="py-3 px-3.5 text-right">Free Available</th>
                    <th className="py-3 px-3.5 text-right">Min / Reorder</th>
                    <th className="py-3 px-3.5">Supplier & Yard Bay</th>
                    <th className="py-3 px-3.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredMaterials.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3.5">
                        <div className="font-bold text-slate-900">{m.name}</div>
                        <div className="font-mono text-slate-500 text-[11px]">{m.code}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-semibold text-slate-800">{m.grade}</div>
                        <div className="text-[11px] text-slate-500">{m.dimensionsMm}</div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold text-slate-900">
                        {m.currentStockMt.toFixed(1)} MT
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-medium text-slate-600">
                        {m.reservedStockMt.toFixed(1)} MT
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold">
                        <span className={m.availableStockMt <= 0 ? 'text-rose-700' : 'text-emerald-700'}>
                          {m.availableStockMt.toFixed(1)} MT
                        </span>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums text-slate-500 text-[11px]">
                        {m.minimumStockMt.toFixed(1)} / {m.reorderLevelMt.toFixed(1)} MT
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-medium text-slate-800">{m.supplier}</div>
                        <div className="text-[11px] text-slate-500">{m.locationBay}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <StatusBadge status={m.status} />
                        {(m as any).storedStatus && (m as any).storedStatus !== m.status && (
                          <div className="text-[10px] font-medium text-amber-700 mt-1">
                            Free stock below minimum buffer
                          </div>
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

      {/* TAB 2: STOCK MOVEMENT HISTORY */}
      {activeTab === 'movements' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-3 px-3.5">Date & Time</th>
                    <th className="py-3 px-3.5">Material & Heat No.</th>
                    <th className="py-3 px-3.5">Movement Type</th>
                    <th className="py-3 px-3.5 text-right">Delta Quantity</th>
                    <th className="py-3 px-3.5 text-right">Balance After</th>
                    <th className="py-3 px-3.5">Reference Document</th>
                    <th className="py-3 px-3.5">Performed By</th>
                    <th className="py-3 px-3.5 text-right">GRN / Voucher PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stockMovements.map((mov) => (
                    <tr key={mov.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3.5 font-mono text-slate-700">{mov.timestamp}</td>
                      <td className="py-3 px-3.5">
                        <div className="font-semibold text-slate-900">{mov.materialGrade}</div>
                        <div className="font-mono text-indigo-700 text-[11px]">{mov.heatNumber}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <span className="font-medium text-slate-800">{mov.movementType}</span>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-bold">
                        <span className={mov.quantityMt > 0 ? 'text-emerald-700' : 'text-rose-700'}>
                          {mov.quantityMt > 0 ? `+${mov.quantityMt.toFixed(1)}` : `${mov.quantityMt.toFixed(1)}`} MT
                        </span>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {mov.balanceAfterMt.toFixed(1)} MT
                      </td>
                      <td className="py-3 px-3.5 font-mono text-slate-700">{mov.referenceDoc}</td>
                      <td className="py-3 px-3.5 text-slate-600">{mov.performedBy}</td>
                      <td className="py-3 px-3.5 text-right">
                        <button
                          onClick={() => handleOpenMovementPdf(mov)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                        >
                          <FileText className="w-3 h-3 text-indigo-700" />
                          <span>{mov.movementType === 'Receipt (GRN)' ? 'GRN PDF' : 'Issue PDF'}</span>
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

      {/* Record Stock Movement Modal */}
      {showMovementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleRecordMovement}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900">Record Raw Material Movement</h3>
                  <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded font-mono text-[10px] font-semibold">
                    RTDB /inventory
                  </span>
                </div>
                <p className="text-slate-500 mt-0.5">
                  Updates physical stock in <code>/inventory/rawMaterials</code> and appends immutable log to <code>/inventory/stockMovements</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMovementModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {!canWriteInventory && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-amber-900 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">RBAC Restriction ({activeRbacGroup})</span>
                  <span>
                    Only <strong>Admin</strong>, <strong>Management</strong>, and <strong>Production</strong> roles can post raw material receipts or issues.
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Raw Material Billet / Ingot</label>
                <select
                  value={selectedMaterialId}
                  onChange={(e) => setSelectedMaterialId(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-white"
                >
                  {rawMaterials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} — {m.grade} ({m.dimensionsMm}) [Stock: {m.currentStockMt.toFixed(1)} MT]
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Movement Type</label>
                  <select
                    value={movementType}
                    onChange={(e) => setMovementType(e.target.value as StockMovement['movementType'])}
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    <option value="Receipt (GRN)">Receipt (GRN) (+ Stock)</option>
                    <option value="Production Issue">Production Issue (- Stock)</option>
                    <option value="Scrap Return">Scrap Return (+ Stock)</option>
                    <option value="Adjustment">Adjustment (+ Stock)</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Quantity (MT)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    required
                    value={quantityDeltaMt}
                    onChange={(e) => setQuantityDeltaMt(parseFloat(e.target.value) || 0.1)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Mill Heat Number</label>
                  <input
                    type="text"
                    required
                    value={heatNumber}
                    onChange={(e) => setHeatNumber(e.target.value)}
                    placeholder="HEAT-JSW-9012-B"
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Reference Doc (GRN / Job)</label>
                  <input
                    type="text"
                    required
                    value={referenceDoc}
                    onChange={(e) => setReferenceDoc(e.target.value)}
                    placeholder="GRN/26-27/0512"
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setShowMovementModal(false)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !canWriteInventory}
                className="px-3.5 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                <span>{saving ? 'Writing to RTDB...' : 'Post Ledger Entry'}</span>
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
