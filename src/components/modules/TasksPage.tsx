import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRightLeft, BookOpen, CheckCircle2, ClipboardCheck, Clock, Plus, Send, TriangleAlert, Zap } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { HandoverRecord, HandoverStageCode, TaskPriority, TaskRecord } from '../../types/mis';
import { canActorAcceptOrRejectHandover, canActorVerifyDepartmentTask, USER_ROLE_METADATA } from '../../types/roles';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, StatTile } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { cn, formatDate, formatNumber, newRecordId, todayIso } from '@/lib/utils';

const DEPARTMENTS = ['Sales', 'Stores', 'Purchase', 'Quality', 'Dispatch', 'Finance', 'Production'];
type GateCode = 'H-1' | 'H-2' | 'H-3' | 'H-4' | 'H-5';
const GATES: Record<GateCode, { label: string; from: string; to: string; what: string }> = {
  'H-1': { label: 'Order documents', from: 'Sales', to: 'Stores', what: 'Customer PO, approved drawing, QAP and TDC' },
  'H-2': { label: 'Cut billets', from: 'Stores', to: 'Production', what: 'Heat-tagged, cut billets issued to the forge shop' },
  'H-3': { label: 'Forged lot', from: 'Production', to: 'Quality', what: 'Forged and heat-treated lot offered for testing' },
  'H-4': { label: 'Cleared lot', from: 'Quality', to: 'Dispatch', what: 'QC-cleared lot with MTC released to the dispatch yard' },
  'H-5': { label: 'Dispatch papers', from: 'Dispatch', to: 'Finance', what: 'Gate pass, LR and packing list for invoicing' },
};
const TASK_STATUS: Record<string, { tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info'; label: string }> = {
  pending: { tone: 'neutral', label: 'To do' },
  not_started: { tone: 'neutral', label: 'To do' },
  in_progress: { tone: 'info', label: 'In progress' },
  submitted_for_verification: { tone: 'warning', label: 'Waiting check' },
  verified_approved: { tone: 'success', label: 'Done' },
  approved: { tone: 'success', label: 'Done' },
  rejected_rework: { tone: 'danger', label: 'Returned' },
  rejected_reopened: { tone: 'danger', label: 'Returned' },
  escalated: { tone: 'danger', label: 'Escalated' },
  blocked: { tone: 'danger', label: 'Blocked' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};
const DONE = ['verified_approved', 'approved', 'cancelled'];
const isOpen = (t: TaskRecord) => !DONE.includes(t.status);
const isPendingHandover = (h: HandoverRecord) => ['pending_acceptance', 'initiated', 'Pending Acceptance'].includes(h.status as string);

type Dlg =
  | { kind: 'task' }
  | { kind: 'handover' }
  | { kind: 'submit'; task: TaskRecord }
  | { kind: 'verify'; task: TaskRecord }
  | { kind: 'resolve'; handover: HandoverRecord };

export function TasksPage({ onSelectOrder }: { onSelectOrder?: (orderId: string) => void }) {
  const { currentUser, tasks, handovers, roleDutyManuals, runSlaAutomationScanRecord } = useRtdb();
  const [tab, setTab] = useState('mine');
  const [dialog, setDialog] = useState<Dlg | null>(null);
  const [scanning, setScanning] = useState(false);
  const today = todayIso();
  const isLead = ['super_admin', 'ceo'].includes(currentUser.role) || Boolean(currentUser.isDepartmentHead);

  const mayVerify = (t: TaskRecord) =>
    canActorVerifyDepartmentTask({
      actorUid: currentUser.id,
      actorRole: currentUser.role,
      actorStatus: currentUser.accountStatus,
      actorDepartment: currentUser.department,
      isDepartmentHead: currentUser.isDepartmentHead,
      managedDepartment: currentUser.managedDepartment,
      taskDepartment: t.department,
      taskAssignedToUid: t.assignedToUid,
    }).allowed;
  const mayResolve = (h: HandoverRecord) =>
    canActorAcceptOrRejectHandover({
      actorUid: currentUser.id,
      actorRole: currentUser.role,
      actorStatus: currentUser.accountStatus,
      actorDepartment: currentUser.department,
      initiatedByUid: h.initiatedByUid,
      toDepartment: h.toDepartment,
    }).allowed;

  const mine = useMemo(() => tasks.filter((t) => t.assignedToUid === currentUser.id && isOpen(t)), [tasks, currentUser.id]);
  const toVerify = useMemo(() => tasks.filter((t) => t.status === 'submitted_for_verification' && mayVerify(t)), [tasks, currentUser]); // eslint-disable-line react-hooks/exhaustive-deps
  const overdue = tasks.filter((t) => isOpen(t) && t.dueDate && t.dueDate < today);
  const pendingHandovers = handovers.filter(isPendingHandover);
  const forMe = pendingHandovers.filter(mayResolve);

  const scan = async () => {
    setScanning(true);
    const r = await runSlaAutomationScanRecord();
    setScanning(false);
    toast.success('Overdue check done', { description: `${r.escalatedTasksCount} task(s) escalated, ${r.newAlertsGenerated} new alert(s).` });
  };

  const taskCols = (withActions: boolean): Column<TaskRecord>[] => [
    {
      id: 'task',
      header: 'Task',
      sortValue: (t) => t.title,
      cell: (t) => (
        <div className="max-w-80">
          <p className="truncate font-medium">{t.title}</p>
          <p className="truncate text-xs text-muted-foreground">{[t.department, t.linkedJobNumber, t.assignedToName && `→ ${t.assignedToName}`].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    {
      id: 'due',
      header: 'Due',
      sortValue: (t) => t.dueDate || '',
      cell: (t) => <span className={cn('whitespace-nowrap', isOpen(t) && t.dueDate && t.dueDate < today && 'font-semibold text-destructive')}>{formatDate(t.dueDate)}</span>,
    },
    { id: 'prio', header: 'Priority', hideBelow: 'md', cell: (t) => <Badge tone={/critical|high/i.test(String(t.priority)) ? 'danger' : 'neutral'}>{String(t.priority).toLowerCase()}</Badge> },
    { id: 'st', header: 'Status', cell: (t) => <Badge tone={TASK_STATUS[t.status]?.tone}>{TASK_STATUS[t.status]?.label || t.status}</Badge> },
    ...(withActions
      ? [
          {
            id: 'act',
            header: '',
            align: 'right' as const,
            cell: (t: TaskRecord) =>
              t.status === 'submitted_for_verification' && mayVerify(t) ? (
                <Button size="sm" onClick={() => setDialog({ kind: 'verify', task: t })}>
                  Check
                </Button>
              ) : t.assignedToUid === currentUser.id && isOpen(t) && t.status !== 'submitted_for_verification' ? (
                <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'submit', task: t })}>
                  <Send /> Mark done
                </Button>
              ) : t.linkedOrderId && onSelectOrder ? (
                <Button size="sm" variant="ghost" onClick={() => onSelectOrder(t.linkedOrderId!)}>
                  Order
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  const handoverCols: Column<HandoverRecord>[] = [
    {
      id: 'gate',
      header: 'Handover',
      sortValue: (h) => h.initiatedAt,
      cell: (h) => {
        const code = String(h.handoverCode || h.stageCode || '').slice(0, 3) as GateCode;
        return (
          <div className="max-w-72">
            <p className="font-medium">
              <span className="font-mono">{code}</span> · {GATES[code]?.label || h.stageLabel}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {h.fromDepartment} → {h.toDepartment} · {formatDate(h.initiatedAt?.slice(0, 10))}
            </p>
          </div>
        );
      },
    },
    { id: 'job', header: 'Job', cell: (h) => <span className="whitespace-nowrap font-mono text-xs">{h.jobNumber}</span> },
    {
      id: 'qty',
      header: 'Quantity',
      align: 'right',
      hideBelow: 'sm',
      cell: (h) => (
        <span className="whitespace-nowrap font-mono">
          {[h.quantityPcs ? `${formatNumber(h.quantityPcs)} pcs` : '', h.weightMt || h.quantityMT ? `${formatNumber(h.weightMt || h.quantityMT || 0, 2)} MT` : ''].filter(Boolean).join(' · ') || '—'}
        </span>
      ),
    },
    { id: 'heat', header: 'Heat', hideBelow: 'lg', cell: (h) => <span className="font-mono text-xs">{h.heatNumber || '—'}</span> },
    {
      id: 'st',
      header: 'Status',
      cell: (h) => {
        const s = String(h.status).toLowerCase();
        return <Badge tone={s.includes('accept') && !s.includes('pending') ? 'success' : s.includes('reject') ? 'danger' : 'warning'}>{isPendingHandover(h) ? 'Waiting receiver' : s.includes('reject') ? 'Returned' : 'Accepted'}</Badge>;
      },
    },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: (h) =>
        isPendingHandover(h) && mayResolve(h) ? (
          <Button size="sm" onClick={() => setDialog({ kind: 'resolve', handover: h })}>
            Receive
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks & Handovers"
        description="Who owes what by when, checked by someone other than the doer, and the signed custody of each job between departments (H-1 to H-5)."
        actions={
          <>
            {isLead && (
              <Button variant="secondary" loading={scanning} onClick={scan}>
                <Zap /> Check overdue
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDialog({ kind: 'handover' })}>
              <ArrowRightLeft /> Hand over
            </Button>
            {isLead && (
              <Button onClick={() => setDialog({ kind: 'task' })}>
                <Plus /> Assign task
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="My open tasks" icon={ClipboardCheck} value={mine.length} hint={`${mine.filter((t) => t.dueDate && t.dueDate < today).length} overdue`} onClick={() => setTab('mine')} />
        <StatTile label="Waiting my check" icon={CheckCircle2} tone={toVerify.length ? 'warning' : 'neutral'} value={toVerify.length} onClick={() => setTab('verify')} />
        <StatTile label="Overdue (all)" icon={TriangleAlert} tone={overdue.length ? 'danger' : 'neutral'} value={overdue.length} onClick={() => setTab('all')} />
        <StatTile label="Handovers to receive" icon={ArrowRightLeft} tone={forMe.length ? 'warning' : 'neutral'} value={forMe.length} hint={`${pendingHandovers.length} pending in total`} onClick={() => setTab('handovers')} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="mine">My tasks</TabsTrigger>
          <TabsTrigger value="verify">
            To check
            {toVerify.length > 0 && <span className="rounded-full bg-warning-soft px-1.5 text-[11px] tabular-nums text-warning">{toVerify.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="all">All tasks</TabsTrigger>
          <TabsTrigger value="handovers">Handovers</TabsTrigger>
          <TabsTrigger value="manual">
            <BookOpen className="size-3.5" /> Duty manual
          </TabsTrigger>
        </TabsList>
        <TabsContent value="mine" className="mt-4">
          <DataTable rows={mine} columns={taskCols(true)} rowKey={(t) => t.id} initialSort={{ id: 'due' }} emptyTitle="Nothing assigned to you" />
        </TabsContent>
        <TabsContent value="verify" className="mt-4">
          <DataTable rows={toVerify} columns={taskCols(true)} rowKey={(t) => t.id} initialSort={{ id: 'due' }} emptyTitle="Nothing waiting for your check" emptyDescription="Tasks appear here when someone in a department you supervise marks them done." />
        </TabsContent>
        <TabsContent value="all" className="mt-4">
          <DataTable rows={tasks} columns={taskCols(true)} rowKey={(t) => t.id} searchText={(t) => `${t.title} ${t.department} ${t.assignedToName} ${t.linkedJobNumber}`} searchPlaceholder="Search task, department, person or job" initialSort={{ id: 'due' }} emptyTitle="No tasks" />
        </TabsContent>
        <TabsContent value="handovers" className="mt-4">
          <DataTable rows={handovers} columns={handoverCols} rowKey={(h) => h.id} searchText={(h) => `${h.jobNumber} ${h.fromDepartment} ${h.toDepartment} ${h.heatNumber}`} searchPlaceholder="Search job, department or heat" initialSort={{ id: 'gate', desc: true }} emptyTitle="No handovers yet" />
        </TabsContent>
        <TabsContent value="manual" className="mt-4">
          <DutyManual manuals={roleDutyManuals} defaultRole={currentUser.role} />
        </TabsContent>
      </Tabs>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog && (
          <DialogContent className="sm:max-w-xl">
            {dialog.kind === 'task' && <TaskForm onDone={() => setDialog(null)} />}
            {dialog.kind === 'handover' && <HandoverForm onDone={() => setDialog(null)} />}
            {dialog.kind === 'submit' && <SubmitForm task={dialog.task} onDone={() => setDialog(null)} />}
            {dialog.kind === 'verify' && <VerifyForm task={dialog.task} onDone={() => setDialog(null)} />}
            {dialog.kind === 'resolve' && <ResolveForm handover={dialog.handover} onDone={() => setDialog(null)} />}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function DutyManual({ manuals, defaultRole }: { manuals: { role: string; designationTitle: string; primaryAccountability: string; dailyDuties: string[]; weeklyDuties: string[]; mandatoryKpis: string[] }[]; defaultRole: string }) {
  const roles = manuals.map((m) => m.role);
  const [role, setRole] = useState(roles.includes(defaultRole) ? defaultRole : roles[0]);
  const m = manuals.find((x) => x.role === role);
  if (!m) return <p className="text-sm text-muted-foreground">Loading duty manual…</p>;
  const Section = ({ title, items }: { title: string; items: string[] }) => (
    <div>
      <h4 className="mb-2 text-sm font-semibold">{title}</h4>
      <ul className="space-y-1.5 text-sm">
        {items.map((i) => (
          <li key={i} className="flex gap-2">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{m.designationTitle}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{m.primaryAccountability}</p>
        </div>
        <Select aria-label="Role" className="w-48" value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {USER_ROLE_METADATA[r as keyof typeof USER_ROLE_METADATA]?.label || r}
            </option>
          ))}
        </Select>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-3">
        <Section title="Every day" items={m.dailyDuties} />
        <Section title="Every week" items={m.weeklyDuties} />
        <Section title="Measured on" items={m.mandatoryKpis} />
      </CardContent>
    </Card>
  );
}

function Shell({ title, description, error, saving, submit, onCancel, onSubmit, children, secondary }: {
  title: string;
  description: string;
  error: string;
  saving: boolean;
  submit: string;
  onCancel: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
  secondary?: React.ReactNode;
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
        {secondary}
        <Button type="submit" loading={saving}>
          {submit}
        </Button>
      </DialogFooter>
    </form>
  );
}

function TaskForm({ onDone }: { onDone: () => void }) {
  const { currentUser, usersList, salesOrders, upsertTaskRecord } = useRtdb();
  const [f, setF] = useState({ title: '', description: '', department: '', assignee: '', order: '', priority: 'medium' as TaskPriority, due: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const people = usersList.filter((u) => u.accountStatus === 'active' && u.id !== currentUser.id);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    const person = people.find((u) => u.id === f.assignee);
    const order = salesOrders.find((o) => o.id === f.order);
    if (f.title.trim().length < 3) return setError('Say what needs to be done.');
    if (!f.department) return setError('Choose the department.');
    if (!person) return setError('Choose who will do it.');
    if (!f.due) return setError('Set a due date.');
    setError('');
    setSaving(true);
    const id = newRecordId('TSK');
    const now = new Date().toISOString();
    const res = await upsertTaskRecord(
      {
        id,
        taskNumber: id,
        title: f.title.trim(),
        description: f.description.trim(),
        department: f.department,
        assignedToUid: person.id,
        assignedToName: person.displayName || person.name,
        assignedByUid: currentUser.id,
        assignedByName: currentUser.name,
        linkedOrderId: order?.id,
        linkedJobNumber: order?.jobNumber,
        priority: f.priority,
        status: 'pending',
        dueDate: f.due,
        slaHours: Math.max(1, Math.round((Date.parse(f.due) - Date.now()) / 3_600_000)),
        escalationLevel: 0,
        createdAt: now,
        updatedAt: now,
      } as TaskRecord,
      true
    );
    setSaving(false);
    if (!res.success) return setError(res.error || 'Not saved.');
    toast.success('Task assigned', { description: `${f.title.trim()} → ${person.displayName || person.name}` });
    onDone();
  };

  return (
    <Shell title="Assign task" description="The person marks it done; someone else from the department checks it." error={error} saving={saving} submit="Assign" onCancel={onDone} onSubmit={submit}>
      <Field label="What needs to be done" htmlFor="tk-title">
        <Input id="tk-title" maxLength={160} value={f.title} onChange={set('title')} />
      </Field>
      <Field label="Details (optional)" htmlFor="tk-desc">
        <Textarea id="tk-desc" rows={2} maxLength={600} value={f.description} onChange={set('description')} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Department" htmlFor="tk-dept">
          <Select id="tk-dept" value={f.department} onChange={set('department')}>
            <option value="">Choose</option>
            {DEPARTMENTS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
        </Field>
        <Field label="Assign to" htmlFor="tk-who">
          <Select id="tk-who" value={f.assignee} onChange={set('assignee')}>
            <option value="">Choose</option>
            {people.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName || u.name} · {u.department}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due" htmlFor="tk-due">
          <Input id="tk-due" type="date" min={todayIso()} value={f.due} onChange={set('due')} />
        </Field>
        <Field label="Priority" htmlFor="tk-prio">
          <Select id="tk-prio" value={f.priority} onChange={set('priority')}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        </Field>
        <Field label="Order (optional)" htmlFor="tk-order" className="sm:col-span-2">
          <Select id="tk-order" value={f.order} onChange={set('order')}>
            <option value="">Not linked to an order</option>
            {salesOrders
              .filter((o) => o.status !== 'completed')
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.jobNumber} · {o.customerName}
                </option>
              ))}
          </Select>
        </Field>
      </div>
    </Shell>
  );
}

function SubmitForm({ task, onDone }: { task: TaskRecord; onDone: () => void }) {
  const { submitTaskForVerificationRecord } = useRtdb();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Shell
      title="Mark task done"
      description={`${task.title}. A supervisor checks it before it is closed.`}
      error={error}
      saving={saving}
      submit="Send for check"
      onCancel={onDone}
      onSubmit={async () => {
        if (note.trim().length < 3) return setError('Say what was done (the checker reads this).');
        setSaving(true);
        const res = await submitTaskForVerificationRecord(task, note.trim());
        setSaving(false);
        if (!res.success) return setError(res.error || 'Not saved.');
        toast.success('Sent for check', { description: task.title });
        onDone();
      }}
    >
      <Field label="What was done" htmlFor="sb-note">
        <Textarea id="sb-note" rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Shell>
  );
}

function VerifyForm({ task, onDone }: { task: TaskRecord; onDone: () => void }) {
  const { verifyTaskRecord } = useRtdb();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<'ok' | 'back' | null>(null);
  const run = async (approved: boolean) => {
    if (!approved && note.trim().length < 3) return setError('Say what needs fixing.');
    setSaving(approved ? 'ok' : 'back');
    const res = await verifyTaskRecord(task, approved, note.trim());
    setSaving(null);
    if (!res.success) return setError(res.error || 'Not saved.');
    toast.success(approved ? 'Task closed' : 'Returned for rework', { description: task.title });
    onDone();
  };
  const sub = task.submissionRemarks;
  return (
    <Shell
      title="Check task"
      description={`${task.title} · done by ${task.assignedToName || 'the assignee'}`}
      error={error}
      saving={saving === 'ok'}
      submit="Approve"
      onCancel={onDone}
      onSubmit={() => run(true)}
      secondary={
        <Button type="button" variant="destructive" loading={saving === 'back'} onClick={() => run(false)}>
          Return
        </Button>
      }
    >
      {sub && <p className="rounded-lg bg-muted p-3 text-sm">{sub}</p>}
      <Field label="Your note (required to return)" htmlFor="vf-note">
        <Textarea id="vf-note" rows={2} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Shell>
  );
}

function HandoverForm({ onDone }: { onDone: () => void }) {
  const { currentUser, salesOrders, initiateHandoverRecord } = useRtdb();
  const [gate, setGate] = useState<GateCode | ''>('');
  const [orderId, setOrderId] = useState('');
  const [pcs, setPcs] = useState('');
  const [mt, setMt] = useState('');
  const [heat, setHeat] = useState('');
  const [checklist, setChecklist] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const meta = gate ? GATES[gate] : undefined;
  const order = salesOrders.find((o) => o.id === orderId);

  const submit = async () => {
    if (!gate || !meta) return setError('Choose the handover stage.');
    if (!order) return setError('Choose the job.');
    if (!(Number(pcs) > 0) && !(Number(mt) > 0)) return setError('Enter the pieces or weight handed over.');
    if (checklist.trim().length < 5) return setError('List what was checked and handed over.');
    setError('');
    setSaving(true);
    const res = await initiateHandoverRecord({
      id: newRecordId('HND'),
      handoverCode: gate as HandoverStageCode,
      stageLabel: `${gate}: ${meta.label}`,
      orderId: order.id,
      jobNumber: order.jobNumber,
      customerName: order.customerName,
      productName: order.lineItems?.[0]?.productName || '',
      fromDepartment: meta.from,
      toDepartment: meta.to,
      initiatedByUid: currentUser.id,
      initiatedByName: currentUser.name,
      status: 'pending_acceptance',
      quantityPcs: Number(pcs) || undefined,
      weightMt: Number(mt) || undefined,
      heatNumber: heat.trim() || undefined,
      checklistSummary: checklist.trim(),
      initiatedAt: new Date().toISOString(),
    } as HandoverRecord);
    setSaving(false);
    if (!res.success) return setError(res.error || 'Not saved.');
    toast.success('Handover sent', { description: `${gate}: ${meta.from} → ${meta.to}, ${order.jobNumber}` });
    onDone();
  };

  return (
    <Shell title="Hand over" description="The receiving department confirms what it got. Until then the job stays in your custody." error={error} saving={saving} submit="Send" onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Stage" htmlFor="ho-gate" hint={meta?.what}>
          <Select id="ho-gate" value={gate} onChange={(e) => setGate(e.target.value as GateCode)}>
            <option value="">Choose</option>
            {(Object.keys(GATES) as GateCode[]).map((g) => (
              <option key={g} value={g}>
                {g} · {GATES[g].from} → {GATES[g].to}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Job" htmlFor="ho-job">
          <Select id="ho-job" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">Choose</option>
            {salesOrders
              .filter((o) => o.status !== 'completed')
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.jobNumber} · {o.customerName}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Pieces" htmlFor="ho-pcs">
          <Input id="ho-pcs" inputMode="numeric" value={pcs} onChange={(e) => setPcs(e.target.value.replace(/[^0-9]/g, ''))} />
        </Field>
        <Field label="Weight (MT)" htmlFor="ho-mt">
          <Input id="ho-mt" inputMode="decimal" value={mt} onChange={(e) => setMt(e.target.value.replace(/[^0-9.]/g, ''))} />
        </Field>
        <Field label="Heat number" htmlFor="ho-heat" className="sm:col-span-2">
          <Input id="ho-heat" className="font-mono" maxLength={64} value={heat} onChange={(e) => setHeat(e.target.value.toUpperCase())} />
        </Field>
      </div>
      <Field label="Checked and handed over" htmlFor="ho-check">
        <Textarea id="ho-check" rows={3} maxLength={600} value={checklist} onChange={(e) => setChecklist(e.target.value)} />
      </Field>
    </Shell>
  );
}

function ResolveForm({ handover, onDone }: { handover: HandoverRecord; onDone: () => void }) {
  const { resolveHandoverRecord } = useRtdb();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<'ok' | 'back' | null>(null);
  const run = async (accepted: boolean) => {
    if (!accepted && note.trim().length < 3) return setError('Say why it is being returned.');
    setSaving(accepted ? 'ok' : 'back');
    const res = await resolveHandoverRecord(handover, accepted, note.trim());
    setSaving(null);
    if (!res.success) return setError(res.error || 'Not saved.');
    toast.success(accepted ? 'Handover received' : 'Handover returned', { description: handover.jobNumber });
    onDone();
  };
  return (
    <Shell
      title="Receive handover"
      description={`${handover.stageLabel} · ${handover.jobNumber} · from ${handover.initiatedByName}`}
      error={error}
      saving={saving === 'ok'}
      submit="Accept"
      onCancel={onDone}
      onSubmit={() => run(true)}
      secondary={
        <Button type="button" variant="destructive" loading={saving === 'back'} onClick={() => run(false)}>
          Return
        </Button>
      }
    >
      <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted p-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Quantity</dt>
          <dd>{[handover.quantityPcs ? `${formatNumber(handover.quantityPcs)} pcs` : '', handover.weightMt ? `${formatNumber(handover.weightMt, 2)} MT` : ''].filter(Boolean).join(' · ') || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Heat</dt>
          <dd className="font-mono">{handover.heatNumber || '—'}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-muted-foreground">Checklist</dt>
          <dd>{handover.checklistSummary || '—'}</dd>
        </div>
      </dl>
      <Field label="Note (required to return)" htmlFor="rs-note">
        <Textarea id="rs-note" rows={2} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3.5" aria-hidden="true" /> Sent {formatDate(handover.initiatedAt?.slice(0, 10))}
      </p>
    </Shell>
  );
}
