import React, { useState } from 'react';
import { ClearanceQueue } from '../orders/ClearanceQueue';
import {
  ShieldCheck,
  AlertTriangle,
  Plus,
  CheckCircle2,
  ShieldAlert,
  Database,
  Ruler,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Download,
} from 'lucide-react';
import { StatusBadge } from '../common/StatusBadge';
import { AlertBanner } from '../common/AlertBanner';
import { useRtdb } from '../../context/RtdbContext';
import {
  deriveQualityInspectionsFromOrders,
  validateQualityInspectionQuantities,
  QualityInspectionRecord,
} from '../../services/misDataValidator';
import { DimensionalInspectionReport } from '../../types/mis';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
import {
  buildDimensionalReportPdfPayload,
  buildMtcDraftPdfPayload,
  buildQualityInspectionPdfPayload,
  exportMontexCsvFile,
  exportMontexExcelWorkbook,
  MontexPdfDocumentPayload,
  verifyExportPermission,
} from '../../services/documentExportService';

export const QualityView: React.FC = () => {
  const {
    salesOrders,
    qualityInspections,
    dimensionalReports,
    ncrCapaRecords,
    activeRbacGroup,
    currentUser,
    isDemoMode,
    recordQualityInspectionRecord,
    createDimensionalReportRecord,
    upsertNcrCapaRecord,
  } = useRtdb();

  const [activeSubTab, setActiveSubTab] = useState<'inspections' | 'dimensional_tpi' | 'ncr_capa'>('inspections');
  const [previewPayload, setPreviewPayload] = useState<MontexPdfDocumentPayload | null>(null);

  // Inspection Lot Modal
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [selectedJobNumber, setSelectedJobNumber] = useState(
    salesOrders[0]?.jobNumber || 'JOB-MF-2026-0412'
  );
  const [inspectedQtyInput, setInspectedQtyInput] = useState<number>(100);
  const [passedQtyInput, setPassedQtyInput] = useState<number>(98);
  const [rejectedQtyInput, setRejectedQtyInput] = useState<number>(2);
  const [mtcNumberInput, setMtcNumberInput] = useState<string>('MTC-MF-2026-0910');
  const [statusInput, setStatusInput] = useState<string>('cleared');

  // Dimensional / TPI Modal
  const [showDirModal, setShowDirModal] = useState(false);
  const [dirJobNumber, setDirJobNumber] = useState(salesOrders[0]?.jobNumber || 'JOB-MF-2026-0412');
  const [dirDrawingNo, setDirDrawingNo] = useState('DRG-MF-B16.5-6-300');
  const [dirSampleSize, setDirSampleSize] = useState<number>(10);
  const [dirOdNominal, setDirOdNominal] = useState('318.0');
  const [dirOdMeasured, setDirOdMeasured] = useState('317.9 - 318.2');
  const [dirBoreNominal, setDirBoreNominal] = useState('154.1');
  const [dirBoreMeasured, setDirBoreMeasured] = useState('154.0 - 154.2');
  const [dirPcdNominal, setDirPcdNominal] = useState('269.9');
  const [dirPcdMeasured, setDirPcdMeasured] = useState('269.8 - 270.0');
  const [dirTpiAgency, setDirTpiAgency] = useState('TUV Rheinland');
  const [dirOfferingStatus, setDirOfferingStatus] =
    useState<DimensionalInspectionReport['offeringStatus']>('witnessed_cleared');

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const canWriteQuality =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo', 'quality'].includes(currentUser.role);

  const derivedInspections = isDemoMode ? deriveQualityInspectionsFromOrders(salesOrders) : [];
  const inspections: QualityInspectionRecord[] =
    qualityInspections.length > 0 ? qualityInspections : derivedInspections;

  const totalInspected = inspections.reduce((acc, q) => acc + q.inspectedQty, 0);
  const totalPassed = inspections.reduce((acc, q) => acc + q.passedQty, 0);
  const totalRejected = inspections.reduce((acc, q) => acc + q.rejectedQty, 0);
  const totalEvaluated = totalPassed + totalRejected;
  const passRate =
    totalEvaluated > 0 ? ((totalPassed / totalEvaluated) * 100).toFixed(1) : '0.0';

  const validationResults = inspections.map((insp) => validateQualityInspectionQuantities(insp));
  const invalidInspections = validationResults.filter((v) => !v.valid);

  const handleRecordInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!canWriteQuality) {
      setFeedback({
        type: 'error',
        message:
          currentUser.accountStatus !== 'active'
            ? `RBAC Policy: Account '${currentUser.email}' is ${currentUser.accountStatus}. Only active accounts can record quality inspections.`
            : `RBAC Policy: Role '${currentUser.role}' (${activeRbacGroup}) cannot record quality inspections. Switch to Super Admin or Quality.`,
      });
      return;
    }

    const matchedOrder =
      salesOrders.find((o) => o.jobNumber === selectedJobNumber) || salesOrders[0];
    const inspId = `QC-2026-${Math.floor(900 + Math.random() * 99)}`;

    const candidate: QualityInspectionRecord = {
      id: inspId,
      jobNumber: selectedJobNumber,
      customer: matchedOrder?.customerName || 'Montex Customer',
      product: matchedOrder?.lineItems?.[0]?.productName || 'Forged Component',
      grade: matchedOrder?.lineItems?.[0]?.materialGrade || 'ASTM A105',
      heatNo: matchedOrder?.materialStatus?.heatNumber || 'HEAT-VERIFIED',
      inspectedQty: inspectedQtyInput,
      passedQty: passedQtyInput,
      rejectedQty: rejectedQtyInput,
      status: statusInput,
      inspector: currentUser.name,
      date: new Date().toISOString().split('T')[0],
      mtcNumber: mtcNumberInput.trim() || `MTC-MF-${inspId}`,
    };

    const check = validateQualityInspectionQuantities(candidate);
    if (!check.valid) {
      setFeedback({
        type: 'error',
        message: `Quantity Invariant Violation: ${check.errors.join(' ')}`,
      });
      return;
    }

    setSaving(true);
    setFeedback(null);
    const res = await recordQualityInspectionRecord(candidate);
    setSaving(false);

    if (res.success) {
      setFeedback({
        type: 'success',
        message: res.persistedToFirestore
          ? `Saved to Cloud Firestore (/qualityInspections/${candidate.id}): Recorded ${candidate.id} (${candidate.passedQty} passed + ${candidate.rejectedQty} rejected ≤ ${candidate.inspectedQty} inspected).`
          : `[Demo Preview Mode] Recorded ${candidate.id} (${candidate.passedQty} passed + ${candidate.rejectedQty} rejected ≤ ${candidate.inspectedQty} inspected) in Quality Register session state.`,
      });
      setShowRecordModal(false);
    } else {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to record quality inspection',
      });
    }
  };

  const handleCreateDimensionalReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!canWriteQuality) {
      setFeedback({
        type: 'error',
        message: `RBAC Policy: Role '${currentUser.role}' (${currentUser.accountStatus}) cannot issue Dimensional Inspection Reports.`,
      });
      return;
    }
    if (dirSampleSize <= 0) {
      setFeedback({
        type: 'error',
        message: 'Sample size (PCS) must be greater than zero.',
      });
      return;
    }
    const matchedOrder =
      salesOrders.find((o) => o.jobNumber === dirJobNumber) || salesOrders[0];
    const newDir: DimensionalInspectionReport = {
      id: `DIR-2026-${Math.floor(110 + Math.random() * 89)}`,
      jobNumber: dirJobNumber,
      orderNo: matchedOrder?.poNumber || 'PO-REF',
      customerName: matchedOrder?.customerName || 'Montex Customer',
      drawingNo: dirDrawingNo.trim() || 'DRG-MF-STD',
      productName: matchedOrder?.lineItems?.[0]?.productName || 'Forged Component',
      sampleSizePcs: dirSampleSize,
      inspectorName: currentUser.name,
      tpiAgency: dirTpiAgency,
      inspectionDate: new Date().toISOString().split('T')[0],
      parameters: [
        {
          dimensionName: 'Outer Diameter (OD)',
          nominalMm: dirOdNominal,
          toleranceMm: '±1.5',
          measuredMinMm: dirOdMeasured.split('-')[0]?.trim() || dirOdNominal,
          measuredMaxMm: dirOdMeasured.split('-')[1]?.trim() || dirOdNominal,
          instrumentUsed: 'Digital Vernier 600mm',
          result: 'OK',
        },
        {
          dimensionName: 'Inside Bore (ID)',
          nominalMm: dirBoreNominal,
          toleranceMm: '±0.8',
          measuredMinMm: dirBoreMeasured.split('-')[0]?.trim() || dirBoreNominal,
          measuredMaxMm: dirBoreMeasured.split('-')[1]?.trim() || dirBoreNominal,
          instrumentUsed: 'Bore Gauge Dial',
          result: 'OK',
        },
        {
          dimensionName: 'Pitch Circle Dia (PCD)',
          nominalMm: dirPcdNominal,
          toleranceMm: '±0.5',
          measuredMinMm: dirPcdMeasured.split('-')[0]?.trim() || dirPcdNominal,
          measuredMaxMm: dirPcdMeasured.split('-')[1]?.trim() || dirPcdNominal,
          instrumentUsed: 'CMM Coordinate Probe',
          result: 'OK',
        },
      ],
      offeringStatus: dirOfferingStatus,
    };

    setSaving(true);
    setFeedback(null);
    const res = await createDimensionalReportRecord(newDir);
    setSaving(false);

    if (!res.success) {
      setFeedback({
        type: 'error',
        message: res.error || 'Failed to persist Dimensional Inspection Report.',
      });
      return;
    }

    setShowDirModal(false);
    setFeedback({
      type: 'success',
      message: res.persistedToFirestore
        ? `Saved to Cloud Firestore (/dimensionalReports/${newDir.id}): Dimensional Inspection Report ${newDir.id} (${newDir.drawingNo}) logged for ${newDir.jobNumber}.`
        : `[Demo Preview Mode] Dimensional Inspection Report ${newDir.id} (${newDir.drawingNo}) logged for ${newDir.jobNumber} in session register.`,
    });
  };

  const handleExportQualityWorkbook = () => {
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
      `Montex_Quality_NDT_DIR_Register_${new Date().toISOString().split('T')[0]}.xlsx`,
      [
        {
          sheetName: 'NDT_Lot_Inspections',
          reportTitle: 'MONTEX FORGE — QUALITY ASSURANCE, NDT & LOT INSPECTION REGISTER',
          reportSubtitle: `Total Lots: ${inspections.length} | Evaluated Pass Rate: ${passRate}% | Exported by ${currentUser.name} (${activeRbacGroup})`,
          metadataRows: [
            ['Total Inspected Quantity (PCS)', totalInspected],
            ['Total Passed Quantity (PCS)', totalPassed],
            ['Total Rejected Quantity (PCS)', totalRejected],
            ['Evaluated Pass Rate (%)', `${passRate}%`],
          ],
          headers: [
            'Inspection ID',
            'Date',
            'Job Number',
            'Customer',
            'Product',
            'Material Grade',
            'Mill Heat No.',
            'Inspected Qty (PCS)',
            'Passed Qty (PCS)',
            'Rejected Qty (PCS)',
            'Quantity Invariant Check',
            'NDT Inspector',
            'MTC Reference',
            'Lot Status',
          ],
          rows: inspections.map((insp) => {
            const check = validateQualityInspectionQuantities(insp);
            return [
              insp.id,
              insp.date,
              insp.jobNumber,
              insp.customer,
              insp.product,
              insp.grade,
              insp.heatNo,
              insp.inspectedQty,
              insp.passedQty,
              insp.rejectedQty,
              check.valid
                ? `${check.totalAccountedQty}/${check.inspectedQty} OK`
                : `VIOLATION: ${check.totalAccountedQty} > ${check.inspectedQty}`,
              insp.inspector,
              insp.mtcNumber,
              insp.status.toUpperCase(),
            ];
          }),
          totalsRow: [
            'TOTAL',
            '',
            '',
            `${inspections.length} Lots`,
            '',
            '',
            '',
            totalInspected,
            totalPassed,
            totalRejected,
            `${passRate}% Pass`,
            '',
            '',
            '',
          ],
        },
        {
          sheetName: 'Dimensional_TPI_Reports',
          reportTitle: 'MONTEX FORGE — DIMENSIONAL INSPECTION REPORTS (DIR) & TPI OFFERINGS',
          reportSubtitle: `Total Dimensional Reports: ${dimensionalReports.length}`,
          headers: [
            'DIR ID',
            'Inspection Date',
            'Job Number',
            'Customer PO No.',
            'Customer Name',
            'Product Name',
            'Drawing Reference',
            'Sample Size (PCS)',
            'Inspector Name',
            'TPI Agency',
            'Offering Status',
            'Recorded Parameters Summary',
          ],
          rows: dimensionalReports.map((dir) => [
            dir.id,
            dir.inspectionDate,
            dir.jobNumber,
            dir.orderNo,
            dir.customerName,
            dir.productName,
            dir.drawingNo,
            dir.sampleSizePcs,
            dir.inspectorName,
            dir.tpiAgency,
            dir.offeringStatus.toUpperCase(),
            dir.parameters
              .map(
                (p) =>
                  `${p.dimensionName}: Nom ${p.nominalMm} (${p.toleranceMm}) -> Meas ${p.measuredMinMm}-${p.measuredMaxMm} [${p.result}]`
              )
              .join(' | '),
          ]),
        },
      ]
    );

    setFeedback({
      type: 'success',
      message: `Downloaded 2-sheet Quality & Dimensional Inspection Excel workbook.`,
    });
  };

  const handleExportQualityCsv = () => {
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
      `Montex_Quality_Inspections_${new Date().toISOString().split('T')[0]}.csv`,
      [
        'Inspection ID',
        'Date',
        'Job Number',
        'Customer',
        'Product',
        'Material Grade',
        'Heat Number',
        'Inspected Qty',
        'Passed Qty',
        'Rejected Qty',
        'Inspector',
        'MTC Reference',
        'Status',
      ],
      inspections.map((insp) => [
        insp.id,
        insp.date,
        insp.jobNumber,
        insp.customer,
        insp.product,
        insp.grade,
        insp.heatNo,
        insp.inspectedQty,
        insp.passedQty,
        insp.rejectedQty,
        insp.inspector,
        insp.mtcNumber,
        insp.status,
      ])
    );

    setFeedback({
      type: 'success',
      message: `Exported ${inspections.length} quality inspection records to CSV.`,
    });
  };

  const handleOpenQcPdf = (insp: QualityInspectionRecord) => {
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
    const linkedOrder = salesOrders.find((o) => o.jobNumber === insp.jobNumber);
    const payload = buildQualityInspectionPdfPayload(
      insp,
      linkedOrder,
      currentUser,
      activeRbacGroup
    );
    setPreviewPayload(payload);
  };

  const handleOpenMtcPdf = (insp: QualityInspectionRecord) => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Production',
      'Sales',
    ]);
    if (!authCheck.allowed) {
      setFeedback({ type: 'error', message: authCheck.reason || 'Export restricted' });
      return;
    }
    const linkedOrder =
      salesOrders.find((o) => o.jobNumber === insp.jobNumber) || salesOrders[0];
    if (!linkedOrder) return;
    const linkedDir = dimensionalReports.find((d) => d.jobNumber === insp.jobNumber);
    const payload = buildMtcDraftPdfPayload(
      linkedOrder,
      insp,
      linkedDir,
      currentUser,
      activeRbacGroup
    );
    setPreviewPayload(payload);
  };

  const handleOpenDirPdf = (dir: DimensionalInspectionReport) => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Production',
      'Sales',
    ]);
    if (!authCheck.allowed) {
      setFeedback({ type: 'error', message: authCheck.reason || 'Export restricted' });
      return;
    }
    const payload = buildDimensionalReportPdfPayload(dir, currentUser, activeRbacGroup);
    setPreviewPayload(payload);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span>Quality Assurance & Metallurgy</span>
            <span aria-hidden="true">·</span>
            <span>Non-Destructive Testing (NDT) & Dimensional QC</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-700">Inspection & MTC Register</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
            Quality Inspection, TPI Offering & Mill Test Certificates
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Volumetric Ultrasonic scans, Magnetic Particle Inspection, Dimensional Inspection Reports (DIR), and EN 10204 3.1 documentation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportQualityWorkbook}
            className="px-3 py-2 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Export Quality & DIR (.xlsx)</span>
          </button>
          <button
            onClick={handleExportQualityCsv}
            className="px-3 py-2 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-600" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => setShowDirModal(true)}
            className="px-3 py-2 text-xs font-semibold bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Ruler className="w-3.5 h-3.5 text-indigo-600" />
            <span>Log Dimensional / TPI Offering</span>
          </button>
          <button
            onClick={() => setShowRecordModal(true)}
            className="px-3.5 py-2 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 rounded-md transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Record Inspection Lot</span>
          </button>
        </div>
      </div>

      {feedback && (
        <AlertBanner
          severity={feedback.type}
          title={feedback.type === 'success' ? 'Quality Record Updated' : 'Quality Action Notice'}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      )}

      {/* Existing Data Inconsistency Warning Banner (Non-Destructive Audit) */}
      {invalidInspections.length > 0 && (
        <AlertBanner
          severity="warning"
          title="Quality Inspection Quantity Review Required"
          message={invalidInspections
            .map((inv) => `${inv.errors.join(' ')}`)
            .join(' | ')}
          reference={invalidInspections
            .map((inv) => `Inspection: ${inv.inspectionId} · Job No: ${inv.jobNumber}`)
            .join(' · ')}
          actionText="Confirm with Quality Assurance whether 508 PCS were inspected in total (500 passed + 8 rejected) or 492 PCS passed out of 500 inspected."
        />
      )}

      <ClearanceQueue kind="quality" />

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-lg">
          <span className="text-xs text-slate-500 uppercase tracking-wider block mb-1">
            Evaluated Pass Rate
          </span>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">{passRate}%</div>
          <span className="text-xs text-emerald-700 font-medium">
            {totalPassed} Passed / {totalRejected} Rejected ({totalEvaluated} Evaluated)
          </span>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-lg">
          <span className="text-xs text-slate-500 uppercase tracking-wider block mb-1">
            Pending Third-Party Witness
          </span>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-700">
            {inspections.filter((q) => q.status === 'in_progress' || q.status === 'pending').length} Lot(s)
          </div>
          <span className="text-xs text-slate-500">TUV Rheinland / Customer TPI</span>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-lg">
          <span className="text-xs text-slate-500 uppercase tracking-wider block mb-1">
            Total Lot Inspected Pcs
          </span>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {totalInspected} PCS
          </div>
          <span className="text-xs text-slate-500">Across {inspections.length} inspection lots</span>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-lg">
          <span className="text-xs text-slate-500 uppercase tracking-wider block mb-1">
            Dimensional & TPI Offerings
          </span>
          <div className="text-2xl font-bold font-mono tabular-nums text-indigo-700">
            {dimensionalReports.length} Reports
          </div>
          <span className="text-xs text-slate-500">OD, ID, PCD & Bolt Holes Verified</span>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {[
          {
            id: 'inspections',
            label: `NDT & Lot Inspection Register (${inspections.length})`,
            icon: ShieldCheck,
          },
          {
            id: 'dimensional_tpi',
            label: `TPI Material Offering & Dimensional Reports (${dimensionalReports.length})`,
            icon: FileCheck2,
          },
          {
            id: 'ncr_capa',
            label: `NCR & CAPA Register — 5-Why & COPQ (${ncrCapaRecords.length})`,
            icon: AlertTriangle,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`flex items-center gap-1.5 py-2.5 px-3.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                active
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* SUB-TAB 1: NDT & LOT INSPECTIONS */}
      {activeSubTab === 'inspections' && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-3.5">Inspection Report No.</th>
                  <th className="py-3 px-3.5">Job No. & Customer</th>
                  <th className="py-3 px-3.5">Product & Heat No.</th>
                  <th className="py-3 px-3.5 text-right">Inspected</th>
                  <th className="py-3 px-3.5 text-right">Passed</th>
                  <th className="py-3 px-3.5 text-right">Rejected</th>
                  <th className="py-3 px-3.5">Quantity Check</th>
                  <th className="py-3 px-3.5">NDT Inspector</th>
                  <th className="py-3 px-3.5">MTC Reference</th>
                  <th className="py-3 px-3.5">Status</th>
                  <th className="py-3 px-3.5 text-right">QC & MTC PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inspections.map((insp) => {
                  const check = validateQualityInspectionQuantities(insp);
                  return (
                    <tr key={insp.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-3.5 font-mono font-bold text-slate-900">{insp.id}</td>
                      <td className="py-3 px-3.5">
                        <div className="font-semibold text-slate-900">{insp.customer}</div>
                        <div className="font-mono text-indigo-700 text-[11px]">{insp.jobNumber}</div>
                      </td>
                      <td className="py-3 px-3.5">
                        <div className="font-medium text-slate-800">{insp.product}</div>
                        <div className="font-mono text-slate-500 text-[11px]">Heat: {insp.heatNo}</div>
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums font-semibold">
                        {insp.inspectedQty}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums text-emerald-700 font-bold">
                        {insp.passedQty}
                      </td>
                      <td className="py-3 px-3.5 text-right font-mono tabular-nums text-rose-700 font-bold">
                        {insp.rejectedQty}
                      </td>
                      <td className="py-3 px-3.5 font-mono text-[11px]">
                        {check.valid ? (
                          <span className="text-emerald-700 font-semibold">
                            {check.totalAccountedQty}/{check.inspectedQty} PCS
                            {check.unaccountedQty > 0 ? ` (${check.unaccountedQty} in QC)` : ' OK'}
                          </span>
                        ) : (
                          <span className="text-rose-700 font-bold bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded block">
                            {check.totalAccountedQty} &gt; {check.inspectedQty} (+{check.excessQty} excess)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3.5 text-slate-700">{insp.inspector}</td>
                      <td className="py-3 px-3.5 font-mono text-indigo-700">{insp.mtcNumber}</td>
                      <td className="py-3 px-3.5">
                        <StatusBadge status={insp.status} />
                      </td>
                      <td className="py-3 px-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenQcPdf(insp)}
                            className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <FileText className="w-3 h-3 text-indigo-700" />
                            <span>QC PDF</span>
                          </button>
                          <button
                            onClick={() => handleOpenMtcPdf(insp)}
                            className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <FileText className="w-3 h-3 text-amber-700" />
                            <span>MTC Draft</span>
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
      )}

      {/* SUB-TAB 2: DIMENSIONAL INSPECTION REPORTS & TPI MATERIAL OFFERING LIST */}
      {activeSubTab === 'dimensional_tpi' && (
        <div className="space-y-4">
          {dimensionalReports.map((dir) => (
            <div
              key={dir.id}
              className="bg-white rounded-lg border border-slate-200 overflow-hidden"
            >
              <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-900 text-sm">{dir.id}</span>
                    <span className="font-mono text-indigo-700 font-semibold">{dir.jobNumber}</span>
                    <span className="text-slate-400">·</span>
                    <span className="font-semibold text-slate-800">{dir.customerName}</span>
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    Product: <strong>{dir.productName}</strong> · Drawing:{' '}
                    <code className="text-slate-800">{dir.drawingNo}</code> · Sample Size:{' '}
                    <strong>{dir.sampleSizePcs} PCS</strong> · TPI Agency:{' '}
                    <strong>{dir.tpiAgency}</strong>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-slate-500">{dir.inspectionDate}</span>
                  <StatusBadge
                    status={
                      dir.offeringStatus === 'witnessed_cleared'
                        ? 'approved'
                        : dir.offeringStatus === 'offered_to_tpi'
                        ? 'pending'
                        : 'rejected'
                    }
                    label={
                      dir.offeringStatus === 'witnessed_cleared'
                        ? 'TPI Witnessed & Cleared'
                        : dir.offeringStatus === 'offered_to_tpi'
                        ? 'Offered to TPI'
                        : 'Rework Advised'
                    }
                  />
                  <button
                    onClick={() => handleOpenDirPdf(dir)}
                    className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <FileText className="w-3 h-3 text-emerald-400" />
                    <span>DIR PDF</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase font-semibold text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3.5">Dimension Parameter</th>
                      <th className="py-2.5 px-3.5 font-mono">Nominal (mm)</th>
                      <th className="py-2.5 px-3.5 font-mono">Tolerance</th>
                      <th className="py-2.5 px-3.5 font-mono">Measured Min</th>
                      <th className="py-2.5 px-3.5 font-mono">Measured Max</th>
                      <th className="py-2.5 px-3.5">Instrument Used</th>
                      <th className="py-2.5 px-3.5">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dir.parameters.map((p, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-3.5 font-semibold text-slate-900">
                          {p.dimensionName}
                        </td>
                        <td className="py-2.5 px-3.5 font-mono text-slate-800">{p.nominalMm}</td>
                        <td className="py-2.5 px-3.5 font-mono text-slate-500">{p.toleranceMm}</td>
                        <td className="py-2.5 px-3.5 font-mono font-semibold text-slate-900">
                          {p.measuredMinMm}
                        </td>
                        <td className="py-2.5 px-3.5 font-mono font-semibold text-slate-900">
                          {p.measuredMaxMm}
                        </td>
                        <td className="py-2.5 px-3.5 text-slate-600">{p.instrumentUsed}</td>
                        <td className="py-2.5 px-3.5">
                          <span
                            className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] ${
                              p.result === 'OK'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {p.result}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SUB-TAB 3: NCR & CAPA REGISTER (5-WHY & COPQ) */}
      {activeSubTab === 'ncr_capa' && (
        <div className="space-y-4 text-xs">
          <div className="bg-slate-900 text-white p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="font-bold text-amber-400 uppercase tracking-wider text-[11px]">
                Non-Conformance Report (NCR), 5-Why Root Cause &amp; CAPA Register (/ncrCapaRecords)
              </span>
              <p className="text-slate-300 text-[11px] mt-0.5">
                Mandatory corrective &amp; preventive action tracking for forging defects, dimensional deviations, and Cost of Poor Quality (COPQ).
              </p>
            </div>
            <div className="font-mono text-xs bg-slate-800 px-3 py-1.5 rounded border border-slate-700">
              Total COPQ: ₹
              {ncrCapaRecords.reduce((s, n) => s + n.costOfPoorQualityInr, 0).toLocaleString('en-IN')}
            </div>
          </div>

          <div className="space-y-3">
            {ncrCapaRecords.map((ncr) => (
              <div
                key={ncr.id}
                className="bg-white rounded-lg border border-slate-200 p-4 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-900 text-sm">
                        {ncr.ncrNumber}
                      </span>
                      <span className="font-mono text-indigo-700 font-semibold">
                        {ncr.jobNumber}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-bold text-slate-800">{ncr.customerName}</span>
                    </div>
                    <div className="text-slate-500 mt-0.5">
                      Product: <strong>{ncr.productName}</strong> · Heat:{' '}
                      <code className="font-mono text-slate-800">{ncr.heatNumber}</code> · Rejected:{' '}
                      <strong className="text-rose-700">{ncr.rejectedQty} PCS</strong> · COPQ:{' '}
                      <strong className="font-mono text-rose-700">
                        ₹{ncr.costOfPoorQualityInr.toLocaleString('en-IN')}
                      </strong>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      status={
                        ncr.status === 'verified_closed'
                          ? 'approved'
                          : ncr.status === 'capa_implemented'
                          ? 'in_progress'
                          : 'rejected'
                      }
                      label={ncr.status.replace(/_/g, ' ').toUpperCase()}
                    />
                    {ncr.status !== 'verified_closed' && canWriteQuality && (
                      <button
                        onClick={async () => {
                          const todayIso = new Date().toISOString().split('T')[0];
                          const res = await upsertNcrCapaRecord({
                            ...ncr,
                            status: 'verified_closed',
                            verifiedByUid: currentUser.id,
                            verifiedByName: currentUser.name,
                            verifiedAt: todayIso,
                            closedAt: todayIso,
                          });
                          setFeedback({
                            type: res.success ? 'success' : 'error',
                            message: res.success
                              ? `CAPA for ${ncr.ncrNumber} verified and closed by ${currentUser.name} (${currentUser.role}).`
                              : res.error || 'Could not close NCR/CAPA.',
                          });
                        }}
                        className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded font-semibold text-[11px] cursor-pointer"
                      >
                        Verify &amp; Close CAPA
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                  <div className="p-2.5 rounded bg-rose-50/50 border border-rose-100">
                    <div className="font-bold text-rose-900 uppercase mb-0.5">
                      Defect Category: {ncr.defectCategory}
                    </div>
                    <div className="text-slate-700">{ncr.defectDescription}</div>
                  </div>
                  <div className="p-2.5 rounded bg-amber-50/50 border border-amber-100">
                    <div className="font-bold text-amber-900 uppercase mb-0.5">
                      5-Why Root Cause Analysis
                    </div>
                    <div className="text-slate-700">{ncr.rootCause5Why}</div>
                  </div>
                  <div className="p-2.5 rounded bg-slate-50 border border-slate-200">
                    <div className="font-bold text-slate-800 uppercase mb-0.5">
                      Corrective Action
                    </div>
                    <div className="text-slate-700">{ncr.correctiveAction}</div>
                  </div>
                  <div className="p-2.5 rounded bg-emerald-50/50 border border-emerald-100">
                    <div className="font-bold text-emerald-900 uppercase mb-0.5">
                      Preventive Action (Horizontal Deployment)
                    </div>
                    <div className="text-slate-700">{ncr.preventiveAction}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Record Inspection Modal */}
      {showRecordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleRecordInspection}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Record Quality Inspection Lot
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Enforces <code>passedQty + rejectedQty ≤ inspectedQty</code> before saving to Quality Register.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowRecordModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Work Order / Job No.</label>
                <select
                  value={selectedJobNumber}
                  onChange={(e) => setSelectedJobNumber(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded bg-white"
                >
                  {salesOrders.map((o) => (
                    <option key={o.id} value={o.jobNumber}>
                      {o.jobNumber} — {o.customerName} ({o.lineItems?.[0]?.productName})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Inspected Qty</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={inspectedQtyInput}
                    onChange={(e) => setInspectedQtyInput(Number(e.target.value) || 0)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Passed Qty</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={passedQtyInput}
                    onChange={(e) => setPassedQtyInput(Number(e.target.value) || 0)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Rejected Qty</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={rejectedQtyInput}
                    onChange={(e) => setRejectedQtyInput(Number(e.target.value) || 0)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              {passedQtyInput + rejectedQtyInput > inspectedQtyInput && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-rose-800 font-medium">
                  Validation Error: Passed ({passedQtyInput}) + Rejected ({rejectedQtyInput}) ={' '}
                  {passedQtyInput + rejectedQtyInput} PCS exceeds Inspected ({inspectedQtyInput} PCS).
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">MTC Reference</label>
                  <input
                    type="text"
                    required
                    value={mtcNumberInput}
                    onChange={(e) => setMtcNumberInput(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Lot Status</label>
                  <select
                    value={statusInput}
                    onChange={(e) => setStatusInput(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    <option value="in_progress">In Progress</option>
                    <option value="cleared">Cleared</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setShowRecordModal(false)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !canWriteQuality}
                className="px-3.5 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                <span>{saving ? 'Validating & Saving...' : 'Save Inspection Lot'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Dimensional Report & TPI Offering Modal */}
      {showDirModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleCreateDimensionalReport}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Log Dimensional Inspection & TPI Offering
                </h3>
                <p className="text-slate-500 mt-0.5">
                  Records dimensional metrology and Third-Party Inspection (TPI) Material Offering status.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDirModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="font-semibold text-slate-700 block mb-1">Job Number</label>
                  <select
                    value={dirJobNumber}
                    onChange={(e) => setDirJobNumber(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    {salesOrders.map((o) => (
                      <option key={o.id} value={o.jobNumber}>
                        {o.jobNumber} — {o.customerName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Sample Size (PCS)</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={dirSampleSize}
                    onChange={(e) => setDirSampleSize(Number(e.target.value) || 5)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Drawing Reference</label>
                  <input
                    type="text"
                    required
                    value={dirDrawingNo}
                    onChange={(e) => setDirDrawingNo(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">TPI Agency</label>
                  <input
                    type="text"
                    required
                    value={dirTpiAgency}
                    onChange={(e) => setDirTpiAgency(e.target.value)}
                    className="w-full p-2 border border-slate-300 rounded"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">OD Nominal / Measured Range (mm)</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={dirOdNominal}
                      onChange={(e) => setDirOdNominal(e.target.value)}
                      className="w-1/2 p-2 border border-slate-300 rounded font-mono"
                    />
                    <input
                      type="text"
                      value={dirOdMeasured}
                      onChange={(e) => setDirOdMeasured(e.target.value)}
                      className="w-1/2 p-2 border border-slate-300 rounded font-mono font-bold"
                    />
                  </div>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Bore ID Nominal / Measured (mm)</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={dirBoreNominal}
                      onChange={(e) => setDirBoreNominal(e.target.value)}
                      className="w-1/2 p-2 border border-slate-300 rounded font-mono"
                    />
                    <input
                      type="text"
                      value={dirBoreMeasured}
                      onChange={(e) => setDirBoreMeasured(e.target.value)}
                      className="w-1/2 p-2 border border-slate-300 rounded font-mono font-bold"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">PCD Nominal / Measured (mm)</label>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={dirPcdNominal}
                      onChange={(e) => setDirPcdNominal(e.target.value)}
                      className="w-1/2 p-2 border border-slate-300 rounded font-mono"
                    />
                    <input
                      type="text"
                      value={dirPcdMeasured}
                      onChange={(e) => setDirPcdMeasured(e.target.value)}
                      className="w-1/2 p-2 border border-slate-300 rounded font-mono font-bold"
                    />
                  </div>
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">TPI Offering Disposition</label>
                  <select
                    value={dirOfferingStatus}
                    onChange={(e) => setDirOfferingStatus(e.target.value as any)}
                    className="w-full p-2 border border-slate-300 rounded bg-white"
                  >
                    <option value="witnessed_cleared">TPI Witnessed & Cleared</option>
                    <option value="offered_to_tpi">Offered to TPI (Awaiting Witness)</option>
                    <option value="rework_advised">Rework Advised</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                onClick={() => setShowDirModal(false)}
                className="px-3 py-1.5 border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 cursor-pointer"
              >
                Save Dimensional Report
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
