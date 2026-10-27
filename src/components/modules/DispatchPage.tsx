import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Clock, FileDown, PackageCheck, Truck } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { DispatchConsignmentRecord, OrderJourney } from '../../types/mis';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Callout, EmptyState, PageHeader, StatTile } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle, SheetContent } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { formatDate, formatNumber } from '@/lib/utils';

const todayIso = () => new Date().toISOString().slice(0, 10);
const orderedQty = (o: OrderJourney) => (o.lineItems || []).reduce((s, li) => s + (li.orderedQty || 0), 0);
const shippedQty = (o: OrderJourney) => o.dispatchStatus?.totalShippedQty || 0;
const balanceQty = (o: OrderJourney) => Math.max(0, orderedQty(o) - shippedQty(o));
const isCleared = (o: OrderJourney) => Boolean(o.qualityClearedBy && o.financeClearedBy);

const STATUS_LABEL: Record<string, { label: string; tone: 'neutral' | 'info' | 'success' }> = {
  ready_for_dispatch: { label: 'Scheduled', tone: 'neutral' },
  dispatched: { label: 'In transit', tone: 'info' },
  partially_dispatched: { label: 'In transit', tone: 'info' },
  completed: { label: 'Delivered', tone: 'success' },
};

export function DispatchPage() {
  const { currentUser, activeRbacGroup, salesOrders, dispatches } = useRtdb();
  const [shipping, setShipping] = useState<OrderJourney | null>(null);
  const canDispatch = ['dispatch', 'ceo', 'super_admin'].includes(currentUser.role);

  const { ready, waiting, monthCount, monthTons } = useMemo(() => {
    const open = salesOrders.filter((o) => o.status !== 'completed' && balanceQty(o) > 0);
    const month = todayIso().slice(0, 7);
    const thisMonth = dispatches.filter((d) => (d.date || '').startsWith(month));
    return {
      ready: open.filter(isCleared),
      waiting: open.filter((o) => !isCleared(o)),
      monthCount: thisMonth.length,
      monthTons: thisMonth.reduce((s, d) => s + (d.weightMt || 0), 0),
    };
  }, [salesOrders, dispatches]);

  const downloadChallan = async (d: DispatchConsignmentRecord) => {
    const svc = await import('../../services/documentExportService');
    const order = salesOrders.find((o) => o.id === d.salesOrderId || o.jobNumber === d.jobNumber);
    const res = svc.generateMontexPdfDocument(svc.buildDispatchChallanPdfPayload(d, order, currentUser, activeRbacGroup), 'download');
    if (res.success) toast.success('Delivery challan downloaded', { description: d.id });
    else toast.error('Challan could not be created', { description: res.error });
  };

  const readyColumns: Column<OrderJourney>[] = [
    { id: 'job', header: 'Job', sortValue: (o) => o.jobNumber, cell: (o) => <span className="whitespace-nowrap font-mono text-xs font-semibold">{o.jobNumber}</span> },
    { id: 'customer', header: 'Customer', sortValue: (o) => o.customerName, cell: (o) => <span className="line-clamp-2 min-w-32">{o.customerName}</span> },
    { id: 'product', header: 'Product', hideBelow: 'lg', cell: (o) => <span className="line-clamp-1 max-w-56">{o.lineItems?.[0]?.productName || '—'}</span> },
    {
      id: 'balance',
      header: 'To ship',
      align: 'right',
      sortValue: balanceQty,
      cell: (o) => (
        <span className="whitespace-nowrap font-mono">
          {formatNumber(balanceQty(o))} <span className="text-muted-foreground">/ {formatNumber(orderedQty(o))}</span>
        </span>
      ),
    },
    { id: 'due', header: 'Delivery', hideBelow: 'md', sortValue: (o) => o.targetDeliveryDate || '', cell: (o) => <span className="whitespace-nowrap">{formatDate(o.targetDeliveryDate)}</span> },
    ...(canDispatch
      ? [
          {
            id: 'act',
            header: '',
            align: 'right' as const,
            cell: (o: OrderJourney) => (
              <Button size="sm" onClick={(e) => (e.stopPropagation(), setShipping(o))}>
                <Truck /> Ship
              </Button>
            ),
          },
        ]
      : []),
  ];

  const waitingColumns: Column<OrderJourney>[] = [
    { id: 'job', header: 'Job', sortValue: (o) => o.jobNumber, cell: (o) => <span className="whitespace-nowrap font-mono text-xs font-semibold">{o.jobNumber}</span> },
    { id: 'customer', header: 'Customer', cell: (o) => <span className="line-clamp-2 min-w-32">{o.customerName}</span> },
    {
      id: 'missing',
      header: 'Waiting for',
      cell: (o) => (
        <span className="flex flex-wrap gap-1">
          {!o.qualityClearedBy && <Badge tone="warning">Quality clearance</Badge>}
          {!o.financeClearedBy && <Badge tone="warning">Finance clearance</Badge>}
        </span>
      ),
    },
    { id: 'due', header: 'Delivery', hideBelow: 'md', sortValue: (o) => o.targetDeliveryDate || '', cell: (o) => <span className="whitespace-nowrap">{formatDate(o.targetDeliveryDate)}</span> },
  ];

  const consignmentColumns: Column<DispatchConsignmentRecord>[] = [
    { id: 'date', header: 'Date', sortValue: (d) => d.date, cell: (d) => <span className="whitespace-nowrap">{formatDate(d.date)}</span> },
    {
      id: 'id',
      header: 'Consignment',
      sortValue: (d) => d.id,
      cell: (d) => (
        <div>
          <p className="whitespace-nowrap font-mono text-xs font-semibold">{d.id}</p>
          <p className="text-xs text-muted-foreground">{d.jobNumber}</p>
        </div>
      ),
    },
    { id: 'customer', header: 'Customer', cell: (d) => <span className="line-clamp-2 min-w-32">{d.customer}</span> },
    {
      id: 'qty',
      header: 'Qty / weight',
      align: 'right',
      cell: (d) => (
        <span className="whitespace-nowrap font-mono">
          {d.quantity ? formatNumber(d.quantity) : '—'} <span className="text-muted-foreground">· {formatNumber(d.weightMt, 2)} t</span>
        </span>
      ),
    },
    {
      id: 'vehicle',
      header: 'Vehicle / LR',
      hideBelow: 'md',
      cell: (d) => (
        <div className="text-xs">
          <p className="font-medium">{d.vehicleNo || '—'}</p>
          <p className="text-muted-foreground">{d.lrNumber ? `LR ${d.lrNumber}` : 'LR not entered'}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      hideBelow: 'sm',
      cell: (d) => {
        const s = STATUS_LABEL[d.status] || { label: d.status, tone: 'neutral' as const };
        return <Badge tone={s.tone}>{s.label}</Badge>;
      },
    },
    {
      id: 'pdf',
      header: '',
      align: 'right',
      cell: (d) => (
        <Button size="icon-sm" variant="ghost" onClick={(e) => (e.stopPropagation(), downloadChallan(d))} aria-label={`Download challan for ${d.id}`}>
          <FileDown />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Dispatch" description="Ship orders that have both quality and finance clearance, and keep the consignment register." />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatTile label="Ready to ship" value={formatNumber(ready.length)} hint="Both clearances given" icon={PackageCheck} tone="success" />
        <StatTile label="Waiting for clearance" value={formatNumber(waiting.length)} hint="Cannot ship yet" icon={Clock} tone={waiting.length ? 'warning' : 'neutral'} />
        <StatTile label="Shipped this month" value={formatNumber(monthCount)} hint={`${formatNumber(monthTons, 2)} tonnes`} icon={Truck} />
      </section>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Ready to ship</CardTitle>
            <CardDescription>Orders with quality and finance clearance and a balance left to ship</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {ready.length === 0 ? (
            <EmptyState icon={PackageCheck} title="Nothing cleared to ship" description="Orders appear here once Quality and Finance have both cleared them." />
          ) : (
            <DataTable className="rounded-none border-0 border-t shadow-none" rows={ready} columns={readyColumns} rowKey={(o) => o.id} initialSort={{ id: 'due' }} pageSize={10} />
          )}
        </CardContent>
      </Card>

      {waiting.length > 0 && (
        <section className="space-y-3">
          <Callout tone="info" title={`${waiting.length} open order${waiting.length === 1 ? ' is' : 's are'} waiting for clearance`} why="Dispatch opens automatically once both clearances are given." />
          <DataTable rows={waiting} columns={waitingColumns} rowKey={(o) => o.id} initialSort={{ id: 'due' }} pageSize={10} />
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Consignment register</h2>
          <p className="text-sm text-muted-foreground">Every consignment shipped, newest first</p>
        </div>
        <DataTable
          rows={dispatches}
          columns={consignmentColumns}
          rowKey={(d) => d.id}
          searchText={(d) => `${d.id} ${d.jobNumber} ${d.orderNo} ${d.customer} ${d.vehicleNo} ${d.lrNumber}`}
          searchPlaceholder="Search consignment, job, vehicle or LR"
          initialSort={{ id: 'date', desc: true }}
          emptyTitle="No consignments yet"
        />
      </section>

      <Dialog open={Boolean(shipping)} onOpenChange={(o) => !o && setShipping(null)}>
        {shipping && (
          <SheetContent>
            <ConsignmentForm order={shipping} onDone={() => setShipping(null)} />
          </SheetContent>
        )}
      </Dialog>
    </div>
  );
}

function ConsignmentForm({ order, onDone }: { order: OrderJourney; onDone: () => void }) {
  const { products, recordDispatchRecord } = useRtdb();
  const li = order.lineItems?.[0];
  const product = products.find((p) => p.id === li?.productId);
  const balance = balanceQty(order);
  const [f, setF] = useState({ qty: String(balance), weight: '', transporter: '', vehicle: '', lr: '', invoice: '', date: todayIso() });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const suggestedWeight = product?.standardWeightKg && Number(f.qty) > 0 ? (Number(f.qty) * product.standardWeightKg) / 1000 : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(f.qty);
    const weight = Number(f.weight || suggestedWeight || 0);
    const errs: Record<string, string> = {};
    if (!Number.isInteger(qty) || qty <= 0) errs.qty = 'Enter a whole number of pieces above zero.';
    else if (qty > balance) errs.qty = `Only ${formatNumber(balance)} pieces are left on this order.`;
    if (!(weight > 0)) errs.weight = 'Enter the consignment weight in tonnes.';
    if (!f.transporter.trim()) errs.transporter = 'Enter the transporter.';
    if (!f.vehicle.trim()) errs.vehicle = 'Enter the vehicle number.';
    if (!f.date) errs.date = 'Enter the dispatch date.';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const shipped = shippedQty(order) + qty;
    const ordered = orderedQty(order);
    const left = Math.max(0, ordered - shipped);
    const id = `DSP-${f.date.slice(0, 4)}-${Date.now().toString(36).toUpperCase()}`;
    const record: DispatchConsignmentRecord = {
      id,
      orderNo: order.poNumber,
      jobNumber: order.jobNumber,
      salesOrderId: order.id,
      customer: order.customerName,
      product: li?.productName || '',
      quantity: qty,
      balanceQty: left,
      weightMt: Number(weight.toFixed(3)),
      transporter: f.transporter.trim(),
      vehicleNo: f.vehicle.trim().toUpperCase(),
      lrNumber: f.lr.trim(),
      destination: order.dispatchStatus?.destinationCity || '',
      date: f.date,
      invoiceRef: f.invoice.trim(),
      clearanceRef: '',
      status: 'dispatched',
    } as DispatchConsignmentRecord;
    const updated: OrderJourney = {
      ...order,
      status: left === 0 ? 'completed' : 'partially_dispatched',
      statusLabel: left === 0 ? 'Completed — all quantity dispatched' : `Partially dispatched (${formatNumber(shipped)}/${formatNumber(ordered)})`,
      lineItems: (order.lineItems || []).map((x, i) => (i === 0 ? { ...x, dispatchedQty: shipped, pendingQty: left } : x)),
      dispatchStatus: {
        ...order.dispatchStatus,
        state: left === 0 ? 'completed' : 'partial',
        totalShippedQty: shipped,
        balanceQty: left,
        transporterName: record.transporter,
        vehicleNo: record.vehicleNo,
        lrNumber: record.lrNumber,
        dispatchDate: record.date,
      },
    };

    setSaving(true);
    const res = await recordDispatchRecord(record, updated);
    setSaving(false);
    if (!res.success) {
      toast.error('Consignment not saved', { description: res.error || 'Please try again.' });
      return;
    }
    if (res.warning) toast.warning('Consignment saved, order not updated', { description: res.warning, duration: 10000 });
    else toast.success('Consignment recorded', { description: `${id} · ${formatNumber(qty)} pcs` });
    onDone();
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col" noValidate>
      <DialogHeader className="border-b border-border px-6 py-5">
        <DialogTitle>Ship {order.jobNumber}</DialogTitle>
        <DialogDescription>
          {order.customerName} · {formatNumber(balance)} of {formatNumber(orderedQty(order))} pieces left to ship
        </DialogDescription>
      </DialogHeader>
      <div className="grid flex-1 content-start gap-4 overflow-y-auto px-6 py-5 sm:grid-cols-2">
        <Field label="Quantity (pieces)" htmlFor="cf-qty" error={errors.qty}>
          <Input id="cf-qty" inputMode="numeric" value={f.qty} onChange={set('qty')} aria-invalid={Boolean(errors.qty)} />
        </Field>
        <Field
          label="Weight (tonnes)"
          htmlFor="cf-wt"
          error={errors.weight}
          hint={suggestedWeight ? `Leave blank to use ${formatNumber(suggestedWeight, 3)} t from the product's standard weight` : 'From the weighbridge slip'}
        >
          <Input id="cf-wt" inputMode="decimal" value={f.weight} placeholder={suggestedWeight ? formatNumber(suggestedWeight, 3) : ''} onChange={set('weight')} aria-invalid={Boolean(errors.weight)} />
        </Field>
        <Field label="Transporter" htmlFor="cf-tr" error={errors.transporter} className="sm:col-span-2">
          <Input id="cf-tr" value={f.transporter} onChange={set('transporter')} aria-invalid={Boolean(errors.transporter)} />
        </Field>
        <Field label="Vehicle number" htmlFor="cf-veh" error={errors.vehicle}>
          <Input id="cf-veh" value={f.vehicle} onChange={set('vehicle')} aria-invalid={Boolean(errors.vehicle)} />
        </Field>
        <Field label="LR number" htmlFor="cf-lr" hint="Optional now; add when the transporter issues it">
          <Input id="cf-lr" value={f.lr} onChange={set('lr')} />
        </Field>
        <Field label="Invoice number" htmlFor="cf-inv" hint="Optional">
          <Input id="cf-inv" value={f.invoice} onChange={set('invoice')} />
        </Field>
        <Field label="Dispatch date" htmlFor="cf-date" error={errors.date}>
          <Input id="cf-date" type="date" value={f.date} onChange={set('date')} aria-invalid={Boolean(errors.date)} />
        </Field>
      </div>
      <DialogFooter className="border-t border-border px-6 py-4">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={saving}><Truck /> Record consignment</Button>
      </DialogFooter>
    </form>
  );
}
