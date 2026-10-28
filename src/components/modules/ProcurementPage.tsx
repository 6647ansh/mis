import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ClipboardList, Download, FileText, MoreHorizontal, PackageCheck, Plus, ShoppingCart, Truck } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { PurchaseOrderRecord, PurchaseRequisitionRecord, RawMaterialStock, SteelMillSupplier } from '../../types/mis';
import type { MontexPdfDocumentPayload } from '../../services/documentExportService';
import { canActorApprovePurchaseRequisition } from '../../types/roles';
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
  DropdownMenuTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/overlays';
import { cn, formatDate, formatINR, formatNumber, newRecordId, todayIso } from '@/lib/utils';

const PO_WRITERS = ['super_admin', 'ceo', 'purchase'];
const GRN_WRITERS = ['super_admin', 'ceo', 'purchase', 'stores'];
const PR_WRITERS = ['super_admin', 'ceo', 'purchase', 'stores'];

const PO_STATUS: Record<string, { tone: 'success' | 'warning' | 'neutral' | 'info'; label: string }> = {
  issued: { tone: 'neutral', label: 'Issued' },
  in_rolling: { tone: 'info', label: 'At mill' },
  partially_received: { tone: 'warning', label: 'Part received' },
  completed: { tone: 'success', label: 'Received' },
};
const PR_STATUS: Record<string, { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = {
  pending_approval: { tone: 'warning', label: 'Waiting approval' },
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Rejected' },
  converted_to_po: { tone: 'neutral', label: 'PO raised' },
  po_issued: { tone: 'neutral', label: 'PO raised' },
};

type Res = { success: boolean; error?: string; warning?: string };
const notify = (res: Res, ok: string, detail?: string) => {
  if (!res.success) toast.error('Not saved', { description: res.error || 'Please try again.' });
  else if (res.warning) toast.warning(ok, { description: res.warning });
  else toast.success(ok, { description: detail });
  return res.success;
};
const decimal = (v: string) => v.replace(/[^0-9.]/g, '');

export function ProcurementPage() {
  const { currentUser, activeRbacGroup, rawMaterials, salesOrders, purchaseOrders, purchaseRequisitions, suppliers, approvePurchaseRequisitionRecord } = useRtdb();
  const active = currentUser.accountStatus === 'active';
  const [addingMill, setAddingMill] = useState(false);
  const canPo = active && PO_WRITERS.includes(currentUser.role);
  const canGrn = active && GRN_WRITERS.includes(currentUser.role);
  const canPr = active && PR_WRITERS.includes(currentUser.role);
  const [tab, setTab] = useState('pos');
  const [poFrom, setPoFrom] = useState<{ pr?: PurchaseRequisitionRecord; material?: RawMaterialStock } | null>(null);
  const [receiving, setReceiving] = useState<PurchaseOrderRecord | null>(null);
  const [prFor, setPrFor] = useState<RawMaterialStock | 'new' | null>(null);
  const [rejecting, setRejecting] = useState<PurchaseRequisitionRecord | null>(null);
  const [preview, setPreview] = useState<MontexPdfDocumentPayload | null>(null);

  const openPos = purchaseOrders.filter((p) => p.status !== 'completed');
  const today = todayIso();
  const latePos = openPos.filter((p) => p.expectedDeliveryDate && p.expectedDeliveryDate < today);
  const waitingPrs = purchaseRequisitions.filter((p) => p.status === 'pending_approval');
  const shortages = useMemo(() => rawMaterials.filter((m) => m.reorderLevelMt > 0 && m.availableStockMt <= m.reorderLevelMt), [rawMaterials]);
  const openJobs = useMemo(() => salesOrders.filter((o) => o.status !== 'completed'), [salesOrders]);

  const mayApprove = (pr: PurchaseRequisitionRecord) =>
    canActorApprovePurchaseRequisition({
      actorUid: currentUser.id,
      actorRole: currentUser.role,
      actorStatus: currentUser.accountStatus,
      isDepartmentHead: currentUser.isDepartmentHead,
      requestedByUid: pr.requestedByUid,
    });

  const approve = async (pr: PurchaseRequisitionRecord) => notify(await approvePurchaseRequisitionRecord(pr, true), `${pr.prNumber} approved`, 'Purchase can now raise the mill PO.');

  const pdf = async (po: PurchaseOrderRecord) => {
    const svc = await import('../../services/documentExportService');
    const check = svc.verifyExportPermission(currentUser, activeRbacGroup, ['Admin', 'Management', 'Production', 'Finance']);
    if (!check.allowed) return toast.error('Export not allowed', { description: check.error });
    setPreview(svc.buildMillPurchaseOrderPdfPayload(po, suppliers.find((s) => s.id === po.supplierId), 'mill_po', currentUser, activeRbacGroup));
  };

  const exportExcel = async () => {
    const svc = await import('../../services/documentExportService');
    const res = svc.exportMontexExcelWorkbook(
      `Montex_Purchase_${today}.xlsx`,
      [
        {
          sheetName: 'Mill POs',
          reportTitle: 'MONTEX MIS — STEEL MILL PURCHASE ORDERS',
          reportSubtitle: `${purchaseOrders.length} POs`,
          headers: ['PO', 'Date', 'Supplier', 'Grade', 'Section', 'Job', 'Ordered MT', 'Received MT', 'Pending MT', 'Rate/MT', 'Value', 'Expected', 'Heat', 'Status'],
          rows: purchaseOrders.map((p) => [p.poNumber, p.poDate, p.supplierName, p.materialGrade, p.sectionMm, p.linkedJobNumber, p.orderedMt, p.receivedMt, p.pendingMt, p.ratePerMt, p.totalValue, p.expectedDeliveryDate, p.millHeatNumber, PO_STATUS[p.status]?.label || p.status]),
        },
        {
          sheetName: 'Requisitions',
          reportTitle: 'MONTEX MIS — PURCHASE REQUISITIONS',
          reportSubtitle: `${purchaseRequisitions.length} requisitions`,
          headers: ['PR', 'Date', 'Grade', 'MT', 'Job', 'Needed by', 'Priority', 'Raised by', 'Status', 'Approved by', 'PO'],
          rows: purchaseRequisitions.map((r) => [r.prNumber, r.requestDate || '', r.materialGrade, r.requiredMt ?? 0, r.linkedJobNumber, r.requiredByDate || '', r.priority || r.urgency, r.requestedByName, PR_STATUS[r.status]?.label || r.status, r.approvedByName || '', r.convertedPoNumber || '']),
        },
        {
          sheetName: 'Suppliers',
          reportTitle: 'MONTEX MIS — APPROVED MILLS',
          reportSubtitle: `${suppliers.length} suppliers`,
          headers: ['Code', 'Name', 'Location', 'Grades', 'Lead time (days)', 'Credit (days)', 'Quality %', 'Contact', 'Phone'],
          rows: suppliers.map((s) => [s.code, s.name, s.location, s.approvedGrades.join(', '), s.leadTimeDays, s.creditTermsDays || '', s.qualityRatingPercent || '', s.contactPerson, s.phone]),
        },
      ],
      currentUser.email
    );
    if (res.success) toast.success('Download started', { description: res.filename });
    else toast.error('Export failed', { description: res.error });
  };

  const poCols: Column<PurchaseOrderRecord>[] = [
    {
      id: 'po',
      header: 'PO / supplier',
      sortValue: (p) => p.poDate,
      cell: (p) => (
        <div className="max-w-64">
          <p className="whitespace-nowrap font-mono text-xs font-semibold">{p.poNumber}</p>
          <p className="truncate text-xs text-muted-foreground">{p.supplierName} · {formatDate(p.poDate)}</p>
        </div>
      ),
    },
    {
      id: 'mat',
      header: 'Material',
      hideBelow: 'md',
      cell: (p) => (
        <div className="max-w-56">
          <p className="truncate">{p.materialGrade}</p>
          <p className="truncate text-xs text-muted-foreground">{[p.sectionMm, p.linkedJobNumber].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    {
      id: 'qty',
      header: 'Received / ordered',
      align: 'right',
      sortValue: (p) => p.pendingMt,
      cell: (p) => (
        <div className="whitespace-nowrap text-right font-mono">
          {formatNumber(p.receivedMt, 2)} / {formatNumber(p.orderedMt, 2)} MT
          {p.pendingMt > 0 && <p className="text-xs text-muted-foreground">{formatNumber(p.pendingMt, 2)} pending</p>}
        </div>
      ),
    },
    {
      id: 'due',
      header: 'Expected',
      hideBelow: 'sm',
      sortValue: (p) => p.expectedDeliveryDate,
      cell: (p) => {
        const late = p.status !== 'completed' && p.expectedDeliveryDate && p.expectedDeliveryDate < today;
        return <span className={cn('whitespace-nowrap', late && 'font-semibold text-destructive')}>{formatDate(p.expectedDeliveryDate)}</span>;
      },
    },
    { id: 'val', header: 'Value', align: 'right', hideBelow: 'lg', cell: (p) => <span className="font-mono">{p.totalValue ? formatINR(p.totalValue, { compact: true }) : '—'}</span> },
    { id: 'st', header: 'Status', cell: (p) => <Badge tone={PO_STATUS[p.status]?.tone}>{PO_STATUS[p.status]?.label || p.status}</Badge> },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: (p) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${p.poNumber}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canGrn && p.pendingMt > 0 && (
              <DropdownMenuItem onSelect={() => setReceiving(p)}>
                <PackageCheck /> Receive (GRN)
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => pdf(p)}>
              <FileText /> PO document
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const prCols: Column<PurchaseRequisitionRecord>[] = [
    {
      id: 'pr',
      header: 'Requisition',
      sortValue: (r) => r.createdAt || r.requestDate || '',
      cell: (r) => (
        <div className="max-w-56">
          <p className="whitespace-nowrap font-mono text-xs font-semibold">{r.prNumber}</p>
          <p className="truncate text-xs text-muted-foreground">
            {r.requestedByName} · {formatDate(r.requestDate)}
          </p>
        </div>
      ),
    },
    {
      id: 'need',
      header: 'Need',
      cell: (r) => (
        <div className="max-w-60">
          <p className="truncate">
            {formatNumber(r.requiredMt ?? 0, 2)} MT · {r.materialGrade}
          </p>
          <p className="line-clamp-1 text-xs text-muted-foreground">{[r.linkedJobNumber, r.justification].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { id: 'by', header: 'Needed by', hideBelow: 'md', sortValue: (r) => r.requiredByDate || '', cell: (r) => <span className="whitespace-nowrap">{formatDate(r.requiredByDate)}</span> },
    { id: 'prio', header: 'Priority', hideBelow: 'lg', cell: (r) => <Badge tone={r.urgency === 'urgent' || r.urgency === 'critical' ? 'danger' : r.urgency === 'high' ? 'warning' : 'neutral'}>{r.priority || r.urgency}</Badge> },
    {
      id: 'st',
      header: 'Status',
      cell: (r) => (
        <div>
          <Badge tone={PR_STATUS[r.status]?.tone}>{PR_STATUS[r.status]?.label || r.status}</Badge>
          {r.convertedPoNumber && <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{r.convertedPoNumber}</p>}
          {r.status === 'rejected' && r.rejectionReason && <p className="mt-0.5 max-w-48 truncate text-xs text-destructive">{r.rejectionReason}</p>}
        </div>
      ),
    },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: (r) => {
        if (r.status === 'pending_approval') {
          const check = mayApprove(r);
          if (!check.allowed) return null;
          return (
            <div className="flex justify-end gap-1.5">
              <Button size="sm" onClick={() => approve(r)}>
                Approve
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setRejecting(r)}>
                Reject
              </Button>
            </div>
          );
        }
        if (r.status === 'approved' && canPo) {
          return (
            <Button size="sm" variant="bronze" onClick={() => setPoFrom({ pr: r })}>
              Raise PO
            </Button>
          );
        }
        return null;
      },
    },
  ];

  const shortCols: Column<RawMaterialStock>[] = [
    {
      id: 'mat',
      header: 'Material',
      sortValue: (m) => m.grade,
      cell: (m) => (
        <div className="max-w-64">
          <p className="truncate font-medium">{m.grade}</p>
          <p className="truncate text-xs text-muted-foreground">{[m.code, m.dimensionsMm].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { id: 'free', header: 'Free', align: 'right', sortValue: (m) => m.availableStockMt, cell: (m) => <span className="whitespace-nowrap font-mono text-destructive">{formatNumber(m.availableStockMt, 2)} MT</span> },
    { id: 'reorder', header: 'Reorder at', align: 'right', hideBelow: 'sm', cell: (m) => <span className="whitespace-nowrap font-mono">{formatNumber(m.reorderLevelMt, 2)} MT</span> },
    {
      id: 'onorder',
      header: 'Already on order',
      align: 'right',
      hideBelow: 'md',
      cell: (m) => {
        const mt = openPos.filter((p) => p.materialId === m.id || p.materialGrade === m.grade).reduce((s, p) => s + p.pendingMt, 0);
        return <span className="whitespace-nowrap font-mono">{mt ? `${formatNumber(mt, 2)} MT` : '—'}</span>;
      },
    },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: (m) =>
        canPr ? (
          <Button size="sm" variant="secondary" onClick={() => setPrFor(m)}>
            Raise PR
          </Button>
        ) : null,
    },
  ];

  const supCols: Column<SteelMillSupplier>[] = [
    {
      id: 'name',
      header: 'Mill',
      sortValue: (s) => s.name,
      cell: (s) => (
        <div className="max-w-64">
          <p className="truncate font-medium">{s.name}</p>
          <p className="truncate text-xs text-muted-foreground">{[s.code, s.location, s.certification].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { id: 'grades', header: 'Grades', hideBelow: 'md', cell: (s) => <span className="line-clamp-2 max-w-64 text-xs">{s.approvedGrades.join(', ') || '—'}</span> },
    { id: 'lead', header: 'Lead time', align: 'right', sortValue: (s) => s.leadTimeDays, cell: (s) => <span className="whitespace-nowrap font-mono">{s.leadTimeDays ? `${s.leadTimeDays} d` : '—'}</span> },
    { id: 'q', header: 'Quality', align: 'right', hideBelow: 'sm', cell: (s) => <span className="font-mono">{s.qualityRatingPercent ? `${s.qualityRatingPercent}%` : '—'}</span> },
    { id: 'contact', header: 'Contact', hideBelow: 'lg', cell: (s) => <span className="text-xs">{[s.contactPerson, s.phone].filter(Boolean).join(' · ') || '—'}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Purchase"
        description="Steel requisitions (raised, then approved by someone else), mill purchase orders, goods received into the yard, and approved mills."
        actions={
          <>
            <Button variant="secondary" onClick={exportExcel}>
              <Download /> Export
            </Button>
            {(canPr || canPo) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    <Plus /> New
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canPr && (
                    <DropdownMenuItem onSelect={() => setPrFor('new')}>
                      <ClipboardList /> Purchase requisition
                    </DropdownMenuItem>
                  )}
                  {canPo && (
                    <DropdownMenuItem onSelect={() => setPoFrom({})}>
                      <ShoppingCart /> Mill purchase order
                    </DropdownMenuItem>
                  )}
                  {canPo && (
                    <DropdownMenuItem onSelect={() => setAddingMill(true)}>
                      <Truck /> Approved mill
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Open POs" icon={Truck} value={openPos.length} hint={`${formatNumber(openPos.reduce((s, p) => s + p.pendingMt, 0), 1)} MT still to come`} onClick={() => setTab('pos')} />
        <StatTile label="Late deliveries" icon={AlertTriangle} tone={latePos.length ? 'danger' : 'neutral'} value={latePos.length} hint="Past expected date" onClick={() => setTab('pos')} />
        <StatTile label="PRs to approve" icon={ClipboardList} tone={waitingPrs.length ? 'warning' : 'neutral'} value={waitingPrs.length} onClick={() => setTab('prs')} />
        <StatTile label="Below reorder" icon={AlertTriangle} tone={shortages.length ? 'danger' : 'neutral'} value={shortages.length} hint="Free stock at or under reorder" onClick={() => setTab('short')} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="pos">Mill POs</TabsTrigger>
          <TabsTrigger value="prs">
            Requisitions
            {waitingPrs.length > 0 && <span className="rounded-full bg-warning-soft px-1.5 text-[11px] tabular-nums text-warning">{waitingPrs.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="short">Shortages</TabsTrigger>
          <TabsTrigger value="mills">Mills</TabsTrigger>
        </TabsList>
        <TabsContent value="pos" className="mt-4">
          <DataTable rows={purchaseOrders} columns={poCols} rowKey={(p) => p.id} searchText={(p) => `${p.poNumber} ${p.supplierName} ${p.materialGrade} ${p.linkedJobNumber} ${p.millHeatNumber}`} searchPlaceholder="Search PO, mill, grade, job or heat" initialSort={{ id: 'po', desc: true }} emptyTitle="No purchase orders" />
        </TabsContent>
        <TabsContent value="prs" className="mt-4">
          <DataTable rows={purchaseRequisitions} columns={prCols} rowKey={(r) => r.id} searchText={(r) => `${r.prNumber} ${r.materialGrade} ${r.linkedJobNumber} ${r.requestedByName}`} searchPlaceholder="Search PR, grade, job or person" initialSort={{ id: 'pr', desc: true }} emptyTitle="No requisitions" />
        </TabsContent>
        <TabsContent value="short" className="mt-4">
          <DataTable rows={shortages} columns={shortCols} rowKey={(m) => m.id} initialSort={{ id: 'free' }} emptyTitle="No shortages" emptyDescription="Every grade has free stock above its reorder level." />
        </TabsContent>
        <TabsContent value="mills" className="mt-4">
          <DataTable rows={suppliers} columns={supCols} rowKey={(s) => s.id} searchText={(s) => `${s.name} ${s.location} ${s.approvedGrades.join(' ')}`} searchPlaceholder="Search mill, place or grade" initialSort={{ id: 'name' }} emptyTitle="No approved mills" />
        </TabsContent>
      </Tabs>

      <Dialog open={poFrom !== null} onOpenChange={(o) => !o && setPoFrom(null)}>
        {poFrom && (
          <DialogContent className="sm:max-w-xl">
            <PoForm from={poFrom} materials={rawMaterials} suppliers={suppliers} jobs={openJobs.map((o) => o.jobNumber)} onDone={() => setPoFrom(null)} />
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={Boolean(receiving)} onOpenChange={(o) => !o && setReceiving(null)}>
        {receiving && (
          <DialogContent>
            <GrnForm po={receiving} material={rawMaterials.find((m) => m.id === receiving.materialId)} onDone={() => setReceiving(null)} />
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={prFor !== null} onOpenChange={(o) => !o && setPrFor(null)}>
        {prFor !== null && (
          <DialogContent className="sm:max-w-xl">
            <PrForm materials={rawMaterials} jobs={openJobs.map((o) => o.jobNumber)} initial={prFor === 'new' ? undefined : prFor} onDone={() => setPrFor(null)} />
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={Boolean(rejecting)} onOpenChange={(o) => !o && setRejecting(null)}>
        {rejecting && (
          <DialogContent>
            <RejectPr pr={rejecting} onDone={() => setRejecting(null)} />
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={addingMill} onOpenChange={setAddingMill}>
        {addingMill && (
          <DialogContent className="sm:max-w-xl">
            <MillForm existing={suppliers} onDone={() => setAddingMill(false)} />
          </DialogContent>
        )}
      </Dialog>
      <DocumentPreviewModal payload={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function MillForm({ existing, onDone }: { existing: SteelMillSupplier[]; onDone: () => void }) {
  const { upsertSupplierRecord } = useRtdb();
  const [f, setF] = useState({ name: '', location: '', grades: '', lead: '', contact: '', phone: '', credit: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, clean?: (v: string) => string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: clean ? clean(e.target.value) : e.target.value }));
  const digits = (v: string) => v.replace(/[^0-9]/g, '');

  const submit = async () => {
    const name = f.name.trim();
    if (name.length < 2) return setError('Enter the mill name.');
    if (existing.some((x) => x.name.trim().toLowerCase() === name.toLowerCase())) return setError('This mill is already in the list.');
    if (f.lead.trim() === '') return setError('Enter the usual delivery time in days.');
    setError('');
    setSaving(true);
    const id = newRecordId('MILL');
    const res = await upsertSupplierRecord(
      {
        id,
        code: id,
        name,
        location: f.location.trim(),
        approvedGrades: f.grades.split(',').map((g) => g.trim()).filter(Boolean).slice(0, 20),
        certification: '',
        leadTimeDays: Number(f.lead),
        creditTermsDays: Number(f.credit || 0),
        qualityRatingPercent: 0,
        contactPerson: f.contact.trim(),
        phone: f.phone.trim(),
      },
      true
    );
    setSaving(false);
    if (!res.success) return setError(res.error || 'The mill could not be saved.');
    toast.success('Mill added', { description: name });
    onDone();
  };

  return (
    <Shell title="Add approved mill" description="Mills on this list can be chosen on a purchase order." error={error} saving={saving} submit="Add mill" onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Mill name" htmlFor="ml-name" className="sm:col-span-2">
          <Input id="ml-name" maxLength={160} value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Location (optional)" htmlFor="ml-loc">
          <Input id="ml-loc" maxLength={60} value={f.location} onChange={set('location')} />
        </Field>
        <Field label="Usual delivery time (days)" htmlFor="ml-lead">
          <Input id="ml-lead" inputMode="numeric" value={f.lead} onChange={set('lead', digits)} />
        </Field>
        <Field label="Grades they supply (optional, comma separated)" htmlFor="ml-grades" className="sm:col-span-2">
          <Input id="ml-grades" maxLength={300} value={f.grades} placeholder="e.g. ASTM A105, 42CrMo4" onChange={set('grades')} />
        </Field>
        <Field label="Contact person (optional)" htmlFor="ml-contact">
          <Input id="ml-contact" maxLength={60} value={f.contact} onChange={set('contact')} />
        </Field>
        <Field label="Phone (optional)" htmlFor="ml-phone">
          <Input id="ml-phone" inputMode="tel" maxLength={20} value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Credit days (optional)" htmlFor="ml-credit">
          <Input id="ml-credit" inputMode="numeric" value={f.credit} onChange={set('credit', digits)} />
        </Field>
      </div>
    </Shell>
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

function PoForm({ from, materials, suppliers, jobs, onDone }: {
  from: { pr?: PurchaseRequisitionRecord; material?: RawMaterialStock };
  materials: RawMaterialStock[];
  suppliers: SteelMillSupplier[];
  jobs: string[];
  onDone: () => void;
}) {
  const { createPurchaseOrderRecord, markPurchaseRequisitionConverted } = useRtdb();
  const pr = from.pr;
  const initialMaterial = from.material || materials.find((m) => m.id === pr?.materialId) || materials.find((m) => pr && m.grade === pr.materialGrade);
  const [materialId, setMaterialId] = useState(initialMaterial?.id || '');
  const [supplierId, setSupplierId] = useState('');
  const [job, setJob] = useState(pr?.linkedJobNumber || '');
  const [mt, setMt] = useState(pr?.requiredMt ? String(pr.requiredMt) : '');
  const [rate, setRate] = useState(pr?.estimatedRatePerMt ? String(pr.estimatedRatePerMt) : '');
  const [due, setDue] = useState(pr?.requiredByDate || '');
  const [poNo, setPoNo] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const material = materials.find((m) => m.id === materialId);
  const supplier = suppliers.find((s) => s.id === supplierId);
  const qty = Number(mt);
  const r = Number(rate);

  const submit = async () => {
    if (!material) return setError('Choose the material.');
    if (!supplier) return setError('Choose the mill.');
    if (!poNo.trim()) return setError('Enter the PO number from your purchase register.');
    if (!(qty > 0)) return setError('Enter the quantity in MT.');
    if (!(r > 0)) return setError('Enter the rate per MT agreed with the mill.');
    if (!due) return setError('Enter the expected delivery date.');
    setError('');
    setSaving(true);
    const id = newRecordId('PO');
    const res = await createPurchaseOrderRecord({
      id,
      poNumber: poNo.trim(),
      poDate: todayIso(),
      supplierId: supplier.id,
      supplierName: supplier.name,
      materialId: material.id,
      materialCode: material.code,
      materialGrade: material.grade,
      sectionMm: material.dimensionsMm,
      linkedJobNumber: job,
      orderedMt: qty,
      receivedMt: 0,
      pendingMt: qty,
      ratePerMt: r,
      totalValue: Math.round(qty * r),
      expectedDeliveryDate: due,
      millHeatNumber: '',
      status: 'issued',
    });
    if (!res.success) {
      setSaving(false);
      return setError(res.error || 'The PO could not be saved.');
    }
    let warning: string | undefined;
    if (pr) {
      const link = await markPurchaseRequisitionConverted(pr, poNo.trim());
      if (!link.success) warning = `PO saved, but ${pr.prNumber} could not be marked as converted: ${link.error}`;
    }
    setSaving(false);
    notify({ success: true, warning }, 'Mill PO raised', `${poNo.trim()} · ${formatNumber(qty, 2)} MT to ${supplier.name}`);
    onDone();
  };

  return (
    <Shell title="Raise mill purchase order" description={pr ? `From ${pr.prNumber}, approved by ${pr.approvedByName || 'an approver'}.` : 'Order steel from an approved mill.'} error={error} saving={saving} submit="Raise PO" onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Material" htmlFor="po-mat">
          <Select id="po-mat" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
            <option value="">Choose</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.grade} · {m.dimensionsMm || m.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mill" htmlFor="po-sup" hint={supplier?.leadTimeDays ? `Usual lead time ${supplier.leadTimeDays} days` : undefined}>
          <Select id="po-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Choose</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {material && s.approvedGrades.length && !s.approvedGrades.includes(material.grade) ? ' (grade not listed)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="PO number" htmlFor="po-no">
          <Input id="po-no" className="font-mono" maxLength={64} value={poNo} onChange={(e) => setPoNo(e.target.value)} />
        </Field>
        <Field label="For job (optional)" htmlFor="po-job">
          <Select id="po-job" value={job} onChange={(e) => setJob(e.target.value)}>
            <option value="">Stock replenishment</option>
            {jobs.map((j) => (
              <option key={j}>{j}</option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity (MT)" htmlFor="po-mt">
          <Input id="po-mt" inputMode="decimal" value={mt} onChange={(e) => setMt(decimal(e.target.value))} />
        </Field>
        <Field label="Rate (₹ per MT)" htmlFor="po-rate">
          <Input id="po-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(decimal(e.target.value))} />
        </Field>
        <Field label="Expected delivery" htmlFor="po-due">
          <Input id="po-due" type="date" min={todayIso()} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
      {qty > 0 && r > 0 && <p className="text-sm text-muted-foreground">PO value {formatINR(qty * r)} (before tax)</p>}
    </Shell>
  );
}

function GrnForm({ po, material, onDone }: { po: PurchaseOrderRecord; material?: RawMaterialStock; onDone: () => void }) {
  const { receivePurchaseOrderGrnRecord } = useRtdb();
  const [mt, setMt] = useState('');
  const [heat, setHeat] = useState(po.millHeatNumber || '');
  const [grn, setGrn] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const qty = Number(mt);

  const submit = async () => {
    if (!material) return setError('This PO is not linked to a stock item, so it cannot be received into the yard.');
    if (!(qty > 0)) return setError('Enter the weight received in MT.');
    if (qty > po.pendingMt) return setError(`Only ${formatNumber(po.pendingMt, 2)} MT is pending on this PO.`);
    if (!heat.trim()) return setError('Enter the mill heat number from the MTC.');
    if (!grn.trim()) return setError('Enter the GRN number.');
    setError('');
    setSaving(true);
    const res = await receivePurchaseOrderGrnRecord({ po, material, receiptQtyMt: qty, heatNumber: heat.trim(), grnNumber: grn.trim() });
    setSaving(false);
    if (!res.success) return setError(res.error || 'The receipt could not be saved.');
    notify(res, 'Goods received', `${formatNumber(qty, 2)} MT of ${po.materialGrade} added to the yard`);
    onDone();
  };

  return (
    <Shell title="Receive against PO" description={`${po.poNumber} · ${po.supplierName} · ${formatNumber(po.pendingMt, 2)} MT pending. Stock and the ledger update together.`} error={error} saving={saving} submit="Save GRN" onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Received (MT)" htmlFor="grn-mt">
          <Input id="grn-mt" inputMode="decimal" value={mt} onChange={(e) => setMt(decimal(e.target.value))} />
        </Field>
        <Field label="Mill heat no." htmlFor="grn-heat">
          <Input id="grn-heat" className="font-mono" maxLength={64} value={heat} onChange={(e) => setHeat(e.target.value.toUpperCase())} />
        </Field>
        <Field label="GRN no." htmlFor="grn-no">
          <Input id="grn-no" className="font-mono" maxLength={64} value={grn} onChange={(e) => setGrn(e.target.value)} />
        </Field>
      </div>
    </Shell>
  );
}

function PrForm({ materials, jobs, initial, onDone }: { materials: RawMaterialStock[]; jobs: string[]; initial?: RawMaterialStock; onDone: () => void }) {
  const { currentUser, createPurchaseRequisitionRecord } = useRtdb();
  const [materialId, setMaterialId] = useState(initial?.id || '');
  const [mt, setMt] = useState('');
  const [rate, setRate] = useState('');
  const [job, setJob] = useState('');
  const [by, setBy] = useState('');
  const [priority, setPriority] = useState<'Normal' | 'High' | 'Urgent'>('Normal');
  const [why, setWhy] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const material = materials.find((m) => m.id === materialId);

  const submit = async () => {
    const qty = Number(mt);
    if (!material) return setError('Choose the material.');
    if (!(qty > 0)) return setError('Enter the quantity needed in MT.');
    if (!by) return setError('Enter when it is needed.');
    if (why.trim().length < 5) return setError('Say why it is needed (job, shortage, etc.).');
    setError('');
    setSaving(true);
    const id = newRecordId('PR');
    const estRate = Number(rate) || 0;
    const res = await createPurchaseRequisitionRecord({
      id,
      prNumber: id,
      requestDate: todayIso(),
      requestedByUid: currentUser.id,
      requestedByName: currentUser.name,
      requestedByRole: currentUser.role,
      materialId: material.id,
      materialCode: material.code,
      materialGrade: material.grade,
      sectionMm: material.dimensionsMm,
      requiredMt: qty,
      requiredByDate: by,
      estimatedRatePerMt: estRate,
      estimatedTotalInr: Math.round(qty * estRate),
      linkedJobNumber: job,
      urgency: priority === 'Urgent' ? 'urgent' : priority === 'High' ? 'high' : 'standard',
      priority,
      justification: why.trim(),
      status: 'pending_approval',
    });
    setSaving(false);
    if (!res.success) return setError(res.error || 'The requisition could not be saved.');
    notify(res, 'Requisition raised', 'Someone other than you must approve it.');
    onDone();
  };

  return (
    <Shell title="Purchase requisition" description="Ask for steel. A different person (head of department, CEO or Super Admin) approves it before a PO is raised." error={error} saving={saving} submit="Raise PR" onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Material" htmlFor="pr-mat" hint={material ? `${formatNumber(material.availableStockMt, 2)} MT free now` : undefined}>
          <Select id="pr-mat" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
            <option value="">Choose</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.grade} · {m.dimensionsMm || m.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quantity (MT)" htmlFor="pr-mt">
          <Input id="pr-mt" inputMode="decimal" value={mt} onChange={(e) => setMt(decimal(e.target.value))} />
        </Field>
        <Field label="Needed by" htmlFor="pr-by">
          <Input id="pr-by" type="date" min={todayIso()} value={by} onChange={(e) => setBy(e.target.value)} />
        </Field>
        <Field label="Priority" htmlFor="pr-prio">
          <Select id="pr-prio" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            <option>Normal</option>
            <option>High</option>
            <option>Urgent</option>
          </Select>
        </Field>
        <Field label="For job (optional)" htmlFor="pr-job">
          <Select id="pr-job" value={job} onChange={(e) => setJob(e.target.value)}>
            <option value="">Stock replenishment</option>
            {jobs.map((j) => (
              <option key={j}>{j}</option>
            ))}
          </Select>
        </Field>
        <Field label="Estimated rate ₹/MT (optional)" htmlFor="pr-rate">
          <Input id="pr-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(decimal(e.target.value))} />
        </Field>
      </div>
      <Field label="Why" htmlFor="pr-why">
        <Textarea id="pr-why" rows={2} maxLength={600} value={why} onChange={(e) => setWhy(e.target.value)} />
      </Field>
    </Shell>
  );
}

function RejectPr({ pr, onDone }: { pr: PurchaseRequisitionRecord; onDone: () => void }) {
  const { approvePurchaseRequisitionRecord } = useRtdb();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Shell
      title="Reject requisition"
      description={`${pr.prNumber} · ${formatNumber(pr.requiredMt ?? 0, 2)} MT ${pr.materialGrade} for ${pr.requestedByName}`}
      error={error}
      saving={saving}
      submit="Reject"
      onCancel={onDone}
      onSubmit={async () => {
        if (reason.trim().length < 3) return setError('Give a short reason; the requester sees it.');
        setSaving(true);
        const res = await approvePurchaseRequisitionRecord(pr, false, reason.trim());
        setSaving(false);
        if (!res.success) return setError(res.error || 'Not saved.');
        notify(res, `${pr.prNumber} rejected`);
        onDone();
      }}
    >
      <Field label="Reason" htmlFor="rj-pr">
        <Textarea id="rj-pr" rows={3} maxLength={600} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Shell>
  );
}
