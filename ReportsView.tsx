import React, { useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  ClipboardCheck,
  Filter,
  ShieldAlert,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import {
  deriveDispatchesFromOrders,
  deriveQualityInspectionsFromOrders,
} from '../../services/misDataValidator';
import {
  CLIENT_REQUIREMENTS_REGISTER,
} from '../../data/requirementsRegister';
import { StatusBadge } from '../common/StatusBadge';
import { JobCostSheet } from '../../types/mis';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
import {
  exportMontexCsvFile,
  exportMontexExcelWorkbook,
  MONTEX_DOCUMENT_CLASSIFICATION_CATALOG,
  MontexPdfDocumentPayload,
  verifyExportPermission,
} from '../../services/documentExportService';
import {
  SHOWCASE_PDF_FILENAME,
  downloadShowcaseRoadmapPdf,
  getShowcasePdfPublicUrl,
} from '../../utils/pdfBrandingUtility';

function computeJobCostTotals(j: JobCostSheet) {
  const totalCostInr =
    j.materialCostInr -
    j.scrapRecoveryCreditInr +
    j.labourCostInr +
    j.powerCostInr +
    j.fuelHeatTreatmentCostInr +
    j.machiningProcessingCostInr +
    j.testingTpiCostInr +
    j.packingCostInr +
    j.transportFreightCostInr +
    j.overheadCostInr;
  const grossMarginInr = j.totalRevenueInr - totalCostInr;
  const marginPercent =
    j.totalRevenueInr > 0
      ? Number(((grossMarginInr / j.totalRevenueInr) * 100).toFixed(1))
      : 0;
  return { totalCostInr, grossMarginInr, marginPercent };
}

export const ReportsView: React.FC = () => {
  const {
    salesOrders,
    products,
    rawMaterials,
    stockMovements,
    dispatches: rtdbDispatches,
    qualityInspections: rtdbInspections,
    outstandingAgeing,
    machineLogs,
    jobCostSheets,
    currentUser,
    activeRbacGroup,
    isDemoMode,
  } = useRtdb();

  const [reportType, setReportType] = useState<
    | 'daily_dispatch'
    | 'daily_production'
    | 'outstanding'
    | 'rejection'
    | 'stock'
    | 'job_costing'
    | 'requirements_register'
    | 'document_catalog'
  >('daily_dispatch');
  const [reqFilter, setReqFilter] = useState<string>('all');
  const [docReadinessFilter, setDocReadinessFilter] = useState<string>('all');
  const [previewPayload, setPreviewPayload] = useState<MontexPdfDocumentPayload | null>(null);
  const [exportMessage, setExportMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const dispatches =
    rtdbDispatches.length > 0
      ? rtdbDispatches
      : isDemoMode
      ? deriveDispatchesFromOrders(salesOrders, products)
      : [];

  const inspections =
    rtdbInspections.length > 0
      ? rtdbInspections
      : isDemoMode
      ? deriveQualityInspectionsFromOrders(salesOrders)
      : [];

  const activeJobCostSheets: JobCostSheet[] = jobCostSheets;

  const filteredReqs =
    reqFilter === 'all'
      ? CLIENT_REQUIREMENTS_REGISTER
      : CLIENT_REQUIREMENTS_REGISTER.filter((r) => r.status === reqFilter);

  const filteredDocCatalog =
    docReadinessFilter === 'all'
      ? MONTEX_DOCUMENT_CLASSIFICATION_CATALOG
      : MONTEX_DOCUMENT_CLASSIFICATION_CATALOG.filter((d) => d.readiness === docReadinessFilter);

  const reportList = [
    {
      id: 'daily_dispatch',
      name: '1. Daily Dispatch & Logistics Report',
      description: 'Itemized outward consignments, transporters, LR numbers, and delivery tonnages.',
    },
    {
      id: 'daily_production',
      name: '2. Shop-Floor Shift & Production Report',
      description: 'Forged pieces, press/hammer output, downtime minutes, and capacity utilization.',
    },
    {
      id: 'outstanding',
      name: '3. Accounts Receivables & Ageing Report',
      description: 'Customer-wise bucketed exposure (0-90+ days) with credit limit variance.',
    },
    {
      id: 'rejection',
      name: '4. Quality Inspection & Rejection Analysis',
      description: 'Inspection lots, passed/rejected quantities, MTC references, and NDT checks.',
    },
    {
      id: 'stock',
      name: '5. Raw Material Yard Stock & Consumption',
      description: 'Physical stock, job reservations, free available MT, and ledger movements.',
    },
    {
      id: 'job_costing',
      name: '6. 8-Head Job Costing & Profitability Report',
      description: 'Order-level raw material, fuel, power, machining, scrap credit, and net margin.',
    },
    {
      id: 'requirements_register',
      name: '7. Full Client Requirements Coverage Register',
      description: 'Complete audit of Montex Forge MIS requirements (Areas A through O).',
    },
    {
      id: 'document_catalog',
      name: '8. Document & Export Readiness Classification',
      description:
        'Authoritative status (Ready / Draft — Missing Fields / Not Supported Yet) for all 19 MIS documents.',
    },
  ];

  const buildActiveReportTableData = (): {
    title: string;
    subtitle: string;
    headers: string[];
    rows: (string | number)[][];
  } => {
    const activeMeta = reportList.find((r) => r.id === reportType)!;
    if (reportType === 'daily_dispatch') {
      return {
        title: activeMeta.name,
        subtitle: activeMeta.description,
        headers: [
          'Dispatch ID',
          'Date',
          'PO Number',
          'Job Number',
          'Customer',
          'Product',
          'Shipped Qty (PCS)',
          'PO Balance (PCS)',
          'Weight (MT)',
          'Transporter',
          'Vehicle No',
          'LR Number',
          'Invoice Ref',
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
          d.invoiceRef,
          d.status,
        ]),
      };
    }
    if (reportType === 'daily_production') {
      const logs = machineLogs;
      return {
        title: activeMeta.name,
        subtitle: activeMeta.description,
        headers: [
          'Shift Log ID',
          'Date',
          'Shift',
          'Machine',
          'Operator',
          'Job Number',
          'Product',
          'Input Billets (PCS)',
          'Forged Output (PCS)',
          'Ok (PCS)',
          'Rejected (PCS)',
          'Downtime (Min)',
          'Utilization (%)',
        ],
        rows: logs.map((m) => [
          m.id,
          m.date,
          m.shift,
          m.machineName,
          m.operatorName,
          m.jobNumber,
          m.productName,
          m.inputBilletsPcs,
          m.forgedOutputPcs,
          m.okPcs,
          m.rejectedPcs,
          m.downtimeMinutes,
          m.capacityUtilizationPercent,
        ]),
      };
    }
    if (reportType === 'outstanding') {
      return {
        title: activeMeta.name,
        subtitle: activeMeta.description,
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
          'Credit Exceeded',
        ],
        rows: outstandingAgeing.map((o) => [
          o.customerId,
          o.customerName,
          o.creditLimit,
          o.totalOutstanding,
          o.bucket0to30,
          o.bucket31to60,
          o.bucket61to90,
          o.bucket90Plus,
          o.oldestInvoiceDate,
          o.creditExceeded ? 'YES' : 'NO',
        ]),
      };
    }
    if (reportType === 'rejection') {
      return {
        title: activeMeta.name,
        subtitle: activeMeta.description,
        headers: [
          'Inspection ID',
          'Date',
          'Job Number',
          'Customer',
          'Product',
          'Heat Number',
          'Inspected Qty',
          'Passed Qty',
          'Rejected Qty',
          'Inspector',
          'MTC Reference',
          'Status',
        ],
        rows: inspections.map((q) => [
          q.id,
          q.date,
          q.jobNumber,
          q.customer,
          q.product,
          q.heatNo,
          q.inspectedQty,
          q.passedQty,
          q.rejectedQty,
          q.inspector,
          q.mtcNumber,
          q.status,
        ]),
      };
    }
    if (reportType === 'stock') {
      return {
        title: activeMeta.name,
        subtitle: activeMeta.description,
        headers: [
          'Material Code',
          'Name',
          'Grade',
          'Section Dimensions',
          'Physical Stock (MT)',
          'Reserved (MT)',
          'Free Available (MT)',
          'Minimum Stock (MT)',
          'Reorder Level (MT)',
          'Supplier',
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
          m.supplier,
          m.status,
        ]),
      };
    }
    if (reportType === 'job_costing') {
      return {
        title: activeMeta.name,
        subtitle: activeMeta.description,
        headers: [
          'Job Number',
          'PO Number',
          'Customer',
          'Product',
          'Qty (PCS)',
          'Revenue (INR)',
          'Total Cost (INR)',
          'Gross Margin (INR)',
          'Actual Margin (%)',
          'Quoted Margin (%)',
        ],
        rows: activeJobCostSheets.map((j) => {
          const { totalCostInr, grossMarginInr, marginPercent } = computeJobCostTotals(j);
          return [
            j.jobNumber,
            j.poNumber,
            j.customerName,
            j.productName,
            j.orderedQty,
            j.totalRevenueInr,
            totalCostInr,
            grossMarginInr,
            marginPercent,
            j.quotedMarginPercent,
          ];
        }),
      };
    }
    if (reportType === 'requirements_register') {
      return {
        title: activeMeta.name,
        subtitle: `Filter: ${reqFilter} (${filteredReqs.length} of ${CLIENT_REQUIREMENTS_REGISTER.length} Areas)`,
        headers: [
          'Req ID',
          'Section Code',
          'Area Title',
          'Requirement Summary',
          'Module',
          'Status',
          'Source Files',
          'Implementation Notes',
        ],
        rows: filteredReqs.map((r) => [
          r.id,
          r.sectionCode,
          r.areaTitle,
          r.requirementSummary,
          r.moduleName,
          r.status,
          r.sourceFiles.join('; '),
          r.implementationNotes,
        ]),
      };
    }
    return {
      title: activeMeta.name,
      subtitle: `Filter: ${docReadinessFilter} (${filteredDocCatalog.length} of ${MONTEX_DOCUMENT_CLASSIFICATION_CATALOG.length} Document Types)`,
      headers: [
        'Doc Type ID',
        'Document / Export Title',
        'Domain Category',
        'Readiness Classification',
        'Supported Formats',
        'Authorized Roles',
        'Available Source Fields',
        'Missing Fields / Dependencies',
      ],
      rows: filteredDocCatalog.map((d) => [
        d.documentTypeId,
        d.title,
        d.category,
        d.readinessLabel,
        d.supportedFormats.join(', '),
        d.authorizedRoles.join(', '),
        d.availableSourceFields.join('; '),
        d.missingSourceFields.length > 0 ? d.missingSourceFields.join('; ') : 'None — Complete',
      ]),
    };
  };

  const handleDownloadExcel = () => {
    const allowedRoles =
      reportType === 'outstanding' || reportType === 'job_costing'
        ? (['Admin', 'Management', 'Finance'] as const)
        : (['Admin', 'Management', 'Finance', 'Sales', 'Production'] as const);

    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [...allowedRoles]);
    if (!authCheck.allowed) {
      setExportMessage({ type: 'error', text: authCheck.reason || 'Export restricted' });
      return;
    }

    const { title, subtitle, headers, rows } = buildActiveReportTableData();
    exportMontexExcelWorkbook(
      `Montex_MIS_${reportType}_${new Date().toISOString().split('T')[0]}.xlsx`,
      [
        {
          sheetName: reportType.slice(0, 28),
          reportTitle: `MONTEX FORGE MIS — ${title.toUpperCase()}`,
          reportSubtitle: `${subtitle} | Exported by ${currentUser.name} (${activeRbacGroup})`,
          headers,
          rows,
        },
      ]
    );

    setExportMessage({
      type: 'success',
      text: `Downloaded Excel workbook (.xlsx) with ${rows.length} rows for "${title}".`,
    });
    setTimeout(() => setExportMessage(null), 4000);
  };

  const handleOpenReportPdf = () => {
    const allowedRoles =
      reportType === 'outstanding' || reportType === 'job_costing'
        ? (['Admin', 'Management', 'Finance'] as const)
        : (['Admin', 'Management', 'Finance', 'Sales', 'Production'] as const);

    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [...allowedRoles]);
    if (!authCheck.allowed) {
      setExportMessage({ type: 'error', text: authCheck.reason || 'Export restricted' });
      return;
    }

    const { title, subtitle, headers, rows } = buildActiveReportTableData();
    const payload: MontexPdfDocumentPayload = {
      filename: `Montex_MIS_${reportType}_${new Date().toISOString().split('T')[0]}.pdf`,
      documentCode: `RPT-${reportType.toUpperCase().slice(0, 8)}-${new Date().toISOString().split('T')[0].replace(/-/g, '')}`,
      documentTitle: title.toUpperCase(),
      documentSubtitle: subtitle,
      readiness: 'ready',
      readinessBannerText:
        'READY TO GENERATE — Verified MIS Standard Management Report',
      metadataGrid: [
        { label: 'Report Identifier', value: reportType },
        { label: 'Total Records Included', value: rows.length },
        { label: 'Generated By', value: currentUser.name },
        { label: 'RBAC Role Group', value: activeRbacGroup },
      ],
      tables: [
        {
          sectionTitle: title,
          headers,
          rows,
        },
      ],
      footerDisclaimer:
        'INTERNAL MANAGEMENT INFORMATION SYSTEM REPORT — Montex Forge Industries Pvt. Ltd.',
      generatedBy: currentUser.name,
      generatedRole: activeRbacGroup,
    };

    setPreviewPayload(payload);
  };

  const handleDownloadCsv = () => {
    const allowedRoles =
      reportType === 'outstanding' || reportType === 'job_costing'
        ? (['Admin', 'Management', 'Finance'] as const)
        : (['Admin', 'Management', 'Finance', 'Sales', 'Production'] as const);

    const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [...allowedRoles]);
    if (!authCheck.allowed) {
      setExportMessage({ type: 'error', text: authCheck.reason || 'Export restricted' });
      return;
    }

    const { title, headers, rows } = buildActiveReportTableData();
    exportMontexCsvFile(
      `Montex_MIS_${reportType}_${new Date().toISOString().split('T')[0]}.csv`,
      headers,
      rows
    );

    setExportMessage({
      type: 'success',
      text: `Exported ${rows.length} rows for "${title}" as CSV.`,
    });
    setTimeout(() => setExportMessage(null), 4000);
  };

  const handleDownloadShowcasePdf = async (
    e: React.MouseEvent<HTMLAnchorElement>
  ) => {
    e.preventDefault();
    setExportMessage({
      type: 'success',
      text: `Preparing ${SHOWCASE_PDF_FILENAME} (22 pages)...`,
    });
    const res = await downloadShowcaseRoadmapPdf();
    setExportMessage({
      type: res.success ? 'success' : 'error',
      text: res.success
        ? `Downloaded ${res.filename} (${((res.byteLength || 0) / (1024 * 1024)).toFixed(2)} MB, 22 pages)`
        : `Showcase PDF Download Error: ${res.error}`,
    });
    setTimeout(() => setExportMessage(null), 5000);
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-slate-500 mb-1">
            <span>Management Information System</span>
            <span aria-hidden="true">·</span>
            <span>Operational, Financial & Audit Reports</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-700">Report Center</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
            Standard Management Reports, Document Catalog & Requirements Register
          </h1>
          <p className="text-slate-500 mt-0.5">
            Live tabular reports and PDF / Excel (.xlsx) / CSV exports across Dispatch, Shop Floor, Receivables, Quality, Yard Stock, Job Costing, and Document Readiness.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={getShowcasePdfPublicUrl()}
            download={SHOWCASE_PDF_FILENAME}
            onClick={handleDownloadShowcasePdf}
            className="px-3.5 py-2 bg-[#14283F] hover:bg-[#234765] text-white border border-[#14283F] rounded-md font-semibold transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#F28C28]" />
            <span>Showcase &amp; Roadmap PDF</span>
          </a>
          <button
            onClick={handleDownloadExcel}
            className="px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-md font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Export Report (.xlsx)</span>
          </button>
          <button
            onClick={handleOpenReportPdf}
            className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-md font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-indigo-700" />
            <span>Printable PDF</span>
          </button>
          <button
            onClick={handleDownloadCsv}
            className="px-3.5 py-2 bg-slate-900 text-white rounded-md font-semibold hover:bg-slate-800 transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {exportMessage && (
        <div
          className={`p-3 rounded-lg border flex items-center justify-between ${
            exportMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {exportMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-medium">{exportMessage.text}</span>
          </div>
          <button
            onClick={() => setExportMessage(null)}
            className="text-slate-600 font-bold px-2"
          >
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Report Selector */}
        <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-1.5 h-fit">
          <span className="font-bold text-slate-900 text-sm block mb-2">
            Select Report View
          </span>
          {reportList.map((r) => (
            <button
              key={r.id}
              onClick={() => setReportType(r.id as any)}
              className={`w-full text-left p-2.5 rounded transition-colors cursor-pointer ${
                reportType === r.id
                  ? 'bg-slate-900 text-white font-semibold'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <div className="font-semibold">{r.name}</div>
              <div
                className={`text-[11px] line-clamp-2 mt-0.5 ${
                  reportType === r.id ? 'text-slate-300' : 'text-slate-500'
                }`}
              >
                {r.description}
              </div>
            </button>
          ))}
        </div>

        {/* Right Live Tabular Output */}
        <div className="lg:col-span-3 bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {reportList.find((r) => r.id === reportType)?.name}
              </h3>
              <p className="text-slate-500 text-[11px]">
                {reportList.find((r) => r.id === reportType)?.description}
              </p>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-slate-600">
              <FileSpreadsheet className="w-4 h-4 text-emerald-700" />
              <span>PDF · XLSX · CSV Ready</span>
            </div>
          </div>

          {/* 1. DAILY DISPATCH REPORT */}
          {reportType === 'daily_dispatch' && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 border-b uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Dispatch ID & Date</th>
                    <th className="py-2.5 px-3">Customer & PO</th>
                    <th className="py-2.5 px-3">Product</th>
                    <th className="py-2.5 px-3 text-right">Qty / Weight</th>
                    <th className="py-2.5 px-3">Transporter & LR</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dispatches.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3 font-mono">
                        <div className="font-bold text-slate-900">{d.id}</div>
                        <div className="text-slate-500 text-[11px]">{d.date}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-900">{d.customer}</div>
                        <div className="font-mono text-slate-500 text-[11px]">{d.orderNo}</div>
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-800">{d.product}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        <div className="font-bold text-slate-900">{d.quantity} PCS</div>
                        <div className="text-[11px] text-slate-500">{d.weightMt} MT</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-800">{d.transporter}</div>
                        <div className="font-mono text-indigo-700 text-[11px]">{d.lrNumber}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusBadge status={d.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 2. DAILY PRODUCTION REPORT */}
          {reportType === 'daily_production' && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 border-b uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Log ID & Shift</th>
                    <th className="py-2.5 px-3">Machine & Operator</th>
                    <th className="py-2.5 px-3">Job & Product</th>
                    <th className="py-2.5 px-3 text-right">Billets / Forged</th>
                    <th className="py-2.5 px-3 text-right">OK / Rejected</th>
                    <th className="py-2.5 px-3 text-right">Utilization</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {machineLogs.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3">
                        <div className="font-mono font-bold text-slate-900">{m.id}</div>
                        <div className="text-[11px] text-slate-500">{m.shift}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-900">{m.machineName}</div>
                        <div className="text-[11px] text-slate-500">{m.operatorName}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-mono font-bold text-indigo-700">{m.jobNumber}</div>
                        <div className="text-[11px] text-slate-700">{m.productName}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {m.inputBilletsPcs} / {m.forgedOutputPcs} PCS
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        <span className="text-emerald-700 font-bold">{m.okPcs}</span> /{' '}
                        <span className="text-rose-700 font-bold">{m.rejectedPcs}</span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                        {m.capacityUtilizationPercent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 3. RECEIVABLES AGEING REPORT */}
          {reportType === 'outstanding' && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 border-b uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Customer Account</th>
                    <th className="py-2.5 px-3 text-right">Total Due</th>
                    <th className="py-2.5 px-3 text-right">0–30 Days</th>
                    <th className="py-2.5 px-3 text-right">31–60 Days</th>
                    <th className="py-2.5 px-3 text-right">61–90 Days</th>
                    <th className="py-2.5 px-3 text-right text-rose-700">90+ Days</th>
                    <th className="py-2.5 px-3">Credit Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {outstandingAgeing.map((o) => (
                    <tr key={o.customerId} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900">{o.customerName}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          Limit: ₹{(o.creditLimit / 100000).toFixed(2)}L
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                        ₹{(o.totalOutstanding / 100000).toFixed(2)}L
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                        ₹{(o.bucket0to30 / 100000).toFixed(2)}L
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                        ₹{(o.bucket31to60 / 100000).toFixed(2)}L
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-700">
                        ₹{(o.bucket61to90 / 100000).toFixed(2)}L
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-rose-700">
                        ₹{(o.bucket90Plus / 100000).toFixed(2)}L
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusBadge
                          status={o.creditExceeded ? 'critical' : 'adequate'}
                          label={o.creditExceeded ? 'Credit Limit Exceeded' : 'Within Limit'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 4. QUALITY & REJECTION REPORT */}
          {reportType === 'rejection' && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 border-b uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Inspection ID</th>
                    <th className="py-2.5 px-3">Job & Customer</th>
                    <th className="py-2.5 px-3">Product & Heat</th>
                    <th className="py-2.5 px-3 text-right">Inspected</th>
                    <th className="py-2.5 px-3 text-right">Passed</th>
                    <th className="py-2.5 px-3 text-right">Rejected</th>
                    <th className="py-2.5 px-3">MTC Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inspections.map((q) => (
                    <tr key={q.id} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{q.id}</td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-900">{q.customer}</div>
                        <div className="font-mono text-[11px] text-indigo-700">{q.jobNumber}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-800">{q.product}</div>
                        <div className="font-mono text-[11px] text-slate-500">{q.heatNo}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {q.inspectedQty}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700 font-bold">
                        {q.passedQty}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-rose-700 font-bold">
                        {q.rejectedQty}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-indigo-700">{q.mtcNumber}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 5. RAW MATERIAL STOCK & CONSUMPTION */}
          {reportType === 'stock' && (
            <div className="space-y-4 p-4">
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 border-b uppercase font-semibold text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Code & Grade</th>
                      <th className="py-2.5 px-3 text-right">Physical (MT)</th>
                      <th className="py-2.5 px-3 text-right">Reserved (MT)</th>
                      <th className="py-2.5 px-3 text-right">Free Available</th>
                      <th className="py-2.5 px-3 text-right">Min / Reorder</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rawMaterials.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/60">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">{m.grade}</div>
                          <div className="font-mono text-[11px] text-slate-500">
                            {m.code} · {m.dimensionsMm}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold">
                          {m.currentStockMt.toFixed(1)} MT
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                          {m.reservedStockMt.toFixed(1)} MT
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-emerald-700">
                          {m.availableStockMt.toFixed(1)} MT
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                          {m.minimumStockMt.toFixed(1)} / {m.reorderLevelMt.toFixed(1)} MT
                        </td>
                        <td className="py-2.5 px-3">
                          <StatusBadge status={m.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                Recent Stock Ledger Movements: {stockMovements.length} verified entries in{' '}
                <code>/inventory/stockMovements</code>.
              </div>
            </div>
          )}

          {/* 6. JOB COSTING & PROFITABILITY */}
          {reportType === 'job_costing' && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 border-b uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Job & Customer</th>
                    <th className="py-2.5 px-3">Product</th>
                    <th className="py-2.5 px-3 text-right">Revenue</th>
                    <th className="py-2.5 px-3 text-right">Net 8-Head Cost</th>
                    <th className="py-2.5 px-3 text-right">Gross Margin</th>
                    <th className="py-2.5 px-3 text-right">Margin % vs Quoted</th>
                    <th className="py-2.5 px-3">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeJobCostSheets.map((j) => {
                    const { totalCostInr, grossMarginInr, marginPercent } =
                      computeJobCostTotals(j);
                    const onTarget = marginPercent >= j.quotedMarginPercent;
                    return (
                      <tr key={j.jobNumber} className="hover:bg-slate-50/60">
                        <td className="py-2.5 px-3">
                          <div className="font-mono font-bold text-indigo-700">{j.jobNumber}</div>
                          <div className="font-semibold text-slate-900">{j.customerName}</div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-800">{j.productName}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold">
                          ₹{(j.totalRevenueInr / 100000).toFixed(2)}L
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                          ₹{(totalCostInr / 100000).toFixed(2)}L
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-emerald-700">
                          ₹{(grossMarginInr / 100000).toFixed(2)}L
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          <span className="font-bold text-slate-900">{marginPercent}%</span>{' '}
                          <span className="text-slate-400">(Qtd {j.quotedMarginPercent}%)</span>
                        </td>
                        <td className="py-2.5 px-3">
                          <StatusBadge
                            status={onTarget ? 'completed' : 'warning'}
                            label={onTarget ? 'On Target' : 'Margin Compression'}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* 7. CLIENT REQUIREMENTS COVERAGE REGISTER */}
          {reportType === 'requirements_register' && (
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b">
                <div className="flex items-center gap-1.5">
                  <ClipboardCheck className="w-4 h-4 text-emerald-600" />
                  <span className="font-bold text-slate-900">
                    Phase 1 Audit — Full Client Requirements Coverage ({filteredReqs.length} of{' '}
                    {CLIENT_REQUIREMENTS_REGISTER.length} Areas)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  {['all', 'Implemented', 'Partially Implemented', 'Requires Client Input'].map(
                    (st) => (
                      <button
                        key={st}
                        onClick={() => setReqFilter(st)}
                        className={`px-2 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                          reqFilter === st
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {st === 'all' ? 'All Areas' : st}
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 border-b uppercase font-semibold text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Area & Requirement</th>
                      <th className="py-2.5 px-3">Module & Data Fields</th>
                      <th className="py-2.5 px-3">Implementation & Source Files</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3">Notes / Client Input</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredReqs.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/60 align-top">
                        <td className="py-2.5 px-3">
                          <div className="font-mono font-bold text-indigo-700">
                            {r.sectionCode} · {r.areaTitle}
                          </div>
                          <div className="font-bold text-slate-900 mt-0.5">
                            {r.requirementSummary}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {r.businessPurpose}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-800">{r.moduleName}</div>
                          <div className="font-mono text-[10px] text-slate-500 mt-1">
                            {r.keyDataFields.join(', ')}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="text-slate-700 text-[11px]">{r.implementationNotes}</div>
                          <div className="font-mono text-[10px] text-indigo-700 mt-1">
                            {r.sourceFiles.join(', ')}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded font-semibold text-[10px] ${
                              r.status === 'Implemented'
                                ? 'bg-emerald-100 text-emerald-800'
                                : r.status === 'Requires Client Input'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-[11px] text-slate-600">
                          {r.clientActionOrDependency || r.implementationNotes}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 8. DOCUMENT & EXPORT READINESS CLASSIFICATION CATALOG */}
          {reportType === 'document_catalog' && (
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b">
                <div className="flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-indigo-700" />
                  <span className="font-bold text-slate-900">
                    Document & Export Readiness Classification ({filteredDocCatalog.length} of{' '}
                    {MONTEX_DOCUMENT_CLASSIFICATION_CATALOG.length} Document Types)
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-slate-400" />
                  {[
                    { id: 'all', label: 'All (19)' },
                    { id: 'ready', label: 'Ready to Generate' },
                    { id: 'draft_missing_fields', label: 'Draft — Missing Required Fields' },
                    { id: 'not_supported_yet', label: 'Not Supported Yet' },
                  ].map((st) => (
                    <button
                      key={st.id}
                      onClick={() => setDocReadinessFilter(st.id)}
                      className={`px-2 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                        docReadinessFilter === st.id
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 border-b uppercase font-semibold text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Document Type & Category</th>
                      <th className="py-2.5 px-3">Readiness Classification</th>
                      <th className="py-2.5 px-3">Formats & RBAC</th>
                      <th className="py-2.5 px-3">Available Source Fields</th>
                      <th className="py-2.5 px-3">Missing Fields & Disclaimer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredDocCatalog.map((doc) => (
                      <tr key={doc.documentTypeId} className="hover:bg-slate-50/60 align-top">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900">{doc.title}</div>
                          <div className="font-mono text-[10px] text-indigo-700 mt-0.5">
                            {doc.documentTypeId} · {doc.category}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded font-semibold text-[10px] ${
                              doc.readiness === 'ready'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : doc.readiness === 'draft_missing_fields'
                                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                : 'bg-rose-100 text-rose-800 border border-rose-200'
                            }`}
                          >
                            {doc.readinessLabel}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-mono font-bold text-slate-800 text-[11px]">
                            {doc.supportedFormats.length > 0
                              ? doc.supportedFormats.join(' · ')
                              : 'NONE'}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-1">
                            Roles: {doc.authorizedRoles.join(', ')}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[10px] text-slate-600 max-w-xs">
                          {doc.availableSourceFields.length > 0
                            ? doc.availableSourceFields.join(', ')
                            : 'None in current schema'}
                        </td>
                        <td className="py-2.5 px-3 max-w-sm">
                          {doc.missingSourceFields.length > 0 && (
                            <div className="text-[10px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded p-1.5 mb-1">
                              Missing: {doc.missingSourceFields.join('; ')}
                            </div>
                          )}
                          <div className="text-[11px] text-slate-600">{doc.disclaimer}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <DocumentPreviewModal
        payload={previewPayload}
        onClose={() => setPreviewPayload(null)}
      />
    </div>
  );
};
