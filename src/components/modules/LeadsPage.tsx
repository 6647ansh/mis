import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, FileText, MoreHorizontal, PhoneCall, Plus, Target, ThumbsDown, Trophy, UserPlus } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { Customer, LeadRecord, LeadStage } from '../../types/mis';
import { handOffQuoteFromLead } from '../../lib/handoff';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  Tooltip,
} from '@/components/ui/overlays';
import { cn, formatDate, formatINR, formatNumber, newRecordId, todayIso } from '@/lib/utils';

const WRITERS = ['super_admin', 'ceo', 'sales'];
const SOURCES = ['Phone call', 'Email', 'Website', 'Exhibition / expo', 'Reference', 'Existing customer', 'Walk-in', 'Other'];
/** Pipeline order; won and lost are outcomes, not steps. */
const PIPELINE: LeadStage[] = ['new', 'contacted', 'qualified', 'rfq_received', 'quoted'];
const STAGE: Record<LeadStage, { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger' }> = {
  new: { label: 'New', tone: 'neutral' },
  contacted: { label: 'Contacted', tone: 'info' },
  qualified: { label: 'Qualified', tone: 'info' },
  rfq_received: { label: 'RFQ received', tone: 'warning' },
  quoted: { label: 'Quoted', tone: 'warning' },
  won: { label: 'Won', tone: 'success' },
  lost: { label: 'Lost', tone: 'danger' },
};
const isOpen = (l: LeadRecord) => l.stage !== 'won' && l.stage !== 'lost';
const stamp = (note: string, prev?: string) => {
  const line = `${formatDate(todayIso())}: ${note.trim()}`;
  return (prev ? `${line}\n${prev}` : line).slice(0, 4000);
};

type Dlg = { kind: 'new' } | { kind: 'follow'; lead: LeadRecord } | { kind: 'lost'; lead: LeadRecord } | { kind: 'rfq'; lead: LeadRecord };

