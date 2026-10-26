import React, { useState } from 'react';
import {
  Truck,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  Package,
  TrendingUp,
  CreditCard,
  Clock,
  ArrowRight,
  Calendar,
  BarChart2,
  Factory,
  Info,
  ChevronDown,
  ChevronUp,
  FileText,
  Database,
} from 'lucide-react';
import { KpiCard } from '../common/KpiCard';
import { StatusBadge } from '../common/StatusBadge';
import { MontexLogo } from '../common/MontexLogo';
import { AlertBanner } from '../common/AlertBanner';
import { ActionQueueItem } from '../../types/mis';
import { useRtdb } from '../../context/RtdbContext';
import {
  calculateDashboardKpisFromRecords,
  reconcileDashboardKpis,
} from '../../services/misDataValidator';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
import {
  exportMontexExcelWorkbook,
  MontexPdfDocumentPayload,
  verifyExportPermission,
} from '../../services/documentExportService';

interface CeoCommandCenterProps {
  onNavigate: (tabId: string, orderId?: string) => void;
  onOpenActionModal?: (action: ActionQueueItem) => void;
}

export const CeoCommandCenter: React.FC<CeoCommandCenterProps> = ({
  onNavigate,
}) => {
  const {
    dashboardKpis,
    productionSummary,
    salesOrders,
    dispatches,
    rawMaterials,
    qualityInspections,
    outstandingAgeing,
    actionQueue,
    tasks,
    handovers,
    purchaseRequisitions,
    ncrCapaRecords,
    currentUser,
    activeRbacGroup,
    dataSource,
    acknowledgeAlertRecord,
    updateMonthlySalesTargetRecord,
  } = useRtdb();

  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'mtd'>('today');
  const [kpiCalcMode, setKpiCalcMode] = useState<'computed_records' | 'stored_snapshot'>(
    'computed_records'
  );
  const [showReconciliationPanel, setShowReconciliationPanel] = useState<boolean>(false);
  const [actionFilter, setActionFilter] = useState<'all' | 'high' | 'stores' | 'quality'>('all');
  const [resolvedActionIds, setResolvedActionIds] = useState<string[]>([]);
  const [previewPayload, setPreviewPayload] = useState<MontexPdfDocumentPayload | null>(null);
  const [customTargetCrores, setCustomTargetCrores] = useState<string>('4.50');
  const [actionNotice, setActionNotice] = useState<{
    type: 'success' | 'info' | 'error';
    title: string;
    text: string;
  } | null>(null);

  const canConfigureTarget =
    currentUser.accountStatus === 'active' &&
    ['super_admin', 'ceo'].includes(currentUser.role);

  const handleSelectMonthlyTarget = async (targetInr: number) => {
    const res = await updateMonthlySalesTargetRecord(targetInr);
    if (res.success) {
      setCustomTargetCrores((targetInr / 10000000).toFixed(2));
      setActionNotice({
        type: 'success',
        title: 'Monthly Revenue Target Updated',
        text: `Plant monthly billing target set to ₹${(targetInr / 10000000).toFixed(2)} Cr (₹${targetInr.toLocaleString('en-IN')}).`,
      });
    } else {
      setActionNotice({
        type: 'error',
        title: 'Target Update Restricted',
        text: res.error || 'Only CEO or Super Admin can change the monthly revenue target.',
      });
    }
  };

  const computedKpis = calculateDashboardKpisFromRecords({
    salesOrders,
    dispatches,
    rawMaterials,
    qualityInspections,
    outstandingAgeing,
    referenceDate: '2026-10-22',
  });

  const reconciliationItems = reconcileDashboardKpis(dashboardKpis, computedKpis);

  const handleResolveAction = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentUser.accountStatus !== 'active') {
      setActionNotice({
        type: 'error',
        title: 'Account Restricted',
        text: `Your account (${currentUser.email}) is ${currentUser.accountStatus}. Only active accounts can acknowledge operational alerts.`,
      });
      return;
    }
    const existingItem = actionQueue.find((a) => a.id === id);
    if (!existingItem) return;
    const res = await acknowledgeAlertRecord(existingItem);
    if (!res.success) {
      setActionNotice({
        type: 'error',
        title: 'Could Not Acknowledge Alert',
        text: res.error || 'Could not update alert status in the database.',
      });
      return;
    }
    setResolvedActionIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActionNotice({
      type: res.persistedToFirestore ? 'success' : 'info',
      title: 'Alert Acknowledged',
      text: res.persistedToFirestore
        ? `"${existingItem.title}" has been marked as acknowledged in Cloud Firestore (/actionQueue/${id}).`
        : `"${existingItem.title}" has been marked as acknowledged for this preview session.`,
    });
  };

  const handleDrillDownAction = (action: ActionQueueItem) => {
    const matchedOrder = salesOrders.find(
      (o) =>
        action.associatedRef.includes(o.jobNumber) ||
        action.associatedRef.includes(o.poNumber) ||
        action.description.includes(o.jobNumber)
    );
    if (matchedOrder) {
      onNavigate('order_journey', matchedOrder.id);
      return;
    }
    if (action.type === 'payment_ageing') {
      onNavigate('finance');
    } else if (action.type === 'material_shortage') {
      onNavigate('inventory');
    } else if (action.type === 'qc_rejection' || action.type === 'clearance_pending') {
      onNavigate('quality');
    } else {
      onNavigate('order_journey');
    }
  };

  const filteredActions = actionQueue.filter((action) => {
    if (action.acknowledged || resolvedActionIds.includes(action.id)) return false;
    if (actionFilter === 'high') return action.severity === 'high';
    if (actionFilter === 'stores') return action.assignedToDepartment.includes('Stores');
    if (actionFilter === 'quality') return action.assignedToDepartment.includes('Quality');
    return true;
  });

  const effectiveOpenOrdersValue =
    kpiCalcMode === 'computed_records'
      ? computedKpis.openOrdersTotalPoValue
      : dashboardKpis.openOrdersValue;
  const effectiveOpenOrdersCount =
    kpiCalcMode === 'computed_records'
      ? computedKpis.openOrdersCount
      : dashboardKpis.openOrdersCount;
  const effectiveMaterialShortages =
    kpiCalcMode === 'computed_records'
      ? computedKpis.materialShortagesByAvailableStockCount
      : dashboardKpis.materialShortagesCount;
  const effectiveQualityPending =
    kpiCalcMode === 'computed_records'
      ? computedKpis.qualityPendingCount
      : dashboardKpis.qualityPendingCount;
  const effectiveDispatchPendingQty =
    kpiCalcMode === 'computed_records'
      ? computedKpis.dispatchReadyClearedQty
      : dashboardKpis.dispatchPendingQty;
  const effectiveTotalOutstanding =
    kpiCalcMode === 'computed_records'
      ? computedKpis.totalOutstanding
      : dashboardKpis.totalOutstanding;
  const effectiveOverdueOrdersCount =
    kpiCalcMode === 'computed_records'
      ? computedKpis.overdueByTargetDateCount
      : dashboardKpis.overdueOrdersCount;

  const activeTargetInr = dashboardKpis.monthlySalesTarget || 45000000;
  const activeTargetCrLabel = `₹${(activeTargetInr / 10000000).toFixed(2)} Cr`;
  const targetPercent = (
    (dashboardKpis.monthlySalesAchieved / activeTargetInr) *
    100
  ).toFixed(1);

  const metricsByDate = {
    today: {
      dispatchVal: `₹${(
        (kpiCalcMode === 'computed_records'
          ? computedKpis.latestExecutedDispatchValue
          : dashboardKpis.todaysDispatchValue) / 100000
      ).toFixed(2)}`,
      dispatchUnit: 'Lakhs',
      dispatchSub: `${
        kpiCalcMode === 'computed_records'
          ? computedKpis.latestExecutedDispatchQty
          : dashboardKpis.todaysDispatchQty
      } Pcs BHEL Flanges (Dispatched ${computedKpis.latestExecutedDispatchDate})`,
      openOrdersVal: `₹${(effectiveOpenOrdersValue / 10000000).toFixed(2)}`,
      openOrdersSub: `${effectiveOpenOrdersCount} Active POs · ${computedKpis.openOrdersTotalPendingQty} Pending Pcs (of ${computedKpis.openOrdersTotalOrderedQty} Ordered)`,
      targetVal: `${targetPercent}%`,
      targetSub: `₹${(dashboardKpis.monthlySalesAchieved / 10000000).toFixed(2)} Cr of ${activeTargetCrLabel} Target · PO Invoiced: ₹${(
        computedKpis.invoicedTaxSalesTotal / 100000
      ).toFixed(2)}L`,
    },
    week: {
      dispatchVal: '₹94.20',
      dispatchUnit: 'Lakhs',
      dispatchSub: '3 Consignments (BHEL, IOCL, Thermax)',
      openOrdersVal: '₹1.85',
      openOrdersSub: '6 Active POs · 840 Pending Pcs',
      targetVal: `${targetPercent}%`,
      targetSub: `₹${(dashboardKpis.monthlySalesAchieved / 10000000).toFixed(2)} Cr Invoiced · Target: ${activeTargetCrLabel}`,
    },
    month: {
      dispatchVal: `₹${(dashboardKpis.monthlySalesAchieved / 10000000).toFixed(2)}`,
      dispatchUnit: 'Crores',
      dispatchSub: '14 Consignments Executed in October',
      openOrdersVal: '₹2.10',
      openOrdersSub: '8 Total POs Registered in October',
      targetVal: `${targetPercent}%`,
      targetSub: `₹${(dashboardKpis.monthlySalesAchieved / 10000000).toFixed(2)} Cr of ${activeTargetCrLabel} Monthly Target`,
    },
    mtd: {
      dispatchVal: `₹${(dashboardKpis.monthlySalesAchieved / 10000000).toFixed(2)}`,
      dispatchUnit: 'Crores',
      dispatchSub: 'Month-to-Date (01–22 Oct 2026)',
      openOrdersVal: `₹${(effectiveOpenOrdersValue / 10000000).toFixed(2)}`,
      openOrdersSub: `${effectiveOpenOrdersCount} Open Orders (${computedKpis.openOrdersTotalPendingQty} Pending Pcs · ₹${(
        computedKpis.openOrdersPendingBacklogValue / 10000000
      ).toFixed(2)} Cr Undispatched)`,
      targetVal: `${targetPercent}%`,
      targetSub: `Target: ${activeTargetCrLabel} · 10 Days Remaining in Cycle`,
    },
  }[dateFilter];

  const handleExportExecutiveWorkbook = () => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Finance',
      'Sales',
      'Production',
    ]);
    if (!authCheck.allowed) {
      setActionNotice({
        type: 'error',
        title: 'Export Restricted',
        text: authCheck.reason || 'Your current role does not have permission to export this workbook.',
      });
      return;
    }

    exportMontexExcelWorkbook(
      `Montex_CEO_Executive_KPI_Pack_${dateFilter.toUpperCase()}_${new Date().toISOString().split('T')[0]}.xlsx`,
      [
        {
          sheetName: 'Executive_KPI_Summary',
          reportTitle: 'MONTEX FORGE — CEO COMMAND CENTER EXECUTIVE KPI PACK',
          reportSubtitle: `Period: ${dateFilter.toUpperCase()} | Mode: ${kpiCalcMode} | Exported by ${currentUser.name} (${activeRbacGroup})`,
          headers: ['KPI Metric', 'Displayed Value', 'Unit', 'Operational Context / Subtext'],
          rows: [
            [
              `${dateFilter.toUpperCase()} Dispatch`,
              metricsByDate.dispatchVal,
              metricsByDate.dispatchUnit,
              metricsByDate.dispatchSub,
            ],
            [
              'Open Orders Backlog',
              metricsByDate.openOrdersVal,
              'Crores',
              metricsByDate.openOrdersSub,
            ],
            [
              'Material Shortages',
              effectiveMaterialShortages,
              'Grades',
              `${computedKpis.materialShortagesByAvailableStockCount} Avail < Min | ${computedKpis.materialShortagesByPhysicalStockCount} Physical < Min`,
            ],
            [
              'Quality Pending Lots',
              effectiveQualityPending,
              'Batch',
              '50 Pcs Forged Rings (L&T TPI Witness)',
            ],
            [
              'Dispatch Pending',
              effectiveDispatchPendingQty,
              'PCS',
              `Ready: ${computedKpis.dispatchReadyClearedQty} PCS | Total Backlog: ${computedKpis.dispatchTotalPendingQty} PCS`,
            ],
            [
              'Sales vs Monthly Target',
              metricsByDate.targetVal,
              'of INR 4.50 Cr',
              metricsByDate.targetSub,
            ],
            [
              'Customer Outstanding',
              `INR ${(effectiveTotalOutstanding / 10000000).toFixed(2)} Cr`,
              'Crores',
              `0-30d: INR ${(computedKpis.bucket0to30 / 10000000).toFixed(2)} Cr | >60d: INR ${((computedKpis.bucket61to90 + computedKpis.bucket90Plus) / 100000).toFixed(1)}L`,
            ],
            [
              'Overdue / At-Risk Orders',
              effectiveOverdueOrdersCount,
              'Orders',
              `Target Past: ${computedKpis.overdueByTargetDateCount} | Material Delay: ${computedKpis.ordersBlockedByMaterialShortageCount}`,
            ],
          ],
        },
        {
          sheetName: 'KPI_Reconciliation_Audit',
          reportTitle: 'MONTEX FORGE — STORED SNAPSHOT VS COMPUTED RECORDS RECONCILIATION',
          reportSubtitle: 'Non-Destructive Audit of Dashboard Snapshot vs Live RTDB Collections',
          headers: [
            'KPI Field',
            'Stored Snapshot Value',
            'Computed From Records',
            'Audit Classification',
            'Reconciliation Explanation',
          ],
          rows: reconciliationItems.map((r) => [
            r.kpiField,
            String(r.storedValue),
            String(r.computedValue),
            r.classification,
            r.explanation,
          ]),
        },
        {
          sheetName: 'Executive_Action_Queue',
          reportTitle: 'MONTEX FORGE — EXECUTIVE ACTION QUEUE & BOTTLENECKS',
          reportSubtitle: `Filter: ${actionFilter.toUpperCase()} (${filteredActions.length} Pending Actions)`,
          headers: [
            'Alert ID',
            'Severity',
            'Bottleneck Title',
            'Associated Reference',
            'Customer / Supplier',
            'Days Pending',
            'Assigned Department',
            'Suggested Action',
          ],
          rows: filteredActions.map((a) => [
            a.id,
            a.severity.toUpperCase(),
            a.title,
            a.associatedRef,
            a.customerOrSupplier,
            a.daysPending,
            a.assignedToDepartment,
            a.suggestedAction,
          ]),
        },
      ]
    );

    setActionNotice({
      type: 'success',
      title: 'Executive Workbook Downloaded',
      text: `Downloaded 3-sheet CEO Executive KPI Pack (.xlsx) for period "${dateFilter.toUpperCase()}".`,
    });
  };

  const handleOpenExecutiveSummaryPdf = () => {
    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
      'Admin',
      'Management',
      'Finance',
      'Sales',
      'Production',
    ]);
    if (!authCheck.allowed) {
      setActionNotice({
        type: 'error',
        title: 'Export Restricted',
        text: authCheck.reason || 'Your current role does not have permission to export this report.',
      });
      return;
    }

    const payload: MontexPdfDocumentPayload = {
      filename: `Montex_CEO_Executive_Summary_${dateFilter.toUpperCase()}_${new Date().toISOString().split('T')[0]}.pdf`,
      documentCode: `EXEC-SUM-${new Date().toISOString().split('T')[0].replace(/-/g, '')}`,
      documentTitle: 'CEO COMMAND CENTER — EXECUTIVE MIS SUMMARY REPORT',
      documentSubtitle: `Operational, Production, Quality & Financial Performance (${dateFilter.toUpperCase()} View)`,
      readiness: 'ready',
      readinessBannerText:
        'READY TO GENERATE — Verified Executive KPI Pack & Non-Destructive Reconciliation Audit',
      metadataGrid: [
        { label: 'Reporting Period Filter', value: dateFilter.toUpperCase() },
        {
          label: 'KPI Calculation Mode',
          value:
            kpiCalcMode === 'computed_records'
              ? 'Computed from Live Records'
              : 'Stored Snapshot (/dashboardKpis)',
        },
        { label: 'Monthly Sales Target', value: 'INR 4.50 Cr (October 2026)' },
        {
          label: 'MTD Sales Achieved',
          value: `INR ${(dashboardKpis.monthlySalesAchieved / 10000000).toFixed(2)} Cr (${targetPercent}%)`,
        },
        {
          label: 'Shop-Floor Yield Rate',
          value: `${(100 - productionSummary.totalRejectionPercent).toFixed(1)}% (${productionSummary.totalRejectionPercent}% Rej)`,
        },
        { label: 'Pending Priority Alerts', value: `${filteredActions.length} Action Items` },
      ],
      tables: [
        {
          sectionTitle: '1. Core Executive KPI Scorecard',
          headers: ['Metric', 'Value', 'Unit', 'Operational Context'],
          rows: [
            [
              `${dateFilter.toUpperCase()} Dispatch`,
              metricsByDate.dispatchVal,
              metricsByDate.dispatchUnit,
              metricsByDate.dispatchSub,
            ],
            [
              'Open Orders Backlog',
              metricsByDate.openOrdersVal,
              'Crores',
              metricsByDate.openOrdersSub,
            ],
            [
              'Material Shortages',
              String(effectiveMaterialShortages),
              'Grades',
              `${computedKpis.materialShortagesByAvailableStockCount} Avail < Min · ${computedKpis.materialShortagesByPhysicalStockCount} Physical < Min`,
            ],
            [
              'Quality Pending',
              String(effectiveQualityPending),
              'Batch',
              '50 Pcs Forged Rings (L&T TPI Witness)',
            ],
            [
              'Dispatch Pending',
              String(effectiveDispatchPendingQty),
              'PCS',
              `Ready: ${computedKpis.dispatchReadyClearedQty} PCS · Total Backlog: ${computedKpis.dispatchTotalPendingQty} PCS`,
            ],
            [
              'Customer Outstanding',
              `INR ${(effectiveTotalOutstanding / 10000000).toFixed(2)}`,
              'Crores',
              `0-30d: INR ${(computedKpis.bucket0to30 / 10000000).toFixed(2)} Cr | >60d: INR ${((computedKpis.bucket61to90 + computedKpis.bucket90Plus) / 100000).toFixed(1)}L`,
            ],
          ],
        },
        {
          sectionTitle: '2. Executive Action Queue (Priority Bottlenecks)',
          headers: ['Severity', 'Bottleneck', 'Reference', 'Account', 'Days', 'Department'],
          rows: filteredActions.map((a) => [
            a.severity.toUpperCase(),
            a.title,
            a.associatedRef,
            a.customerOrSupplier,
            `${a.daysPending}d`,
            a.assignedToDepartment,
          ]),
        },
      ],
      notesAndTerms: [
        'KPI Reconciliation Note: Stored snapshot (/dashboardKpis) and live record sums are both preserved non-destructively.',
      ],
      footerDisclaimer:
        'CONFIDENTIAL EXECUTIVE MANAGEMENT REPORT — Montex Forge Industries Pvt. Ltd.',
      generatedBy: currentUser.name,
      generatedRole: activeRbacGroup,
    };

    setPreviewPayload(payload);
  };

  return (
    <div className="space-y-6">
      {/* Page Header with Context, Data Source Indicator & Period Filter */}
      <div className="bg-white rounded-xl border border-slate-200 border-t-4 border-t-[#14283F] shadow-2xs p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <MontexLogo variant="compact" size="lg" surface="light" className="hidden sm:inline-flex" />
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1">
              <span className="font-semibold text-[#234765]">Overview</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-[#F28C28]">Executive Summary</span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                  dataSource === 'live_rtdb'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                <Database className="w-3 h-3" />
                {dataSource === 'live_rtdb' ? 'Live Plant Database' : 'Sample / Demo Data'}
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-[#14283F]">
              CEO Command Center
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Real-time overview of dispatches, active orders, raw material shortages, quality holds, and customer receivables. Click any KPI card to open its module.
            </p>
          </div>
        </div>

        {/* Clean Date Range & Export Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-0.5 text-xs">
            <span className="px-2 text-slate-500 flex items-center gap-1 font-medium">
              <Calendar className="w-3.5 h-3.5" /> Period:
            </span>
            {(['today', 'week', 'month', 'mtd'] as const).map((period) => (
              <button
                key={period}
                onClick={() => setDateFilter(period)}
                className={`px-3 py-1 font-medium rounded-md transition-colors capitalize cursor-pointer ${
                  dateFilter === period
                    ? 'bg-[#14283F] text-white shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {period === 'mtd' ? 'MTD (Oct)' : period}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowReconciliationPanel((prev) => !prev)}
            className="px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Info className="w-3.5 h-3.5 text-slate-500" />
            <span>KPI Audit</span>
            {showReconciliationPanel ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            onClick={handleExportExecutiveWorkbook}
            className="px-3 py-1.5 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Export Excel</span>
          </button>

          <button
            onClick={handleOpenExecutiveSummaryPdf}
            className="px-3.5 py-1.5 text-xs font-semibold bg-[#14283F] hover:bg-[#234765] text-white border border-[#14283F] rounded-lg flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-[#F28C28]" />
            <span>Executive Summary PDF</span>
          </button>
        </div>
      </div>

      {/* Configurable Monthly Revenue Target & Executive Accountability Pulse */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-col xl:flex-row xl:items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono uppercase text-[11px] font-bold text-[#14283F] bg-slate-100 px-2.5 py-1 rounded">
            FY 2026–27 Monthly Target Configurator:
          </span>
          {[
            { label: '₹4.50 Cr (Baseline)', val: 45000000 },
            { label: '₹8.00 Cr (Growth)', val: 80000000 },
            { label: '₹10.00 Cr (Expansion)', val: 100000000 },
          ].map((preset) => (
            <button
              key={preset.val}
              type="button"
              disabled={!canConfigureTarget}
              onClick={() => handleSelectMonthlyTarget(preset.val)}
              className={`px-2.5 py-1 rounded font-semibold border transition-colors cursor-pointer ${
                activeTargetInr === preset.val
                  ? 'bg-[#14283F] text-amber-300 border-[#14283F]'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              } ${!canConfigureTarget ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {preset.label}
            </button>
          ))}
          {canConfigureTarget && (
            <div className="flex items-center gap-1 ml-1">
              <input
                type="number"
                step="0.25"
                min="1"
                value={customTargetCrores}
                onChange={(e) => setCustomTargetCrores(e.target.value)}
                className="w-20 px-2 py-1 rounded border border-slate-300 font-mono text-xs"
                title="Custom Monthly Target in Crores (INR)"
              />
              <button
                type="button"
                onClick={() => {
                  const num = parseFloat(customTargetCrores);
                  if (!isNaN(num) && num > 0) {
                    handleSelectMonthlyTarget(Math.round(num * 10000000));
                  }
                }}
                className="px-2.5 py-1 rounded bg-slate-800 text-white font-semibold hover:bg-slate-900 cursor-pointer"
              >
                Set Cr
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('tasks_accountability')}
            className="px-2.5 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-amber-700" />
            <span>
              Verify Tasks:{' '}
              <strong>
                {tasks.filter((t) => t.status === 'submitted_for_verification').length}
              </strong>
            </span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('tasks_accountability')}
            className="px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <span>
              H-1..H-5 Handovers:{' '}
              <strong>
                {handovers.filter((h) => h.status === 'pending_acceptance').length}
              </strong>
            </span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('purchase')}
            className="px-2.5 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <span>
              PR Approvals:{' '}
              <strong>
                {
                  purchaseRequisitions.filter((p) => p.status === 'pending_approval')
                    .length
                }
              </strong>
            </span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('quality')}
            className="px-2.5 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-200 font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <span>
              Open NCR/CAPA:{' '}
              <strong>
                {ncrCapaRecords.filter((n) => n.status !== 'verified_closed').length}
              </strong>
            </span>
          </button>
        </div>
      </div>

      {actionNotice && (
        <AlertBanner
          severity={actionNotice.type}
          title={actionNotice.title}
          message={actionNotice.text}
          onDismiss={() => setActionNotice(null)}
        />
      )}

      {/* Expandable Executive KPI Reconciliation & Audit Drawer */}
      {showReconciliationPanel && (
        <div className="bg-white rounded-xl border border-amber-300 shadow-xs p-5 space-y-4 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Executive KPI Calculation & Underlying Record Reconciliation
              </h2>
              <p className="text-slate-500 mt-0.5">
                Compares live computed sums from operational records against stored snapshot values without modifying existing database records.
              </p>
            </div>
            <div className="flex items-center bg-slate-100 border border-slate-200 rounded-lg p-0.5 text-xs shrink-0">
              <span className="px-2 text-slate-500 font-medium">Display Mode:</span>
              <button
                onClick={() => setKpiCalcMode('computed_records')}
                className={`px-2.5 py-1 font-medium rounded transition-colors cursor-pointer ${
                  kpiCalcMode === 'computed_records'
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Computed from Records
              </button>
              <button
                onClick={() => setKpiCalcMode('stored_snapshot')}
                className={`px-2.5 py-1 font-medium rounded transition-colors cursor-pointer ${
                  kpiCalcMode === 'stored_snapshot'
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Stored Snapshot
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase text-[10px] font-semibold">
                <tr>
                  <th className="py-2 px-3">KPI Metric</th>
                  <th className="py-2 px-3">Stored Snapshot</th>
                  <th className="py-2 px-3">Computed from Records</th>
                  <th className="py-2 px-3">Audit Status</th>
                  <th className="py-2 px-3">Explanation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reconciliationItems.map((item) => (
                  <tr key={item.kpiField} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3 font-semibold text-slate-900">{item.kpiField}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-700">{String(item.storedValue)}</td>
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{String(item.computedValue)}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          item.classification === 'MATCH'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : item.classification === 'CONFIRMED_ERROR'
                            ? 'bg-rose-50 text-rose-800 border border-rose-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {item.classification.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 leading-relaxed">{item.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 1. PRIMARY KPIs AT THE TOP (8 Core Management Metrics) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title={`${dateFilter === 'today' ? "Today's" : dateFilter.toUpperCase()} Dispatch`}
          value={metricsByDate.dispatchVal}
          unit={metricsByDate.dispatchUnit}
          subtext={metricsByDate.dispatchSub}
          icon={Truck}
          highlight="success"
          trend={{ label: 'On Schedule', positive: true }}
          onClick={() => onNavigate('dispatch')}
          actionText="Open Dispatch Module"
        />

        <KpiCard
          title="Open Orders"
          value={metricsByDate.openOrdersVal}
          unit="Crores"
          subtext={metricsByDate.openOrdersSub}
          icon={FileSpreadsheet}
          trend={{ label: '+12% vs last month', positive: true }}
          onClick={() => onNavigate('sales_orders')}
          actionText="Open Sales Orders"
        />

        <KpiCard
          title="Material Shortages"
          value={String(effectiveMaterialShortages)}
          unit="Grades"
          subtext={
            kpiCalcMode === 'computed_records'
              ? `${computedKpis.materialShortagesByAvailableStockCount} Grade Below Min Stock (${computedKpis.materialShortagesByPhysicalStockCount} Physical)`
              : '2 Critical Grades · 12.3 MT Deficit (42CrMo4)'
          }
          icon={AlertTriangle}
          highlight="alert"
          trend={{
            label: `Blocking ${computedKpis.materialShortagesByOrderStateCount} Job`,
            positive: false,
          }}
          onClick={() => onNavigate('inventory')}
          actionText="Review Raw Materials"
        />

        <KpiCard
          title="Quality Pending"
          value={String(effectiveQualityPending)}
          unit="Batch"
          subtext="50 Pcs Forged Rings (L&T TPI Witness)"
          icon={CheckCircle2}
          highlight="warning"
          trend={{ label: 'Inspection 23-Oct', neutral: true }}
          onClick={() => onNavigate('quality')}
          actionText="Open Quality Queue"
        />

        <KpiCard
          title="Dispatch Pending"
          value={String(effectiveDispatchPendingQty)}
          unit="PCS"
          subtext={`Ready to Ship: ${computedKpis.dispatchReadyClearedQty} PCS · QC-Cleared: ${computedKpis.dispatchClearedUndispatchedQty} PCS`}
          icon={Package}
          highlight="warning"
          trend={{ label: `${computedKpis.dispatchTotalPendingQty} PCS Total Backlog`, positive: true }}
          onClick={() => onNavigate('dispatch')}
          actionText="View Cleared Lots"
        />

        <KpiCard
          title="Sales vs Monthly Target"
          value={metricsByDate.targetVal}
          unit="of ₹4.50 Cr"
          subtext={metricsByDate.targetSub}
          icon={TrendingUp}
          trend={{ label: '₹68L Target Gap', neutral: true }}
          onClick={() => onNavigate('finance')}
          actionText="Open Finance & Invoices"
        />

        <KpiCard
          title="Customer Outstanding"
          value={`₹${(effectiveTotalOutstanding / 10000000).toFixed(2)}`}
          unit="Crores"
          subtext={`0–30d: ₹${(computedKpis.bucket0to30 / 10000000).toFixed(2)} Cr · >60d: ₹${(
            (computedKpis.bucket61to90 + computedKpis.bucket90Plus) /
            100000
          ).toFixed(1)}L`}
          icon={CreditCard}
          trend={{ label: `${outstandingAgeing.length} Key Accounts`, neutral: true }}
          onClick={() => onNavigate('finance')}
          actionText="View Ageing Ledger"
        />

        <KpiCard
          title="Overdue / At-Risk Orders"
          value={String(effectiveOverdueOrdersCount)}
          unit="Order"
          subtext={`Past Target Date: ${computedKpis.overdueByTargetDateCount} (IOCL) · Material Hold: ${computedKpis.ordersBlockedByMaterialShortageCount} (Thermax)`}
          icon={Clock}
          highlight="alert"
          trend={{ label: `${computedKpis.overdueByContractualDateCount} Past PO Date`, positive: false }}
          onClick={() => onNavigate('order_journey', 'ORD-2026-003')}
          actionText="Inspect Delayed Job"
        />
      </div>

      {/* 2. PRIORITY EXCEPTIONS & PENDING ACTIONS NEXT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Priority Exceptions & Action Queue (2 Columns) */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#14283F]">
                  Priority Exceptions & Pending Actions
                </h2>
                <span className="text-xs bg-rose-100 text-rose-800 font-bold px-2.5 py-0.5 rounded-full font-mono tabular-nums">
                  {filteredActions.length} Pending
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Action items requiring management attention across raw materials, TPI clearance, quality holds, and overdue payments.
              </p>
            </div>

            {/* Filter segmented buttons */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs">
              {[
                { id: 'all', label: `All (${filteredActions.length})` },
                { id: 'high', label: 'Critical' },
                { id: 'stores', label: 'Stores / RM' },
                { id: 'quality', label: 'Quality / TPI' },
              ].map((btn) => (
                <button
                  key={btn.id}
                  onClick={() => setActionFilter(btn.id as typeof actionFilter)}
                  className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                    actionFilter === btn.id
                      ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {filteredActions.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs">
                No outstanding operational exceptions matching this filter.
              </div>
            ) : (
              filteredActions.map((action) => (
                <AlertBanner
                  key={action.id}
                  severity={action.severity === 'high' ? 'critical' : 'warning'}
                  title={action.title}
                  message={action.description}
                  reference={`${action.associatedRef} · ${action.customerOrSupplier} · ${action.daysPending} days pending · Dept: ${action.assignedToDepartment}`}
                  actionText={action.suggestedAction}
                  actions={
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => handleResolveAction(action.id, e)}
                        className="px-3 py-1.5 text-xs font-semibold bg-white text-slate-700 border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                      >
                        Acknowledge
                      </button>
                      <button
                        onClick={() => handleDrillDownAction(action)}
                        className="px-3 py-1.5 text-xs font-semibold bg-[#14283F] text-white hover:bg-[#234765] rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <span>Review</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  }
                />
              ))
            )}
          </div>
        </div>

        {/* Right Column: Latest Executed Dispatch & Receivables Summary */}
        <div className="space-y-6">
          {/* Today's Dispatch Spotlight Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <span className="text-xs font-bold text-[#14283F]">
                  Latest Executed Dispatch
                </span>
                <span className="block text-[11px] text-slate-500">
                  Gate Pass & LR Confirmed
                </span>
              </div>
              <StatusBadge status="completed" label="Dispatched" />
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Customer</span>
                <span className="font-semibold text-slate-900">BHEL Hyderabad</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Product</span>
                <span className="font-medium text-slate-800">12&quot; Class 300 WN Flanges</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Shipped Quantity</span>
                <span className="font-mono tabular-nums font-bold text-slate-900">
                  {dashboardKpis.todaysDispatchQty} PCS (25.8 MT)
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Commercial Value</span>
                <span className="font-mono tabular-nums font-semibold text-emerald-700">
                  ₹{dashboardKpis.todaysDispatchValue.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Transporter & LR</span>
                <span className="font-mono text-slate-700">VRL / VRL-PUN-892104</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Invoice Reference</span>
                <span className="font-mono text-slate-700">MF/26-27/0914</span>
              </div>
            </div>

            <button
              onClick={() => onNavigate('order_journey', 'ORD-2026-001')}
              className="w-full mt-2 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>View BHEL Order Lifecycle</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Quick Outstanding Bucket Summary */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="text-xs font-bold text-[#14283F]">
                Receivables Ageing Breakdown
              </span>
              <span className="text-xs font-mono tabular-nums font-bold text-slate-900">
                Total ₹{(computedKpis.totalOutstanding / 10000000).toFixed(2)} Cr
              </span>
            </div>

            {(() => {
              const total = computedKpis.totalOutstanding || 1;
              const p0to30 = Math.round((computedKpis.bucket0to30 / total) * 100);
              const p31to60 = Math.round((computedKpis.bucket31to60 / total) * 100);
              const p61to90 = Math.round((computedKpis.bucket61to90 / total) * 100);
              const p90Plus = Math.max(
                1,
                Math.round((computedKpis.bucket90Plus / total) * 100)
              );
              return (
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600">0–30 Days (Current)</span>
                      <span className="font-mono tabular-nums text-slate-900 font-medium">
                        ₹{(computedKpis.bucket0to30 / 10000000).toFixed(2)} Cr ({p0to30}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-600 h-full rounded-full"
                        style={{ width: `${p0to30}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600">31–60 Days</span>
                      <span className="font-mono tabular-nums text-slate-900 font-medium">
                        ₹{(computedKpis.bucket31to60 / 100000).toFixed(2)} Lakhs ({p31to60}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-blue-600 h-full rounded-full"
                        style={{ width: `${p31to60}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600">61–90 Days</span>
                      <span className="font-mono tabular-nums text-amber-700 font-medium">
                        ₹{(computedKpis.bucket61to90 / 100000).toFixed(2)} Lakhs ({p61to90}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-amber-500 h-full rounded-full"
                        style={{ width: `${p61to90}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600">&gt; 90 Days (Critical)</span>
                      <span className="font-mono tabular-nums text-rose-700 font-bold">
                        ₹{(computedKpis.bucket90Plus / 100000).toFixed(2)} Lakhs ({p90Plus}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-rose-600 h-full rounded-full"
                        style={{ width: `${p90Plus}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })()}

            <button
              onClick={() => onNavigate('finance')}
              className="w-full pt-2 text-xs font-semibold text-slate-700 hover:text-slate-900 flex items-center justify-center gap-1 cursor-pointer"
            >
              <span>View Account-Wise Ageing Ledger</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. DETAILED ANALYTICS BELOW: Monthly Sales Target & Shop-Floor Forging Yield */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Visual Dispatch vs Target Performance Bar */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-[#14283F] flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-slate-700" />
                <span>Monthly Sales & Dispatch Target Progress (October 2026)</span>
              </h2>
              <p className="text-xs text-slate-500">
                Achieved ₹{(dashboardKpis.monthlySalesAchieved / 10000000).toFixed(2)} Cr (
                {targetPercent}%) against target of ₹
                {(dashboardKpis.monthlySalesTarget / 10000000).toFixed(2)} Cr.
              </p>
            </div>
            <span className="text-xs font-mono font-bold text-slate-900 bg-slate-100 px-2.5 py-1 rounded">
              Target: ₹{(dashboardKpis.monthlySalesTarget / 10000000).toFixed(2)} Cr
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="font-semibold text-slate-700">MTD Invoiced & Dispatched</span>
              <span className="font-mono font-bold text-emerald-700">
                ₹{(dashboardKpis.monthlySalesAchieved / 10000000).toFixed(2)} Cr / ₹
                {(dashboardKpis.monthlySalesTarget / 10000000).toFixed(2)} Cr ({targetPercent}%)
              </span>
            </div>
            <div className="w-full bg-slate-100 h-3.5 rounded-full overflow-hidden relative">
              <div
                className="bg-emerald-600 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Number(targetPercent))}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-slate-400 font-mono">
              <span>0% (₹0)</span>
              <span>25% (₹1.12 Cr)</span>
              <span>50% (₹2.25 Cr)</span>
              <span>75% (₹3.37 Cr)</span>
              <span className="text-slate-900 font-bold">100% (₹4.50 Cr)</span>
            </div>
          </div>

          <div className="pt-2">
            <span className="text-xs font-bold text-slate-800 block mb-2">
              Weekly Dispatch Run-Rate (MT):
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
              {Object.entries(productionSummary.weeklyRunRate).map(([key, wk], idx) => (
                <div
                  key={key}
                  className={`p-2.5 border rounded-lg ${
                    idx === 3 ? 'bg-indigo-50/50 border-indigo-200' : 'bg-slate-50'
                  }`}
                >
                  <span
                    className={`block text-[11px] ${
                      idx === 3 ? 'text-indigo-800 font-medium' : 'text-slate-500'
                    }`}
                  >
                    {wk.label}
                  </span>
                  <span className="font-mono font-bold text-slate-900 block text-sm">
                    {wk.tonnageMt} MT
                  </span>
                  <span
                    className={`text-[10px] font-semibold ${
                      idx === 3 ? 'text-indigo-700' : 'text-emerald-700'
                    }`}
                  >
                    ₹{wk.valueLakhs} Lakhs
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Shop-Floor Forging Yield & Shift Breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-[#14283F] flex items-center gap-1.5">
                  <Factory className="w-4 h-4 text-slate-700" />
                  <span>Shop-Floor Yield & Shifts</span>
                </h3>
                <span className="text-xs text-slate-500">Hammer, Press & Ring Rolling Output</span>
              </div>
              <span className="text-[11px] font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded font-bold">
                {(100 - productionSummary.totalRejectionPercent).toFixed(1)}% OK
              </span>
            </div>

            <div className="space-y-3 text-xs">
              {Object.entries(productionSummary.shifts).map(([key, sh], idx) => (
                <div key={key}>
                  <div className="flex justify-between mb-1">
                    <span className="text-slate-600">{sh.name}</span>
                    <span className="font-mono tabular-nums font-bold text-slate-900">
                      {sh.tonnageMt} MT · {sh.yieldPercent}% Yield
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className={`${
                        idx === 2 ? 'bg-blue-600' : 'bg-emerald-600'
                      } h-full rounded-full`}
                      style={{ width: `${sh.yieldPercent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t space-y-2">
            <div className="text-[11px] text-slate-500 flex justify-between">
              <span>
                Total Shop Rejection:{' '}
                <strong className="text-rose-700 font-mono">
                  {productionSummary.totalRejectionPercent}%
                </strong>{' '}
                (Target &lt; 2.0%)
              </span>
              <span>56.7 MT Forged</span>
            </div>
            <button
              onClick={() => onNavigate('production')}
              className="w-full py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>Open Production & Shop Floor</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <DocumentPreviewModal
        payload={previewPayload}
        onClose={() => setPreviewPayload(null)}
      />
    </div>
  );
};
