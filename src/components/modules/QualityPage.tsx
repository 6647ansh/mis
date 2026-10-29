import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertOctagon, ClipboardCheck, Download, FileText, MoreHorizontal, Plus, Ruler, ShieldCheck } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { DimensionalInspectionReport, NcrCapaRecord, OrderJourney, QualityInspectionRecord } from '../../types/mis';
import type { MontexPdfDocumentPayload } from '../../services/documentExportService';
import { DIR_DIMENSIONS } from '../../services/firestoreMappers';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
import { ClearanceQueue, isAwaitingQualityClearance } from '../orders/ClearanceQueue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader, StatTile } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/overlays';
import { cn, formatDate, formatNumber, newRecordId, todayIso } from '@/lib/utils';

const QC_WRITERS = ['super_admin', 'ceo', 'quality'];

const LOT_RESULT: Record<string, { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = {
  cleared: { tone: 'success', label: 'Passed' },
  in_progress: { tone: 'warning', label: 'In progress' },
  pending: { tone: 'neutral', label: 'Pending' },
  rejected: { tone: 'danger', label: 'Rejected' },
};
const DIR_STATUS: Record<string, { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  witnessed_cleared: { tone: 'success', label: 'Cleared' },
  offered_to_tpi: { tone: 'warning', label: 'Offered to TPI' },
  rework_advised: { tone: 'danger', label: 'Rework advised' },
};
const NCR_CATEGORIES = ['Dimensional', 'Surface Crack', 'UT Indication', 'Hardness Deviation', 'Chemistry Mix', 'Machining Error'];
const NCR_DISPOSITIONS = ['Hold', 'Rework', 'Scrap', 'Use As Is (Concession)'];
const isNcrClosed = (n: NcrCapaRecord) => n.status === 'Verified & Closed' || n.status === 'verified_closed';

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

function useWriteToast() {
  return (res: { success: boolean; error?: string; warning?: string }, ok: string, detail?: string) => {
    if (!res.success) toast.error('Not saved', { description: res.error || 'Please try again.' });
    else if (res.warning) toast.warning(ok, { description: res.warning });
    else toast.success(ok, { description: detail });
    return res.success;
  };
}

export function QualityPage() {
  const { salesOrders, qualityInspections, dimensionalReports, ncrCapaRecords, currentUser, activeRbacGroup, upsertNcrCapaRecord } = useRtdb();
  const canWrite = currentUser.accountStatus === 'active' && QC_WRITERS.includes(currentUser.role);
  const [tab, setTab] = useState('queue');
  const [dialog, setDialog] = useState<'lot' | 'dir' | 'ncr' | null>(null);
  const [preview, setPreview] = useState<MontexPdfDocumentPayload | null>(null);
  const report = useWriteToast();

  const openOrders = useMemo(() => salesOrders.filter((o) => o.status !== 'completed'), [salesOrders]);
  const waiting = openOrders.filter(isAwaitingQualityClearance).length;
  const passed = qualityInspections.reduce((s, q) => s + q.passedQty, 0);
  const rejected = qualityInspections.reduce((s, q) => s + q.rejectedQty, 0);
  const passRate = passed + rejected > 0 ? (passed / (passed + rejected)) * 100 : null;
  const openNcrs = ncrCapaRecords.filter((n) => !isNcrClosed(n));

  const pdf = async (build: (svc: typeof import('../../services/documentExportService')) => MontexPdfDocumentPayload) => {
    const svc = await import('../../services/documentExportService');
    const check = svc.verifyExportPermission(currentUser, activeRbacGroup, ['Admin', 'Management', 'Production', 'Sales', 'Finance']);
    if (!check.allowed) return toast.error('Export not allowed', { description: check.error });
    setPreview(build(svc));
  };

  const exportExcel = async () => {
    const svc = await import('../../services/documentExportService');
    const res = svc.exportMontexExcelWorkbook(
      `Montex_Quality_${todayIso()}.xlsx`,
      [
        {
          sheetName: 'Inspection lots',
          reportTitle: 'MONTEX MIS — INSPECTION LOTS',
          reportSubtitle: `${qualityInspections.length} lots`,
          headers: ['Lot', 'Date', 'Job', 'Customer', 'Product', 'Grade', 'Heat', 'Inspected', 'Passed', 'Rejected', 'Result', 'MTC', 'Inspector'],
          rows: qualityInspections.map((q) => [q.id, q.date, q.jobNumber, q.customer, q.product, q.grade, q.heatNo, q.inspectedQty, q.passedQty, q.rejectedQty, LOT_RESULT[q.status]?.label || q.status, q.mtcNumber, q.inspector]),
        },
        {
          sheetName: 'NCR CAPA',
          reportTitle: 'MONTEX MIS — NON-CONFORMANCE REPORTS',
          reportSubtitle: `${ncrCapaRecords.length} NCRs`,
          headers: ['NCR', 'Raised', 'Job', 'Category', 'Description', 'Affected MT', 'Disposition', 'Status', 'Root cause', 'Corrective action', 'Raised by'],
          rows: ncrCapaRecords.map((n) => [n.ncrNumber, n.dateRaised || '', n.jobNumber, n.defectCategory, n.defectDescription, n.affectedQtyMT ?? '', n.disposition || '', n.status, n.rootCauseAnalysis, n.correctiveAction, n.raisedByName || '']),
        },
      ],
      currentUser.email
    );
    if (res.success) toast.success('Download started', { description: res.filename });
    else toast.error('Export failed', { description: res.error });
  };

  const closeNcr = async (n: NcrCapaRecord) => {
    const res = await upsertNcrCapaRecord({ ...n, status: 'Verified & Closed', verifiedByUid: currentUser.id, verifiedByName: currentUser.name, verifiedAt: todayIso(), closedAt: todayIso() });
    report(res, `${n.ncrNumber} closed`);
  };
  const advanceNcr = async (n: NcrCapaRecord, status: NcrCapaRecord['status']) => {
    const res = await upsertNcrCapaRecord({ ...n, status });
    report(res, `${n.ncrNumber} updated`);
  };

  const lotColumns: Column<QualityInspectionRecord>[] = [
    {
      id: 'lot',
      header: 'Lot / job',
      sortValue: (q) => q.date,
      cell: (q) => (
        <div>
          <p className="whitespace-nowrap font-mono text-xs font-semibold">{q.jobNumber}</p>
          <p className="text-xs text-muted-foreground">{formatDate(q.date)}</p>
        </div>
      ),
    },
    {
      id: 'what',
      header: 'Product',
      hideBelow: 'md',
      cell: (q) => (
        <div className="max-w-60">
          <p className="truncate">{q.product}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[q.grade, q.heatNo && `Heat ${q.heatNo}`].filter(Boolean).join(' · ')}
          </p>
        </div>
      ),
    },
    {
      id: 'qty',
      header: 'Passed / inspected',
      align: 'right',
      sortValue: (q) => q.inspectedQty,
      cell: (q) => (
        <div className="whitespace-nowrap text-right font-mono">
          {formatNumber(q.passedQty)} / {formatNumber(q.inspectedQty)}
          {q.rejectedQty > 0 && <p className="text-xs text-destructive">{formatNumber(q.rejectedQty)} rejected</p>}
        </div>
      ),
    },
    { id: 'result', header: 'Result', hideBelow: 'sm', cell: (q) => <Badge tone={LOT_RESULT[q.status]?.tone}>{LOT_RESULT[q.status]?.label || q.status}</Badge> },
    { id: 'mtc', header: 'MTC', hideBelow: 'lg', cell: (q) => <span className="font-mono text-xs">{q.mtcNumber || '—'}</span> },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: (q) => {
        const order = salesOrders.find((o) => o.jobNumber === q.jobNumber);
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`Documents for ${q.id}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => pdf((svc) => svc.buildQualityInspectionPdfPayload(q, order, currentUser, activeRbacGroup))}>
                <FileText /> Inspection report
              </DropdownMenuItem>
              {order && (
                <DropdownMenuItem
                  onSelect={() =>
                    pdf((svc) => svc.buildMtcDraftPdfPayload(order, q, dimensionalReports.find((d) => d.jobNumber === q.jobNumber), currentUser, activeRbacGroup))
                  }
                >
                  <FileText /> MTC data summary (draft)
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const dirColumns: Column<DimensionalInspectionReport>[] = [
    {
      id: 'job',
      header: 'Report / job',
      sortValue: (d) => d.inspectionDate,
      cell: (d) => (
        <div>
          <p className="whitespace-nowrap font-mono text-xs font-semibold">{d.jobNumber}</p>
          <p className="text-xs text-muted-foreground">
            {d.id} · {formatDate(d.inspectionDate)}
          </p>
        </div>
      ),
    },
    { id: 'drawing', header: 'Drawing', hideBelow: 'md', cell: (d) => <span className="font-mono text-xs">{d.drawingNo || '—'}</span> },
    {
      id: 'od',
      header: 'OD nominal / measured',
      align: 'right',
      hideBelow: 'sm',
      cell: (d) => {
        const od = d.parameters[0];
        return od ? <span className="whitespace-nowrap font-mono">{od.nominalMm} / {od.measuredMaxMm} mm</span> : '—';
      },
    },
    { id: 'tpi', header: 'TPI', hideBelow: 'lg', cell: (d) => d.tpiAgency || '—' },
    { id: 'status', header: 'Status', cell: (d) => <Badge tone={DIR_STATUS[d.offeringStatus]?.tone}>{DIR_STATUS[d.offeringStatus]?.label || d.offeringStatus}</Badge> },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: (d) => (
        <Button size="icon-sm" variant="ghost" aria-label={`Open ${d.id} PDF`} onClick={() => pdf((svc) => svc.buildDimensionalReportPdfPayload(d, currentUser, activeRbacGroup))}>
          <FileText />
        </Button>
      ),
    },
  ];

  const ncrColumns: Column<NcrCapaRecord>[] = [
    {
      id: 'ncr',
      header: 'NCR / job',
      sortValue: (n) => n.createdAt || n.dateRaised || '',
      cell: (n) => (
        <div>
          <p className="whitespace-nowrap font-mono text-xs font-semibold">{n.ncrNumber}</p>
          <p className="text-xs text-muted-foreground">
            {n.jobNumber} · {formatDate(n.dateRaised)}
          </p>
        </div>
      ),
    },
    {
      id: 'defect',
      header: 'Defect',
      cell: (n) => (
        <div className="max-w-72">
          <p className="font-medium">{n.defectCategory}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{n.defectDescription}</p>
        </div>
      ),
    },
    { id: 'qty', header: 'Affected', align: 'right', hideBelow: 'md', cell: (n) => <span className="whitespace-nowrap font-mono">{n.affectedQtyMT ? `${formatNumber(n.affectedQtyMT, 2)} MT` : '—'}</span> },
    { id: 'disp', header: 'Disposition', hideBelow: 'lg', cell: (n) => n.disposition || '—' },
    { id: 'status', header: 'Status', cell: (n) => <Badge tone={isNcrClosed(n) ? 'success' : 'warning'}>{n.status}</Badge> },
    ...(canWrite
      ? [
          {
            id: 'act',
            header: '',
            align: 'right' as const,
            cell: (n: NcrCapaRecord) =>
              isNcrClosed(n) ? null : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label={`Update ${n.ncrNumber}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => advanceNcr(n, 'Root Cause Analysis')}>Mark: root cause found</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => advanceNcr(n, 'CAPA Implemented')}>Mark: CAPA implemented</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => closeNcr(n)}>Verify and close</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Quality & MTC"
        description="Inspect lots, record dimensional reports, track NCRs, and give the quality clearance an order needs before it can ship."
        actions={
          <>
            <Button variant="secondary" onClick={exportExcel}>
              <Download /> Export
            </Button>
            {canWrite && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    <Plus /> Record
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setDialog('lot')}>
                    <ClipboardCheck /> Inspection lot
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog('dir')}>
                    <Ruler /> Dimensional report
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog('ncr')}>
                    <AlertOctagon /> Non-conformance (NCR)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Waiting clearance" icon={ShieldCheck} tone={waiting ? 'warning' : 'neutral'} value={waiting} hint="Orders at inspection" onClick={() => setTab('queue')} />
        <StatTile label="Pass rate" icon={ClipboardCheck} value={passRate === null ? '—' : formatNumber(passRate, 1)} unit={passRate === null ? undefined : '%'} hint={`${formatNumber(passed + rejected)} pcs judged, last 90 days`} onClick={() => setTab('lots')} />
        <StatTile label="Rejected" icon={AlertOctagon} tone={rejected ? 'danger' : 'neutral'} value={formatNumber(rejected)} unit="pcs" hint="Lots in the last 90 days" onClick={() => setTab('lots')} />
        <StatTile label="Open NCRs" icon={AlertOctagon} tone={openNcrs.length ? 'warning' : 'neutral'} value={openNcrs.length} hint={`${ncrCapaRecords.length - openNcrs.length} closed`} onClick={() => setTab('ncr')} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="queue">Clearance queue</TabsTrigger>
          <TabsTrigger value="lots">Inspection lots</TabsTrigger>
          <TabsTrigger value="dir">Dimensional reports</TabsTrigger>
          <TabsTrigger value="ncr">
            NCR / CAPA
            {openNcrs.length > 0 && <span className="rounded-full bg-warning-soft px-1.5 text-[11px] tabular-nums text-warning">{openNcrs.length}</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="queue" className="mt-4">
          <ClearanceQueue kind="quality" />
        </TabsContent>
        <TabsContent value="lots" className="mt-4">
          <DataTable
            rows={qualityInspections}
            columns={lotColumns}
            rowKey={(q) => q.id}
            searchText={(q) => `${q.jobNumber} ${q.customer} ${q.product} ${q.heatNo} ${q.mtcNumber}`}
            searchPlaceholder="Search job, customer, heat or MTC"
            initialSort={{ id: 'lot', desc: true }}
            emptyTitle="No lots inspected yet"
            emptyDescription={canWrite ? 'Use Record → Inspection lot after checking a lot.' : undefined}
          />
        </TabsContent>
        <TabsContent value="dir" className="mt-4">
          <DataTable
            rows={dimensionalReports}
            columns={dirColumns}
            rowKey={(d) => d.id}
            searchText={(d) => `${d.jobNumber} ${d.drawingNo} ${d.tpiAgency} ${d.id}`}
            searchPlaceholder="Search job, drawing or TPI agency"
            initialSort={{ id: 'job', desc: true }}
            emptyTitle="No dimensional reports yet"
          />
        </TabsContent>
        <TabsContent value="ncr" className="mt-4">
          <DataTable
            rows={ncrCapaRecords}
            columns={ncrColumns}
            rowKey={(n) => n.id}
            searchText={(n) => `${n.ncrNumber} ${n.jobNumber} ${n.defectCategory} ${n.defectDescription}`}
            searchPlaceholder="Search NCR, job or defect"
            initialSort={{ id: 'ncr', desc: true }}
            emptyTitle="No NCRs raised"
          />
        </TabsContent>
      </Tabs>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog && (
          <DialogContent className="sm:max-w-xl">
            {dialog === 'lot' && <LotForm orders={openOrders} onDone={() => setDialog(null)} />}
            {dialog === 'dir' && <DirForm orders={openOrders} onDone={() => setDialog(null)} />}
            {dialog === 'ncr' && <NcrForm orders={salesOrders} onDone={() => setDialog(null)} />}
          </DialogContent>
        )}
      </Dialog>

      <DocumentPreviewModal payload={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function JobSelect({ id, orders, value, onChange }: { id: string; orders: OrderJourney[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a job</option>
      {orders.map((o) => (
        <option key={o.id} value={o.jobNumber}>
          {o.jobNumber} · {o.customerName}
        </option>
      ))}
    </Select>
  );
}

function FormShell({ title, description, error, saving, submitLabel, onCancel, onSubmit, children }: {
  title: string;
  description: string;
  error: string;
  saving: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-danger-soft p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function LotForm({ orders, onDone }: { orders: OrderJourney[]; onDone: () => void }) {
  const { currentUser, recordQualityInspectionRecord } = useRtdb();
  const report = useWriteToast();
  const [job, setJob] = useState('');
  const [inspected, setInspected] = useState('');
  const [passedQ, setPassedQ] = useState('');
  const [rejectedQ, setRejectedQ] = useState('');
  const [mtc, setMtc] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const order = orders.find((o) => o.jobNumber === job);
  const li = order?.lineItems?.[0];
  const i = num(inspected);
  const p = num(passedQ);
  const r = num(rejectedQ);
  const left = Number.isFinite(i) ? i - (Number.isFinite(p) ? p : 0) - (Number.isFinite(r) ? r : 0) : NaN;

  const submit = async () => {
    if (!order) return setError('Choose the job you inspected.');
    if (!(i > 0)) return setError('Enter how many pieces were inspected.');
    if (!(p >= 0) || !(r >= 0)) return setError('Enter passed and rejected pieces (0 if none).');
    if (p + r > i) return setError(`Passed + rejected (${p + r}) is more than inspected (${i}).`);
    setError('');
    setSaving(true);
    const res = await recordQualityInspectionRecord({
      id: newRecordId('QC'),
      jobNumber: order.jobNumber,
      customer: order.customerName,
      product: li?.productName || '',
      grade: li?.materialGrade || order.materialStatus?.materialGrade || '',
      heatNo: order.materialStatus?.heatNumber || '',
      inspectedQty: i,
      passedQty: p,
      rejectedQty: r,
      status: r === i ? 'rejected' : p + r < i ? 'in_progress' : 'cleared',
      inspector: currentUser.name,
      date: todayIso(),
      mtcNumber: mtc.trim(),
    });
    setSaving(false);
    if (report(res, 'Inspection lot recorded', `${order.jobNumber}: ${p} passed, ${r} rejected`)) onDone();
  };

  return (
    <FormShell title="Record inspection lot" description="Passed and rejected pieces are added to the order's QC totals." error={error} saving={saving} submitLabel="Save lot" onCancel={onDone} onSubmit={submit}>
      <Field label="Job" htmlFor="lot-job">
        <JobSelect id="lot-job" orders={orders} value={job} onChange={setJob} />
      </Field>
      {li && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          {li.productName} · made {formatNumber(li.producedQty)} · passed so far {formatNumber(li.inspectedOkQty)} · rejected so far {formatNumber(li.rejectedQty)}
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Inspected" htmlFor="lot-i">
          <Input id="lot-i" inputMode="numeric" value={inspected} onChange={(e) => setInspected(e.target.value.replace(/[^0-9]/g, ''))} />
        </Field>
        <Field label="Passed" htmlFor="lot-p">
          <Input id="lot-p" inputMode="numeric" value={passedQ} onChange={(e) => setPassedQ(e.target.value.replace(/[^0-9]/g, ''))} />
        </Field>
        <Field label="Rejected" htmlFor="lot-r" hint="Includes rework">
          <Input id="lot-r" inputMode="numeric" value={rejectedQ} onChange={(e) => setRejectedQ(e.target.value.replace(/[^0-9]/g, ''))} />
        </Field>
      </div>
      {Number.isFinite(left) && (
        <p className={cn('text-xs', left < 0 ? 'font-medium text-destructive' : 'text-muted-foreground')}>
          {left < 0 ? `${formatNumber(-left)} more than inspected` : left > 0 ? `${formatNumber(left)} pieces not yet judged — lot stays in progress` : 'Every inspected piece is judged'}
        </p>
      )}
      <Field label="MTC number (optional)" htmlFor="lot-mtc" hint="Only if the certificate is already issued">
        <Input id="lot-mtc" className="font-mono" maxLength={64} value={mtc} onChange={(e) => setMtc(e.target.value)} />
      </Field>
    </FormShell>
  );
}

function DirForm({ orders, onDone }: { orders: OrderJourney[]; onDone: () => void }) {
  const { currentUser, createDimensionalReportRecord } = useRtdb();
  const report = useWriteToast();
  const [job, setJob] = useState('');
  const [drawing, setDrawing] = useState('');
  const [sample, setSample] = useState('');
  const [tpi, setTpi] = useState('');
  const [status, setStatus] = useState<DimensionalInspectionReport['offeringStatus']>('offered_to_tpi');
  const [rows, setRows] = useState(DIR_DIMENSIONS.map(() => ({ nominal: '', measured: '', ok: true })));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const setRow = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    const order = orders.find((o) => o.jobNumber === job);
    if (!order) return setError('Choose the job you measured.');
    if (!(Number(sample) > 0)) return setError('Enter the sample size (pieces measured).');
    if (!(Number(rows[0].nominal) > 0 && Number(rows[0].measured) > 0)) return setError('Outer diameter needs both nominal and measured values.');
    const half = rows.findIndex((r) => Boolean(r.nominal) !== Boolean(r.measured));
    if (half > 0) return setError(`${DIR_DIMENSIONS[half]}: enter both nominal and measured, or leave both empty.`);
    setError('');
    setSaving(true);
    const res = await createDimensionalReportRecord({
      id: newRecordId('DIR'),
      jobNumber: order.jobNumber,
      orderNo: order.poNumber,
      customerName: order.customerName,
      productName: order.lineItems?.[0]?.productName || '',
      drawingNo: drawing.trim(),
      sampleSizePcs: Number(sample),
      inspectorName: currentUser.name,
      tpiAgency: tpi.trim(),
      inspectionDate: todayIso(),
      offeringStatus: status,
      parameters: rows.map((r, i) => ({
        dimensionName: DIR_DIMENSIONS[i],
        nominalMm: r.nominal,
        toleranceMm: '',
        measuredMinMm: r.measured,
        measuredMaxMm: r.measured,
        instrumentUsed: '',
        result: r.ok ? 'OK' : 'DEVIATION',
      })),
    });
    setSaving(false);
    if (report(res, 'Dimensional report saved', order.jobNumber)) onDone();
  };

  return (
    <FormShell title="Dimensional report" description="Record measured sizes against the drawing. Outer diameter is required; bore and height if measured." error={error} saving={saving} submitLabel="Save report" onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job" htmlFor="dir-job">
          <JobSelect id="dir-job" orders={orders} value={job} onChange={setJob} />
        </Field>
        <Field label="Drawing number" htmlFor="dir-drg">
          <Input id="dir-drg" className="font-mono" maxLength={80} value={drawing} onChange={(e) => setDrawing(e.target.value)} />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-[13px] font-medium">Measurements (mm)</legend>
        {DIR_DIMENSIONS.map((name, i) => (
          <div key={name} className="grid grid-cols-[1fr_5.5rem_5.5rem_auto] items-center gap-2">
            <span className="text-sm">{name}</span>
            <Input aria-label={`${name} nominal`} placeholder="Nominal" inputMode="decimal" value={rows[i].nominal} onChange={(e) => setRow(i, { nominal: e.target.value.replace(/[^0-9.]/g, '') })} />
            <Input aria-label={`${name} measured`} placeholder="Measured" inputMode="decimal" value={rows[i].measured} onChange={(e) => setRow(i, { measured: e.target.value.replace(/[^0-9.]/g, '') })} />
            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
              <input type="checkbox" className="size-4" checked={rows[i].ok} onChange={(e) => setRow(i, { ok: e.target.checked })} /> In tolerance
            </label>
          </div>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Sample size" htmlFor="dir-ss">
          <Input id="dir-ss" inputMode="numeric" value={sample} onChange={(e) => setSample(e.target.value.replace(/[^0-9]/g, ''))} />
        </Field>
        <Field label="TPI agency" htmlFor="dir-tpi" hint="Blank if internal">
          <Input id="dir-tpi" maxLength={40} value={tpi} onChange={(e) => setTpi(e.target.value)} />
        </Field>
        <Field label="Status" htmlFor="dir-st">
          <Select id="dir-st" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="offered_to_tpi">Offered to TPI</option>
            <option value="witnessed_cleared">Cleared</option>
            <option value="rework_advised">Rework advised</option>
          </Select>
        </Field>
      </div>
    </FormShell>
  );
}

function NcrForm({ orders, onDone }: { orders: OrderJourney[]; onDone: () => void }) {
  const { currentUser, upsertNcrCapaRecord } = useRtdb();
  const report = useWriteToast();
  const [job, setJob] = useState('');
  const [batch, setBatch] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [affected, setAffected] = useState('');
  const [disposition, setDisposition] = useState('Hold');
  const [rootCause, setRootCause] = useState('');
  const [corrective, setCorrective] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const order = orders.find((o) => o.jobNumber === job);
    if (!order) return setError('Choose the job with the defect.');
    if (!batch.trim()) return setError('Enter the lot, batch or heat number.');
    if (!category) return setError('Choose the defect category.');
    if (description.trim().length < 3) return setError('Describe the defect.');
    if (!(Number(affected) > 0)) return setError('Enter the affected quantity in MT.');
    setError('');
    setSaving(true);
    const id = newRecordId('NCR');
    const now = new Date().toISOString();
    const res = await upsertNcrCapaRecord(
      {
        id,
        ncrNumber: id,
        orderId: order.jobNumber,
        jobNumber: order.jobNumber,
        batchId: batch.trim(),
        customerName: order.customerName,
        productName: order.lineItems?.[0]?.productName || '',
        steelGrade: order.lineItems?.[0]?.materialGrade,
        heatNumber: order.materialStatus?.heatNumber || '',
        rejectedQtyPcs: 0,
        affectedQtyMT: Number(affected),
        defectCategory: category,
        defectDescription: description.trim(),
        rootCauseAnalysis: rootCause.trim(),
        correctiveAction: corrective.trim(),
        preventiveAction: '',
        disposition: disposition as NcrCapaRecord['disposition'],
        status: 'Open',
        raisedByUid: currentUser.id,
        raisedByName: currentUser.name,
        costOfPoorQualityInr: 0,
        createdAt: now,
      },
      true
    );
    setSaving(false);
    if (report(res, 'NCR raised', `${order.jobNumber} · ${category}`)) onDone();
  };

  return (
    <FormShell title="Raise NCR" description="Log a non-conformance and what is being done about it." error={error} saving={saving} submitLabel="Raise NCR" onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job" htmlFor="ncr-job">
          <JobSelect id="ncr-job" orders={orders} value={job} onChange={setJob} />
        </Field>
        <Field label="Lot / batch / heat" htmlFor="ncr-batch">
          <Input id="ncr-batch" className="font-mono" maxLength={80} value={batch} onChange={(e) => setBatch(e.target.value)} />
        </Field>
        <Field label="Defect category" htmlFor="ncr-cat">
          <Select id="ncr-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Choose</option>
            {NCR_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Affected quantity (MT)" htmlFor="ncr-mt">
          <Input id="ncr-mt" inputMode="decimal" value={affected} onChange={(e) => setAffected(e.target.value.replace(/[^0-9.]/g, ''))} />
        </Field>
      </div>
      <Field label="What is wrong" htmlFor="ncr-desc">
        <Textarea id="ncr-desc" rows={2} maxLength={600} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Disposition" htmlFor="ncr-disp">
          <Select id="ncr-disp" value={disposition} onChange={(e) => setDisposition(e.target.value)}>
            {NCR_DISPOSITIONS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
        </Field>
        <Field label="Root cause (if known)" htmlFor="ncr-rc">
          <Input id="ncr-rc" maxLength={600} value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
        </Field>
      </div>
      <Field label="Corrective action (if decided)" htmlFor="ncr-ca">
        <Input id="ncr-ca" maxLength={600} value={corrective} onChange={(e) => setCorrective(e.target.value)} />
      </Field>
    </FormShell>
  );
}
