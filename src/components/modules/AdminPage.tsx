import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Download, MoreHorizontal, ShieldCheck, UserPlus, Users, UserX, X } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { AuditLogEntry, UserProfile, UserRole } from '../../types/mis';
import {
  ALL_USER_ROLES,
  ROLE_DISPLAY_LABELS,
  ROLE_PERMISSION_DEFAULTS,
  USER_ROLE_METADATA,
  canActorManageTargetRole,
  mapRoleToRbacGroup,
} from '../../types/roles';
import { firestoreService } from '../../services/firestoreService';
import { mapUserProfileToFirestoreDoc } from '../../services/firestoreMappers';
import {
  adminCreateEmployeeViaApi,
  adminDeactivateEmployeeViaApi,
  adminReactivateEmployeeViaApi,
  adminUpdateEmployeeRoleViaApi,
  wakeAdminApi,
} from '../../services/adminEmployeeApi';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout, EmptyState, PageHeader, StatTile } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
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
import { formatDate } from '@/lib/utils';

type Result = { ok: true } | { ok: false; error: string };

const STATUS_BADGE: Record<string, { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  pending_approval: { tone: 'warning', label: 'Waiting for approval' },
  pending_invitation: { tone: 'warning', label: 'Invited' },
  rejected: { tone: 'danger', label: 'Rejected' },
  deactivated: { tone: 'neutral', label: 'Deactivated' },
};

const isPending = (u: UserProfile) => u.accountStatus === 'pending_approval' || u.accountStatus === 'pending_invitation';
const nameOf = (u: UserProfile) => u.displayName || u.name || u.email;
const initials = (u: UserProfile) =>
  u.avatarInitials ||
  nameOf(u)
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

function Person({ u }: { u: UserProfile }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials(u)}</span>
      <div className="min-w-0">
        <p className="truncate font-medium">{nameOf(u)}</p>
        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
      </div>
    </div>
  );
}

// The free admin server sleeps when idle; say so instead of leaving a silent spinner.
function SlowServerHint({ active }: { active: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) return setSlow(false);
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, [active]);
  if (!slow) return null;
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Starting the admin server. On the free plan this can take up to a minute; keep this window open.
    </p>
  );
}

