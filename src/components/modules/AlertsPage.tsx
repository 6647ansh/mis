import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowUpRight, BellRing, Check, CheckCheck, Settings2, TriangleAlert } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { ActionQueueItem, RtdbAlertThresholds } from '../../types/mis';
import { validateSalesOrderQuantities } from '../../services/misDataValidator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, PageHeader, StatTile } from '@/components/ui/data-display';
import { Field, Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { cn, formatDate } from '@/lib/utils';

const RULE_EDITORS = ['super_admin', 'ceo'];
const SEVERITY: Record<string, { tone: 'danger' | 'warning' | 'neutral'; label: string; rank: number }> = {
  critical: { tone: 'danger', label: 'Critical', rank: 0 },
  high: { tone: 'danger', label: 'High', rank: 1 },
  medium: { tone: 'warning', label: 'Medium', rank: 2 },
  low: { tone: 'neutral', label: 'Low', rank: 3 },
};
const MODULE_BY_TYPE: Record<string, string> = {
  payment_ageing: 'finance',
  material_shortage: 'inventory',
  qc_rejection: 'quality',
  quality_hold: 'quality',
  clearance_pending: 'quality',
  overdue_order: 'sales_orders',
};
const RULES: { key: keyof RtdbAlertThresholds; label: string; unit: string; hint: string }[] = [
  { key: 'deliveryDelayDays', label: 'Order late by', unit: 'days', hint: 'Flag an order once it is this many days past its delivery date.' },
  { key: 'criticalAgeingDays', label: 'Receivable older than', unit: 'days', hint: 'Flag customer dues older than this.' },
  { key: 'rejectionPercent', label: 'Rejection above', unit: '%', hint: 'Flag a lot or shift when rejection exceeds this.' },
  { key: 'furnaceTemp', label: 'Furnace peak above', unit: '°C', hint: 'Furnace charges hotter than this are logged as a temperature deviation.' },
  { key: 'machineDowntimeMinutes', label: 'Machine downtime above', unit: 'min / shift', hint: 'Flag shifts with more downtime than this.' },
  { key: 'lowStockDays', label: 'Stock cover below', unit: 'days', hint: 'Flag raw material expected to run out within this many days.' },
];

export function AlertsPage({ onNavigate }: { onNavigate?: (tab: string, orderId?: string) => void }) {
  const { currentUser, actionQueue, salesOrders, alertThresholds, acknowledgeAlertRecord, saveAlertThresholdsRecord } = useRtdb();
  const canEditRules = currentUser.accountStatus === 'active' && RULE_EDITORS.includes(currentUser.role);
  const [tab, setTab] = useState('open');
  const [busy, setBusy] = useState<string | null>(null);

  const open = useMemo(
    () => actionQueue.filter((a) => !a.acknowledged).sort((a, b) => (SEVERITY[a.severity]?.rank ?? 9) - (SEVERITY[b.severity]?.rank ?? 9) || b.daysPending - a.daysPending),
    [actionQueue]
  );
  const done = actionQueue.filter((a) => a.acknowledged);
  const dataChecks = useMemo(
    () =>
      salesOrders
        .filter((o) => !o.commercialRestricted)
        .map((o) => ({ order: o, result: validateSalesOrderQuantities(o) }))
        .filter((x) => !x.result.valid),
    [salesOrders]
  );

  const acknowledge = async (a: ActionQueueItem) => {
    setBusy(a.id);
    const res = await acknowledgeAlertRecord(a);
    setBusy(null);
    if (res.success) toast.success('Marked as seen', { description: a.title });
    else toast.error('Not saved', { description: res.error });
  };

  const openSource = (a: ActionQueueItem) => {
    if (!onNavigate) return;
    const order = salesOrders.find((o) => a.associatedRef.includes(o.jobNumber) || a.associatedRef.includes(o.poNumber) || a.description.includes(o.jobNumber));
    if (order) onNavigate('order_journey', order.id);
    else onNavigate(MODULE_BY_TYPE[a.type] || 'dashboard');
  };

  const AlertList = ({ items, acknowledged }: { items: ActionQueueItem[]; acknowledged?: boolean }) =>
    items.length === 0 ? (
      <EmptyState icon={CheckCheck} title={acknowledged ? 'Nothing acknowledged yet' : 'No open alerts'} description={acknowledged ? undefined : 'Everything flagged has been seen.'} />
    ) : (
      <ul className="space-y-3">
        {items.map((a) => (
          <li key={a.id} className={cn('rounded-xl border border-border bg-card p-4 shadow-card', !acknowledged && SEVERITY[a.severity]?.rank <= 1 && 'border-l-4 border-l-destructive')}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY[a.severity]?.tone}>
                    {SEVERITY[a.severity]?.rank <= 1 && <TriangleAlert />} {SEVERITY[a.severity]?.label || a.severity}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">{a.associatedRef}</span>
                  {a.daysPending > 0 && <span className="text-xs text-muted-foreground">{a.daysPending} days open</span>}
                </div>
                <p className="font-semibold">{a.title}</p>
                <p className="text-sm text-muted-foreground">{a.description}</p>
                {a.suggestedAction && (
                  <p className="text-sm">
                    <span className="font-medium">Next step: </span>
                    {a.suggestedAction}
                    {a.assignedToDepartment && <span className="text-muted-foreground"> · {a.assignedToDepartment}</span>}
                  </p>
                )}
                {acknowledged && a.acknowledgedBy && (
                  <p className="text-xs text-muted-foreground">
                    Seen by {a.acknowledgedBy}
                    {a.acknowledgedAt ? ` on ${formatDate(a.acknowledgedAt.slice(0, 10))}` : ''}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {onNavigate && (
                  <Button size="sm" variant="secondary" onClick={() => openSource(a)}>
                    Open <ArrowUpRight />
                  </Button>
                )}
                {!acknowledged && (
                  <Button size="sm" loading={busy === a.id} onClick={() => acknowledge(a)}>
                    <Check /> Mark seen
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-5">
      <PageHeader title="Alerts" description="What needs attention across the plant, the order records whose numbers do not add up, and the limits that raise alerts." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Open alerts" icon={BellRing} tone={open.length ? 'warning' : 'neutral'} value={open.length} onClick={() => setTab('open')} />
        <StatTile label="Critical / high" icon={TriangleAlert} tone={open.some((a) => SEVERITY[a.severity]?.rank <= 1) ? 'danger' : 'neutral'} value={open.filter((a) => SEVERITY[a.severity]?.rank <= 1).length} onClick={() => setTab('open')} />
        <StatTile label="Data checks failing" icon={TriangleAlert} tone={dataChecks.length ? 'danger' : 'neutral'} value={dataChecks.length} hint="Order quantities that do not add up" onClick={() => setTab('checks')} />
        <StatTile label="Acknowledged" icon={CheckCheck} value={done.length} onClick={() => setTab('done')} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="checks">
            Data checks
            {dataChecks.length > 0 && <span className="rounded-full bg-danger-soft px-1.5 text-[11px] tabular-nums text-destructive">{dataChecks.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="done">Acknowledged</TabsTrigger>
          <TabsTrigger value="rules">
            <Settings2 className="size-3.5" /> Alert rules
          </TabsTrigger>
        </TabsList>
        <TabsContent value="open" className="mt-4">
          <AlertList items={open} />
        </TabsContent>
        <TabsContent value="done" className="mt-4">
          <AlertList items={done} acknowledged />
        </TabsContent>
        <TabsContent value="checks" className="mt-4">
          {dataChecks.length === 0 ? (
            <EmptyState icon={CheckCheck} title="All order quantities add up" description="Produced, passed, rejected, dispatched and pending agree on every order you can see." />
          ) : (
            <ul className="space-y-3">
              {dataChecks.map(({ order, result }) => (
                <li key={order.id} className="rounded-xl border border-border bg-card p-4 shadow-card">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        <span className="font-mono text-sm">{order.jobNumber}</span> · {order.customerName}
                      </p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-destructive">
                        {result.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs text-muted-foreground">Correct the source entry (shift log, QC lot or consignment). Totals are never adjusted automatically.</p>
                    </div>
                    {onNavigate && (
                      <Button size="sm" variant="secondary" onClick={() => onNavigate('order_journey', order.id)}>
                        Open order <ArrowUpRight />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <RulesForm current={alertThresholds} canEdit={canEditRules} onSave={saveAlertThresholdsRecord} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RulesForm({ current, canEdit, onSave }: { current: RtdbAlertThresholds; canEdit: boolean; onSave: (t: RtdbAlertThresholds) => Promise<{ success: boolean; error?: string }> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Live snapshots hand over a new object each time; reset only when the saved values change.
  const savedKey = JSON.stringify(RULES.map((r) => current?.[r.key]));
  useEffect(() => {
    setValues(Object.fromEntries(RULES.map((r) => [r.key, current?.[r.key] !== undefined ? String(current[r.key]) : ''])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  const changed = RULES.some((r) => values[r.key] !== (current?.[r.key] !== undefined ? String(current[r.key]) : ''));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = Object.fromEntries(RULES.map((r) => [r.key, Number(values[r.key])])) as unknown as RtdbAlertThresholds;
    const bad = RULES.find((r) => !(Number(values[r.key]) >= 0) || values[r.key] === '');
    if (bad) return setError(`Enter a number for “${bad.label}”.`);
    if (next.rejectionPercent > 100) return setError('Rejection limit cannot be above 100%.');
    setError('');
    setSaving(true);
    const res = await onSave(next);
    setSaving(false);
    if (res.success) toast.success('Alert rules saved', { description: 'They apply to everyone straight away.' });
    else setError(res.error || 'Not saved.');
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Alert rules</CardTitle>
          <CardDescription>{canEdit ? 'Company-wide limits. Changes apply for everyone immediately.' : 'Only the CEO or Super Admin can change these.'}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {RULES.map((r) => (
              <Field key={r.key} label={`${r.label} (${r.unit})`} htmlFor={`rule-${r.key}`} hint={r.hint}>
                <Input id={`rule-${r.key}`} inputMode="decimal" disabled={!canEdit} value={values[r.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value.replace(/[^0-9.]/g, '') }))} />
              </Field>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {canEdit && (
            <div className="flex justify-end">
              <Button type="submit" loading={saving} disabled={!changed}>
                Save rules
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
