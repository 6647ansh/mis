import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BarChart3, Boxes, ClipboardList, Download, Factory, FileDown, FileSpreadsheet, FileText, ShieldCheck, Truck, Wallet } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { MontexPdfDocumentPayload } from '../../services/documentExportService';
import type { RbacRoleGroup } from '../../types/mis';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Field, Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { cn, formatDate, todayIso } from '@/lib/utils';

type Cell = string | number;
type Report = {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Groups allowed to export; money reports are limited. */
  groups: RbacRoleGroup[];
  /** Index of the YYYY-MM-DD column the date range filters on; undefined = not dated. */
  dateCol?: number;
  headers: string[];
  rows: Cell[][];
};

const ALL_GROUPS: RbacRoleGroup[] = ['Admin', 'Management', 'Finance', 'Sales', 'Production'];
const MONEY_GROUPS: RbacRoleGroup[] = ['Admin', 'Management', 'Finance'];
const firstOfMonth = () => `${todayIso().slice(0, 7)}-01`;

export function ReportsPage() {
  const { salesOrders, dispatches, qualityInspections, machineLogs, outstandingAgeing, rawMaterials, stockMovements, jobCostSheets, currentUser, activeRbacGroup } = useRtdb();
  const [reportId, setReportId] = useState('orders');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayIso());
  const [preview, setPreview] = useState<MontexPdfDocumentPayload | null>(null);
  const today = todayIso();

  const reports: Report[] = useMemo(
    () => [
      {
        id: 'orders',
        name: 'Open orders',
        description: 'Every open order with stage, delivery date, days late and clearances.',
        icon: ClipboardList,
        groups: ALL_GROUPS,
        headers: ['Job', 'PO', 'Customer', 'PO date', 'Delivery', 'Days late', 'Ordered', 'Made', 'Passed', 'Shipped', 'Quality clr.', 'Finance clr.', 'Stage'],
        rows: salesOrders
          .filter((o) => o.status !== 'completed')
          .map((o) => {
            const li = o.lineItems?.[0];
            const late = o.targetDeliveryDate && o.targetDeliveryDate < today ? Math.floor((Date.parse(today) - Date.parse(o.targetDeliveryDate)) / 86_400_000) : 0;
            return [o.jobNumber, o.poNumber, o.customerName, o.poDate, o.targetDeliveryDate, late, li?.orderedQty ?? 0, li?.producedQty ?? 0, li?.inspectedOkQty ?? 0, o.dispatchStatus?.totalShippedQty ?? 0, o.qualityClearedBy ? 'Yes' : 'No', o.financeClearedBy ? 'Yes' : 'No', o.statusLabel || o.status];
          }),
      },
      {
        id: 'dispatch',
        name: 'Dispatches',
        description: 'Consignments shipped: transporter, vehicle, LR and quantities.',
        icon: Truck,
        groups: ALL_GROUPS,
        dateCol: 1,
        headers: ['Consignment', 'Date', 'Job', 'Customer', 'Product', 'Qty (pcs)', 'Weight (MT)', 'Transporter', 'Vehicle', 'LR no.', 'Invoice'],
        rows: dispatches.map((d) => [d.id, d.date, d.jobNumber, d.customer, d.product, d.quantity, d.weightMt, d.transporter, d.vehicleNo, d.lrNumber, d.invoiceRef || '']),
      },
      {
        id: 'production',
        name: 'Shift production',
        description: 'Output by machine and shift: OK, rejected, rework and downtime.',
        icon: Factory,
        groups: ALL_GROUPS,
        dateCol: 0,
        headers: ['Date', 'Shift', 'Machine', 'Operator', 'Job', 'Billets in', 'OK', 'Rejected', 'Rework', 'Downtime (min)'],
        rows: machineLogs.map((m) => [m.date, m.shift, m.machineName, m.operatorName, m.jobNumber, m.inputBilletsPcs, m.okPcs, m.rejectedPcs, m.reworkPcs, m.downtimeMinutes]),
      },
      {
        id: 'quality',
        name: 'Inspection & rejection',
        description: 'Inspection lots with passed and rejected pieces, heat and MTC.',
        icon: ShieldCheck,
        groups: ALL_GROUPS,
        dateCol: 0,
        headers: ['Date', 'Job', 'Customer', 'Product', 'Heat', 'Inspected', 'Passed', 'Rejected', 'Rejection %', 'MTC', 'Inspector'],
        rows: qualityInspections.map((q) => [q.date, q.jobNumber, q.customer, q.product, q.heatNo, q.inspectedQty, q.passedQty, q.rejectedQty, q.inspectedQty ? Number(((q.rejectedQty / q.inspectedQty) * 100).toFixed(1)) : 0, q.mtcNumber, q.inspector]),
      },
      {
        id: 'stock',
        name: 'Stock position',
        description: 'Raw material on hand, reserved and free, against reorder level.',
        icon: Boxes,
        groups: ALL_GROUPS,
        headers: ['Code', 'Grade', 'Size', 'On hand (MT)', 'Reserved (MT)', 'Free (MT)', 'Reorder (MT)', 'Supplier', 'Bay'],
        rows: rawMaterials.map((m) => [m.code, m.grade, m.dimensionsMm, m.currentStockMt, m.reservedStockMt, m.availableStockMt, m.reorderLevelMt, m.supplier, m.locationBay]),
      },
      {
        id: 'ledger',
        name: 'Stock movements',
        description: 'Every receipt, issue, return and adjustment with heat number.',
        icon: Boxes,
        groups: ALL_GROUPS,
        dateCol: 0,
        headers: ['Date', 'Material', 'Grade', 'Type', 'Heat', 'Qty (MT)', 'Balance (MT)', 'Reference', 'By'],
        rows: stockMovements.map((v) => [String(v.timestamp || '').slice(0, 10), v.materialCode, v.materialGrade, v.movementType, v.heatNumber, v.quantityMt, v.balanceAfterMt, v.referenceDoc, v.performedBy]),
      },
      {
        id: 'receivables',
        name: 'Receivables ageing',
        description: 'What each customer owes, by age, against credit limit.',
        icon: Wallet,
        groups: MONEY_GROUPS,
        headers: ['Customer', 'Credit limit', 'Outstanding', '0–30', '31–60', '61–90', '90+', 'Oldest invoice', 'Over limit'],
        rows: outstandingAgeing.map((a) => [a.customerName, a.creditLimit, a.totalOutstanding, a.bucket0to30, a.bucket31to60, a.bucket61to90, a.bucket90Plus, a.oldestInvoiceDate, a.creditExceeded ? 'Yes' : 'No']),
      },
      {
        id: 'margins',
        name: 'Job margins',
        description: 'Revenue, full cost and margin per job against the quoted margin.',
        icon: BarChart3,
        groups: MONEY_GROUPS,
        headers: ['Job', 'Customer', 'Product', 'Qty', 'Revenue', 'Cost', 'Margin', 'Margin %', 'Quoted %'],
        rows: jobCostSheets.map((j) => {
          const cost =
            j.materialCostInr - j.scrapRecoveryCreditInr + j.labourCostInr + j.powerCostInr + j.fuelHeatTreatmentCostInr +
            j.machiningProcessingCostInr + j.testingTpiCostInr + j.packingCostInr + j.transportFreightCostInr + j.overheadCostInr;
          const margin = j.totalRevenueInr - cost;
          return [j.jobNumber, j.customerName, j.productName, j.orderedQty, j.totalRevenueInr, cost, margin, j.totalRevenueInr ? Number(((margin / j.totalRevenueInr) * 100).toFixed(1)) : 0, j.quotedMarginPercent];
        }),
      },
    ],
    [salesOrders, dispatches, machineLogs, qualityInspections, rawMaterials, stockMovements, outstandingAgeing, jobCostSheets, today]
  );

  const visible = reports.filter((r) => r.groups.includes(activeRbacGroup as RbacRoleGroup));
  const report = visible.find((r) => r.id === reportId) || visible[0];
  const rows = useMemo(() => {
    if (!report) return [];
    if (report.dateCol === undefined) return report.rows;
    return report.rows.filter((r) => {
      const d = String(r[report.dateCol!] || '');
      return (!from || d >= from) && (!to || d <= to);
    });
  }, [report, from, to]);

  if (!report) {
    return (
      <div className="space-y-5">
        <PageHeader title="Reports" description="No reports are available for your role." />
      </div>
    );
  }

  const period = report.dateCol !== undefined ? `${formatDate(from)} – ${formatDate(to)}` : `As of ${formatDate(today)}`;
  const fileBase = `Montex_${report.name.replace(/[^A-Za-z0-9]+/g, '_')}_${today}`;

  const run = async (kind: 'xlsx' | 'csv' | 'pdf') => {
    const svc = await import('../../services/documentExportService');
    const check = svc.verifyExportPermission(currentUser, activeRbacGroup, report.groups);
    if (!check.allowed) return toast.error('Export not allowed', { description: check.error });
    if (rows.length === 0) return toast.error('Nothing to export', { description: 'No rows in the chosen period.' });
    if (kind === 'pdf') {
      setPreview({
        filename: `${fileBase}.pdf`,
        documentCode: `RPT-${report.id.toUpperCase()}-${today.replace(/-/g, '')}`,
        documentTitle: report.name.toUpperCase(),
        documentSubtitle: `${report.description} ${period}.`,
        readiness: 'ready',
        readinessBannerText: 'MANAGEMENT REPORT — generated from live MIS records',
        metadataGrid: [
          { label: 'Period', value: period },
          { label: 'Rows', value: rows.length },
          { label: 'Generated by', value: currentUser.name },
        ],
        tables: [{ sectionTitle: report.name, headers: report.headers, rows }],
        footerDisclaimer: 'Internal management report — Montex Forge Industries Pvt. Ltd.',
        generatedBy: currentUser.name,
        generatedRole: activeRbacGroup,
      } as MontexPdfDocumentPayload);
      return;
    }
    const res =
      kind === 'xlsx'
        ? svc.exportMontexExcelWorkbook(`${fileBase}.xlsx`, [{ sheetName: report.name.slice(0, 31), reportTitle: `MONTEX MIS — ${report.name.toUpperCase()}`, reportSubtitle: period, headers: report.headers, rows }], currentUser.email)
        : svc.exportMontexCsvFile(`${fileBase}.csv`, report.headers, rows);
    if (res.success) toast.success('Download started', { description: res.filename });
    else toast.error('Export failed', { description: res.error });
  };

  const columns: Column<{ i: number; r: Cell[] }>[] = report.headers.map((h, ci) => ({
    id: String(ci),
    header: h,
    align: typeof report.rows[0]?.[ci] === 'number' ? ('right' as const) : undefined,
    sortValue: (x: { r: Cell[] }) => x.r[ci] as string | number,
    hideBelow: ci > 4 ? ('lg' as const) : ci > 2 ? ('md' as const) : undefined,
    cell: (x: { r: Cell[] }) => {
      const v = x.r[ci];
      if (typeof v === 'number') return <span className="whitespace-nowrap font-mono">{v.toLocaleString('en-IN')}</span>;
      const text = String(v || '');
      // Codes and dates stay on one line; only long free text wraps.
      return text.length <= 24 ? <span className="whitespace-nowrap">{text || '—'}</span> : <span className="line-clamp-2 min-w-40 max-w-64">{text}</span>;
    },
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        description="Pick a report, set the period, check the rows, then download. Everything comes from the live records."
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Download /> Download
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => run('xlsx')}>
                <FileSpreadsheet /> Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run('csv')}>
                <FileDown /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => run('pdf')}>
                <FileText /> PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Report">
        {visible.map((r) => {
          const Icon = r.icon;
          const active = r.id === report.id;
          return (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setReportId(r.id)}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-3 text-left transition-[border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'border-bronze-500 shadow-raised' : 'border-border hover:border-slate-300'
              )}
            >
              <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', active ? 'bg-bronze-50 text-bronze-700' : 'bg-muted text-slate-600')}>
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{r.name}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{r.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{report.name}</h2>
          <p className="text-sm text-muted-foreground">
            {period} · {rows.length} rows {report.groups === MONEY_GROUPS && <Badge tone="bronze" className="ml-1">Finance & management only</Badge>}
          </p>
        </div>
        {report.dateCol !== undefined && (
          <div className="flex items-end gap-2">
            <Field label="From" htmlFor="rp-from">
              <Input id="rp-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To" htmlFor="rp-to">
              <Input id="rp-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        )}
      </div>

      <DataTable
        key={report.id}
        rows={rows.map((r, i) => ({ i, r }))}
        columns={columns}
        rowKey={(x) => String(x.i)}
        searchText={(x) => x.r.join(' ')}
        searchPlaceholder="Search within this report"
        pageSize={20}
        emptyTitle="No rows in this period"
        emptyDescription={report.dateCol !== undefined ? 'Widen the date range.' : undefined}
      />

      <DocumentPreviewModal payload={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
