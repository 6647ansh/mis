import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Download, FileText, IndianRupee, MoreHorizontal, PhoneCall, Plus, Receipt, ShieldCheck, Upload, Wallet } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { JobCostSheet, OrderJourney, OutstandingAgeingRecord, PaymentFollowUpRecord, PurchaseOrderRecord } from '../../types/mis';
import type { MontexPdfDocumentPayload, RecordedPaymentReceiptItem } from '../../services/documentExportService';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
import { ClearanceQueue } from '../orders/ClearanceQueue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout, PageHeader, StatTile } from '@/components/ui/data-display';
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
  Tooltip,
} from '@/components/ui/overlays';
import { cn, formatDate, formatINR, formatNumber, newRecordId, todayIso } from '@/lib/utils';

const WRITERS = ['super_admin', 'ceo', 'finance'];
const FOLLOW_UP_WRITERS = ['super_admin', 'ceo', 'finance', 'sales'];
// Sequential bronze ramp: darker = older money (dataviz: magnitude of risk, one hue).
const BUCKETS = [
  { key: 'bucket0to30', label: '0–30 days', cls: 'bg-bronze-200' },
  { key: 'bucket31to60', label: '31–60 days', cls: 'bg-bronze-400' },
  { key: 'bucket61to90', label: '61–90 days', cls: 'bg-bronze-600' },
  { key: 'bucket90Plus', label: '90+ days', cls: 'bg-bronze-800' },
] as const;
const FOLLOW_UP_MODES = ['Phone Call', 'Email', 'WhatsApp', 'Executive Visit', 'Legal Notice'];
const FOLLOW_UP_OUTCOMES = ['Payment Promised', 'Part Payment Released', 'Dispute Raised', 'No Response', 'Cleared'];
const OUTCOME_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  'Payment Promised': 'warning',
  'Part Payment Released': 'warning',
  Cleared: 'success',
  'Dispute Raised': 'danger',
  'No Response': 'neutral',
};

function costOf(c: JobCostSheet) {
  const total =
    c.materialCostInr - c.scrapRecoveryCreditInr + c.labourCostInr + c.powerCostInr + c.fuelHeatTreatmentCostInr +
    c.machiningProcessingCostInr + c.testingTpiCostInr + c.packingCostInr + c.transportFreightCostInr + c.overheadCostInr;
  const profit = c.totalRevenueInr - total;
  return { total, profit, margin: c.totalRevenueInr > 0 ? (profit / c.totalRevenueInr) * 100 : null };
}

function AgeingBar({ a }: { a: OutstandingAgeingRecord }) {
  const total = a.totalOutstanding || 1;
  return (
    <div className="flex h-2.5 w-full min-w-28 overflow-hidden rounded-full bg-muted" role="img" aria-label={BUCKETS.map((b) => `${b.label} ${formatINR(a[b.key])}`).join(', ')}>
      {BUCKETS.map((b) =>
        a[b.key] > 0 ? (
          <Tooltip key={b.key} content={`${b.label}: ${formatINR(a[b.key])}`}>
            <span className={cn('h-full border-r-2 border-card last:border-r-0', b.cls)} style={{ width: `${(a[b.key] / total) * 100}%` }} />
          </Tooltip>
        ) : null
      )}
    </div>
  );
}

