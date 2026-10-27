import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Award, CalendarClock, Download, FileText, MoreHorizontal, Plus, Repeat, Send, Trophy } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { QuotationRecord, TenderRecord } from '../../types/mis';
import type { MontexPdfDocumentPayload } from '../../services/documentExportService';
import { buildNewOrder } from '../../lib/orders';
import { takeQuoteFromLead, type QuoteFromLead } from '../../lib/handoff';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/overlays';
import { cn, formatDate, formatINR, formatNumber, newRecordId, todayIso } from '@/lib/utils';

const WRITERS = ['super_admin', 'ceo', 'sales'];
const STATUS: Record<QuotationRecord['status'], { tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info'; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  submitted: { tone: 'info', label: 'Sent' },
  follow_up: { tone: 'warning', label: 'Following up' },
  negotiation: { tone: 'warning', label: 'Negotiating' },
  won: { tone: 'success', label: 'Won' },
  lost: { tone: 'danger', label: 'Lost' },
};
const OPEN: QuotationRecord['status'][] = ['draft', 'submitted', 'follow_up', 'negotiation'];
const BID_STATUS: Record<string, string> = {
  under_preparation: 'Preparing',
  submitted: 'Submitted',
  qualified: 'Qualified',
  disqualified: 'Disqualified',
  awarded: 'Awarded',
};
const decimal = (v: string) => v.replace(/[^0-9.]/g, '');
const digits = (v: string) => v.replace(/[^0-9]/g, '');

