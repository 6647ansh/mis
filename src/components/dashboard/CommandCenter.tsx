import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Layers,
  PackageCheck,
  Target,
  Wallet,
} from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { ActionQueueItem, OrderJourney, OrderStatus } from '../../types/mis';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Callout, EmptyState, PageHeader, StatTile } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/overlays';
import { cn, formatDate, formatINR, formatNumber } from '@/lib/utils';
import { canRoleReadCollection } from '../../types/roles';

const PIPELINE: { label: string; statuses: OrderStatus[] }[] = [
  { label: 'Booked', statuses: ['po_registered', 'job_assigned'] },
  { label: 'Material', statuses: ['material_pending', 'material_allocated'] },
  { label: 'Production', statuses: ['in_production'] },
  { label: 'Quality', statuses: ['quality_pending', 'quality_cleared'] },
  { label: 'Clearance', statuses: ['clearance_pending', 'clearance_approved'] },
  { label: 'Ready / part-shipped', statuses: ['ready_for_dispatch', 'partially_dispatched'] },
  { label: 'On hold', statuses: ['on_hold'] },
];

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const today = () => new Date().toISOString().slice(0, 10);

function daysLate(order: OrderJourney) {
  const due = order.targetDeliveryDate || order.expectedDeliveryDate;
  if (!due) return 0;
  const diff = Math.floor((Date.parse(today()) - Date.parse(due)) / 86_400_000);
  return diff > 0 ? diff : 0;
}

function ClearanceChips({ order }: { order: OrderJourney }) {
  return (
    <span className="inline-flex gap-1">
      <Badge tone={order.qualityClearedBy ? 'success' : 'neutral'}>
        {order.qualityClearedBy && <CheckCircle2 />}Quality
      </Badge>
      <Badge tone={order.financeClearedBy ? 'success' : 'neutral'}>
        {order.financeClearedBy && <CheckCircle2 />}Finance
      </Badge>
    </span>
  );
}