export function LeadsPage({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { currentUser, leads, quotations, upsertLeadRecord } = useRtdb();
  const canWrite = currentUser.accountStatus === 'active' && WRITERS.includes(currentUser.role);
  const [tab, setTab] = useState('open');
  const [dialog, setDialog] = useState<Dlg | null>(null);
  const today = todayIso();

  // A lead whose quotation was won counts as won, even if nobody updated the lead.
  const quoteStatus = useMemo(() => new Map(quotations.map((q) => [q.id, q.status])), [quotations]);
  const effective = useMemo(
    () => leads.map((l) => (l.quotationId && quoteStatus.get(l.quotationId) === 'won' && l.stage !== 'won' ? { ...l, stage: 'won' as LeadStage } : l)),
    [leads, quoteStatus]
  );
  const open = effective.filter(isOpen);
  const due = open.filter((l) => l.nextFollowUpDate && l.nextFollowUpDate <= today);
  const won = effective.filter((l) => l.stage === 'won');
  const lost = effective.filter((l) => l.stage === 'lost');
  const winRate = won.length + lost.length ? (won.length / (won.length + lost.length)) * 100 : null;
  const rows = tab === 'open' ? open : tab === 'due' ? due : tab === 'won' ? won : tab === 'lost' ? lost : effective;

  const bySource = useMemo(() => {
    const m = new Map<string, { total: number; quoted: number; won: number }>();
    for (const l of effective) {
      const r = m.get(l.source) || { total: 0, quoted: 0, won: 0 };
      r.total += 1;
      if (['quoted', 'won'].includes(l.stage) || l.quotationId) r.quoted += 1;
      if (l.stage === 'won') r.won += 1;
      m.set(l.source, r);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [effective]);

  const stageCounts = PIPELINE.map((s) => ({ s, n: effective.filter((l) => l.stage === s).length }));
  const maxStage = Math.max(1, ...stageCounts.map((x) => x.n));

  const advance = async (l: LeadRecord, stage: LeadStage) => {
    const res = await upsertLeadRecord({ ...l, stage, lastContactDate: today }, false);
    if (res.success) toast.success(`${l.companyName}: ${STAGE[stage].label.toLowerCase()}`);
    else toast.error('Not saved', { description: res.error });
  };

  const cols: Column<LeadRecord>[] = [
    {
      id: 'who',
      header: 'Company',
      sortValue: (l) => l.companyName,
      cell: (l) => (
        <div className="max-w-64">
          <p className="truncate font-medium">{l.companyName}</p>
          <p className="truncate text-xs text-muted-foreground">{[l.contactPerson, l.city].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    {
      id: 'need',
      header: 'Asking for',
      hideBelow: 'md',
      cell: (l) => (
        <div className="max-w-72">
          <p className="line-clamp-1">{l.productInterest}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[l.materialGrade, l.estimatedValueInr ? `~${formatINR(l.estimatedValueInr, { compact: true })}` : ''].filter(Boolean).join(' · ') || l.source}
          </p>
        </div>
      ),
    },
    {
      id: 'next',
      header: 'Next follow-up',
      sortValue: (l) => (isOpen(l) ? l.nextFollowUpDate || '9999' : '9999'),
      cell: (l) =>
        isOpen(l) ? (
          <span className={cn('whitespace-nowrap', l.nextFollowUpDate && l.nextFollowUpDate <= today && 'font-semibold text-destructive')}>{l.nextFollowUpDate ? formatDate(l.nextFollowUpDate) : 'Not set'}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { id: 'owner', header: 'Owner', hideBelow: 'lg', cell: (l) => <span className="whitespace-nowrap">{l.ownerName}</span> },
    { id: 'stage', header: 'Stage', sortValue: (l) => [...PIPELINE, 'won', 'lost'].indexOf(l.stage), cell: (l) => <Badge tone={STAGE[l.stage].tone}>{STAGE[l.stage].label}</Badge> },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: (l) =>
        canWrite && isOpen(l) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${l.companyName}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDialog({ kind: 'follow', lead: l })}>
                <PhoneCall /> Log follow-up
              </DropdownMenuItem>
              {l.stage === 'new' && <DropdownMenuItem onSelect={() => advance(l, 'contacted')}>Mark contacted</DropdownMenuItem>}
              {['new', 'contacted'].includes(l.stage) && <DropdownMenuItem onSelect={() => advance(l, 'qualified')}>Mark qualified (we can make it)</DropdownMenuItem>}
              {!l.quotationId && (
                <DropdownMenuItem onSelect={() => setDialog({ kind: 'rfq', lead: l })}>
                  <FileText /> RFQ received — make quotation
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onSelect={() => setDialog({ kind: 'lost', lead: l })}>
                <ThumbsDown /> Mark lost
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Enquiries"
        description="New customer enquiries before they become quotations: who asked, what for, where they came from and when to call back."
        actions={
          canWrite && (
            <Button onClick={() => setDialog({ kind: 'new' })}>
              <Plus /> New enquiry
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Open enquiries" icon={Target} value={open.length} hint={`${effective.length} in total`} onClick={() => setTab('open')} />
        <StatTile label="Follow-ups due" icon={CalendarClock} tone={due.length ? 'warning' : 'neutral'} value={due.length} hint="Today or earlier" onClick={() => setTab('due')} />
        <StatTile label="Won" icon={Trophy} tone={won.length ? 'success' : 'neutral'} value={won.length} hint="Became an order" onClick={() => setTab('won')} />
        <StatTile label="Win rate" icon={Trophy} value={winRate === null ? '—' : formatNumber(winRate, 0)} unit={winRate === null ? undefined : '%'} hint={`${won.length} won of ${won.length + lost.length} closed`} onClick={() => setTab('all')} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Pipeline</CardTitle>
              <CardDescription>Open enquiries at each step</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {stageCounts.map(({ s, n }) => (
                <li key={s} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{STAGE[s].label}</span>
                  <Tooltip content={`${STAGE[s].label}: ${n}`}>
                    <span className="h-4 rounded-r bg-muted/60">
                      <span className="block h-full rounded-r bg-bronze-500" style={{ width: `${(n / maxStage) * 100}%`, minWidth: n ? 4 : 0 }} />
                    </span>
                  </Tooltip>
                  <span className="text-right font-mono text-xs font-semibold tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Where enquiries come from</CardTitle>
              <CardDescription>Which sources turn into quotations and orders</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {bySource.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add enquiries to see which sources work best.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="py-2">Source</th>
                    <th className="py-2 text-right">Enquiries</th>
                    <th className="py-2 text-right">Quoted</th>
                    <th className="py-2 text-right">Won</th>
                  </tr>
                </thead>
                <tbody>
                  {bySource.map(([src, r]) => (
                    <tr key={src} className="border-b border-border last:border-0">
                      <td className="py-2">{src}</td>
                      <td className="py-2 text-right font-mono">{r.total}</td>
                      <td className="py-2 text-right font-mono">{r.quoted}</td>
                      <td className="py-2 text-right font-mono">{r.won}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="due">
            Follow-ups due
            {due.length > 0 && <span className="rounded-full bg-warning-soft px-1.5 text-[11px] tabular-nums text-warning">{due.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="won">Won</TabsTrigger>
          <TabsTrigger value="lost">Lost</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
        {['open', 'due', 'won', 'lost', 'all'].map((t) => (
          <TabsContent key={t} value={t} className="mt-4">
            <DataTable
              rows={rows}
              columns={cols}
              rowKey={(l) => l.id}
              searchText={(l) => `${l.companyName} ${l.contactPerson} ${l.city || ''} ${l.productInterest} ${l.source} ${l.ownerName}`}
              searchPlaceholder="Search company, contact, product or source"
              initialSort={t === 'open' || t === 'due' ? { id: 'next' } : { id: 'who' }}
              emptyTitle={t === 'due' ? 'No follow-ups due' : 'No enquiries here'}
              emptyDescription={t === 'open' && canWrite ? 'Add the next call, email or expo contact with “New enquiry”.' : undefined}
            />
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog && (
          <DialogContent className="sm:max-w-xl">
            {dialog.kind === 'new' && <LeadForm onDone={() => setDialog(null)} />}
            {dialog.kind === 'follow' && <FollowForm lead={dialog.lead} onDone={() => setDialog(null)} />}
            {dialog.kind === 'lost' && <LostForm lead={dialog.lead} onDone={() => setDialog(null)} />}
            {dialog.kind === 'rfq' && (
              <RfqForm
                lead={dialog.lead}
                onDone={(customerId) => {
                  setDialog(null);
                  if (customerId && onNavigate) {
                    handOffQuoteFromLead({ leadId: dialog.lead.id, customerId, productHint: dialog.lead.productInterest });
                    onNavigate('quotations');
                  }
                }}
              />
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function Shell({ title, description, error, saving, submit, danger, onCancel, onSubmit, children }: {
  title: string;
  description: string;
  error: string;
  saving: boolean;
  submit: string;
  danger?: boolean;
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
        <Button type="submit" variant={danger ? 'destructive' : 'primary'} loading={saving}>
          {submit}
        </Button>
      </DialogFooter>
    </form>
  );
}

function LeadForm({ onDone }: { onDone: () => void }) {
  const { currentUser, usersList, customers, leads, upsertLeadRecord } = useRtdb();
  const sellers = usersList.filter((u) => u.accountStatus === 'active' && ['sales', 'ceo', 'super_admin'].includes(u.role));
  const [f, setF] = useState({ company: '', contact: '', phone: '', email: '', city: '', industry: '', source: '', product: '', grade: '', value: '', owner: currentUser.id, next: '', note: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const name = f.company.trim().toLowerCase();
  const existingCustomer = name.length >= 3 ? customers.find((c) => c.name.toLowerCase().includes(name) || name.includes(c.name.toLowerCase())) : undefined;
  const openDuplicate = name.length >= 3 ? leads.find((l) => isOpen(l) && l.companyName.trim().toLowerCase() === name) : undefined;

  const submit = async () => {
    if (f.company.trim().length < 2) return setError('Enter the company name.');
    if (f.contact.trim().length < 2) return setError('Enter who you spoke to.');
    if (!f.phone.trim() && !f.email.trim()) return setError('Enter a phone number or email so someone can call back.');
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setError('The email address is not valid.');
    if (!f.source) return setError('Choose where the enquiry came from.');
    if (f.product.trim().length < 2) return setError('Enter what they are asking for.');
    if (!f.next) return setError('Set the next follow-up date.');
    const owner = sellers.find((u) => u.id === f.owner) || currentUser;
    setError('');
    setSaving(true);
    const now = new Date().toISOString();
    const res = await upsertLeadRecord(
      {
        id: newRecordId('LEAD'),
        companyName: f.company.trim(),
        contactPerson: f.contact.trim(),
        phone: f.phone.trim(),
        email: f.email.trim().toLowerCase(),
        city: f.city.trim(),
        industry: f.industry.trim(),
        source: f.source,
        productInterest: f.product.trim(),
        materialGrade: f.grade.trim(),
        estimatedValueInr: Number(f.value) || undefined,
        stage: 'new',
        ownerUid: owner.id,
        ownerName: owner.displayName || owner.name,
        nextFollowUpDate: f.next,
        lastContactDate: todayIso(),
        notes: f.note.trim() ? stamp(f.note) : undefined,
        customerId: existingCustomer?.id,
        createdByUid: currentUser.id,
        createdAt: now,
      },
      true
    );
    setSaving(false);
    if (!res.success) return setError(res.error || 'Not saved.');
    toast.success('Enquiry added', { description: `${f.company.trim()} · follow up ${formatDate(f.next)}` });
    onDone();
  };

  return (
    <Shell title="New enquiry" description="Capture it now; details can be added on the next call." error={error} saving={saving} submit="Save enquiry" onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company" htmlFor="ld-co" className="sm:col-span-2" hint={openDuplicate ? `An open enquiry from ${openDuplicate.companyName} already exists (owner ${openDuplicate.ownerName}).` : existingCustomer ? `Already a customer: ${existingCustomer.name}` : undefined}>
          <Input id="ld-co" maxLength={160} value={f.company} onChange={set('company')} />
        </Field>
        <Field label="Contact person" htmlFor="ld-contact">
          <Input id="ld-contact" maxLength={120} value={f.contact} onChange={set('contact')} />
        </Field>
        <Field label="City" htmlFor="ld-city">
          <Input id="ld-city" maxLength={120} value={f.city} onChange={set('city')} />
        </Field>
        <Field label="Phone" htmlFor="ld-phone">
          <Input id="ld-phone" inputMode="tel" maxLength={40} value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Email" htmlFor="ld-email">
          <Input id="ld-email" type="email" maxLength={160} value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Came from" htmlFor="ld-src">
          <Select id="ld-src" value={f.source} onChange={set('source')}>
            <option value="">Choose</option>
            {SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Industry (optional)" htmlFor="ld-ind">
          <Input id="ld-ind" maxLength={120} value={f.industry} onChange={set('industry')} />
        </Field>
        <Field label="Asking for" htmlFor="ld-prod" className="sm:col-span-2" hint="Product, size, rating, quantity — as they said it">
          <Input id="ld-prod" maxLength={300} value={f.product} onChange={set('product')} />
        </Field>
        <Field label="Grade (optional)" htmlFor="ld-grade">
          <Input id="ld-grade" maxLength={64} value={f.grade} onChange={set('grade')} />
        </Field>
        <Field label="Rough value ₹ (optional)" htmlFor="ld-val">
          <Input id="ld-val" inputMode="numeric" value={f.value} onChange={(e) => setF((p) => ({ ...p, value: e.target.value.replace(/[^0-9]/g, '') }))} />
        </Field>
        <Field label="Owner" htmlFor="ld-owner">
          <Select id="ld-owner" value={f.owner} onChange={set('owner')}>
            {(sellers.some((u) => u.id === currentUser.id) ? sellers : [currentUser, ...sellers]).map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName || u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Next follow-up" htmlFor="ld-next">
          <Input id="ld-next" type="date" min={todayIso()} value={f.next} onChange={set('next')} />
        </Field>
      </div>
      <Field label="Note (optional)" htmlFor="ld-note">
        <Textarea id="ld-note" rows={2} maxLength={500} value={f.note} onChange={set('note')} />
      </Field>
    </Shell>
  );
}

function FollowForm({ lead, onDone }: { lead: LeadRecord; onDone: () => void }) {
  const { upsertLeadRecord } = useRtdb();
  const [stage, setStage] = useState<LeadStage>(lead.stage === 'new' ? 'contacted' : lead.stage);
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (note.trim().length < 3) return setError('Write what was discussed.');
    if (!next) return setError('Set the next follow-up date.');
    setError('');
    setSaving(true);
    const res = await upsertLeadRecord({ ...lead, stage, nextFollowUpDate: next, lastContactDate: todayIso(), notes: stamp(note, lead.notes) }, false);
    setSaving(false);
    if (!res.success) return setError(res.error || 'Not saved.');
    toast.success('Follow-up saved', { description: `${lead.companyName} · next ${formatDate(next)}` });
    onDone();
  };
  return (
    <Shell title="Log follow-up" description={`${lead.companyName} · ${lead.contactPerson}${lead.phone ? ` · ${lead.phone}` : ''}`} error={error} saving={saving} submit="Save" onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Stage" htmlFor="fl-stage">
          <Select id="fl-stage" value={stage} onChange={(e) => setStage(e.target.value as LeadStage)}>
            {PIPELINE.filter((s) => s !== 'quoted' || lead.quotationId).map((s) => (
              <option key={s} value={s}>
                {STAGE[s].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Next follow-up" htmlFor="fl-next">
          <Input id="fl-next" type="date" min={todayIso()} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>
      <Field label="What was discussed" htmlFor="fl-note">
        <Textarea id="fl-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {lead.notes && <p className="max-h-28 overflow-y-auto whitespace-pre-line rounded-lg bg-muted p-3 text-xs text-muted-foreground">{lead.notes}</p>}
    </Shell>
  );
}

function LostForm({ lead, onDone }: { lead: LeadRecord; onDone: () => void }) {
  const { upsertLeadRecord } = useRtdb();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Shell
      title="Mark enquiry lost"
      description={`${lead.companyName} · ${lead.productInterest}`}
      error={error}
      saving={saving}
      submit="Mark lost"
      danger
      onCancel={onDone}
      onSubmit={async () => {
        if (reason.trim().length < 3) return setError('Say why (price, delivery, size not made, no reply…). This shows which enquiries to chase.');
        setSaving(true);
        const res = await upsertLeadRecord({ ...lead, stage: 'lost', lostReason: reason.trim(), lastContactDate: todayIso(), notes: stamp(`Lost: ${reason}`, lead.notes) }, false);
        setSaving(false);
        if (!res.success) return setError(res.error || 'Not saved.');
        toast.success(`${lead.companyName} marked lost`);
        onDone();
      }}
    >
      <Field label="Reason" htmlFor="lo-reason">
        <Textarea id="lo-reason" rows={2} maxLength={400} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Shell>
  );
}

/** RFQ arrived: make sure the company exists as a customer, then open a pre-filled quotation. */
function RfqForm({ lead, onDone }: { lead: LeadRecord; onDone: (customerId?: string) => void }) {
  const { customers, upsertCustomerRecord, upsertLeadRecord } = useRtdb();
  const match = customers.find((c) => c.id === lead.customerId) || customers.find((c) => c.name.trim().toLowerCase() === lead.companyName.trim().toLowerCase());
  const [mode, setMode] = useState<'existing' | 'new'>(match ? 'existing' : 'new');
  const [customerId, setCustomerId] = useState(match?.id || '');
  const [email, setEmail] = useState(lead.email || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    let cid = customerId;
    setError('');
    if (mode === 'existing') {
      if (!cid) return setError('Choose the customer.');
    } else {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('A customer needs a contact email. Enter it.');
      setSaving(true);
      cid = newRecordId('CUST');
      const res = await upsertCustomerRecord(
        {
          id: cid,
          code: cid,
          name: lead.companyName,
          contactPerson: lead.contactPerson,
          phone: lead.phone || '',
          email: email.trim().toLowerCase(),
          location: lead.city || '',
          industry: lead.industry || '',
          creditLimit: 0,
          creditDays: 0,
          assignedSalesPerson: lead.ownerName,
          active: true,
          totalOrders: 0,
          totalOutstanding: 0,
        } as Customer,
        true
      );
      if (!res.success) {
        setSaving(false);
        return setError(res.error || 'The customer could not be created.');
      }
    }
    setSaving(true);
    const upd = await upsertLeadRecord({ ...lead, stage: 'rfq_received', customerId: cid, lastContactDate: todayIso(), notes: stamp('RFQ received', lead.notes) }, false);
    setSaving(false);
    if (!upd.success) return setError(upd.error || 'Not saved.');
    toast.success('RFQ recorded', { description: 'Opening a new quotation for this customer.' });
    onDone(cid);
  };

  return (
    <Shell title="RFQ received" description={`${lead.companyName} sent an RFQ. Link it to a customer, then fill in the quotation.`} error={error} saving={saving} submit="Continue to quotation" onCancel={() => onDone()} onSubmit={submit}>
      <div className="flex gap-2" role="radiogroup">
        {(['existing', 'new'] as const).map((m) => (
          <Button key={m} type="button" size="sm" variant={mode === m ? 'primary' : 'secondary'} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
            {m === 'existing' ? 'Existing customer' : (
              <>
                <UserPlus /> New customer
              </>
            )}
          </Button>
        ))}
      </div>
      {mode === 'existing' ? (
        <Field label="Customer" htmlFor="rf-cust">
          <Select id="rf-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Choose</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <>
          <p className="rounded-lg bg-muted p-3 text-sm">
            {lead.companyName} · {lead.contactPerson}
            {lead.city ? ` · ${lead.city}` : ''}. Credit limit and terms stay blank until Finance sets them.
          </p>
          <Field label="Contact email" htmlFor="rf-email">
            <Input id="rf-email" type="email" maxLength={160} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </>
      )}
    </Shell>
  );
}