export function QuotationsPage({ onSelectOrder }: { onSelectOrder?: (orderId: string) => void }) {
  const { currentUser, activeRbacGroup, quotations, tenders, customers, products } = useRtdb();
  const canWrite = currentUser.accountStatus === 'active' && WRITERS.includes(currentUser.role);
  const [tab, setTab] = useState('open');
  const [dialog, setDialog] = useState<{ kind: 'new'; fromLead?: QuoteFromLead } | { kind: 'tender' } | { kind: 'follow' | 'convert'; quote: QuotationRecord } | null>(null);
  // An enquiry with a fresh RFQ opens a quotation already pointed at its customer.
  useEffect(() => {
    const fromLead = takeQuoteFromLead();
    if (fromLead) setDialog({ kind: 'new', fromLead });
  }, []);
  const [preview, setPreview] = useState<MontexPdfDocumentPayload | null>(null);
  const today = todayIso();

  const open = useMemo(() => quotations.filter((q) => OPEN.includes(q.status)), [quotations]);
  const due = open.filter((q) => q.nextFollowUpDate && q.nextFollowUpDate <= today);
  const won = quotations.filter((q) => q.status === 'won');
  const decided = quotations.filter((q) => q.status === 'won' || q.status === 'lost');
  const winRate = decided.length ? (won.length / decided.length) * 100 : null;
  const rows = tab === 'open' ? open : tab === 'due' ? due : quotations;

  const pdf = async (build: (svc: typeof import('../../services/documentExportService')) => MontexPdfDocumentPayload) => {
    const svc = await import('../../services/documentExportService');
    const check = svc.verifyExportPermission(currentUser, activeRbacGroup, ['Admin', 'Management', 'Sales']);
    if (!check.allowed) return toast.error('Export not allowed', { description: check.error });
    setPreview(build(svc));
  };

  const exportExcel = async () => {
    const svc = await import('../../services/documentExportService');
    const res = svc.exportMontexExcelWorkbook(
      `Montex_Quotations_${today}.xlsx`,
      [
        {
          sheetName: 'Quotations',
          reportTitle: 'MONTEX MIS — QUOTATIONS',
          reportSubtitle: `${quotations.length} quotations`,
          headers: ['RFQ / ref', 'Date', 'Valid until', 'Customer', 'Product', 'Grade', 'Qty pcs', 'Wt/pc kg', 'Rate/kg', 'Rate/pc', 'Value', 'Margin %', 'Lead weeks', 'Repeat', 'Status', 'Next follow-up', 'Notes', 'Order'],
          rows: quotations.map((q) => [q.rfqReference, q.quoteDate, q.validUntil, q.customerName, q.productName, q.materialGrade, q.inquiryQtyPcs, q.unitWeightKg, q.quotedRatePerKg, q.quotedRatePerPc, q.totalQuotedValue, q.estimatedMarginPercent || '', q.deliveryLeadWeeks || '', q.isRepeatOrder ? 'Yes' : 'No', STATUS[q.status]?.label || q.status, q.nextFollowUpDate, q.followUpNotes, q.convertedOrderId || '']),
        },
        {
          sheetName: 'Tenders',
          reportTitle: 'MONTEX MIS — TENDERS',
          reportSubtitle: `${tenders.length} tenders`,
          headers: ['Tender no.', 'Authority', 'Project', 'Items', 'Est. value (lakh)', 'EMD', 'Bid due', 'Price bid opens', 'Status', 'Owner'],
          rows: tenders.map((t) => [t.tenderNumber, t.issuingAuthority, t.projectTitle, t.itemSummary, t.estimatedValueLakhs, t.emdAmount, t.bidSubmissionDate, t.priceBidOpeningDate, BID_STATUS[t.technicalBidStatus] || t.technicalBidStatus, t.assignedOwner]),
        },
      ],
      currentUser.email
    );
    if (res.success) toast.success('Download started', { description: res.filename });
    else toast.error('Export failed', { description: res.error });
  };

  const quoteCols: Column<QuotationRecord>[] = [
    {
      id: 'ref',
      header: 'Quotation',
      sortValue: (q) => q.quoteDate,
      cell: (q) => (
        <div className="max-w-56">
          <p className="truncate font-mono text-xs font-semibold">{q.rfqReference}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(q.quoteDate)}
            {q.isRepeatOrder && ' · repeat'}
          </p>
        </div>
      ),
    },
    {
      id: 'cust',
      header: 'Customer / product',
      sortValue: (q) => q.customerName,
      cell: (q) => (
        <div className="max-w-64">
          <p className="truncate">{q.customerName}</p>
          <p className="truncate text-xs text-muted-foreground">{[q.productName, q.materialGrade].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    {
      id: 'val',
      header: 'Value',
      align: 'right',
      sortValue: (q) => q.totalQuotedValue,
      cell: (q) => (
        <div className="whitespace-nowrap text-right">
          <p className="font-mono font-semibold">{formatINR(q.totalQuotedValue, { compact: true })}</p>
          <p className="text-xs text-muted-foreground">
            {formatNumber(q.inquiryQtyPcs)} pcs{q.quotedRatePerKg ? ` · ₹${formatNumber(q.quotedRatePerKg, 1)}/kg` : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'next',
      header: 'Next follow-up',
      hideBelow: 'md',
      sortValue: (q) => q.nextFollowUpDate || '9999',
      cell: (q) =>
        OPEN.includes(q.status) ? (
          <span className={cn('whitespace-nowrap', q.nextFollowUpDate && q.nextFollowUpDate <= today && 'font-semibold text-destructive')}>{formatDate(q.nextFollowUpDate)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'st',
      header: 'Status',
      cell: (q) => (
        <div>
          <Badge tone={STATUS[q.status]?.tone}>{STATUS[q.status]?.label || q.status}</Badge>
          {q.validUntil && OPEN.includes(q.status) && q.validUntil < today && <p className="mt-0.5 text-[11px] text-destructive">Validity over</p>}
        </div>
      ),
    },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: (q) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${q.rfqReference}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canWrite && OPEN.includes(q.status) && (
              <>
                <DropdownMenuItem onSelect={() => setDialog({ kind: 'follow', quote: q })}>
                  <CalendarClock /> Log follow-up
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog({ kind: 'convert', quote: q })}>
                  <Trophy /> Won — register PO
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {q.convertedOrderId && onSelectOrder && (
              <DropdownMenuItem onSelect={() => onSelectOrder(q.convertedOrderId!)}>
                <Send /> Open order
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => pdf((svc) => svc.buildQuotationPdfPayload(q, customers.find((c) => c.id === q.customerId), products.find((p) => p.id === q.productId), currentUser, activeRbacGroup))}>
              <FileText /> Quotation document
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const tenderCols: Column<TenderRecord>[] = [
    {
      id: 'no',
      header: 'Tender',
      sortValue: (t) => t.bidSubmissionDate,
      cell: (t) => (
        <div className="max-w-64">
          <p className="truncate font-mono text-xs font-semibold">{t.tenderNumber}</p>
          <p className="truncate text-xs text-muted-foreground">{t.issuingAuthority}</p>
        </div>
      ),
    },
    { id: 'what', header: 'Scope', hideBelow: 'md', cell: (t) => <div className="max-w-72"><p className="truncate">{t.projectTitle}</p><p className="truncate text-xs text-muted-foreground">{t.itemSummary}</p></div> },
    { id: 'val', header: 'Est. value', align: 'right', sortValue: (t) => t.estimatedValueLakhs, cell: (t) => <span className="whitespace-nowrap font-mono">{formatINR(t.estimatedValueLakhs * 100000, { compact: true })}</span> },
    {
      id: 'due',
      header: 'Bid due',
      sortValue: (t) => t.bidSubmissionDate,
      cell: (t) => <span className={cn('whitespace-nowrap', t.technicalBidStatus === 'under_preparation' && t.bidSubmissionDate < today && 'font-semibold text-destructive')}>{formatDate(t.bidSubmissionDate)}</span>,
    },
    { id: 'st', header: 'Status', hideBelow: 'sm', cell: (t) => <Badge tone={t.technicalBidStatus === 'awarded' ? 'success' : t.technicalBidStatus === 'disqualified' ? 'danger' : 'neutral'}>{BID_STATUS[t.technicalBidStatus] || t.technicalBidStatus}</Badge> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Quotations & Tenders"
        description="Offers sent to customers, who to call back and when, won offers turned into orders, and PSU/EPC tenders."
        actions={
          <>
            <Button variant="secondary" onClick={exportExcel}>
              <Download /> Export
            </Button>
            {canWrite && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    <Plus /> New
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setDialog({ kind: 'new' })}>
                    <FileText /> Quotation
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog({ kind: 'tender' })}>
                    <Award /> Tender
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Open pipeline" icon={FileText} tone="bronze" value={formatINR(open.reduce((s, q) => s + q.totalQuotedValue, 0), { compact: true })} hint={`${open.length} quotations`} onClick={() => setTab('open')} />
        <StatTile label="Follow-ups due" icon={CalendarClock} tone={due.length ? 'warning' : 'neutral'} value={due.length} hint="Today or earlier" onClick={() => setTab('due')} />
        <StatTile label="Win rate" icon={Trophy} value={winRate === null ? '—' : formatNumber(winRate, 0)} unit={winRate === null ? undefined : '%'} hint={`${won.length} won of ${decided.length} decided`} onClick={() => setTab('all')} />
        <StatTile label="Repeat enquiries" icon={Repeat} value={open.filter((q) => q.isRepeatOrder).length} hint="Open, dies already proven" onClick={() => setTab('open')} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="due">
            Follow-ups due
            {due.length > 0 && <span className="rounded-full bg-warning-soft px-1.5 text-[11px] tabular-nums text-warning">{due.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="tenders">Tenders</TabsTrigger>
        </TabsList>
        {['open', 'due', 'all'].map((t) => (
          <TabsContent key={t} value={t} className="mt-4">
            <DataTable
              rows={rows}
              columns={quoteCols}
              rowKey={(q) => q.id}
              searchText={(q) => `${q.rfqReference} ${q.customerName} ${q.productName} ${q.materialGrade}`}
              searchPlaceholder="Search reference, customer, product or grade"
              initialSort={t === 'due' ? { id: 'next' } : { id: 'ref', desc: true }}
              emptyTitle={t === 'due' ? 'No follow-ups due' : 'No quotations'}
            />
          </TabsContent>
        ))}
        <TabsContent value="tenders" className="mt-4">
          <DataTable rows={tenders} columns={tenderCols} rowKey={(t) => t.id} searchText={(t) => `${t.tenderNumber} ${t.issuingAuthority} ${t.projectTitle} ${t.itemSummary}`} searchPlaceholder="Search tender, authority or scope" initialSort={{ id: 'due' }} emptyTitle="No tenders" />
        </TabsContent>
      </Tabs>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog && (
          <DialogContent className="sm:max-w-xl">
            {dialog.kind === 'new' && <QuoteForm fromLead={dialog.fromLead} onDone={() => setDialog(null)} />}
            {dialog.kind === 'tender' && <TenderForm onDone={() => setDialog(null)} />}
            {dialog.kind === 'follow' && <FollowForm quote={dialog.quote} onDone={() => setDialog(null)} />}
            {dialog.kind === 'convert' && <ConvertForm quote={dialog.quote} onDone={() => setDialog(null)} />}
          </DialogContent>
        )}
      </Dialog>
      <DocumentPreviewModal payload={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function Shell({ title, description, error, saving, submit, onCancel, onSubmit, children }: {
  title: string;
  description: string;
  error: string;
  saving: boolean;
  submit: string;
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
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {submit}
        </Button>
      </DialogFooter>
    </form>
  );
}

function QuoteForm({ fromLead, onDone }: { fromLead?: QuoteFromLead; onDone: () => void }) {
  const { customers, products, quotations, leads, createQuotationRecord, upsertLeadRecord } = useRtdb();
  const [ref, setRef] = useState('');
  const [customerId, setCustomerId] = useState(fromLead?.customerId || '');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [weight, setWeight] = useState('');
  const [rateKg, setRateKg] = useState('');
  const [margin, setMargin] = useState('');
  const [lead, setLead] = useState('');
  const [valid, setValid] = useState('');
  const [next, setNext] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const customer = customers.find((c) => c.id === customerId);
  const product = products.find((p) => p.id === productId);
  const pcs = Number(qty);
  const wt = Number(weight);
  const rk = Number(rateKg);
  const ratePc = Math.round(wt * rk);
  const repeat = Boolean(customer && product && quotations.some((q) => q.customerId === customer.id && q.productId === product.id && q.status === 'won'));

  const submit = async () => {
    if (!ref.trim()) return setError('Enter the customer’s RFQ / enquiry reference.');
    if (!customer) return setError('Choose the customer.');
    if (!product) return setError('Choose the product.');
    if (!(pcs > 0)) return setError('Enter the quantity in pieces.');
    if (!(wt > 0)) return setError('Enter the forged weight per piece in kg.');
    if (!(rk > 0)) return setError('Enter the quoted rate per kg.');
    if (!valid) return setError('Enter how long the offer is valid.');
    if (!next) return setError('Enter when to follow up.');
    setError('');
    setSaving(true);
    const quoteId = newRecordId('QTN');
    const res = await createQuotationRecord({
      id: quoteId,
      rfqReference: ref.trim(),
      quoteDate: todayIso(),
      validUntil: valid,
      customerId: customer.id,
      customerName: customer.name,
      contactPerson: customer.contactPerson || '',
      productId: product.id,
      productName: product.name,
      materialGrade: product.materialGrade,
      standard: product.standard || '',
      unitWeightKg: wt,
      inquiryQtyPcs: pcs,
      quotedRatePerKg: rk,
      quotedRatePerPc: ratePc,
      totalQuotedValue: ratePc * pcs,
      estimatedMarginPercent: Number(margin) || 0,
      deliveryLeadWeeks: Number(lead) || 0,
      isRepeatOrder: repeat,
      status: 'submitted',
      nextFollowUpDate: next,
      followUpNotes: notes.trim(),
    });
    setSaving(false);
    if (!res.success) return setError(res.error || 'The quotation could not be saved.');
    const enquiry = fromLead && leads.find((l) => l.id === fromLead.leadId);
    if (enquiry) {
      const link = await upsertLeadRecord({ ...enquiry, stage: 'quoted', quotationId: quoteId, nextFollowUpDate: next }, false);
      if (!link.success) toast.warning('Quotation saved, enquiry not updated', { description: link.error });
    }
    toast.success('Quotation saved', { description: `${customer.name} · ${formatINR(ratePc * pcs, { compact: true })}` });
    onDone();
  };

  return (
    <Shell
      title="New quotation"
      description={fromLead ? `From enquiry: ${fromLead.productHint}. Price = weight per piece × rate per kg.` : 'Price is worked out from weight per piece × rate per kg.'}
      error={error}
      saving={saving}
      submit="Save quotation"
      onCancel={onDone}
      onSubmit={submit}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer" htmlFor="q-cust">
          <Select id="q-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Choose</option>
            {customers.filter((c) => c.active !== false).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="RFQ / enquiry ref." htmlFor="q-ref">
          <Input id="q-ref" className="font-mono" maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
        <Field label="Product" htmlFor="q-prod" className="sm:col-span-2" hint={repeat ? 'Repeat: this customer has ordered this product before.' : undefined}>
          <Select
            id="q-prod"
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              const p = products.find((x) => x.id === e.target.value);
              if (p?.standardWeightKg && !weight) setWeight(String(p.standardWeightKg));
            }}
          >
            <option value="">Choose</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.materialGrade}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity (pcs)" htmlFor="q-qty">
          <Input id="q-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(digits(e.target.value))} />
        </Field>
        <Field label="Weight per piece (kg)" htmlFor="q-wt" hint={product?.standardWeightKg ? `Master: ${product.standardWeightKg} kg` : undefined}>
          <Input id="q-wt" inputMode="decimal" value={weight} onChange={(e) => setWeight(decimal(e.target.value))} />
        </Field>
        <Field label="Rate (₹ per kg)" htmlFor="q-rk">
          <Input id="q-rk" inputMode="decimal" value={rateKg} onChange={(e) => setRateKg(decimal(e.target.value))} />
        </Field>
        <Field label="Expected margin % (optional)" htmlFor="q-mgn">
          <Input id="q-mgn" inputMode="decimal" value={margin} onChange={(e) => setMargin(decimal(e.target.value))} />
        </Field>
        <Field label="Delivery (weeks, optional)" htmlFor="q-lead">
          <Input id="q-lead" inputMode="numeric" value={lead} onChange={(e) => setLead(digits(e.target.value))} />
        </Field>
        <Field label="Valid until" htmlFor="q-valid">
          <Input id="q-valid" type="date" min={todayIso()} value={valid} onChange={(e) => setValid(e.target.value)} />
        </Field>
        <Field label="Follow up on" htmlFor="q-next">
          <Input id="q-next" type="date" min={todayIso()} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>
      {pcs > 0 && wt > 0 && rk > 0 && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          ₹{formatNumber(ratePc)} per piece × {formatNumber(pcs)} = <span className="font-semibold">{formatINR(ratePc * pcs)}</span>
        </p>
      )}
      <Field label="Notes" htmlFor="q-notes">
        <Textarea id="q-notes" rows={2} maxLength={600} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Shell>
  );
}

function FollowForm({ quote, onDone }: { quote: QuotationRecord; onDone: () => void }) {
  const { updateQuotationRecord } = useRtdb();
  const [status, setStatus] = useState<QuotationRecord['status']>(quote.status === 'submitted' ? 'follow_up' : quote.status);
  const [next, setNext] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (status !== 'lost' && !next) return setError('Enter the next follow-up date.');
    if (note.trim().length < 3) return setError('Write what the customer said.');
    setError('');
    setSaving(true);
    const stamp = `${formatDate(todayIso())}: ${note.trim()}`;
    const res = await updateQuotationRecord({
      ...quote,
      status,
      nextFollowUpDate: status === 'lost' ? quote.nextFollowUpDate : next,
      followUpNotes: (quote.followUpNotes ? `${stamp}\n${quote.followUpNotes}` : stamp).slice(0, 600),
    });
    setSaving(false);
    if (!res.success) return setError(res.error || 'Not saved.');
    toast.success('Follow-up saved', { description: quote.customerName });
    onDone();
  };

  return (
    <Shell title="Log follow-up" description={`${quote.rfqReference} · ${quote.customerName}`} error={error} saving={saving} submit="Save" onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status" htmlFor="f-st">
          <Select id="f-st" value={status} onChange={(e) => setStatus(e.target.value as QuotationRecord['status'])}>
            <option value="follow_up">Following up</option>
            <option value="negotiation">Negotiating</option>
            <option value="lost">Lost</option>
          </Select>
        </Field>
        {status !== 'lost' && (
          <Field label="Next follow-up" htmlFor="f-next">
            <Input id="f-next" type="date" min={todayIso()} value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label={status === 'lost' ? 'Why it was lost' : 'What the customer said'} htmlFor="f-note">
        <Textarea id="f-note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {quote.followUpNotes && <p className="max-h-24 overflow-y-auto whitespace-pre-line rounded-lg bg-muted p-3 text-xs text-muted-foreground">{quote.followUpNotes}</p>}
    </Shell>
  );
}

function ConvertForm({ quote, onDone }: { quote: QuotationRecord; onDone: () => void }) {
  const { customers, products, salesOrders, convertQuotationToOrderRecord } = useRtdb();
  const [po, setPo] = useState('');
  const [poDate, setPoDate] = useState(todayIso());
  const [qty, setQty] = useState(String(quote.inquiryQtyPcs || ''));
  const [rate, setRate] = useState(String(quote.quotedRatePerPc || ''));
  const [delivery, setDelivery] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const customer = customers.find((c) => c.id === quote.customerId);
  const product = products.find((p) => p.id === quote.productId);

  const submit = async () => {
    if (!customer || !product) return setError('The customer or product on this quotation is no longer in master data.');
    if (!po.trim()) return setError('Enter the customer’s PO number.');
    if (salesOrders.some((o) => o.poNumber.trim().toLowerCase() === po.trim().toLowerCase())) return setError('An order with this PO number already exists.');
    if (!(Number(qty) > 0)) return setError('Enter the ordered quantity.');
    if (!(Number(rate) >= 0) || rate === '') return setError('Enter the agreed rate per piece.');
    if (!delivery || delivery < poDate) return setError('Enter a delivery date on or after the PO date.');
    setError('');
    setSaving(true);
    const order = buildNewOrder({
      orders: salesOrders,
      customer,
      product,
      poNumber: po,
      poDate,
      deliveryDate: delivery,
      qty: Number(qty),
      rate: Number(rate),
      statusLabel: `From quotation ${quote.rfqReference} — awaiting material allocation`,
    });
    const res = await convertQuotationToOrderRecord({ ...quote, status: 'won', convertedOrderId: order.id }, order);
    setSaving(false);
    if (!res.success) return setError(res.error || 'The order could not be created.');
    toast.success('Order registered', { description: `${order.jobNumber} · ${customer.name}` });
    onDone();
  };

  return (
    <Shell title="Quotation won — register the PO" description="Enter the customer PO exactly as received. Quantity and rate start from the quotation; change them if the PO differs." error={error} saving={saving} submit="Register order" onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer PO number" htmlFor="c-po">
          <Input id="c-po" className="font-mono" maxLength={80} value={po} onChange={(e) => setPo(e.target.value)} />
        </Field>
        <Field label="PO date" htmlFor="c-date">
          <Input id="c-date" type="date" max={todayIso()} value={poDate} onChange={(e) => setPoDate(e.target.value)} />
        </Field>
        <Field label="Quantity (pcs)" htmlFor="c-qty">
          <Input id="c-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(digits(e.target.value))} />
        </Field>
        <Field label="Rate per piece (₹)" htmlFor="c-rate">
          <Input id="c-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(decimal(e.target.value))} />
        </Field>
        <Field label="Committed delivery" htmlFor="c-del" className="sm:col-span-2">
          <Input id="c-del" type="date" min={poDate} value={delivery} onChange={(e) => setDelivery(e.target.value)} />
        </Field>
      </div>
      {Number(qty) > 0 && rate !== '' && <p className="text-sm text-muted-foreground">Order value {formatINR(Number(qty) * Number(rate))}</p>}
    </Shell>
  );
}

function TenderForm({ onDone }: { onDone: () => void }) {
  const { currentUser, createTenderRecord } = useRtdb();
  const [f, setF] = useState({ no: '', authority: '', title: '', items: '', value: '', emd: '', bid: '', open: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, clean?: (v: string) => string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: clean ? clean(e.target.value) : e.target.value }));

  const submit = async () => {
    if (!f.no.trim() || !f.authority.trim()) return setError('Enter the tender number and issuing authority.');
    if (!f.title.trim() || !f.items.trim()) return setError('Enter the project and the items in scope.');
    if (!f.bid) return setError('Enter the bid submission date.');
    setError('');
    setSaving(true);
    const res = await createTenderRecord({
      id: newRecordId('TND'),
      tenderNumber: f.no.trim(),
      issuingAuthority: f.authority.trim(),
      projectTitle: f.title.trim(),
      itemSummary: f.items.trim(),
      estimatedValueLakhs: Number(f.value) || 0,
      emdAmount: Number(f.emd) || 0,
      bidSubmissionDate: f.bid,
      priceBidOpeningDate: f.open,
      technicalBidStatus: 'under_preparation',
      assignedOwner: currentUser.name,
    });
    setSaving(false);
    if (!res.success) return setError(res.error || 'The tender could not be saved.');
    toast.success('Tender registered', { description: f.no.trim() });
    onDone();
  };

  return (
    <Shell title="Register tender" description="Track a PSU / EPC tender until it is awarded." error={error} saving={saving} submit="Save tender" onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tender number" htmlFor="t-no">
          <Input id="t-no" className="font-mono" maxLength={80} value={f.no} onChange={set('no')} />
        </Field>
        <Field label="Issuing authority" htmlFor="t-auth">
          <Input id="t-auth" maxLength={120} value={f.authority} onChange={set('authority')} />
        </Field>
        <Field label="Project" htmlFor="t-title" className="sm:col-span-2">
          <Input id="t-title" maxLength={160} value={f.title} onChange={set('title')} />
        </Field>
        <Field label="Items in scope" htmlFor="t-items" className="sm:col-span-2">
          <Input id="t-items" maxLength={200} value={f.items} onChange={set('items')} />
        </Field>
        <Field label="Estimated value (₹ lakh)" htmlFor="t-val">
          <Input id="t-val" inputMode="decimal" value={f.value} onChange={set('value', decimal)} />
        </Field>
        <Field label="EMD (₹)" htmlFor="t-emd">
          <Input id="t-emd" inputMode="numeric" value={f.emd} onChange={set('emd', digits)} />
        </Field>
        <Field label="Bid due" htmlFor="t-bid">
          <Input id="t-bid" type="date" value={f.bid} onChange={set('bid')} />
        </Field>
        <Field label="Price bid opens (optional)" htmlFor="t-open">
          <Input id="t-open" type="date" value={f.open} onChange={set('open')} />
        </Field>
      </div>
    </Shell>
  );
}