/** Executive overview built only from live records; every figure links to its module. */
export function CommandCenter({ onNavigate }: { onNavigate: (tabId: string, orderId?: string) => void }) {
  const {
    currentUser,
    salesOrders,
    rawMaterials,
    outstandingAgeing,
    actionQueue,
    dashboardKpis,
    acknowledgeAlertRecord,
    updateMonthlySalesTargetRecord,
  } = useRtdb();
  const [targetOpen, setTargetOpen] = useState(false);
  const canSetTarget = currentUser.role === 'ceo' || currentUser.role === 'super_admin';
  const canSeeStock = canRoleReadCollection(currentUser.role, 'rawMaterials');
  const canSeeReceivables = canRoleReadCollection(currentUser.role, 'outstandingPayments');

  const m = useMemo(() => {
    const open = salesOrders.filter((o) => o.status !== 'completed');
    const restricted = salesOrders.some((o) => o.commercialRestricted);
    const month = today().slice(0, 7);
    const bookedThisMonth = salesOrders
      .filter((o) => (o.poDate || '').startsWith(month))
      .reduce((s, o) => s + (o.totalValue || 0), 0);
    const ready = open.filter((o) => o.qualityClearedBy && o.financeClearedBy);
    const late = open.filter((o) => daysLate(o) > 0);
    const needQuality = open.filter((o) => !o.qualityClearedBy && ['quality_pending', 'quality_cleared', 'clearance_pending', 'clearance_approved', 'ready_for_dispatch'].includes(o.status));
    const needFinance = open.filter((o) => o.qualityClearedBy && !o.financeClearedBy);
    const ageing = outstandingAgeing.reduce(
      (a, r) => ({
        b0: a.b0 + (r.bucket0to30 || 0),
        b31: a.b31 + (r.bucket31to60 || 0),
        b61: a.b61 + (r.bucket61to90 || 0),
        b90: a.b90 + (r.bucket90Plus || 0),
      }),
      { b0: 0, b31: 0, b61: 0, b90: 0 }
    );
    const outstanding = ageing.b0 + ageing.b31 + ageing.b61 + ageing.b90;
    const critical = rawMaterials.filter((r) => r.status === 'critical');
    const pipeline = PIPELINE.map((p) => ({ ...p, count: open.filter((o) => p.statuses.includes(o.status)).length }));
    const alerts = actionQueue
      .filter((a) => !a.acknowledged)
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) || b.daysPending - a.daysPending);
    return {
      open,
      restricted,
      openValue: open.reduce((s, o) => s + (o.totalValue || 0), 0),
      bookedThisMonth,
      ready,
      late,
      needQuality,
      needFinance,
      ageing,
      outstanding,
      critical,
      pipeline,
      alerts,
    };
  }, [salesOrders, outstandingAgeing, rawMaterials, actionQueue]);

  const target = dashboardKpis.monthlySalesTarget || 0;
  const targetPct = target > 0 ? Math.min(100, (m.bookedThisMonth / target) * 100) : 0;
  const maxStage = Math.max(1, ...m.pipeline.map((p) => p.count));

  const handleExport = async () => {
    const { exportMontexExcelWorkbook } = await import('../../services/documentExportService');
    const res = exportMontexExcelWorkbook(
      `Montex_Command_Center_${today()}.xlsx`,
      [
        {
          sheetName: 'Open orders',
          reportTitle: 'MONTEX MIS — OPEN ORDERS',
          reportSubtitle: `Exported by ${currentUser.displayName || currentUser.name} on ${today()}`,
          headers: ['Job no.', 'PO no.', 'Customer', 'Stage', 'Target date', 'Days late', 'Quality clearance', 'Finance clearance', ...(m.restricted ? [] : ['Value (INR)'])],
          rows: m.open.map((o) => [
            o.jobNumber,
            o.poNumber,
            o.customerName,
            o.statusLabel || o.status,
            o.targetDeliveryDate || '',
            daysLate(o),
            o.qualityClearedBy ? 'Yes' : 'No',
            o.financeClearedBy ? 'Yes' : 'No',
            ...(m.restricted ? [] : [o.totalValue || 0]),
          ]),
        },
      ],
      currentUser.email
    );
    if (res.success) toast.success('Excel downloaded', { description: res.filename });
    else toast.error('Export failed', { description: res.error });
  };

  const acknowledge = async (a: ActionQueueItem) => {
    const res = await acknowledgeAlertRecord(a);
    if (res.success) toast.success('Alert acknowledged', { description: a.title });
    else toast.error('Could not acknowledge this alert', { description: res.error || 'Please try again.' });
  };

  const orderColumns: Column<OrderJourney>[] = [
    {
      id: 'job',
      header: 'Job / PO',
      sortValue: (o) => o.jobNumber,
      cell: (o) => (
        <div className="min-w-0">
          <p className="whitespace-nowrap font-mono text-xs font-semibold">{o.jobNumber}</p>
          <p className="truncate text-xs text-muted-foreground">{o.poNumber}</p>
        </div>
      ),
    },
    { id: 'customer', header: 'Customer', sortValue: (o) => o.customerName, cell: (o) => <span className="line-clamp-1">{o.customerName}</span> },
    { id: 'stage', header: 'Stage', hideBelow: 'md', cell: (o) => <Badge>{o.statusLabel || o.status}</Badge> },
    {
      id: 'late',
      header: 'Due',
      sortValue: (o) => daysLate(o),
      cell: (o) => {
        const d = daysLate(o);
        return d > 0 ? <Badge tone="danger">{d} days late</Badge> : <span className="whitespace-nowrap text-muted-foreground">{formatDate(o.targetDeliveryDate)}</span>;
      },
    },
    { id: 'clear', header: 'Clearances', hideBelow: 'lg', cell: (o) => <ClearanceChips order={o} /> },
    ...(!m.restricted
      ? [{ id: 'value', header: 'Value', align: 'right' as const, sortValue: (o: OrderJourney) => o.totalValue || 0, cell: (o: OrderJourney) => <span className="whitespace-nowrap font-mono">{formatINR(o.totalValue || 0, { compact: true })}</span> }]
      : []),
  ];

  const ageingBars = [
    { label: '0–30 days', value: m.ageing.b0, cls: 'bg-bronze-200' },
    { label: '31–60 days', value: m.ageing.b31, cls: 'bg-bronze-400' },
    { label: '61–90 days', value: m.ageing.b61, cls: 'bg-bronze-600' },
    { label: '90+ days', value: m.ageing.b90, cls: 'bg-bronze-800' },
  ];
  const maxAgeing = Math.max(1, ...ageingBars.map((b) => b.value));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Command Center"
        description="Orders, clearances, material and money that need attention today. Every figure opens its register."
        actions={
          <Button variant="secondary" onClick={handleExport}>
            <Download /> Export open orders
          </Button>
        }
      />

      {/* KPIs */}
      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile
          label="Open orders"
          value={formatNumber(m.open.length)}
          hint={m.restricted ? undefined : `${formatINR(m.openValue, { compact: true })} order book`}
          icon={FileSpreadsheet}
          onClick={() => onNavigate('sales_orders')}
        />
        <StatTile
          label="Ready to dispatch"
          value={formatNumber(m.ready.length)}
          hint="Quality and finance cleared"
          icon={PackageCheck}
          tone="success"
          onClick={() => onNavigate('dispatch')}
        />
        <StatTile
          label="Late orders"
          value={formatNumber(m.late.length)}
          hint={m.late.length ? `Oldest ${Math.max(...m.late.map(daysLate))} days past target` : 'All open orders on time'}
          icon={CalendarClock}
          tone={m.late.length ? 'danger' : 'neutral'}
          onClick={() => onNavigate('sales_orders')}
        />
        {canSeeStock && <StatTile
          label="Critical materials"
          value={formatNumber(m.critical.length)}
          hint={m.critical.length ? m.critical.slice(0, 2).map((r) => r.grade).join(', ') : 'No grade below minimum'}
          icon={Layers}
          tone={m.critical.length ? 'warning' : 'neutral'}
          onClick={() => onNavigate('inventory')}
        />}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Sales vs target */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Orders booked this month</CardTitle>
              <CardDescription>Value of orders with a PO date in {new Date().toLocaleString('en-IN', { month: 'long' })}</CardDescription>
            </div>
            <Target className="size-5 text-bronze-600" aria-hidden="true" />
          </CardHeader>
          <CardContent className="space-y-4">
            {m.restricted ? (
              <p className="text-sm text-muted-foreground">Order values are not visible for your role.</p>
            ) : (
              <>
                <p className="font-mono text-3xl font-semibold tracking-tight">{formatINR(m.bookedThisMonth, { compact: true })}</p>
                {target > 0 ? (
                  <div>
                    <div
                      className="relative h-2.5 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(targetPct)}
                      aria-label="Progress to monthly target"
                    >
                      <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${targetPct}%` }} />
                    </div>
                    <p className="mt-2 flex justify-between text-xs text-muted-foreground">
                      <span>{Math.round(targetPct)}% of target</span>
                      <span>Target {formatINR(target, { compact: true })}</span>
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No monthly target set yet.</p>
                )}
                {canSetTarget && (
                  <Button variant="link" size="sm" onClick={() => setTargetOpen(true)}>
                    {target > 0 ? 'Change target' : 'Set monthly target'}
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Pipeline */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Open orders by stage</CardTitle>
              <CardDescription>Where the {m.open.length} open orders are right now</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {m.open.length === 0 ? (
              <EmptyState title="No open orders" description="New purchase orders appear here as soon as Sales registers them." />
            ) : (
              <ul className="space-y-2.5">
                {m.pipeline.map((p) => (
                  <li key={p.label}>
                    <Tooltip content={`${p.label}: ${p.count} order${p.count === 1 ? '' : 's'}`}>
                      <button
                        type="button"
                        onClick={() => onNavigate('sales_orders')}
                        className="grid w-full cursor-pointer grid-cols-[9rem_1fr_2.5rem] items-center gap-3 rounded-md py-0.5 text-left text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="truncate text-muted-foreground">{p.label}</span>
                        <span className="h-5 rounded-r bg-muted/60">
                          <span
                            className={cn('block h-full rounded-r', p.label === 'On hold' ? 'bg-amber-500' : 'bg-slate-700')}
                            style={{ width: `${(p.count / maxStage) * 100}%`, minWidth: p.count ? 4 : 0 }}
                          />
                        </span>
                        <span className="text-right font-mono font-semibold tabular-nums">{p.count}</span>
                      </button>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Exceptions */}
        <Card className={canSeeReceivables ? 'xl:col-span-2' : 'xl:col-span-3'}>
          <CardHeader>
            <div>
              <CardTitle>Needs attention</CardTitle>
              <CardDescription>Open alerts, most severe first</CardDescription>
            </div>
            {m.alerts.length > 0 && <Badge tone="danger">{m.alerts.length} open</Badge>}
          </CardHeader>
          <CardContent className="space-y-3">
            {m.needQuality.length > 0 && (
              <Callout
                tone="warning"
                title={`${m.needQuality.length} order${m.needQuality.length === 1 ? '' : 's'} waiting for quality clearance`}
                why="Dispatch is blocked until Quality clears each order."
                action={<Button size="sm" variant="secondary" onClick={() => onNavigate('quality')}>Open Quality</Button>}
              />
            )}
            {m.needFinance.length > 0 && (
              <Callout
                tone="warning"
                title={`${m.needFinance.length} quality-cleared order${m.needFinance.length === 1 ? '' : 's'} waiting for finance clearance`}
                why="These can ship as soon as Finance clears them."
                action={<Button size="sm" variant="secondary" onClick={() => onNavigate('finance')}>Open Finance</Button>}
              />
            )}
            {m.alerts.slice(0, 5).map((a) => (
              <Callout
                key={a.id}
                tone={a.severity === 'critical' || a.severity === 'high' ? 'danger' : 'info'}
                title={a.title}
                why={a.description}
                next={a.suggestedAction}
                action={
                  <Button size="sm" variant="ghost" onClick={() => acknowledge(a)}>
                    Acknowledge
                  </Button>
                }
              />
            ))}
            {m.alerts.length === 0 && m.needQuality.length === 0 && m.needFinance.length === 0 && (
              <EmptyState icon={CheckCircle2} title="Nothing needs attention" description="No open alerts or blocked clearances." />
            )}
            {m.alerts.length > 5 && (
              <Button variant="link" size="sm" onClick={() => onNavigate('notifications')}>
                See all {m.alerts.length} alerts
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Receivables ageing */}
        {canSeeReceivables && <Card>
          <CardHeader>
            <div>
              <CardTitle>Receivables ageing</CardTitle>
              <CardDescription>Money owed by customers, by invoice age</CardDescription>
            </div>
            <Wallet className="size-5 text-bronze-600" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            {outstandingAgeing.length === 0 ? (
              <EmptyState title="No receivables data" description="Visible to Finance, Sales, CEO and admins." />
            ) : (
              <>
                <p className="font-mono text-3xl font-semibold tracking-tight">{formatINR(m.outstanding, { compact: true })}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatINR(m.ageing.b61 + m.ageing.b90, { compact: true })} older than 60 days
                </p>
                <ul className="mt-4 space-y-2.5">
                  {ageingBars.map((b) => (
                    <li key={b.label} className="grid grid-cols-[5.5rem_1fr_4.5rem] items-center gap-3 text-sm">
                      <span className="text-muted-foreground">{b.label}</span>
                      <Tooltip content={`${b.label}: ${formatINR(b.value)}`}>
                        <span className="h-4 rounded-r bg-muted/60">
                          <span className={cn('block h-full rounded-r', b.cls)} style={{ width: `${(b.value / maxAgeing) * 100}%`, minWidth: b.value ? 4 : 0 }} />
                        </span>
                      </Tooltip>
                      <span className="text-right font-mono text-xs font-semibold tabular-nums">{formatINR(b.value, { compact: true })}</span>
                    </li>
                  ))}
                </ul>
                <Button variant="link" size="sm" className="mt-3" onClick={() => onNavigate('finance')}>
                  Open receivables
                </Button>
              </>
            )}
          </CardContent>
        </Card>}
      </div>

      {/* Late & at-risk orders */}
      <section aria-label="Open orders" className="space-y-3">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Open orders</h2>
            <p className="text-sm text-muted-foreground">Sorted by days late. Select an order to follow it end to end.</p>
          </div>
          {m.late.length > 0 && (
            <Badge tone="danger">
              <AlertTriangle /> {m.late.length} late
            </Badge>
          )}
        </div>
        <DataTable
          rows={m.open}
          columns={orderColumns}
          rowKey={(o) => o.id}
          searchText={(o) => `${o.jobNumber} ${o.poNumber} ${o.customerName}`}
          searchPlaceholder="Search job, PO or customer"
          onRowClick={(o) => onNavigate('order_journey', o.id)}
          initialSort={{ id: 'late', desc: true }}
          pageSize={10}
          emptyTitle="No open orders"
        />
      </section>

      <TargetDialog
        open={targetOpen}
        onOpenChange={setTargetOpen}
        current={target}
        onSave={async (inr) => {
          const res = await updateMonthlySalesTargetRecord(inr);
          if (res.success) {
            toast.success('Monthly target saved', { description: formatINR(inr, { compact: true }) });
            return null;
          }
          return res.error || 'The target could not be saved. Please try again.';
        }}
      />
    </div>
  );
}

function TargetDialog({
  open,
  onOpenChange,
  current,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  current: number;
  onSave: (inr: number) => Promise<string | null>;
}) {
  const [crore, setCrore] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  React.useEffect(() => {
    if (open) {
      setCrore(current > 0 ? String(+(current / 1e7).toFixed(2)) : '');
      setError(null);
    }
  }, [open, current]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(crore);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter the target in crore, for example 4.5');
      return;
    }
    setSaving(true);
    const err = await onSave(Math.round(value * 1e7));
    setSaving(false);
    if (err) setError(err);
    else onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Monthly sales target</DialogTitle>
            <DialogDescription>Used for the progress bar on this page. Only the CEO and Super Admin can change it.</DialogDescription>
          </DialogHeader>
          <Field label="Target (₹ crore)" htmlFor="target-crore" error={error} hint="Example: 4.5 means ₹4.50 crore">
            <Input
              id="target-crore"
              inputMode="decimal"
              value={crore}
              onChange={(e) => setCrore(e.target.value)}
              aria-invalid={Boolean(error)}
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save target
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
