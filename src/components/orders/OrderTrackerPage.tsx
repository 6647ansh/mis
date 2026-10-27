import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CalendarClock,
  Check,
  ClipboardList,
  Download,
  FileText,
  Package,
  PencilLine,
  Truck,
  UserRound,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { OrderJourney, OrderStatus } from '../../types/mis';
import type { MontexPdfDocumentPayload } from '../../services/documentExportService';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
import { OrderClearancePanel } from './OrderClearancePanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, PageHeader, StatTile } from '@/components/ui/data-display';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/overlays';
import { cn, formatDate, formatINR, formatNumber } from '@/lib/utils';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  po_registered: 'PO registered',
  job_assigned: 'Job assigned',
  material_pending: 'Material pending',
  material_allocated: 'Material allocated',
  in_production: 'In production',
  quality_pending: 'Quality inspection',
  quality_cleared: 'Quality cleared',
  clearance_pending: 'Customer inspection pending',
  clearance_approved: 'Customer inspection approved',
  ready_for_dispatch: 'Ready for dispatch',
  partially_dispatched: 'Partially dispatched',
  completed: 'Completed',
  on_hold: 'On hold',
};

const HANDOVER_GATES = [
  ['H-1', 'Sales → Planning'],
  ['H-2', 'Stores → Shop floor'],
  ['H-3', 'Shop floor → Quality'],
  ['H-4', 'Quality → Dispatch'],
  ['H-5', 'Dispatch → Billing'],
] as const;

const STAGE_EDITORS = ['super_admin', 'ceo', 'sales', 'purchase', 'stores', 'quality', 'dispatch', 'finance'];

/** Placeholder values ('-', '') read as "not recorded" instead of being shown as data. */
const shown = (v?: string | number | null) => (v === undefined || v === null || v === '' || v === '-' ? '—' : String(v));
const recordedDate = (v?: string | null) => (!v || v === '-' ? '—' : formatDate(v));

type StepState = 'done' | 'active' | 'blocked' | 'todo';

function buildSteps(o: OrderJourney): { title: string; detail: string; state: StepState }[] {
  const li = o.lineItems?.[0];
  const ordered = (o.lineItems || []).reduce((s, x) => s + (x.orderedQty || 0), 0);
  const shipped = o.dispatchStatus?.totalShippedQty || 0;
  return [
    { title: 'PO received', detail: formatDate(o.poDate), state: 'done' },
    {
      title: 'Material',
      detail: o.materialStatus?.heatNumber ? `Heat ${o.materialStatus.heatNumber}` : 'Heat not allocated',
      state: o.materialStatus?.state === 'verified' ? 'done' : o.materialStatus?.state === 'shortage' ? 'blocked' : o.materialStatus?.heatNumber ? 'active' : 'todo',
    },
    {
      title: 'Production',
      detail: li && li.orderedQty > 0 ? `${formatNumber(li.producedQty)} / ${formatNumber(li.orderedQty)} made` : '—',
      state: li && li.orderedQty > 0 && li.producedQty >= li.orderedQty ? 'done' : li && li.producedQty > 0 ? 'active' : 'todo',
    },
    {
      title: 'Quality',
      detail: o.qualityClearedBy ? 'Cleared' : o.qualityStatus?.state === 'rejected' ? 'Rejected' : 'Not cleared',
      state: o.qualityClearedBy ? 'done' : o.qualityStatus?.state === 'rejected' ? 'blocked' : o.qualityStatus?.state === 'in_progress' ? 'active' : 'todo',
    },
    {
      title: 'Finance',
      detail: o.financeClearedBy ? 'Cleared' : 'Not cleared',
      state: o.financeClearedBy ? 'done' : o.qualityClearedBy ? 'active' : 'todo',
    },
    {
      title: 'Dispatch',
      detail: ordered > 0 ? `${formatNumber(shipped)} / ${formatNumber(ordered)} shipped` : `${formatNumber(shipped)} shipped`,
      state: o.dispatchStatus?.state === 'completed' ? 'done' : shipped > 0 ? 'active' : 'todo',
    },
    {
      title: 'Invoice',
      detail: shown(o.invoiceStatus?.invoiceNumber),
      state: ['invoiced', 'settled'].includes(o.invoiceStatus?.state) ? 'done' : o.invoiceStatus?.state === 'partial' ? 'active' : 'todo',
    },
  ];
}