export function FinancePage() {
  const { currentUser, activeRbacGroup, outstandingAgeing, salesOrders, customers, products, purchaseOrders, suppliers, jobCostSheets, paymentFollowUps } = useRtdb();
  const active = currentUser.accountStatus === 'active';
  const canWrite = active && WRITERS.includes(currentUser.role);
  const canFollowUp = active && FOLLOW_UP_WRITERS.includes(currentUser.role);
  const [tab, setTab] = useState('receivables');
  const [paying, setPaying] = useState<OutstandingAgeingRecord | null>(null);
  const [followUpFor, setFollowUpFor] = useState<OutstandingAgeingRecord | 'new' | null>(null);
  const [receipts, setReceipts] = useState<RecordedPaymentReceiptItem[]>([]);
  const [preview, setPreview] = useState<MontexPdfDocumentPayload | null>(null);

  const total = outstandingAgeing.reduce((s, a) => s + a.totalOutstanding, 0);
  const over60 = outstandingAgeing.reduce((s, a) => s + a.bucket61to90 + a.bucket90Plus, 0);
  const overLimit = outstandingAgeing.filter((a) => a.creditExceeded || a.creditLimitExceeded);
  const waitingFinance = salesOrders.filter((o) => o.status !== 'completed' && o.qualityClearedBy && !o.financeClearedBy).length;
  const invoiced = useMemo(() => salesOrders.filter((o) => o.invoiceStatus?.invoiceNumber && o.invoiceStatus.invoiceNumber !== '-'), [salesOrders]);
  const today = todayIso();
  const dueFollowUps = paymentFollowUps.filter((f) => f.nextFollowUpDate && f.nextFollowUpDate <= today && f.status !== 'received');

  const pdf = async (allowed: ('Admin' | 'Management' | 'Finance' | 'Sales' | 'Production')[], build: (svc: typeof import('../../services/documentExportService')) => MontexPdfDocumentPayload) => {
    const svc = await import('../../services/documentExportService');
    const check = svc.verifyExportPermission(currentUser, activeRbacGroup, allowed);
    if (!check.allowed) return toast.error('Export not allowed', { description: check.error });
    setPreview(build(svc));
  };

  const exportExcel = async () => {
    const svc = await import('../../services/documentExportService');
    const check = svc.verifyExportPermission(currentUser, activeRbacGroup, ['Admin', 'Management', 'Finance', 'Sales']);
    if (!check.allowed) return toast.error('Export not allowed', { description: check.error });
    const res = svc.exportMontexExcelWorkbook(
      `Montex_Receivables_${today}.xlsx`,
      [
        {
          sheetName: 'Receivables ageing',
          reportTitle: 'MONTEX MIS — RECEIVABLES AGEING',
          reportSubtitle: `Total ${formatINR(total)} · as of ${formatDate(today)}`,
          headers: ['Customer', 'Credit limit', 'Outstanding', '0–30', '31–60', '61–90', '90+', 'Oldest invoice', 'Over limit'],
          rows: outstandingAgeing.map((a) => [a.customerName, a.creditLimit, a.totalOutstanding, a.bucket0to30, a.bucket31to60, a.bucket61to90, a.bucket90Plus, a.oldestInvoiceDate, a.creditExceeded ? 'Yes' : 'No']),
        },
        {
          sheetName: 'Invoices',
          reportTitle: 'MONTEX MIS — INVOICES BY ORDER',
          reportSubtitle: `${invoiced.length} invoiced orders`,
          headers: ['Job', 'PO', 'Customer', 'Invoice', 'Date', 'Amount', 'Received', 'Balance', 'Due'],
          rows: invoiced.map((o) => [o.jobNumber, o.poNumber, o.customerName, o.invoiceStatus.invoiceNumber, o.invoiceStatus.invoiceDate, o.invoiceStatus.invoiceAmount, o.invoiceStatus.paidAmount, o.invoiceStatus.outstandingAmount, o.invoiceStatus.paymentDueDate]),
        },
      ],
      currentUser.email
    );
    if (res.success) toast.success('Download started', { description: res.filename });
    else toast.error('Export failed', { description: res.error });
  };

  const ageingCols: Column<OutstandingAgeingRecord>[] = [
    {
      id: 'customer',
      header: 'Customer',
      sortValue: (a) => a.customerName,
      cell: (a) => (
        <div className="max-w-64">
          <p className="truncate font-medium">{a.customerName}</p>
          {(a.creditExceeded || a.creditLimitExceeded) && (
            <Badge tone="danger" className="mt-1">
              <AlertTriangle /> Over credit limit
            </Badge>
          )}
        </div>
      ),
    },
    { id: 'total', header: 'Outstanding', align: 'right', sortValue: (a) => a.totalOutstanding, cell: (a) => <span className="whitespace-nowrap font-mono font-semibold">{formatINR(a.totalOutstanding, { compact: true })}</span> },
    { id: 'age', header: 'By age', hideBelow: 'md', cell: (a) => <AgeingBar a={a} /> },
    {
      id: 'old',
      header: 'Over 60 days',
      align: 'right',
      hideBelow: 'sm',
      sortValue: (a) => a.bucket61to90 + a.bucket90Plus,
      cell: (a) => {
        const v = a.bucket61to90 + a.bucket90Plus;
        return <span className={cn('whitespace-nowrap font-mono', v > 0 && 'text-destructive')}>{v ? formatINR(v, { compact: true }) : '—'}</span>;
      },
    },
    { id: 'limit', header: 'Credit limit', align: 'right', hideBelow: 'lg', cell: (a) => <span className="whitespace-nowrap font-mono">{a.creditLimit ? formatINR(a.creditLimit, { compact: true }) : '—'}</span> },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: (a) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${a.customerName}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canWrite && a.totalOutstanding > 0 && (
              <DropdownMenuItem onSelect={() => setPaying(a)}>
                <IndianRupee /> Record payment
              </DropdownMenuItem>
            )}
            {canFollowUp && (
              <DropdownMenuItem onSelect={() => setFollowUpFor(a)}>
                <PhoneCall /> Log follow-up
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() =>
                pdf(['Admin', 'Management', 'Finance', 'Sales'], (svc) =>
                  svc.buildPaymentReceiptPdfPayload(a, customers.find((c) => c.id === a.customerId), receipts.find((r) => r.customerId === a.customerId), currentUser, activeRbacGroup)
                )
              }
            >
              <FileText /> {receipts.some((r) => r.customerId === a.customerId) ? 'Payment receipt' : 'Statement'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const followCols: Column<PaymentFollowUpRecord>[] = [
    {
      id: 'next',
      header: 'Next follow-up',
      sortValue: (f) => f.nextFollowUpDate,
      cell: (f) => (
        <span className={cn('whitespace-nowrap', f.nextFollowUpDate <= today && f.status !== 'received' && 'font-semibold text-destructive')}>{formatDate(f.nextFollowUpDate)}</span>
      ),
    },
    {
      id: 'who',
      header: 'Customer / invoice',
      cell: (f) => (
        <div className="max-w-64">
          <p className="truncate font-medium">{f.customerName}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{f.invoiceNumber}</p>
        </div>
      ),
    },
    {
      id: 'promise',
      header: 'Promised',
      align: 'right',
      hideBelow: 'sm',
      cell: (f) =>
        f.promisedAmountInr ? (
          <div className="whitespace-nowrap text-right">
            <p className="font-mono">{formatINR(f.promisedAmountInr, { compact: true })}</p>
            {f.promisedPaymentDate && <p className="text-xs text-muted-foreground">by {formatDate(f.promisedPaymentDate)}</p>}
          </div>
        ) : (
          '—'
        ),
    },
    { id: 'outcome', header: 'Outcome', cell: (f) => <Badge tone={OUTCOME_TONE[f.outcome || ''] || 'neutral'}>{f.outcome || '—'}</Badge> },
    {
      id: 'contact',
      header: 'Spoke to',
      hideBelow: 'lg',
      cell: (f) => (
        <div className="max-w-56">
          <p className="truncate">{f.contactedPerson}</p>
          <p className="truncate text-xs text-muted-foreground">
            {f.modeOfCommunication} · {f.loggedByName}
          </p>
        </div>
      ),
    },
  ];

  const costCols: Column<JobCostSheet>[] = [
    {
      id: 'job',
      header: 'Job',
      sortValue: (c) => c.jobNumber,
      cell: (c) => (
        <div className="max-w-64">
          <p className="font-mono text-xs font-semibold">{c.jobNumber}</p>
          <p className="truncate text-xs text-muted-foreground">{c.customerName}</p>
        </div>
      ),
    },
    { id: 'rev', header: 'Revenue', align: 'right', sortValue: (c) => c.totalRevenueInr, cell: (c) => <span className="font-mono">{formatINR(c.totalRevenueInr, { compact: true })}</span> },
    { id: 'cost', header: 'Cost', align: 'right', hideBelow: 'sm', cell: (c) => <span className="font-mono">{formatINR(costOf(c).total, { compact: true })}</span> },
    {
      id: 'margin',
      header: 'Margin',
      align: 'right',
      sortValue: (c) => costOf(c).margin ?? -999,
      cell: (c) => {
        const { margin } = costOf(c);
        const below = margin !== null && c.quotedMarginPercent && margin < c.quotedMarginPercent;
        return (
          <div className="whitespace-nowrap text-right font-mono">
            <span className={cn(margin !== null && margin < 0 ? 'text-destructive' : below ? 'text-warning' : '')}>{margin === null ? '—' : `${formatNumber(margin, 1)}%`}</span>
            {c.quotedMarginPercent ? <p className="text-xs text-muted-foreground">quoted {formatNumber(c.quotedMarginPercent, 1)}%</p> : null}
          </div>
        );
      },
    },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: (c) => (
        <Button size="icon-sm" variant="ghost" aria-label={`Cost sheet ${c.jobNumber}`} onClick={() => pdf(['Admin', 'Management', 'Finance'], (svc) => svc.buildJobCostSheetPdfPayload(c, currentUser, activeRbacGroup))}>
          <FileText />
        </Button>
      ),
    },
  ];

  const invoiceCols: Column<OrderJourney>[] = [
    {
      id: 'inv',
      header: 'Invoice',
      sortValue: (o) => o.invoiceStatus.invoiceDate || '',
      cell: (o) => (
        <div>
          <p className="whitespace-nowrap font-mono text-xs font-semibold">{o.invoiceStatus.invoiceNumber}</p>
          <p className="text-xs text-muted-foreground">{formatDate(o.invoiceStatus.invoiceDate)}</p>
        </div>
      ),
    },
    { id: 'cust', header: 'Customer / job', cell: (o) => <div className="max-w-64"><p className="truncate">{o.customerName}</p><p className="font-mono text-xs text-muted-foreground">{o.jobNumber}</p></div> },
    { id: 'amt', header: 'Amount', align: 'right', hideBelow: 'sm', cell: (o) => <span className="font-mono">{o.commercialRestricted ? '—' : formatINR(o.invoiceStatus.invoiceAmount || 0, { compact: true })}</span> },
    { id: 'bal', header: 'Balance', align: 'right', cell: (o) => <span className={cn('font-mono', o.invoiceStatus.outstandingAmount > 0 && 'text-destructive')}>{o.commercialRestricted ? '—' : formatINR(o.invoiceStatus.outstandingAmount || 0, { compact: true })}</span> },
    { id: 'due', header: 'Due', hideBelow: 'md', cell: (o) => <span className="whitespace-nowrap">{formatDate(o.invoiceStatus.paymentDueDate)}</span> },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: (o) => (
        <Button size="icon-sm" variant="ghost" aria-label={`Billing summary ${o.jobNumber}`} onClick={() => pdf(['Admin', 'Management', 'Finance', 'Sales'], (svc) => svc.buildInvoicePdfPayload(o, customers.find((c) => c.id === o.customerId), products, currentUser, activeRbacGroup))}>
          <FileText />
        </Button>
      ),
    },
  ];

  const billCols: Column<PurchaseOrderRecord>[] = [
    { id: 'po', header: 'PO', sortValue: (p) => p.poDate, cell: (p) => <div><p className="font-mono text-xs font-semibold">{p.poNumber}</p><p className="text-xs text-muted-foreground">{formatDate(p.poDate)}</p></div> },
    { id: 'sup', header: 'Supplier', cell: (p) => <div className="max-w-64"><p className="truncate">{p.supplierName}</p><p className="truncate text-xs text-muted-foreground">{p.materialGrade} · {p.sectionMm}</p></div> },
    { id: 'mt', header: 'Received / ordered', align: 'right', hideBelow: 'sm', cell: (p) => <span className="whitespace-nowrap font-mono">{formatNumber(p.receivedMt, 2)} / {formatNumber(p.orderedMt, 2)} MT</span> },
    { id: 'val', header: 'Value', align: 'right', sortValue: (p) => p.totalValue, cell: (p) => <span className="font-mono">{formatINR(p.totalValue, { compact: true })}</span> },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: (p) => (
        <Button size="icon-sm" variant="ghost" aria-label={`Bill summary ${p.poNumber}`} onClick={() => pdf(['Admin', 'Management', 'Finance', 'Production'], (svc) => svc.buildMillPurchaseOrderPdfPayload(p, suppliers.find((s) => s.id === p.supplierId), 'supplier_bill_summary', currentUser, activeRbacGroup))}>
          <FileText />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Finance"
        description="Who owes what and for how long, collections, finance clearance for dispatch, job margins and Tally cross-checks."
        actions={
          <>
            <Button variant="secondary" onClick={exportExcel}>
              <Download /> Export
            </Button>
            {canFollowUp && (
              <Button onClick={() => setFollowUpFor('new')}>
                <Plus /> Log follow-up
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Receivables" icon={Wallet} tone="bronze" value={formatINR(total, { compact: true })} hint={`${outstandingAgeing.length} customers`} onClick={() => setTab('receivables')} />
        <StatTile label="Over 60 days" icon={AlertTriangle} tone={over60 ? 'danger' : 'neutral'} value={formatINR(over60, { compact: true })} hint={total ? `${formatNumber((over60 / total) * 100, 0)}% of receivables` : undefined} onClick={() => setTab('receivables')} />
        <StatTile label="Waiting clearance" icon={ShieldCheck} tone={waitingFinance ? 'warning' : 'neutral'} value={waitingFinance} hint="Quality-cleared orders" onClick={() => setTab('queue')} />
        <StatTile label="Follow-ups due" icon={PhoneCall} tone={dueFollowUps.length ? 'warning' : 'neutral'} value={dueFollowUps.length} hint={overLimit.length ? `${overLimit.length} customers over limit` : 'Today or earlier'} onClick={() => setTab('followups')} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="receivables">Receivables</TabsTrigger>
          <TabsTrigger value="queue">
            Clearance queue
            {waitingFinance > 0 && <span className="rounded-full bg-warning-soft px-1.5 text-[11px] tabular-nums text-warning">{waitingFinance}</span>}
          </TabsTrigger>
          <TabsTrigger value="followups">Follow-ups</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="costing">Job margins</TabsTrigger>
          <TabsTrigger value="bills">Supplier POs</TabsTrigger>
          <TabsTrigger value="tally">Tally check</TabsTrigger>
        </TabsList>
        <TabsContent value="receivables" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
            {BUCKETS.map((b) => (
              <span key={b.key} className="inline-flex items-center gap-1.5">
                <span className={cn('size-2.5 rounded-sm', b.cls)} aria-hidden="true" /> {b.label}
              </span>
            ))}
          </div>
          <DataTable rows={outstandingAgeing} columns={ageingCols} rowKey={(a) => a.customerId} searchText={(a) => a.customerName} searchPlaceholder="Search customer" initialSort={{ id: 'total', desc: true }} emptyTitle="No receivables" />
        </TabsContent>
        <TabsContent value="queue" className="mt-4">
          <ClearanceQueue kind="finance" />
        </TabsContent>
        <TabsContent value="followups" className="mt-4">
          <DataTable rows={paymentFollowUps} columns={followCols} rowKey={(f) => f.id} searchText={(f) => `${f.customerName} ${f.invoiceNumber} ${f.contactedPerson}`} searchPlaceholder="Search customer, invoice or contact" initialSort={{ id: 'next' }} emptyTitle="No follow-ups logged" />
        </TabsContent>
        <TabsContent value="invoices" className="mt-4">
          <DataTable rows={invoiced} columns={invoiceCols} rowKey={(o) => o.id} searchText={(o) => `${o.invoiceStatus.invoiceNumber} ${o.customerName} ${o.jobNumber}`} searchPlaceholder="Search invoice, customer or job" initialSort={{ id: 'inv', desc: true }} emptyTitle="No invoices recorded" />
        </TabsContent>
        <TabsContent value="costing" className="mt-4">
          <DataTable rows={jobCostSheets} columns={costCols} rowKey={(c) => c.jobNumber} searchText={(c) => `${c.jobNumber} ${c.customerName} ${c.productName}`} searchPlaceholder="Search job or customer" initialSort={{ id: 'margin' }} emptyTitle="No job cost sheets" />
        </TabsContent>
        <TabsContent value="bills" className="mt-4">
          <DataTable rows={purchaseOrders} columns={billCols} rowKey={(p) => p.id} searchText={(p) => `${p.poNumber} ${p.supplierName} ${p.materialGrade}`} searchPlaceholder="Search PO, supplier or grade" initialSort={{ id: 'po', desc: true }} emptyTitle="No purchase orders" />
        </TabsContent>
        <TabsContent value="tally" className="mt-4">
          <TallyCheck orders={salesOrders} />
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(paying)} onOpenChange={(o) => !o && setPaying(null)}>
        {paying && (
          <DialogContent>
            <PaymentForm
              account={paying}
              onDone={(receipt) => {
                if (receipt) setReceipts((prev) => [receipt, ...prev]);
                setPaying(null);
              }}
            />
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={followUpFor !== null} onOpenChange={(o) => !o && setFollowUpFor(null)}>
        {followUpFor !== null && (
          <DialogContent className="sm:max-w-xl">
            <FollowUpForm accounts={outstandingAgeing} initial={followUpFor === 'new' ? undefined : followUpFor} onDone={() => setFollowUpFor(null)} />
          </DialogContent>
        )}
      </Dialog>

      <DocumentPreviewModal payload={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function FormActions({ saving, label, onCancel }: { saving: boolean; label: string; onCancel: () => void }) {
  return (
    <DialogFooter>
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" loading={saving}>
        {label}
      </Button>
    </DialogFooter>
  );
}

function PaymentForm({ account, onDone }: { account: OutstandingAgeingRecord; onDone: (receipt?: RecordedPaymentReceiptItem) => void }) {
  const { currentUser, recordCustomerPaymentRecord } = useRtdb();
  const [amount, setAmount] = useState('');
  const [utr, setUtr] = useState('');
  const [method, setMethod] = useState('RTGS / NEFT');
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const value = Number(amount);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(value > 0)) return setError('Enter the amount received.');
    if (value > account.totalOutstanding) return setError(`That is more than the ${formatINR(account.totalOutstanding)} outstanding.`);
    if (utr.trim().length < 4) return setError('Enter the UTR or cheque number.');
    setError('');
    setSaving(true);
    const res = await recordCustomerPaymentRecord(account, value, utr.trim());
    setSaving(false);
    if (!res.success || !res.data) return setError(res.error || 'The payment could not be saved.');
    toast.success('Payment recorded', { description: `${formatINR(value)} from ${account.customerName}. Oldest dues were cleared first.` });
    onDone({
      receiptNumber: newRecordId('RCPT'),
      paymentDate: date,
      customerId: account.customerId,
      customerName: account.customerName,
      utrReference: utr.trim(),
      paymentMethod: method,
      amountReceived: value,
      previousOutstanding: account.totalOutstanding,
      closingOutstanding: res.data.totalOutstanding,
      recordedBy: currentUser.name,
    });
  };

  return (
    <form className="space-y-4" noValidate onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Record payment</DialogTitle>
        <DialogDescription>
          {account.customerName} · {formatINR(account.totalOutstanding)} outstanding. The payment clears the oldest dues first.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (₹)" htmlFor="pay-amt">
          <Input id="pay-amt" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} />
        </Field>
        <Field label="Received on" htmlFor="pay-date">
          <Input id="pay-date" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Mode" htmlFor="pay-mode">
          <Select id="pay-mode" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option>RTGS / NEFT</option>
            <option>Cheque</option>
            <option>UPI</option>
            <option>Demand draft</option>
          </Select>
        </Field>
        <Field label="UTR / cheque no." htmlFor="pay-utr">
          <Input id="pay-utr" className="font-mono" maxLength={40} value={utr} onChange={(e) => setUtr(e.target.value.toUpperCase())} />
        </Field>
      </div>
      {value > 0 && value <= account.totalOutstanding && (
        <p className="text-xs text-muted-foreground">Balance after this payment: {formatINR(account.totalOutstanding - value)}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <FormActions saving={saving} label="Record payment" onCancel={() => onDone()} />
    </form>
  );
}

function FollowUpForm({ accounts, initial, onDone }: { accounts: OutstandingAgeingRecord[]; initial?: OutstandingAgeingRecord; onDone: () => void }) {
  const { currentUser, upsertPaymentFollowUpRecord } = useRtdb();
  const [customerId, setCustomerId] = useState(initial?.customerId || '');
  const [invoice, setInvoice] = useState('');
  const [contact, setContact] = useState('');
  const [mode, setMode] = useState(FOLLOW_UP_MODES[0]);
  const [outcome, setOutcome] = useState('');
  const [promisedAmt, setPromisedAmt] = useState('');
  const [promisedDate, setPromisedDate] = useState('');
  const [next, setNext] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const account = accounts.find((a) => a.customerId === customerId);
    if (!account) return setError('Choose the customer.');
    if (!invoice.trim()) return setError('Enter the invoice number you followed up on.');
    if (contact.trim().length < 2) return setError('Enter who you spoke to.');
    if (!outcome) return setError('Choose the outcome.');
    if (!next) return setError('Enter the next follow-up date.');
    setError('');
    setSaving(true);
    const id = newRecordId('PFU');
    const res = await upsertPaymentFollowUpRecord(
      {
        id,
        customerId: account.customerId,
        customerName: account.customerName,
        invoiceNumber: invoice.trim(),
        invoiceAmountInr: 0,
        outstandingAmountInr: 0,
        dueDate: promisedDate,
        overdueDays: 0,
        contactedPerson: contact.trim(),
        contactPerson: contact.trim(),
        followUpDate: todayIso(),
        nextFollowUpDate: next,
        promisedPaymentDate: promisedDate,
        promisedAmountInr: Number(promisedAmt || 0),
        followUpMode: mode,
        modeOfCommunication: mode,
        outcome,
        remarks: notes.trim(),
        loggedByUid: currentUser.id,
        loggedByName: currentUser.name,
        loggedByRole: currentUser.role,
        status: 'contacted',
      } as PaymentFollowUpRecord,
      true
    );
    setSaving(false);
    if (!res.success) return setError(res.error || 'The follow-up could not be saved.');
    toast.success('Follow-up logged', { description: `${account.customerName} · next on ${formatDate(next)}` });
    onDone();
  };

  return (
    <form className="space-y-4" noValidate onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Log collection follow-up</DialogTitle>
        <DialogDescription>Record the call or visit and when to follow up next.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer" htmlFor="fu-cust">
          <Select id="fu-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Choose</option>
            {accounts.map((a) => (
              <option key={a.customerId} value={a.customerId}>
                {a.customerName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Invoice number" htmlFor="fu-inv">
          <Input id="fu-inv" className="font-mono" maxLength={64} value={invoice} onChange={(e) => setInvoice(e.target.value)} />
        </Field>
        <Field label="Spoke to" htmlFor="fu-contact">
          <Input id="fu-contact" maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
        <Field label="How" htmlFor="fu-mode">
          <Select id="fu-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {FOLLOW_UP_MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Outcome" htmlFor="fu-out">
          <Select id="fu-out" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Choose</option>
            {FOLLOW_UP_OUTCOMES.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </Select>
        </Field>
        <Field label="Next follow-up" htmlFor="fu-next">
          <Input id="fu-next" type="date" min={todayIso()} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Promised amount (₹, optional)" htmlFor="fu-pamt">
          <Input id="fu-pamt" inputMode="numeric" value={promisedAmt} onChange={(e) => setPromisedAmt(e.target.value.replace(/[^0-9]/g, ''))} />
        </Field>
        <Field label="Promised by (optional)" htmlFor="fu-pdate">
          <Input id="fu-pdate" type="date" value={promisedDate} onChange={(e) => setPromisedDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="fu-notes">
        <Textarea id="fu-notes" rows={2} maxLength={600} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <FormActions saving={saving} label="Save follow-up" onCancel={onDone} />
    </form>
  );
}

type TallyRow = { invoice: string; customer: string; amount: number | null };
type TallyResult = { file: string; rows: TallyRow[]; matched: TallyRow[]; amountDiff: { row: TallyRow; mis: number }[]; missingInMis: TallyRow[]; missingInTally: OrderJourney[] };

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Read-only cross-check of a Tally sales register export against invoices recorded here.
 * Nothing is written: differences are listed for Finance to resolve at source.
 */
function TallyCheck({ orders }: { orders: OrderJourney[] }) {
  const [result, setResult] = useState<TallyResult | null>(null);
  const [error, setError] = useState('');

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result || '').split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) return setError('The file has no data rows.');
      const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
      const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
      const iInv = col('invoiceno', 'vouchernumber', 'voucherno', 'invoice');
      const iCust = col('customername', 'partyname', 'party', 'customer');
      const iAmt = col('totalinvoiceamount', 'invoiceamount', 'grandtotal', 'amount', 'total');
      if (iInv < 0) return setError('No invoice number column found. Expected a header like "InvoiceNo" or "Voucher No".');
      const rows: TallyRow[] = lines.slice(1).map((l) => {
        const c = parseCsvLine(l);
        const amt = iAmt >= 0 ? Number(String(c[iAmt] || '').replace(/[^0-9.-]/g, '')) : NaN;
        return { invoice: (c[iInv] || '').trim(), customer: iCust >= 0 ? c[iCust] || '' : '', amount: Number.isFinite(amt) ? amt : null };
      }).filter((r) => r.invoice);
      const misByInvoice = new Map(orders.filter((o) => o.invoiceStatus?.invoiceNumber && o.invoiceStatus.invoiceNumber !== '-').map((o) => [o.invoiceStatus.invoiceNumber.trim().toUpperCase(), o]));
      const seen = new Set<string>();
      const matched: TallyRow[] = [];
      const amountDiff: TallyResult['amountDiff'] = [];
      const missingInMis: TallyRow[] = [];
      for (const r of rows) {
        const key = r.invoice.toUpperCase();
        const o = misByInvoice.get(key);
        if (!o) {
          missingInMis.push(r);
          continue;
        }
        seen.add(key);
        const mis = o.invoiceStatus.invoiceAmount || 0;
        if (r.amount !== null && !o.commercialRestricted && Math.abs(r.amount - mis) > 1) amountDiff.push({ row: r, mis });
        else matched.push(r);
      }
      const missingInTally = Array.from(misByInvoice.entries()).filter(([k]) => !seen.has(k)).map(([, o]) => o);
      setError('');
      setResult({ file: file.name, rows, matched, amountDiff, missingInMis, missingInTally });
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">Compare a Tally sales register with MIS invoices</p>
          <p className="text-sm text-muted-foreground">Export the register from Tally as CSV. Nothing is changed here; differences are listed for you to fix at source.</p>
        </div>
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-within:ring-2 focus-within:ring-ring">
          <Upload className="size-4" aria-hidden="true" /> Choose CSV
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
      </div>
      {error && <Callout tone="danger" title="Could not read the file" why={error} />}
      {result && (
        <>
          <p className="text-sm text-muted-foreground">
            {result.file}: {formatNumber(result.rows.length)} invoices read.
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Matched" icon={Receipt} tone="success" value={result.matched.length} />
            <StatTile label="Amount differs" icon={AlertTriangle} tone={result.amountDiff.length ? 'danger' : 'neutral'} value={result.amountDiff.length} />
            <StatTile label="In Tally, not in MIS" icon={AlertTriangle} tone={result.missingInMis.length ? 'warning' : 'neutral'} value={result.missingInMis.length} />
            <StatTile label="In MIS, not in Tally" icon={AlertTriangle} tone={result.missingInTally.length ? 'warning' : 'neutral'} value={result.missingInTally.length} />
          </div>
          {result.amountDiff.length + result.missingInMis.length + result.missingInTally.length > 0 && (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
              {result.amountDiff.map(({ row, mis }) => (
                <li key={`d-${row.invoice}`} className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
                  <span className="font-mono">{row.invoice}</span>
                  <span className="text-destructive">
                    Tally {formatINR(row.amount || 0)} · MIS {formatINR(mis)}
                  </span>
                </li>
              ))}
              {result.missingInMis.map((r) => (
                <li key={`t-${r.invoice}`} className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
                  <span className="font-mono">{r.invoice}</span>
                  <span className="text-warning">In Tally only{r.customer ? ` · ${r.customer}` : ''}</span>
                </li>
              ))}
              {result.missingInTally.map((o) => (
                <li key={`m-${o.id}`} className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
                  <span className="font-mono">{o.invoiceStatus.invoiceNumber}</span>
                  <span className="text-warning">In MIS only · {o.customerName}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