export function AdminPage() {
  const { currentUser, usersList, setUsersList, auditLogs, activeRbacGroup, approveEmployeeAccount, rejectEmployeeAccount } = useRtdb();
  const isSuperAdmin = currentUser.accountStatus === 'active' && currentUser.role === 'super_admin';
  const isApprover = currentUser.accountStatus === 'active' && (isSuperAdmin || currentUser.role === 'ceo');
  const assignableRoles = ALL_USER_ROLES.filter((r) => isSuperAdmin || (r !== 'super_admin' && r !== 'ceo'));
  useEffect(() => {
    if (isApprover) wakeAdminApi();
  }, [isApprover]);

  const [backingUp, setBackingUp] = useState(false);
  const runBackup = async () => {
    setBackingUp(true);
    try {
      const { downloadFullBackup } = await import('../../services/backupService');
      const res = await downloadFullBackup(currentUser.email);
      const failed = res.collections.filter((c) => c.error);
      if (failed.length) {
        toast.warning('Backup downloaded, but some data could not be read', {
          description: `${res.totalRecords} records saved. Not read: ${failed.map((c) => c.name).join(', ')}`,
        });
      } else {
        toast.success('Backup downloaded', {
          description: `${res.totalRecords} records in ${res.fileBase}.json and .xlsx. Keep both files somewhere safe, such as Google Drive.`,
        });
      }
    } catch (err: any) {
      toast.error('Backup failed', { description: err?.message || 'Check your internet connection and try again.' });
    } finally {
      setBackingUp(false);
    }
  };

  const [tab, setTab] = useState('requests');
  const [approving, setApproving] = useState<UserProfile | null>(null);
  const [rejecting, setRejecting] = useState<UserProfile | null>(null);
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pending = useMemo(() => usersList.filter(isPending), [usersList]);
  const active = usersList.filter((u) => u.accountStatus === 'active');
  const deactivated = usersList.filter((u) => u.accountStatus === 'deactivated' || u.accountStatus === 'rejected');
  const activeSuperAdmins = active.filter((u) => u.role === 'super_admin').length;

  const replaceUser = (updated: UserProfile) =>
    setUsersList((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));

  /** Server Admin API first (also updates Auth claims); direct Firestore write when the server has no Admin credentials. */
  const saveProfile = async (
    user: UserProfile,
    viaApi: () => Promise<any>,
    fallback: UserProfile,
    audit: { action: string; details: string }
  ): Promise<Result> => {
    const api = await viaApi();
    if (api.success && api.data?.employee) {
      replaceUser({ ...user, ...api.data.employee });
      return { ok: true };
    }
    if (!api.isUnauthenticatedPreview && api.status < 500) return { ok: false, error: api.message };
    const fs = await firestoreService.adminUpsertEmployeeProfileToFirestore(user.id, mapUserProfileToFirestoreDoc(fallback), {
      auditAction: audit.action,
      auditDetails: audit.details,
    });
    if (!fs.success) return { ok: false, error: 'The change could not be saved. Nothing was changed.' };
    replaceUser(fallback);
    return { ok: true };
  };

  const toggleActive = async (user: UserProfile) => {
    const deactivate = user.accountStatus === 'active';
    if (deactivate && user.id === currentUser.id) return toast.error('You cannot deactivate your own account.');
    if (!isSuperAdmin && user.role === 'super_admin') return toast.error('Only a Super Admin can change another Super Admin.');
    if (deactivate && user.role === 'super_admin' && activeSuperAdmins <= 1) return toast.error('This is the last active Super Admin and cannot be deactivated.');
    const now = new Date().toISOString();
    setBusyId(user.id);
    const res = await saveProfile(
      user,
      () => (deactivate ? adminDeactivateEmployeeViaApi(user.id, 'Deactivated from Admin') : adminReactivateEmployeeViaApi(user.id)),
      {
        ...user,
        accountStatus: deactivate ? 'deactivated' : 'active',
        status: deactivate ? 'Inactive' : 'Active',
        disabledAt: deactivate ? now : null,
        deactivatedBy: deactivate ? currentUser.id : null,
        deactivationReason: deactivate ? 'Deactivated from Admin' : null,
        updatedAt: now,
      },
      { action: deactivate ? 'EMPLOYEE_DEACTIVATED' : 'EMPLOYEE_REACTIVATED', details: `${deactivate ? 'Deactivated' : 'Reactivated'} ${user.email}` }
    );
    setBusyId(null);
    if (res.ok) toast.success(deactivate ? `${nameOf(user)} can no longer sign in` : `${nameOf(user)} is active again`);
    else toast.error('Not saved', { description: res.error });
  };

  const changeRole = async (user: UserProfile, role: UserRole) => {
    if (role === user.role) return;
    const check = canActorManageTargetRole({
      actorRole: isSuperAdmin ? 'super_admin' : 'ceo',
      actorStatus: currentUser.accountStatus,
      targetCurrentRole: user.role,
      targetNewRole: role,
    });
    if (!check.allowed) return toast.error('Role not changed', { description: check.reason });
    if (user.id === currentUser.id && role !== 'super_admin' && isSuperAdmin) return toast.error('You cannot remove your own Super Admin role.');
    const now = new Date().toISOString();
    setBusyId(user.id);
    const res = await saveProfile(
      user,
      () => adminUpdateEmployeeRoleViaApi(user.id, { role, department: user.department, designation: ROLE_DISPLAY_LABELS[role] }),
      {
        ...user,
        role,
        legacyRole: role,
        rbacGroup: mapRoleToRbacGroup(role),
        roleTitle: ROLE_DISPLAY_LABELS[role],
        designation: ROLE_DISPLAY_LABELS[role],
        permissions: ROLE_PERMISSION_DEFAULTS[role],
        updatedAt: now,
      },
      { action: role === 'ceo' ? 'HIGHER_AUTHORITY_PROMOTED' : 'EMPLOYEE_ROLE_UPDATED', details: `Role of ${user.email}: ${user.role} → ${role}` }
    );
    setBusyId(null);
    if (res.ok) toast.success('Role updated', { description: `${nameOf(user)} is now ${USER_ROLE_METADATA[role].label}` });
    else toast.error('Role not changed', { description: res.error });
  };

  const exportAudit = async () => {
    const svc = await import('../../services/documentExportService');
    const check = svc.verifyExportPermission(currentUser, activeRbacGroup, ['Admin', 'Management']);
    if (!check.allowed) return toast.error('Export not allowed', { description: check.error });
    const res = svc.exportMontexExcelWorkbook(
      `Montex_Audit_Log_${new Date().toISOString().slice(0, 10)}.xlsx`,
      [
        {
          sheetName: 'Audit log',
          reportTitle: 'MONTEX MIS — AUDIT LOG',
          reportSubtitle: `${auditLogs.length} events`,
          headers: ['Time', 'Who', 'Action', 'Record', 'Details', 'Outcome'],
          rows: auditLogs.map((a) => [a.timestamp, a.actorEmail || a.userName, a.action, `${a.collectionName}/${a.documentId}`, a.newValueSummary, a.outcome || '']),
        },
      ],
      currentUser.email
    );
    if (res.success) toast.success('Download started', { description: res.filename });
    else toast.error('Export failed', { description: res.error });
  };

  if (!isApprover) {
    return (
      <div className="space-y-5">
        <PageHeader title="Admin" />
        <EmptyState icon={ShieldCheck} title="Admins only" description="Only the Super Admin and the CEO can manage employee access." />
      </div>
    );
  }

  const peopleColumns: Column<UserProfile>[] = [
    { id: 'who', header: 'Employee', sortValue: (u) => nameOf(u), cell: (u) => <Person u={u} /> },
    {
      id: 'role',
      header: 'Role',
      sortValue: (u) => u.role,
      cell: (u) => (
        <div>
          <p>{USER_ROLE_METADATA[u.role]?.label || u.role}</p>
          <p className="text-xs text-muted-foreground">{u.department}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      hideBelow: 'sm',
      sortValue: (u) => u.accountStatus,
      cell: (u) => <Badge tone={STATUS_BADGE[u.accountStatus]?.tone}>{STATUS_BADGE[u.accountStatus]?.label || u.accountStatus}</Badge>,
    },
    { id: 'login', header: 'Last sign-in', hideBelow: 'lg', sortValue: (u) => u.lastLoginAt || '', cell: (u) => <span className="whitespace-nowrap">{formatDate(u.lastLoginAt || u.lastLogin)}</span> },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: (u) => {
        const locked = (!isSuperAdmin && u.role === 'super_admin') || isPending(u);
        if (locked) return null;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${nameOf(u)}`} loading={busyId === u.id}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {u.accountStatus === 'active' && (
                <>
                  <DropdownMenuLabel>Change role</DropdownMenuLabel>
                  {assignableRoles
                    .filter((r) => r !== u.role)
                    .map((r) => (
                      <DropdownMenuItem key={r} onSelect={() => changeRole(u, r)}>
                        {USER_ROLE_METADATA[r].label}
                      </DropdownMenuItem>
                    ))}
                  <DropdownMenuSeparator />
                </>
              )}
              {u.accountStatus === 'rejected' ? (
                <DropdownMenuItem onSelect={() => setApproving(u)}>
                  <Check /> Approve after all
                </DropdownMenuItem>
              ) : u.id !== currentUser.id ? (
                <DropdownMenuItem onSelect={() => toggleActive(u)} className={u.accountStatus === 'active' ? 'text-destructive' : undefined}>
                  {u.accountStatus === 'active' ? (
                    <>
                      <UserX /> Deactivate
                    </>
                  ) : (
                    <>
                      <Check /> Reactivate
                    </>
                  )}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const auditColumns: Column<AuditLogEntry>[] = [
    { id: 'time', header: 'Time', sortValue: (a) => a.timestamp, cell: (a) => <span className="whitespace-nowrap font-mono text-xs">{a.timestamp?.replace('T', ' ').slice(0, 16)}</span> },
    { id: 'who', header: 'Who', cell: (a) => <span className="line-clamp-1 max-w-48">{a.actorName || a.userName || a.actorEmail}</span> },
    { id: 'action', header: 'Action', sortValue: (a) => a.action, cell: (a) => <Badge tone={a.outcome && a.outcome !== 'SUCCESS' ? 'danger' : 'neutral'}>{a.action.replace(/_/g, ' ').toLowerCase()}</Badge> },
    { id: 'what', header: 'Details', hideBelow: 'md', cell: (a) => <span className="line-clamp-2 max-w-md text-muted-foreground">{a.newValueSummary || (typeof a.details === 'string' ? a.details : '')}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Admin"
        description="Approve who can sign in, set each person's role, and review every change made in the system."
        actions={
          <div className="flex flex-wrap gap-2">
            {isSuperAdmin && (
              <Button variant="secondary" loading={backingUp} onClick={runBackup}>
                <Download /> Download backup
              </Button>
            )}
            <Button onClick={() => setInviting(true)}>
              <UserPlus /> Invite employee
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Waiting" value={pending.length} hint="Access requests" tone={pending.length ? 'warning' : 'neutral'} icon={ShieldCheck} onClick={() => setTab('requests')} />
        <StatTile label="Active" value={active.length} hint="Can sign in" icon={Users} onClick={() => setTab('people')} />
        <StatTile label="Blocked" value={deactivated.length} hint="Deactivated or rejected" icon={UserX} onClick={() => setTab('people')} />
        <StatTile label="Audit log" value={auditLogs.length} hint="Latest 200 events" onClick={() => setTab('audit')} />
      </div>

      <SlowServerHint active={busyId !== null} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="requests">
            Access requests
            {pending.length > 0 && <span className="rounded-full bg-warning-soft px-1.5 text-[11px] tabular-nums text-warning">{pending.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
        </TabsList>

        <TabsContent value="requests" className="mt-4">
          {pending.length === 0 ? (
            <EmptyState icon={Check} title="No one is waiting" description="When a new employee signs in with Google, their request appears here." />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {pending.map((u) => (
                <li key={u.id} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-card">
                  <Person u={u} />
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Asked for</dt>
                      <dd className="font-medium">{u.requestedRole ? USER_ROLE_METADATA[u.requestedRole]?.label : 'Not stated'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Requested on</dt>
                      <dd className="font-medium">{formatDate(u.createdAt)}</dd>
                    </div>
                    {u.requestedDepartment && (
                      <div className="col-span-2">
                        <dt className="text-xs text-muted-foreground">Department</dt>
                        <dd className="font-medium">{u.requestedDepartment}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="mt-auto flex gap-2">
                    <Button className="flex-1" onClick={() => setApproving(u)}>
                      <Check /> Approve
                    </Button>
                    <Button className="flex-1" variant="secondary" onClick={() => setRejecting(u)}>
                      <X /> Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="people" className="mt-4">
          <DataTable
            rows={usersList.filter((u) => !isPending(u))}
            columns={peopleColumns}
            rowKey={(u) => u.id}
            searchText={(u) => `${nameOf(u)} ${u.email} ${u.role} ${u.department}`}
            searchPlaceholder="Search name, email, role or department"
            initialSort={{ id: 'who' }}
          />
        </TabsContent>

        <TabsContent value="audit" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button variant="secondary" onClick={exportAudit}>
              <Download /> Export Excel
            </Button>
          </div>
          <DataTable
            rows={auditLogs}
            columns={auditColumns}
            rowKey={(a) => a.id}
            searchText={(a) => `${a.action} ${a.userName} ${a.actorEmail || ''} ${a.newValueSummary || ''} ${a.documentId}`}
            searchPlaceholder="Search action, person or record"
            initialSort={{ id: 'time', desc: true }}
            pageSize={15}
            emptyTitle="No audit events yet"
          />
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(approving)} onOpenChange={(o) => !o && setApproving(null)}>
        {approving && (
          <DialogContent>
            <ApproveForm
              user={approving}
              roles={assignableRoles}
              onCancel={() => setApproving(null)}
              onSubmit={async (opts) => {
                const res = await approveEmployeeAccount(approving, opts);
                if (!res.success) return res.error || 'Approval was not saved.';
                toast.success(`${nameOf(approving)} approved`, { description: `Signed in as ${USER_ROLE_METADATA[opts.role].label}` });
                setApproving(null);
                return null;
              }}
            />
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={Boolean(rejecting)} onOpenChange={(o) => !o && setRejecting(null)}>
        {rejecting && (
          <DialogContent>
            <RejectForm
              user={rejecting}
              onCancel={() => setRejecting(null)}
              onSubmit={async (reason) => {
                const res = await rejectEmployeeAccount(rejecting, reason);
                if (!res.success) return res.error || 'Rejection was not saved.';
                toast.success(`Request from ${nameOf(rejecting)} rejected`);
                setRejecting(null);
                return null;
              }}
            />
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={inviting} onOpenChange={setInviting}>
        {inviting && (
          <DialogContent>
            <InviteForm roles={assignableRoles} onDone={() => setInviting(false)} onCreated={(u) => setUsersList((prev) => [u, ...prev.filter((x) => x.id !== u.id)])} />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function ApproveForm({
  user,
  roles,
  onCancel,
  onSubmit,
}: {
  user: UserProfile;
  roles: UserRole[];
  onCancel: () => void;
  onSubmit: (opts: { role: UserRole; department: string; designation: string; isDepartmentHead: boolean; notes: string }) => Promise<string | null>;
}) {
  const initialRole: UserRole = user.requestedRole && roles.includes(user.requestedRole) ? user.requestedRole : roles.includes(user.role) ? user.role : roles[0];
  const [role, setRole] = useState<UserRole>(initialRole);
  const [department, setDepartment] = useState(user.requestedDepartment || USER_ROLE_METADATA[initialRole].defaultDepartment);
  const [designation, setDesignation] = useState(ROLE_DISPLAY_LABELS[initialRole]);
  const [head, setHead] = useState(Boolean(user.isDepartmentHead));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const pickRole = (r: UserRole) => {
    setRole(r);
    setDepartment(USER_ROLE_METADATA[r].defaultDepartment);
    setDesignation(ROLE_DISPLAY_LABELS[r]);
  };

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!department.trim()) return setError('Enter a department.');
        setSaving(true);
        const err = await onSubmit({ role, department: department.trim(), designation: designation.trim() || ROLE_DISPLAY_LABELS[role], isDepartmentHead: head, notes: notes.trim() });
        setSaving(false);
        setError(err || '');
      }}
    >
      <DialogHeader>
        <DialogTitle>Approve access</DialogTitle>
        <DialogDescription>
          {nameOf(user)} · {user.email}
        </DialogDescription>
      </DialogHeader>
      <Field label="Role" htmlFor="ap-role" hint={USER_ROLE_METADATA[role].description}>
        <Select id="ap-role" value={role} onChange={(e) => pickRole(e.target.value as UserRole)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {USER_ROLE_METADATA[r].label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Department" htmlFor="ap-dept">
          <Input id="ap-dept" maxLength={80} value={department} onChange={(e) => setDepartment(e.target.value)} />
        </Field>
        <Field label="Designation" htmlFor="ap-desig">
          <Input id="ap-desig" maxLength={80} value={designation} onChange={(e) => setDesignation(e.target.value)} />
        </Field>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={head} onChange={(e) => setHead(e.target.checked)} />
        Head of this department
      </label>
      <Field label="Note (optional)" htmlFor="ap-notes">
        <Textarea id="ap-notes" rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {role === 'ceo' || role === 'super_admin' ? (
        <Callout tone="warning" title="Full authority" why={`${USER_ROLE_METADATA[role].label} can approve people and see every price.`} />
      ) : null}
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
          Approve
        </Button>
      </DialogFooter>
      <SlowServerHint active={saving} />
    </form>
  );
}

function RejectForm({ user, onCancel, onSubmit }: { user: UserProfile; onCancel: () => void; onSubmit: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (reason.trim().length < 3) return setError('Write a short reason; the employee sees it.');
        setSaving(true);
        const err = await onSubmit(reason.trim());
        setSaving(false);
        setError(err || '');
      }}
    >
      <DialogHeader>
        <DialogTitle>Reject request</DialogTitle>
        <DialogDescription>
          {nameOf(user)} · {user.email}
        </DialogDescription>
      </DialogHeader>
      <Field label="Reason" htmlFor="rj-reason" error={error || undefined} hint="Shown to the employee on their sign-in screen">
        <Textarea id="rj-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" loading={saving}>
          Reject
        </Button>
      </DialogFooter>
      <SlowServerHint active={saving} />
    </form>
  );
}

function InviteForm({ roles, onDone, onCreated }: { roles: UserRole[]; onDone: () => void; onCreated: (u: UserProfile) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>(roles.includes('sales') ? 'sales' : roles[0]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const cleanEmail = email.trim().toLowerCase();
        if (name.trim().length < 2) return setError('Enter the employee’s full name.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return setError('Enter a valid email address.');
        setError('');
        setSaving(true);
        const res = await adminCreateEmployeeViaApi({
          email: cleanEmail,
          displayName: name.trim(),
          role,
          department: USER_ROLE_METADATA[role].defaultDepartment,
          designation: ROLE_DISPLAY_LABELS[role],
        });
        setSaving(false);
        if (res.success && res.data?.employee) {
          onCreated(res.data.employee);
          toast.success('Invitation saved', { description: `${cleanEmail} can now sign in with Google.` });
          onDone();
          return;
        }
        setError(
          res.isUnauthenticatedPreview || res.status === 503
            ? 'The server is not connected to Firebase Admin yet. Ask the employee to sign in with Google once; their request will appear under Access requests.'
            : res.message
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>Invite employee</DialogTitle>
        <DialogDescription>They sign in with this Google account and get the role you choose.</DialogDescription>
      </DialogHeader>
      <Field label="Full name" htmlFor="inv-name">
        <Input id="inv-name" autoComplete="off" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Google account email" htmlFor="inv-email">
        <Input id="inv-email" type="email" autoComplete="off" maxLength={160} value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Role" htmlFor="inv-role">
        <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {USER_ROLE_METADATA[r].label}
            </option>
          ))}
        </Select>
      </Field>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Send invite
        </Button>
      </DialogFooter>
      <SlowServerHint active={saving} />
    </form>
  );
}