const STEP_STYLE: Record<StepState, { dot: string; label: string }> = {
  done: { dot: 'bg-success text-white border-success', label: 'Done' },
  active: { dot: 'bg-bronze-500 text-white border-bronze-500', label: 'In progress' },
  blocked: { dot: 'bg-destructive text-white border-destructive', label: 'Blocked' },
  todo: { dot: 'bg-card text-muted-foreground border-border', label: 'Not started' },
};

function Stepper({ order }: { order: OrderJourney }) {
  const steps = buildSteps(order);
  return (
    <ol className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4 lg:grid-cols-7" aria-label="Order progress">
      {steps.map((s, i) => (
        <li key={s.title} className="relative min-w-0">
          {i < steps.length - 1 && (
            <span aria-hidden="true" className={cn('absolute left-8 right-0 top-3.5 hidden h-0.5 lg:block', s.state === 'done' ? 'bg-success' : 'bg-border')} />
          )}
          <span className={cn('relative z-10 flex size-7 items-center justify-center rounded-full border-2 text-xs font-bold', STEP_STYLE[s.state].dot)}>
            {s.state === 'done' ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
          </span>
          <p className="mt-2 text-sm font-semibold">{s.title}</p>
          <p className="truncate text-xs text-muted-foreground" title={s.detail}>{s.detail}</p>
          <span className="sr-only">{STEP_STYLE[s.state].label}</span>
        </li>
      ))}
    </ol>
  );
}

function Detail({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn('text-right text-sm font-medium', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}

export function OrderTrackerPage({ initialOrderId }: { initialOrderId?: string; onNavigateToModule?: (id: string) => void }) {
  const { salesOrders, customers, products, qualityInspections, dimensionalReports, handovers, usersList, currentUser, activeRbacGroup } = useRtdb();
  const [selectedId, setSelectedId] = useState<string | undefined>(initialOrderId);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<MontexPdfDocumentPayload | null>(null);

  useEffect(() => {
    if (initialOrderId) setSelectedId(initialOrderId);
  }, [initialOrderId]);

  const sorted = useMemo(
    () => [...salesOrders].sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed') || (a.targetDeliveryDate || '').localeCompare(b.targetDeliveryDate || '')),
    [salesOrders]
  );
  const order = sorted.find((o) => o.id === selectedId) || sorted[0];

  if (!order) {
    return (
      <div className="space-y-5">
        <PageHeader title="Order Tracker" description="Follow one order from PO to invoice." />
        <EmptyState icon={ClipboardList} title="No orders yet" description="Orders appear here once Sales registers a customer PO." />
      </div>
    );
  }

  const restricted = Boolean(order.commercialRestricted);
  const ordered = (order.lineItems || []).reduce((s, x) => s + (x.orderedQty || 0), 0);
  const shipped = order.dispatchStatus?.totalShippedQty || 0;
  const today = new Date().toISOString().slice(0, 10);
  const lateDays =
    order.status !== 'completed' && order.targetDeliveryDate && order.targetDeliveryDate < today
      ? Math.floor((Date.parse(today) - Date.parse(order.targetDeliveryDate)) / 86_400_000)
      : 0;
  const gateCount = handovers.filter((h) => h.orderId === order.id || h.jobNumber === order.jobNumber).length;
  const canEdit = currentUser.accountStatus === 'active' && STAGE_EDITORS.includes(currentUser.role);

  const makePdf = async (kind: 'po_summary' | 'full_progress' | 'mtc' | 'billing', action: 'preview' | 'download') => {
    const svc = await import('../../services/documentExportService');
    const check = svc.verifyExportPermission(currentUser, activeRbacGroup, ['Admin', 'Management', 'Sales', 'Production', 'Finance']);
    if (!check.allowed) {
      toast.error('Export not allowed', { description: check.error });
      return;
    }
    const payload =
      kind === 'mtc'
        ? svc.buildMtcDraftPdfPayload(
            order,
            qualityInspections.find((q) => q.jobNumber === order.jobNumber),
            dimensionalReports.find((d) => d.jobNumber === order.jobNumber),
            currentUser,
            activeRbacGroup
          )
        : kind === 'billing'
        ? svc.buildInvoicePdfPayload(order, customers.find((c) => c.id === order.customerId), products, currentUser, activeRbacGroup)
        : svc.buildOrderProgressPdfPayload(order, kind, currentUser, activeRbacGroup);
    if (action === 'preview') {
      setPreview(payload);
      return;
    }
    const res = svc.generateMontexPdfDocument(payload, 'download');
    if (res.success) toast.success('PDF downloaded', { description: res.filename });
    else toast.error('PDF could not be created', { description: res.error });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={
          <>
            <span className="font-mono text-xs font-semibold text-muted-foreground">{order.jobNumber}</span>
            <Badge tone={order.status === 'completed' ? 'success' : order.status === 'on_hold' ? 'danger' : 'neutral'}>
              {ORDER_STATUS_LABELS[order.status] || order.statusLabel}
            </Badge>
            {lateDays > 0 && <Badge tone="danger">{lateDays} days late</Badge>}
          </>
        }
        title={order.customerName}
        description={`PO ${shown(order.poNumber)} · received ${formatDate(order.poDate)}${order.statusLabel ? ` · ${order.statusLabel}` : ''}`}
        actions={
          <>
            <Select aria-label="Choose order" className="w-full sm:w-64" value={order.id} onChange={(e) => setSelectedId(e.target.value)}>
              {sorted.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.jobNumber} · {o.customerName}
                </option>
              ))}
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">
                  <Download /> Documents
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Preview</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => makePdf('po_summary', 'preview')}>
                  <FileText /> PO summary
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => makePdf('full_progress', 'preview')}>
                  <FileText /> Progress report
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => makePdf('mtc', 'preview')}>
                  <FileText /> MTC data summary (draft)
                </DropdownMenuItem>
                {!restricted && (
                  <DropdownMenuItem onSelect={() => makePdf('billing', 'preview')}>
                    <FileText /> Billing summary (draft)
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => makePdf('full_progress', 'download')}>
                  <Download /> Download progress PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canEdit && (
              <Button onClick={() => setEditing(true)}>
                <PencilLine /> Update stage
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Delivery date"
          icon={CalendarClock}
          tone={lateDays > 0 ? 'danger' : 'neutral'}
          value={formatDate(order.targetDeliveryDate)}
          hint={order.expectedDeliveryDate && order.expectedDeliveryDate !== order.targetDeliveryDate ? `Customer date ${formatDate(order.expectedDeliveryDate)}` : lateDays > 0 ? `${lateDays} days late` : 'Plant target'}
        />
        <StatTile label="Ordered" icon={Package} value={ordered > 0 ? formatNumber(ordered) : '—'} unit={order.lineItems?.[0]?.uom} hint={order.lineItems?.[0]?.productName} />
        <StatTile
          label="Shipped"
          icon={Truck}
          tone={order.dispatchStatus?.state === 'completed' ? 'success' : 'neutral'}
          value={formatNumber(shipped)}
          unit={order.lineItems?.[0]?.uom}
          hint={ordered > 0 ? `${formatNumber(Math.max(0, ordered - shipped))} still to ship` : undefined}
        />
        <StatTile label="Order value" icon={FileText} tone="bronze" restricted={restricted} value={formatINR(order.totalValue || 0, { compact: true })} hint={restricted ? 'Not visible for your role' : 'GST extra'} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <Stepper order={order} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0">
          <Tabs defaultValue="items">
            <div className="overflow-x-auto border-b border-border px-4 pt-3">
              <TabsList className="h-auto">
                <TabsTrigger value="items">Products</TabsTrigger>
                <TabsTrigger value="material">Material</TabsTrigger>
                <TabsTrigger value="quality">Quality</TabsTrigger>
                <TabsTrigger value="inspection">Customer inspection</TabsTrigger>
                <TabsTrigger value="dispatch">Dispatch</TabsTrigger>
                {!restricted && <TabsTrigger value="invoice">Invoice</TabsTrigger>}
              </TabsList>
            </div>
            <CardContent className="pt-4">
              <TabsContent value="items">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-3">Product</th>
                        <th className="py-2 pr-3 text-right">Ordered</th>
                        <th className="py-2 pr-3 text-right">Made</th>
                        <th className="py-2 pr-3 text-right">Passed</th>
                        <th className="py-2 pr-3 text-right">Rejected</th>
                        <th className="py-2 pr-3 text-right">Shipped</th>
                        {!restricted && <th className="py-2 text-right">Amount</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(order.lineItems || []).map((li) => (
                        <tr key={li.id} className="border-b border-border last:border-0">
                          <td className="py-2.5 pr-3">
                            <p className="font-medium">{li.productName}</p>
                            <p className="text-xs text-muted-foreground">{[li.productCode, li.materialGrade, li.size].filter((x) => x && x !== '-').join(' · ')}</p>
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono">{li.orderedQty > 0 ? formatNumber(li.orderedQty) : '—'}</td>
                          <td className="py-2.5 pr-3 text-right font-mono">{formatNumber(li.producedQty)}</td>
                          <td className="py-2.5 pr-3 text-right font-mono">{formatNumber(li.inspectedOkQty)}</td>
                          <td className={cn('py-2.5 pr-3 text-right font-mono', li.rejectedQty > 0 && 'text-destructive')}>{formatNumber(li.rejectedQty)}</td>
                          <td className="py-2.5 pr-3 text-right font-mono">{formatNumber(li.dispatchedQty)}</td>
                          {!restricted && <td className="py-2.5 text-right font-mono">{li.totalAmount ? formatINR(li.totalAmount) : '—'}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              <TabsContent value="material">
                <dl>
                  <Detail label="Grade" value={shown(order.materialStatus?.materialGrade)} />
                  <Detail label="Heat number" mono value={shown(order.materialStatus?.heatNumber)} />
                  <Detail label="Mill / supplier" value={shown(order.materialStatus?.supplierName)} />
                  <Detail label="Required" value={order.materialStatus?.requiredKg ? `${formatNumber(order.materialStatus.requiredKg)} kg` : '—'} />
                  <Detail label="Allocated" value={order.materialStatus?.allocatedKg ? `${formatNumber(order.materialStatus.allocatedKg)} kg` : '—'} />
                  <Detail label="Last updated" value={recordedDate(order.materialStatus?.lastUpdated)} />
                </dl>
                {order.materialStatus?.notes && <p className="mt-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground">{order.materialStatus.notes}</p>}
              </TabsContent>

              <TabsContent value="quality">
                <dl>
                  <Detail label="Inspector" value={shown(order.qualityStatus?.inspectorName)} />
                  <Detail label="Inspection date" value={recordedDate(order.qualityStatus?.inspectionDate)} />
                  <Detail label="MTC number" mono value={shown(order.qualityStatus?.mtcNumber)} />
                  <Detail label="MTC status" value={<Badge tone={order.qualityStatus?.mtcStatus === 'draft' ? 'neutral' : 'success'}>{order.qualityStatus?.mtcStatus || '—'}</Badge>} />
                  <Detail label="Tests" value={order.qualityStatus?.testTypes?.length ? order.qualityStatus.testTypes.join(', ') : '—'} />
                </dl>
                {order.qualityStatus?.rejectionReason && (
                  <p className="mt-3 rounded-lg border border-red-200 bg-danger-soft p-3 text-sm text-destructive">Rejection: {order.qualityStatus.rejectionReason}</p>
                )}
              </TabsContent>

              <TabsContent value="inspection">
                <dl>
                  <Detail
                    label="Status"
                    value={
                      <Badge tone={order.clearanceStatus?.state === 'approved' ? 'success' : order.clearanceStatus?.state === 'query_raised' ? 'danger' : 'neutral'}>
                        {{ approved: 'Approved', pending: 'Pending', not_required: 'Not required', query_raised: 'Query raised' }[order.clearanceStatus?.state] || '—'}
                      </Badge>
                    }
                  />
                  <Detail label="Agency" value={shown(order.clearanceStatus?.agency)} />
                  <Detail label="Inspector" value={shown(order.clearanceStatus?.inspectorName)} />
                  <Detail label="Release note no." mono value={shown(order.clearanceStatus?.clearanceRefNo)} />
                  <Detail label="Date" value={recordedDate(order.clearanceStatus?.clearanceDate)} />
                </dl>
                {order.clearanceStatus?.remarks && <p className="mt-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground">{order.clearanceStatus.remarks}</p>}
              </TabsContent>

              <TabsContent value="dispatch">
                <dl>
                  <Detail label="Shipped / balance" value={`${formatNumber(shipped)} / ${formatNumber(order.dispatchStatus?.balanceQty || 0)}`} />
                  <Detail label="Last dispatch" value={recordedDate(order.dispatchStatus?.dispatchDate)} />
                  <Detail label="Transporter" value={shown(order.dispatchStatus?.transporterName)} />
                  <Detail label="Vehicle" mono value={shown(order.dispatchStatus?.vehicleNo)} />
                  <Detail label="LR number" mono value={shown(order.dispatchStatus?.lrNumber)} />
                  <Detail label="Destination" value={shown(order.dispatchStatus?.destinationCity)} />
                </dl>
              </TabsContent>

              {!restricted && (
                <TabsContent value="invoice">
                  <dl>
                    <Detail label="Invoice number" mono value={shown(order.invoiceStatus?.invoiceNumber)} />
                    <Detail label="Invoice date" value={recordedDate(order.invoiceStatus?.invoiceDate)} />
                    <Detail label="Amount" value={order.invoiceStatus?.invoiceAmount ? formatINR(order.invoiceStatus.invoiceAmount) : '—'} />
                    <Detail label="Received" value={formatINR(order.invoiceStatus?.paidAmount || 0)} />
                    <Detail label="Outstanding" value={<span className={order.invoiceStatus?.outstandingAmount ? 'text-destructive' : ''}>{formatINR(order.invoiceStatus?.outstandingAmount || 0)}</span>} />
                    <Detail label="Payment due" value={recordedDate(order.invoiceStatus?.paymentDueDate)} />
                  </dl>
                </TabsContent>
              )}
            </CardContent>
          </Tabs>
        </Card>

        <div className="min-w-0 space-y-5">
          <OrderClearancePanel order={order} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserRound className="size-4 text-bronze-600" aria-hidden="true" /> Accountability
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <Detail label="Owner (FPR)" value={order.fprName || <span className="text-warning">Not assigned</span>} />
                <Detail label="Handover gate" value={order.handoverStage ? `${order.handoverStage} · ${HANDOVER_GATES.find(([g]) => g === order.handoverStage)?.[1] || ''}` : '—'} />
                <Detail label="Handovers logged" value={formatNumber(gateCount)} />
                <Detail
                  label="Customer document pack"
                  value={
                    <Badge tone={order.documentChecklistStatus === 'Verified' ? 'success' : order.documentChecklistStatus === 'Ready' ? 'info' : 'warning'}>
                      {order.documentChecklistStatus || 'Incomplete'}
                    </Badge>
                  }
                />
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        {editing && (
          <DialogContent>
            <StageForm order={order} onDone={() => setEditing(false)} people={usersList} />
          </DialogContent>
        )}
      </Dialog>

      <DocumentPreviewModal payload={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function StageForm({ order, people, onDone }: { order: OrderJourney; people: any[]; onDone: () => void }) {
  const { updateSalesOrderRecord } = useRtdb();
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [note, setNote] = useState(order.statusLabel && order.statusLabel !== ORDER_STATUS_LABELS[order.status] ? order.statusLabel : '');
  const [tpiState, setTpiState] = useState(order.clearanceStatus?.state || 'pending');
  const [tpiRef, setTpiRef] = useState(order.clearanceStatus?.clearanceRefNo && order.clearanceStatus.clearanceRefNo !== '-' ? order.clearanceStatus.clearanceRefNo : '');
  const [fprUid, setFprUid] = useState(order.fprUid || '');
  const [gate, setGate] = useState(order.handoverStage || '');
  const [docPack, setDocPack] = useState(order.documentChecklistStatus || 'Incomplete');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const active = people.filter((u) => u.accountStatus === 'active' || u.status === 'active');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tpiState === 'approved' && !tpiRef.trim()) {
      setError('Enter the release note number for an approved customer inspection.');
      return;
    }
    setError('');
    setSaving(true);
    const fpr = active.find((u) => (u.uid || u.id) === fprUid);
    const today = new Date().toISOString().slice(0, 10);
    const updated: OrderJourney = {
      ...order,
      status,
      statusLabel: note.trim() || ORDER_STATUS_LABELS[status],
      fprUid: fpr ? fpr.uid || fpr.id : order.fprUid,
      fprName: fpr ? fpr.displayName || fpr.name : order.fprName,
      fprDepartment: fpr ? fpr.department || fpr.role : order.fprDepartment,
      handoverStage: (gate || undefined) as OrderJourney['handoverStage'],
      documentChecklistStatus: docPack as OrderJourney['documentChecklistStatus'],
      clearanceStatus: {
        ...order.clearanceStatus,
        state: tpiState as OrderJourney['clearanceStatus']['state'],
        clearanceRefNo: tpiRef.trim(),
        clearanceDate:
          tpiState === 'approved' && (!order.clearanceStatus?.clearanceDate || order.clearanceStatus.clearanceDate === '-')
            ? today
            : order.clearanceStatus?.clearanceDate || '',
      },
    };
    const res = await updateSalesOrderRecord(updated, `stage=${status}, gate=${gate || '-'}, tpi=${tpiState}`);
    setSaving(false);
    if (res.success) {
      toast.success('Order updated', { description: order.jobNumber });
      onDone();
    } else {
      setError(res.error || 'The order could not be saved.');
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Update stage</DialogTitle>
        <DialogDescription>
          {order.jobNumber} · {order.customerName}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Stage" htmlFor="st-status">
          <Select id="st-status" value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)}>
            {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)" htmlFor="st-note" hint="Shown under the stage, e.g. waiting for die repair">
          <Input id="st-note" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Field label="Customer inspection" htmlFor="st-tpi">
          <Select id="st-tpi" value={tpiState} onChange={(e) => setTpiState(e.target.value as typeof tpiState)}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="query_raised">Query raised</option>
            <option value="not_required">Not required</option>
          </Select>
        </Field>
        <Field label="Release note no." htmlFor="st-ref">
          <Input id="st-ref" className="font-mono" maxLength={64} value={tpiRef} onChange={(e) => setTpiRef(e.target.value)} />
        </Field>
        <Field label="Owner (FPR)" htmlFor="st-fpr">
          <Select id="st-fpr" value={fprUid} onChange={(e) => setFprUid(e.target.value)}>
            <option value="">{order.fprName ? `Keep ${order.fprName}` : 'Not assigned'}</option>
            {active.map((u) => (
              <option key={u.uid || u.id} value={u.uid || u.id}>
                {u.displayName || u.name} · {u.role}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Handover gate" htmlFor="st-gate">
          <Select id="st-gate" value={gate} onChange={(e) => setGate(e.target.value as typeof gate)}>
            <option value="">Not set</option>
            {HANDOVER_GATES.map(([g, label]) => (
              <option key={g} value={g}>
                {g} · {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Customer document pack" htmlFor="st-docs" hint="Invoice, e-way bill, packing list, MTC, inspection release">
          <Select id="st-docs" value={docPack} onChange={(e) => setDocPack(e.target.value as typeof docPack)}>
            <option value="Incomplete">Incomplete</option>
            <option value="Ready">Ready</option>
            <option value="Verified">Verified</option>
          </Select>
        </Field>
      </div>
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-danger-soft p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
