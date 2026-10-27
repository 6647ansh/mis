import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowUpRight, Download, FileDown, FileSpreadsheet, Plus } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { OrderJourney } from '../../types/mis';
import { canRoleWriteCollection } from '../../types/roles';
import { OrderClearancePanel } from '../orders/OrderClearancePanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle, SheetContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/overlays';
import { formatDate, formatINR, formatNumber } from '@/lib/utils';

type Filter = 'open' | 'late' | 'ready' | 'completed' | 'all';

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysLate = (o: OrderJourney) => {
  if (o.status === 'completed' || !o.targetDeliveryDate) return 0;
  const d = Math.floor((Date.parse(todayIso()) - Date.parse(o.targetDeliveryDate)) / 86_400_000);
  return d > 0 ? d : 0;
};
const isReady = (o: OrderJourney) => Boolean(o.qualityClearedBy && o.financeClearedBy) && o.status !== 'completed';

export function SalesOrdersPage({ onSelectOrder }: { onSelectOrder: (orderId: string) => void }) {
  const { currentUser, activeRbacGroup, salesOrders } = useRtdb();
  const [filter, setFilter] = useState<Filter>('open');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const canCreate = canRoleWriteCollection(currentUser.role, 'salesOrders') && ['sales', 'ceo', 'super_admin'].includes(currentUser.role);
  const restricted = salesOrders.some((o) => o.commercialRestricted);

  const counts = useMemo(
    () => ({
      all: salesOrders.length,
      open: salesOrders.filter((o) => o.status !== 'completed').length,
      late: salesOrders.filter((o) => daysLate(o) > 0).length,
      ready: salesOrders.filter(isReady).length,
      completed: salesOrders.filter((o) => o.status === 'completed').length,
    }),
    [salesOrders]
  );

  const rows = useMemo(() => {
    switch (filter) {
      case 'open':
        return salesOrders.filter((o) => o.status !== 'completed');
      case 'late':
        return salesOrders.filter((o) => daysLate(o) > 0);
      case 'ready':
        return salesOrders.filter(isReady);
      case 'completed':
        return salesOrders.filter((o) => o.status === 'completed');
      default:
        return salesOrders;
    }
  }, [salesOrders, filter]);

  const selected = salesOrders.find((o) => o.id === selectedId) || null;

  const columns: Column<OrderJourney>[] = [
    {
      id: 'job',
      header: 'Job / PO',
      sortValue: (o) => o.jobNumber,
      cell: (o) => (
        <div>
          <p className="whitespace-nowrap font-mono text-xs font-semibold">{o.jobNumber}</p>
          <p className="max-w-44 truncate text-xs text-muted-foreground">{o.poNumber}</p>
        </div>
      ),
    },
    { id: 'customer', header: 'Customer', sortValue: (o) => o.customerName, cell: (o) => <span className="line-clamp-2 min-w-32 max-w-56">{o.customerName}</span> },
    {
      id: 'product',
      header: 'Product',
      hideBelow: 'xl',
      cell: (o) => {
        const li = o.lineItems?.[0];
        return li ? (
          <div className="max-w-56">
            <p className="truncate">{li.productName}</p>
            <p className="text-xs text-muted-foreground">
              {formatNumber(li.orderedQty)} {li.uom} · {li.materialGrade}
            </p>
          </div>
        ) : (
          '—'
        );
      },
    },
    { id: 'stage', header: 'Stage', hideBelow: 'md', cell: (o) => <Badge className="max-w-48 truncate">{o.statusLabel || o.status}</Badge> },
    {
      id: 'due',
      header: 'Delivery',
      sortValue: (o) => o.targetDeliveryDate || '',
      cell: (o) => {
        const late = daysLate(o);
        return (
          <div className="whitespace-nowrap">
            <p>{formatDate(o.targetDeliveryDate)}</p>
            {late > 0 && <p className="text-xs font-semibold text-destructive">{late} days late</p>}
          </div>
        );
      },
    },
    {
      id: 'clear',
      header: 'Clearances',
      hideBelow: 'sm',
      cell: (o) =>
        isReady(o) ? (
          <Badge tone="success" dot>Ready</Badge>
        ) : (
          <span className="flex gap-1">
            <Badge tone={o.qualityClearedBy ? 'success' : 'neutral'}>QC</Badge>
            <Badge tone={o.financeClearedBy ? 'success' : 'neutral'}>Fin</Badge>
          </span>
        ),
    },
    ...(!restricted
      ? [
          {
            id: 'value',
            header: 'Value',
            align: 'right' as const,
            sortValue: (o: OrderJourney) => o.totalValue || 0,
            cell: (o: OrderJourney) => <span className="whitespace-nowrap font-mono">{formatINR(o.totalValue || 0, { compact: true })}</span>,
          },
        ]
      : []),
  ];

  const exportRows = async (kind: 'xlsx' | 'csv') => {
    const svc = await import('../../services/documentExportService');
    const headers = ['Job no.', 'PO no.', 'PO date', 'Customer', 'Product', 'Qty', 'Stage', 'Delivery date', 'Days late', 'Quality clearance', 'Finance clearance', ...(restricted ? [] : ['Value (INR)'])];
    const data = rows.map((o) => [
      o.jobNumber,
      o.poNumber,
      o.poDate,
      o.customerName,
      o.lineItems?.[0]?.productName || '',
      o.lineItems?.[0]?.orderedQty || 0,
      o.statusLabel || o.status,
      o.targetDeliveryDate,
      daysLate(o),
      o.qualityClearedBy ? 'Yes' : 'No',
      o.financeClearedBy ? 'Yes' : 'No',
      ...(restricted ? [] : [o.totalValue || 0]),
    ]);
    const name = `Montex_Sales_Orders_${filter}_${todayIso()}`;
    const res =
      kind === 'xlsx'
        ? svc.exportMontexExcelWorkbook(`${name}.xlsx`, [{ sheetName: 'Sales orders', reportTitle: 'MONTEX MIS — SALES ORDERS', reportSubtitle: `Filter: ${filter}`, headers, rows: data }], currentUser.email)
        : svc.exportMontexCsvFile(`${name}.csv`, headers, data);
    if (res.success) toast.success('Download started', { description: res.filename });
    else toast.error('Export failed', { description: res.error });
  };

  const downloadPdf = async (o: OrderJourney) => {
    const svc = await import('../../services/documentExportService');
    const res = svc.generateMontexPdfDocument(svc.buildOrderProgressPdfPayload(o, 'full_progress', currentUser, activeRbacGroup), 'download');
    if (res.success) toast.success('Order PDF downloaded', { description: o.jobNumber });
    else toast.error('PDF could not be created', { description: res.error });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales Orders"
        description="Customer purchase orders, their job numbers, delivery dates and dispatch clearances."
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">
                  <Download /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => exportRows('xlsx')}>
                  <FileSpreadsheet /> Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportRows('csv')}>
                  <FileDown /> CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canCreate && (
              <Button onClick={() => setCreating(true)}>
                <Plus /> New order
              </Button>
            )}
          </>
        }
      />

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList className="h-auto flex-wrap">
          {(
            [
              ['open', 'Open'],
              ['late', 'Late'],
              ['ready', 'Ready to dispatch'],
              ['completed', 'Completed'],
              ['all', 'All'],
            ] as [Filter, string][]
          ).map(([id, label]) => (
            <TabsTrigger key={id} value={id}>
              {label}
              <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums">{counts[id]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(o) => o.id}
        searchText={(o) => `${o.jobNumber} ${o.poNumber} ${o.customerName} ${o.lineItems?.[0]?.productName || ''}`}
        searchPlaceholder="Search job, PO, customer or product"
        onRowClick={(o) => setSelectedId(o.id)}
        initialSort={{ id: 'due' }}
        emptyTitle={filter === 'late' ? 'No late orders' : 'No orders here'}
        emptyDescription={canCreate ? 'Register a customer PO with “New order”.' : undefined}
      />

      <Dialog open={Boolean(selected)} onOpenChange={(o) => !o && setSelectedId(null)}>
        {selected && (
          <SheetContent>
            <OrderSheet
              order={selected}
              restricted={Boolean(selected.commercialRestricted)}
              onOpenTracker={() => onSelectOrder(selected.id)}
              onDownloadPdf={() => downloadPdf(selected)}
            />
          </SheetContent>
        )}
      </Dialog>

      <Dialog open={creating} onOpenChange={setCreating}>
        {creating && (
          <SheetContent>
            <NewOrderForm onDone={() => setCreating(false)} />
          </SheetContent>
        )}
      </Dialog>
    </div>
  );
}

function OrderSheet({
  order,
  restricted,
  onOpenTracker,
  onDownloadPdf,
}: {
  order: OrderJourney;
  restricted: boolean;
  onOpenTracker: () => void;
  onDownloadPdf: () => void;
}) {
  const li = order.lineItems?.[0];
  const steps = li
    ? [
        ['Produced', li.producedQty],
        ['Passed QC', li.inspectedOkQty],
        ['Dispatched', li.dispatchedQty],
      ]
    : [];
  return (
    <>
      <div className="border-b border-border px-6 py-5 pr-14">
        <p className="font-mono text-xs font-semibold text-muted-foreground">{order.jobNumber}</p>
        <DialogTitle className="mt-1">{order.customerName}</DialogTitle>
        <DialogDescription>
          PO {order.poNumber} · {formatDate(order.poDate)}
        </DialogDescription>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{order.statusLabel || order.status}</Badge>
          {daysLate(order) > 0 && <Badge tone="danger">{daysLate(order)} days late</Badge>}
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Product</dt>
            <dd className="font-medium">{li?.productName || '—'}</dd>
            {li && <dd className="text-xs text-muted-foreground">{li.materialGrade} · {li.size}</dd>}
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Delivery date</dt>
            <dd className="font-medium">{formatDate(order.targetDeliveryDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Ordered</dt>
            <dd className="font-medium">{li ? `${formatNumber(li.orderedQty)} ${li.uom}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Order value</dt>
            <dd className="font-medium">{restricted ? 'Not visible for your role' : formatINR(order.totalValue || 0)}</dd>
          </div>
        </dl>

        {li && li.orderedQty > 0 && (
          <section aria-label="Quantity progress" className="space-y-3">
            <h3 className="text-sm font-semibold">Progress</h3>
            {steps.map(([label, qty]) => (
              <div key={label as string}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono font-semibold">
                    {formatNumber(qty as number)} / {formatNumber(li.orderedQty)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-slate-700" style={{ width: `${Math.min(100, ((qty as number) / li.orderedQty) * 100)}%` }} />
                </div>
              </div>
            ))}
          </section>
        )}

        <OrderClearancePanel order={order} />
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border px-6 py-4">
        <Button onClick={onOpenTracker}>
          Open in Order Tracker <ArrowUpRight />
        </Button>
        <Button variant="secondary" onClick={onDownloadPdf}>
          <FileDown /> Progress PDF
        </Button>
      </div>
    </>
  );
}

function NewOrderForm({ onDone }: { onDone: () => void }) {
  const { customers, products, salesOrders, createSalesOrderRecord } = useRtdb();
  const [f, setF] = useState({ customerId: '', productId: '', poNumber: '', poDate: todayIso(), deliveryDate: '', qty: '', rate: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(f.qty);
    const rate = Number(f.rate);
    const errs: Record<string, string> = {};
    if (!f.customerId) errs.customerId = 'Choose the customer.';
    if (!f.productId) errs.productId = 'Choose the product.';
    if (!f.poNumber.trim()) errs.poNumber = 'Enter the customer’s PO number.';
    else if (salesOrders.some((o) => o.poNumber.trim().toLowerCase() === f.poNumber.trim().toLowerCase()))
      errs.poNumber = 'An order with this PO number already exists.';
    if (!f.poDate) errs.poDate = 'Enter the PO date.';
    if (!f.deliveryDate) errs.deliveryDate = 'Enter the committed delivery date.';
    else if (f.poDate && f.deliveryDate < f.poDate) errs.deliveryDate = 'Delivery date cannot be before the PO date.';
    if (!(qty > 0) || !Number.isInteger(qty)) errs.qty = 'Enter a whole number of pieces above zero.';
    if (!(rate >= 0) || f.rate === '') errs.rate = 'Enter the rate per piece (0 or more).';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const cust = customers.find((c) => c.id === f.customerId)!;
    const prod = products.find((p) => p.id === f.productId)!;
    const year = f.poDate.slice(0, 4);
    // Next job number in this year's series; Firestore create refuses a duplicate id.
    const jobSeq =
      Math.max(
        0,
        ...salesOrders
          .map((o) => o.jobNumber.match(new RegExp(`^JOB-MF-${year}-(\\d+)$`)))
          .filter(Boolean)
          .map((m) => Number(m![1]))
      ) + 1;
    const jobNumber = `JOB-MF-${year}-${String(jobSeq).padStart(4, '0')}`;
    const id = `ORD-${year}-${Date.now().toString(36).toUpperCase()}`;
    const total = qty * rate;

    const order: OrderJourney = {
      id,
      poNumber: f.poNumber.trim(),
      poDate: f.poDate,
      jobNumber,
      customerId: cust.id,
      customerName: cust.name,
      totalValue: total,
      currency: 'INR',
      expectedDeliveryDate: f.deliveryDate,
      targetDeliveryDate: f.deliveryDate,
      status: 'material_pending',
      statusLabel: 'New order — awaiting material allocation',
      lineItems: [
        {
          id: `${id}-L1`,
          salesOrderId: id,
          productId: prod.id,
          productCode: prod.code,
          productName: prod.name,
          materialGrade: prod.materialGrade,
          size: prod.size,
          orderedQty: qty,
          uom: prod.uom || 'PCS',
          ratePerUnit: rate,
          totalAmount: total,
          producedQty: 0,
          inspectedOkQty: 0,
          rejectedQty: 0,
          dispatchedQty: 0,
          pendingQty: qty,
        },
      ],
      // Later stages are filled by Stores, Quality, Dispatch and Finance; nothing is pre-assumed.
      materialStatus: { state: 'shortage', materialGrade: prod.materialGrade, heatNumber: '', requiredKg: Math.round(qty * (prod.standardWeightKg || 0)), allocatedKg: 0, supplierName: '', lastUpdated: todayIso(), notes: 'Not yet allocated by Stores.' },
      qualityStatus: { state: 'pending', inspectorName: '', inspectionDate: '', mtcNumber: '', mtcStatus: 'draft', testTypes: [] },
      clearanceStatus: { state: 'pending', agency: '', inspectorName: '', clearanceDate: '', clearanceRefNo: '', remarks: '' },
      dispatchStatus: { state: 'pending', totalShippedQty: 0, balanceQty: qty, transporterName: '', vehicleNo: '', lrNumber: '', dispatchDate: '', destinationCity: cust.location || '' },
      invoiceStatus: { state: 'pending', invoiceNumber: '', invoiceDate: '', invoiceAmount: 0, paidAmount: 0, paymentDueDate: '', tallySyncStatus: 'pending_import', outstandingAmount: 0 },
    } as OrderJourney;

    setSaving(true);
    const res = await createSalesOrderRecord(order);
    setSaving(false);
    if (!res.success) {
      toast.error('Order not saved', { description: res.error || 'Please try again.' });
      return;
    }
    if ((res as { warning?: string }).warning) toast.warning('Saved with a problem', { description: (res as { warning?: string }).warning });
    else toast.success('Order registered', { description: `${jobNumber} · ${cust.name}` });
    onDone();
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col" noValidate>
      <DialogHeader className="border-b border-border px-6 py-5">
        <DialogTitle>New sales order</DialogTitle>
        <DialogDescription>Register a customer purchase order. A job number is assigned automatically.</DialogDescription>
      </DialogHeader>
      <div className="grid flex-1 content-start gap-4 overflow-y-auto px-6 py-5 sm:grid-cols-2">
        <Field label="Customer" htmlFor="no-cust" error={errors.customerId} className="sm:col-span-2">
          <Select id="no-cust" value={f.customerId} onChange={set('customerId')} aria-invalid={Boolean(errors.customerId)}>
            <option value="">Choose a customer…</option>
            {customers.filter((c) => c.active !== false).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Product" htmlFor="no-prod" error={errors.productId} className="sm:col-span-2">
          <Select id="no-prod" value={f.productId} onChange={set('productId')} aria-invalid={Boolean(errors.productId)}>
            <option value="">Choose a product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.materialGrade}</option>
            ))}
          </Select>
        </Field>
        <Field label="Customer PO number" htmlFor="no-po" error={errors.poNumber}>
          <Input id="no-po" value={f.poNumber} onChange={set('poNumber')} aria-invalid={Boolean(errors.poNumber)} />
        </Field>
        <Field label="PO date" htmlFor="no-podate" error={errors.poDate}>
          <Input id="no-podate" type="date" value={f.poDate} onChange={set('poDate')} aria-invalid={Boolean(errors.poDate)} />
        </Field>
        <Field label="Quantity (pieces)" htmlFor="no-qty" error={errors.qty}>
          <Input id="no-qty" inputMode="numeric" value={f.qty} onChange={set('qty')} aria-invalid={Boolean(errors.qty)} />
        </Field>
        <Field label="Rate per piece (₹)" htmlFor="no-rate" error={errors.rate} hint={Number(f.qty) > 0 && Number(f.rate) >= 0 && f.rate ? `Order value ${formatINR(Number(f.qty) * Number(f.rate))}` : undefined}>
          <Input id="no-rate" inputMode="decimal" value={f.rate} onChange={set('rate')} aria-invalid={Boolean(errors.rate)} />
        </Field>
        <Field label="Committed delivery date" htmlFor="no-del" error={errors.deliveryDate} className="sm:col-span-2">
          <Input id="no-del" type="date" value={f.deliveryDate} min={f.poDate} onChange={set('deliveryDate')} aria-invalid={Boolean(errors.deliveryDate)} />
        </Field>
      </div>
      <DialogFooter className="border-t border-border px-6 py-4">
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" loading={saving}>Register order</Button>
      </DialogFooter>
    </form>
  );
}
