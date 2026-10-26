import React, { useCallback, useEffect, useState } from 'react';
import {
  Lock,
  UserPlus,
  Check,
  ShieldAlert,
  Users,
  FileSearch,
  Database,
  ShieldCheck,
  Terminal,
  FileSpreadsheet,
  FileText,
  Download,
  KeyRound,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import { ref, get } from 'firebase/database';
import { rtdb, isFirestoreConfigured } from '../../lib/firebase';
import { ROLE_PERMISSION_DEFAULTS } from '../../data/mockData';
import { UserProfile, UserRole } from '../../types/mis';
import {
  ALL_USER_ROLES,
  ROLE_DISPLAY_LABELS,
  canActorManageTargetRole,
  isCanonicalUserRole,
  isHigherAuthorityOrAdmin,
  mapRoleToRbacGroup,
} from '../../types/roles';
import { useRtdb, reconcileRecordsById } from '../../context/RtdbContext';
import { adminUpdateEmployeeProfileInRtdb, recordToArray } from '../../services/rtdbService';
import { firestoreService } from '../../services/firestoreService';
import {
  mapFirestoreDocToUserProfile,
  mapUserProfileToFirestoreDoc,
} from '../../services/firestoreMappers';
import { resolveUserRoleMapping } from '../../services/misDataValidator';
import {
  adminCreateEmployeeViaApi,
  adminDeactivateEmployeeViaApi,
  adminInitiatePasswordResetViaApi,
  adminReactivateEmployeeViaApi,
  adminUpdateEmployeeRoleViaApi,
} from '../../services/adminEmployeeApi';
import { BlueprintView } from '../blueprint/BlueprintView';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
import {
  exportMontexCsvFile,
  exportMontexExcelWorkbook,
  MontexPdfDocumentPayload,
  verifyExportPermission,
} from '../../services/documentExportService';

interface AdminViewProps {
  currentUser: UserProfile;
  onSelectUserRole: (u: UserProfile) => void;
  onOpenFirebaseConsole?: (tab: 'auth' | 'diagnostics' | 'rules') => void;
}

export const AdminView: React.FC<AdminViewProps> = ({
  currentUser,
  onSelectUserRole,
  onOpenFirebaseConsole,
}) => {
  const {
    firebaseUser,
    usersList,
    setUsersList,
    auditLogs,
    setAuditLogs,
    activeRbacGroup,
    dataSource,
    isRtdbConnected,
    approveEmployeeAccount,
    rejectEmployeeAccount,
  } = useRtdb();

  const [activeSubTab, setActiveSubTab] = useState<
    'approval_queue' | 'directory' | 'audit_logs' | 'diagnostics'
  >('approval_queue');
  const [previewPayload, setPreviewPayload] = useState<MontexPdfDocumentPayload | null>(null);
  const [localUsers, setLocalUsers] = useState<UserProfile[]>(usersList);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [newEmployeeEmail, setNewEmployeeEmail] = useState('');
  const [newEmployeeRole, setNewEmployeeRole] = useState<UserRole>('sales');
  const [newEmployeeDesignation, setNewEmployeeDesignation] = useState(
    ROLE_DISPLAY_LABELS.sales
  );
  const [newEmployeeDept, setNewEmployeeDept] = useState('Sales & Marketing');
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);
  const [pendingUserActionId, setPendingUserActionId] = useState<string | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [actionErrorMsg, setActionErrorMsg] = useState<string | null>(null);

  // Employee Approval Queue state
  const [queueSearch, setQueueSearch] = useState('');
  const [queueStatusFilter, setQueueStatusFilter] = useState<
    'all' | 'pending' | 'rejected' | 'active' | 'deactivated'
  >('all');
  const [syncingQueue, setSyncingQueue] = useState(false);

  // Approval confirmation modal state
  const [approvalTarget, setApprovalTarget] = useState<UserProfile | null>(null);
  const [approvalRole, setApprovalRole] = useState<UserRole>('sales');
  const [approvalDept, setApprovalDept] = useState('Sales & Marketing');
  const [approvalDesignation, setApprovalDesignation] = useState('');
  const [approvalIsDeptHead, setApprovalIsDeptHead] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);

  // Rejection confirmation modal state
  const [rejectionTarget, setRejectionTarget] = useState<UserProfile | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isSubmittingRejection, setIsSubmittingRejection] = useState(false);

  useEffect(() => {
    setLocalUsers(usersList);
  }, [usersList]);

  const displayedUsers = dataSource === 'live_rtdb' ? usersList : localUsers;
  const isSuperAdmin =
    currentUser.accountStatus === 'active' &&
    (currentUser.role === 'super_admin' ||
      currentUser.legacyRole === 'super_admin' ||
      activeRbacGroup === 'Admin');
  const isHigherAuthority =
    currentUser.accountStatus === 'active' &&
    (currentUser.role === 'ceo' ||
      currentUser.legacyRole === 'ceo' ||
      activeRbacGroup === 'Management');
  const isAdmin = isSuperAdmin || isHigherAuthority || isHigherAuthorityOrAdmin(currentUser.role);
  const canViewDirectory =
    currentUser.accountStatus === 'active' &&
    (activeRbacGroup === 'Admin' ||
      activeRbacGroup === 'Management' ||
      currentUser.role === 'super_admin' ||
      currentUser.role === 'ceo');

  const assignableRoles = ALL_USER_ROLES.filter((r) =>
    isSuperAdmin ? true : r !== 'super_admin' && r !== 'ceo'
  );

  // Live sync of /users from both Cloud Firestore and Realtime Database for Admin Approval Queue
  const syncEmployeeDirectoryFromDatabases = useCallback(async () => {
    if (!canViewDirectory || !firebaseUser) return;
    setSyncingQueue(true);
    try {
      let fsUsers: UserProfile[] = [];
      let rtdbUsers: UserProfile[] = [];

      if (isFirestoreConfigured) {
        const fsRes = await firestoreService.listDocuments('users', { pageSize: 200 });
        if (fsRes.success && fsRes.items.length > 0) {
          fsUsers = fsRes.items.map((doc) => mapFirestoreDocToUserProfile(doc));
        }
      }

      try {
        const snap = await get(ref(rtdb, 'users'));
        if (snap.exists()) {
          const rawArr = recordToArray<any>(snap.val(), []);
          rtdbUsers = rawArr.map((u: any) => {
            const resolved = resolveUserRoleMapping(u);
            const status = (u.accountStatus || 'pending_approval') as UserProfile['accountStatus'];
            const isAct = status === 'active' && !resolved.isUnassigned;
            const rawReqRole = u.requestedRole || u.legacyRole || resolved.granularRole;
            const safeReqRole: UserRole = isCanonicalUserRole(rawReqRole)
              ? rawReqRole
              : resolved.granularRole;
            const legacyStatus: UserProfile['status'] =
              status === 'active'
                ? 'Active'
                : status === 'rejected'
                  ? 'Rejected'
                  : status === 'deactivated'
                    ? 'Inactive'
                    : 'Pending';
            return {
              ...u,
              id: u.id || u.uid,
              uid: u.uid || u.id,
              name: u.displayName || u.name || u.email?.split('@')[0] || 'Employee',
              displayName: u.displayName || u.name || u.email?.split('@')[0] || 'Employee',
              role: resolved.granularRole,
              requestedRole: safeReqRole,
              requestedDepartment: u.requestedDepartment || u.department || 'Operations',
              rbacGroup: resolved.rbacGroup,
              roleTitle:
                status === 'deactivated'
                  ? 'ACCOUNT DEACTIVATED'
                  : status === 'rejected'
                  ? 'ACCESS REQUEST REJECTED'
                  : status === 'pending_approval' || status === 'pending_invitation'
                  ? `Pending Admin Approval (Requested: ${safeReqRole.toUpperCase()})`
                  : u.roleTitle || `${resolved.rbacGroup}`,
              accountStatus: status,
              status: legacyStatus,
              permissions: isAct ? resolved.permissions : [],
            } as UserProfile;
          });
        }
      } catch {
        // Ignore RTDB read error if offline
      }

      if (fsUsers.length > 0 || rtdbUsers.length > 0) {
        const merged = reconcileRecordsById<UserProfile>(fsUsers, rtdbUsers, 'id');
        setUsersList(merged);
        setLocalUsers(merged);
      }
    } finally {
      setSyncingQueue(false);
    }
  }, [canViewDirectory, firebaseUser, setUsersList]);

  useEffect(() => {
    if (canViewDirectory && firebaseUser) {
      syncEmployeeDirectoryFromDatabases();
    }
  }, [canViewDirectory, firebaseUser, syncEmployeeDirectoryFromDatabases]);

  const openApproveModal = (user: UserProfile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActionErrorMsg(null);
    const defaultRole: UserRole =
      user.requestedRole && assignableRoles.includes(user.requestedRole)
        ? user.requestedRole
        : assignableRoles.includes(user.role)
        ? user.role
        : 'sales';
    setApprovalTarget(user);
    setApprovalRole(defaultRole);
    setApprovalDept(user.requestedDepartment || user.department || 'Sales & Marketing');
    setApprovalDesignation(
      user.designation && !user.designation.startsWith('Requested:') && !user.designation.startsWith('Pending')
        ? user.designation
        : ROLE_DISPLAY_LABELS[defaultRole]
    );
    setApprovalIsDeptHead(Boolean(user.isDepartmentHead));
    setApprovalNotes('');
  };

  const handleConfirmApproval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approvalTarget || isSubmittingApproval) return;
    setActionErrorMsg(null);
    setActionSuccessMsg(null);
    setIsSubmittingApproval(true);

    try {
      const res = await approveEmployeeAccount(approvalTarget, {
        role: approvalRole,
        department: approvalDept,
        designation: approvalDesignation || ROLE_DISPLAY_LABELS[approvalRole],
        isDepartmentHead: approvalIsDeptHead,
        notes: approvalNotes,
      });

      if (!res.success || !res.updatedProfile) {
        setActionErrorMsg(res.error || 'Failed to approve employee account.');
        return;
      }

      const updated = res.updatedProfile;
      setLocalUsers((prev) =>
        prev.some((u) => u.id === updated.id || u.uid === updated.uid)
          ? prev.map((u) =>
              u.id === updated.id || u.uid === updated.uid ? updated : u
            )
          : [updated, ...prev]
      );
      setApprovalTarget(null);
      setActionSuccessMsg(
        `Approved ${updated.email} (UID: ${updated.uid || updated.id}) with canonical role "${updated.role}" (${updated.department}) and accountStatus="active". Confirmed write to database.`
      );
      syncEmployeeDirectoryFromDatabases().catch(() => {});
      setTimeout(() => setActionSuccessMsg(null), 6000);
    } catch (err: any) {
      setActionErrorMsg(err?.message || 'Unexpected error while persisting approval.');
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const openRejectModal = (user: UserProfile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActionErrorMsg(null);
    setRejectionTarget(user);
    setRejectionReason(user.rejectionReason || '');
  };

  const handleConfirmRejection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectionTarget || isSubmittingRejection) return;
    const cleanReason = rejectionReason.trim();
    if (cleanReason.length < 3) {
      setActionErrorMsg(
        'Please provide a clear rejection reason of at least 3 characters.'
      );
      return;
    }
    setActionErrorMsg(null);
    setActionSuccessMsg(null);
    setIsSubmittingRejection(true);

    try {
      const res = await rejectEmployeeAccount(rejectionTarget, cleanReason);
      if (!res.success || !res.updatedProfile) {
        setActionErrorMsg(res.error || 'Failed to reject employee account.');
        return;
      }

      const updated = res.updatedProfile;
      setLocalUsers((prev) =>
        prev.some((u) => u.id === updated.id || u.uid === updated.uid)
          ? prev.map((u) =>
              u.id === updated.id || u.uid === updated.uid ? updated : u
            )
          : [updated, ...prev]
      );
      setRejectionTarget(null);
      setRejectionReason('');
      setActionSuccessMsg(
        `Rejected access request for ${updated.email} (UID: ${updated.uid || updated.id}). Account status set to "rejected" with zero permissions.`
      );
      syncEmployeeDirectoryFromDatabases().catch(() => {});
      setTimeout(() => setActionSuccessMsg(null), 6000);
    } catch (err: any) {
      setActionErrorMsg(err?.message || 'Unexpected error while persisting rejection.');
    } finally {
      setIsSubmittingRejection(false);
    }
  };

  const pendingQueueCount = displayedUsers.filter(
    (u) =>
      u.accountStatus === 'pending_approval' || u.accountStatus === 'pending_invitation'
  ).length;
  const rejectedQueueCount = displayedUsers.filter(
    (u) => u.accountStatus === 'rejected'
  ).length;

  const filteredQueueUsers = (canViewDirectory ? displayedUsers : [currentUser])
    .filter((u) => {
      if (queueStatusFilter === 'pending') {
        return (
          u.accountStatus === 'pending_approval' ||
          u.accountStatus === 'pending_invitation'
        );
      }
      if (queueStatusFilter === 'rejected') return u.accountStatus === 'rejected';
      if (queueStatusFilter === 'active') return u.accountStatus === 'active';
      if (queueStatusFilter === 'deactivated') return u.accountStatus === 'deactivated';
      return true;
    })
    .filter((u) => {
      if (!queueSearch.trim()) return true;
      const q = queueSearch.trim().toLowerCase();
      return (
        (u.name || '').toLowerCase().includes(q) ||
        (u.displayName || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.id || '').toLowerCase().includes(q) ||
        (u.uid || '').toLowerCase().includes(q) ||
        (u.department || '').toLowerCase().includes(q) ||
        (u.requestedDepartment || '').toLowerCase().includes(q) ||
        (u.role || '').toLowerCase().includes(q) ||
        (u.requestedRole || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const order: Record<string, number> = {
        pending_approval: 0,
        pending_invitation: 1,
        rejected: 2,
        active: 3,
        deactivated: 4,
      };
      return (order[a.accountStatus] ?? 5) - (order[b.accountStatus] ?? 5);
    });

  const appendSessionAuditPreview = (
    action: string,
    targetUid: string,
    summary: string
  ) => {
    const entry = {
      id: `AUD-EMP-${Date.now().toString().slice(-6)}`,
      timestamp: new Date().toISOString(),
      collectionName: 'users',
      documentId: targetUid,
      action,
      actorUid: currentUser.id,
      userId: currentUser.id,
      userName: `${currentUser.name} (${currentUser.email})`,
      targetUid,
      outcome: 'SUCCESS' as const,
      newValueSummary: summary,
    };
    setAuditLogs((prev) => [entry, ...prev]);
  };

  const handleToggleAccountStatus = async (user: UserProfile, e: React.MouseEvent) => {
    e.stopPropagation();
    if (pendingUserActionId) return;
    setActionErrorMsg(null);

    if (!isAdmin) {
      setActionErrorMsg(
        'RBAC Policy: Only an active Super Administrator (super_admin) or Higher Authority (ceo) can activate or deactivate employee accounts.'
      );
      return;
    }
    const targetIsSuperAdmin =
      user.role === 'super_admin' || user.legacyRole === 'super_admin';
    if (!isSuperAdmin && targetIsSuperAdmin) {
      setActionErrorMsg(
        '3-Tier Authority Guard: Higher Authority (CEO/Management) cannot modify, deactivate, or reactivate a Super Administrator account.'
      );
      return;
    }
    if (user.id === currentUser.id && user.accountStatus === 'active') {
      setActionErrorMsg(
        'Self-Lockout Guard: You cannot deactivate your own active account.'
      );
      return;
    }

    const activeSuperAdmins = displayedUsers.filter(
      (u) =>
        u.accountStatus === 'active' &&
        (u.role === 'super_admin' || u.legacyRole === 'super_admin')
    ).length;
    if (
      user.accountStatus === 'active' &&
      targetIsSuperAdmin &&
      activeSuperAdmins <= 1
    ) {
      setActionErrorMsg(
        'Last Super Admin Guard: Cannot deactivate the last active Super Administrator account.'
      );
      return;
    }

    const newStatus: UserProfile['accountStatus'] =
      user.accountStatus === 'active' ? 'deactivated' : 'active';
    const roleGroup = user.rbacGroup || mapRoleToRbacGroup(user.role);

    setPendingUserActionId(user.id);
    try {
      const apiRes =
        newStatus === 'deactivated'
          ? await adminDeactivateEmployeeViaApi(
              user.id,
              'Deactivated via Super Admin Directory'
            )
          : await adminReactivateEmployeeViaApi(user.id);

      if (apiRes.success && apiRes.data?.employee) {
        const updatedEmp = apiRes.data.employee;
        const updateFn = (prev: UserProfile[]) =>
          prev.map((u) => (u.id === user.id ? { ...u, ...updatedEmp } : u));
        setLocalUsers(updateFn);
        setUsersList(updateFn);
        setActionSuccessMsg(apiRes.message);
        setTimeout(() => setActionSuccessMsg(null), 5000);
        return;
      }

      // If authenticated and backend returned an explicit business/auth error (401/403/409), surface it directly
      if (!apiRes.isUnauthenticatedPreview && apiRes.status < 500) {
        setActionErrorMsg(`Admin API (${apiRes.code}): ${apiRes.message}`);
        return;
      }

      // Fallback for unauthenticated preview mode or when Admin SDK service account is not mounted in preview
      const nowIso = new Date().toISOString();
      const updatedToggleUser: UserProfile = {
        ...user,
        accountStatus: newStatus,
        status: newStatus === 'deactivated' ? 'Inactive' : 'Active',
        disabledAt: newStatus === 'deactivated' ? nowIso : undefined,
        deactivatedBy: newStatus === 'deactivated' ? currentUser.id : undefined,
        deactivationReason:
          newStatus === 'deactivated' ? 'Deactivated via Super Admin Directory' : undefined,
        approvedByUid:
          newStatus === 'active' ? user.approvedByUid || currentUser.id : user.approvedByUid,
        approvedByEmail:
          newStatus === 'active' ? user.approvedByEmail || currentUser.email : user.approvedByEmail,
        approvedByName:
          newStatus === 'active' ? user.approvedByName || currentUser.name : user.approvedByName,
        approvedAt: newStatus === 'active' ? user.approvedAt || nowIso : user.approvedAt,
        updatedAt: nowIso,
      };

      let fsToggleOk = false;
      if (isFirestoreConfigured) {
        await firestoreService.syncOwnActiveProfileToFirestore(currentUser).catch(() => false);
        const fsRes = await firestoreService.adminUpsertEmployeeProfileToFirestore(
          user.id,
          mapUserProfileToFirestoreDoc(updatedToggleUser),
          {
            auditAction:
              newStatus === 'deactivated' ? 'EMPLOYEE_DEACTIVATED' : 'EMPLOYEE_REACTIVATED',
            auditDetails: `${newStatus === 'deactivated' ? 'Deactivated' : 'Reactivated'} ${user.email} (${user.id}).`,
          }
        );
        fsToggleOk = fsRes.success;
      }

      const rtdbRes = await adminUpdateEmployeeProfileInRtdb(
        updatedToggleUser,
        roleGroup,
        newStatus,
        undefined,
        currentUser
      );
      if (!rtdbRes.success && !fsToggleOk) {
        setActionErrorMsg(
          `Update Error: ${rtdbRes.error || apiRes.message}`
        );
        return;
      }

      const updateFn = (prev: UserProfile[]) =>
        prev.map((u) => (u.id === user.id ? updatedToggleUser : u));

      setLocalUsers(updateFn);
      setUsersList(updateFn);
      appendSessionAuditPreview(
        newStatus === 'deactivated' ? 'EMPLOYEE_DEACTIVATED' : 'EMPLOYEE_REACTIVATED',
        user.id,
        `${newStatus === 'deactivated' ? 'Deactivated' : 'Reactivated'} ${user.email} (${user.id}).`
      );

      const persistedAnywhere = rtdbRes.persistedToRtdb || fsToggleOk;
      const msg =
        newStatus === 'deactivated'
          ? persistedAnywhere
            ? `Saved to Firebase (/users/${user.id}): Account ${user.email} deactivated.`
            : `[Preview Session Mode] Account ${user.email} deactivated in session state.`
          : persistedAnywhere
          ? `Saved to Firebase (/users/${user.id}): Account ${user.email} reactivated with role=${user.role}.`
          : `[Preview Session Mode] Account ${user.email} reactivated with role=${user.role} in session state.`;
      setActionSuccessMsg(msg);
      setTimeout(() => setActionSuccessMsg(null), 5000);
    } finally {
      setPendingUserActionId(null);
    }
  };

  const handleChangeEmployeeRole = async (
    user: UserProfile,
    newRole: UserRole,
    e?: React.ChangeEvent<HTMLSelectElement> | React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    if (pendingUserActionId || (newRole === user.role && user.accountStatus === 'active')) return;
    setActionErrorMsg(null);

    if (!isAdmin) {
      setActionErrorMsg(
        'RBAC Policy: Only an active Super Administrator or Higher Authority (CEO) can change employee roles.'
      );
      return;
    }

    const actorCanonicalRole: UserRole = isSuperAdmin ? 'super_admin' : 'ceo';
    const targetCurrentRole =
      user.role === 'super_admin' || user.legacyRole === 'super_admin'
        ? 'super_admin'
        : user.role;

    const roleCheck = canActorManageTargetRole({
      actorRole: actorCanonicalRole,
      actorStatus: currentUser.accountStatus,
      targetCurrentRole,
      targetNewRole: newRole,
    });
    if (!roleCheck.allowed) {
      setActionErrorMsg(
        roleCheck.reason ||
          '3-Tier Authority Guard: Higher Authority (CEO) can promote employees up to Higher Authority (ceo) and manage department roles, but cannot assign or modify Super Administrator (super_admin).'
      );
      return;
    }

    if (user.id === currentUser.id && isSuperAdmin && newRole !== 'super_admin') {
      setActionErrorMsg(
        'Self-Lockout Guard: You cannot demote your own Super Administrator role.'
      );
      return;
    }

    const newGroup = mapRoleToRbacGroup(newRole);
    const newDesignation = ROLE_DISPLAY_LABELS[newRole];
    const isHigherAuthorityPromotion = newRole === 'ceo' && user.role !== 'ceo';

    setPendingUserActionId(user.id);
    try {
      const apiRes = await adminUpdateEmployeeRoleViaApi(user.id, {
        role: newRole,
        department: user.department,
        designation: newDesignation,
      });

      if (apiRes.success && apiRes.data?.employee) {
        const updatedEmp = apiRes.data.employee;
        const updateFn = (prev: UserProfile[]) =>
          prev.map((u) => (u.id === user.id ? { ...u, ...updatedEmp } : u));
        setLocalUsers(updateFn);
        setUsersList(updateFn);
        setActionSuccessMsg(apiRes.message);
        setTimeout(() => setActionSuccessMsg(null), 5000);
        return;
      }

      if (!apiRes.isUnauthenticatedPreview && apiRes.status < 500) {
        setActionErrorMsg(`Admin API (${apiRes.code}): ${apiRes.message}`);
        return;
      }

      const nowIso = new Date().toISOString();
      const nextStatus: UserProfile['accountStatus'] =
        user.accountStatus === 'pending_approval' ||
        user.accountStatus === 'pending_invitation'
          ? 'active'
          : user.accountStatus;

      const updatedUser: UserProfile = {
        ...user,
        role: newRole,
        legacyRole: newRole,
        rbacGroup: newGroup,
        roleTitle: newDesignation,
        designation: newDesignation,
        accountStatus: nextStatus,
        status: nextStatus === 'active' ? 'Active' : user.status,
        approvedByUid: nextStatus === 'active' ? user.approvedByUid || currentUser.id : user.approvedByUid,
        approvedByEmail:
          nextStatus === 'active' ? user.approvedByEmail || currentUser.email : user.approvedByEmail,
        approvedByName:
          nextStatus === 'active' ? user.approvedByName || currentUser.name : user.approvedByName,
        approvedAt: nextStatus === 'active' ? user.approvedAt || nowIso : user.approvedAt,
        updatedAt: nowIso,
        permissions: ROLE_PERMISSION_DEFAULTS[newRole],
      };

      if (isFirestoreConfigured) {
        await firestoreService.syncOwnActiveProfileToFirestore(currentUser).catch(() => false);
        await firestoreService.adminUpsertEmployeeProfileToFirestore(
          user.id,
          mapUserProfileToFirestoreDoc(updatedUser),
          {
            auditAction: isHigherAuthorityPromotion
              ? 'HIGHER_AUTHORITY_PROMOTED'
              : 'EMPLOYEE_ROLE_UPDATED',
            auditDetails: `Updated role for ${user.email} (${user.id}) to ${newRole}.`,
          }
        );
      }

      await adminUpdateEmployeeProfileInRtdb(
        updatedUser,
        newGroup,
        nextStatus === 'active' ? 'active' : 'deactivated',
        undefined,
        currentUser
      );

      const updateFn = (prev: UserProfile[]) =>
        prev.map((u) => (u.id === user.id ? updatedUser : u));
      setLocalUsers(updateFn);
      setUsersList(updateFn);
      appendSessionAuditPreview(
        isHigherAuthorityPromotion
          ? 'HIGHER_AUTHORITY_PROMOTED'
          : 'EMPLOYEE_ROLE_UPDATED',
        user.id,
        isHigherAuthorityPromotion
          ? `Promoted ${user.email} from "${user.role}" to Higher Authority "ceo" (${newGroup}) by ${currentUser.email} (${actorCanonicalRole}).`
          : `Updated role for ${user.email} from "${user.role}" to "${newRole}" (${newGroup}).`
      );
      setActionSuccessMsg(
        isHigherAuthorityPromotion
          ? `Promoted ${user.email} to Higher Authority (CEO / Management) with full operational authority.`
          : `Updated ${user.email} to canonical role "${newRole}" (${newGroup}).`
      );
      setTimeout(() => setActionSuccessMsg(null), 5000);
    } finally {
      setPendingUserActionId(null);
    }
  };

  const handlePasswordReset = async (user: UserProfile, e: React.MouseEvent) => {
    e.stopPropagation();
    if (pendingUserActionId) return;
    setActionErrorMsg(null);

    if (!isAdmin) {
      setActionErrorMsg(
        'RBAC Policy: Only an active Super Administrator or Higher Authority (CEO) can initiate employee password resets.'
      );
      return;
    }

    if (
      !isSuperAdmin &&
      (user.role === 'super_admin' || user.legacyRole === 'super_admin')
    ) {
      setActionErrorMsg(
        '3-Tier Authority Guard: Higher Authority (CEO) cannot initiate password resets for a Super Administrator account.'
      );
      return;
    }

    if (user.accountStatus === 'deactivated') {
      setActionErrorMsg(
        `Cannot initiate password reset for deactivated account ${user.email}.`
      );
      return;
    }

    setPendingUserActionId(user.id);
    try {
      const apiRes = await adminInitiatePasswordResetViaApi(user.id);
      if (apiRes.success) {
        setActionSuccessMsg(apiRes.message);
        setTimeout(() => setActionSuccessMsg(null), 5000);
        return;
      }

      if (!apiRes.isUnauthenticatedPreview && apiRes.status < 500) {
        setActionErrorMsg(`Admin API (${apiRes.code}): ${apiRes.message}`);
        return;
      }

      appendSessionAuditPreview(
        'EMPLOYEE_PASSWORD_RESET_INITIATED',
        user.id,
        `Initiated password reset flow for ${user.email} (${user.id}).`
      );
      setActionSuccessMsg(
        `Password reset flow initiated for ${user.email} (no plaintext passwords generated or logged).`
      );
      setTimeout(() => setActionSuccessMsg(null), 5000);
    } finally {
      setPendingUserActionId(null);
    }
  };

  const handleInviteEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingInvite) return;
    setActionErrorMsg(null);

    if (!isAdmin) {
      setActionErrorMsg(
        'RBAC Policy: Only an active Super Administrator or Higher Authority (CEO) can provision employee accounts and assign roles.'
      );
      return;
    }
    if (!isSuperAdmin && newEmployeeRole === 'super_admin') {
      setActionErrorMsg(
        '3-Tier Authority Guard: Higher Authority (CEO) cannot create or assign a Super Administrator (super_admin) account.'
      );
      return;
    }
    if (!newEmployeeName.trim() || !newEmployeeEmail.trim()) return;

    const cleanEmail = newEmployeeEmail.trim().toLowerCase();
    const cleanName = newEmployeeName.trim();
    const rbacGroup = mapRoleToRbacGroup(newEmployeeRole);
    const designation =
      newEmployeeDesignation.trim() || ROLE_DISPLAY_LABELS[newEmployeeRole];

    setIsSubmittingInvite(true);
    try {
      const apiRes = await adminCreateEmployeeViaApi({
        email: cleanEmail,
        displayName: cleanName,
        role: newEmployeeRole,
        department: newEmployeeDept.trim() || 'Operations',
        designation,
      });

      if (apiRes.success && apiRes.data?.employee) {
        const createdEmp = apiRes.data.employee;
        setLocalUsers((prev) => [
          createdEmp,
          ...prev.filter((u) => u.id !== createdEmp.id),
        ]);
        setUsersList((prev) => [
          createdEmp,
          ...prev.filter((u) => u.id !== createdEmp.id),
        ]);
        setShowInviteModal(false);
        setActionSuccessMsg(apiRes.message);
        setTimeout(() => setActionSuccessMsg(null), 5000);
        setNewEmployeeName('');
        setNewEmployeeEmail('');
        return;
      }

      // If backend returned a validation/duplicate/partial-failure error (400/401/403/409/502), surface it directly
      if (!apiRes.isUnauthenticatedPreview && apiRes.status !== 503) {
        setActionErrorMsg(`Admin API (${apiRes.code}): ${apiRes.message}`);
        return;
      }

      // Preview session fallback when not signed in to live Firebase Auth
      if (
        displayedUsers.some(
          (u) => u.email.trim().toLowerCase() === cleanEmail
        )
      ) {
        setActionErrorMsg(
          `Duplicate Employee Email: An account with email "${cleanEmail}" already exists in the directory.`
        );
        return;
      }

      const initials = cleanName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);

      const uid = `uid-emp-${Date.now().toString().slice(-4)}`;
      const nowIso = new Date().toISOString();

      const newUser: UserProfile = {
        id: uid,
        uid,
        name: cleanName,
        displayName: cleanName,
        email: cleanEmail,
        role: newEmployeeRole,
        legacyRole: newEmployeeRole,
        rbacGroup,
        roleTitle: designation,
        designation,
        department: newEmployeeDept.trim() || 'Operations',
        avatarInitials: initials || 'EM',
        accountStatus: 'active',
        mustChangePassword: true,
        invitedBy: currentUser.name,
        provisionedBy: currentUser.id,
        provisionedAt: nowIso,
        createdAt: nowIso.split('T')[0],
        updatedAt: nowIso,
        permissions: ROLE_PERMISSION_DEFAULTS[newEmployeeRole],
      };

      const rtdbRes = await adminUpdateEmployeeProfileInRtdb(
        newUser,
        rbacGroup,
        'active'
      );
      if (!rtdbRes.success) {
        setActionErrorMsg(
          `Provisioning Error: ${rtdbRes.error || 'Failed to provision employee profile'}`
        );
        return;
      }

      setLocalUsers((prev) => [newUser, ...prev]);
      setUsersList((prev) =>
        prev.some((u) => u.id === newUser.id) ? prev : [newUser, ...prev]
      );
      appendSessionAuditPreview(
        'EMPLOYEE_PROVISIONED',
        uid,
        `Provisioned employee ${cleanName} (${cleanEmail}) with canonical role="${newEmployeeRole}" (${rbacGroup}).`
      );
      setShowInviteModal(false);
      setActionSuccessMsg(
        rtdbRes.persistedToRtdb
          ? `Provisioned ${cleanEmail} with canonical role="${newEmployeeRole}" (${rbacGroup}) and accountStatus="active".`
          : `[Preview Session Mode — Sign in as Super Admin for live Admin SDK provisioning] Provisioned ${cleanEmail} with canonical role="${newEmployeeRole}" (${rbacGroup}).`
      );
      setTimeout(() => setActionSuccessMsg(null), 5000);

      setNewEmployeeName('');
      setNewEmployeeEmail('');
    } finally {
      setIsSubmittingInvite(false);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-slate-500 mb-1">
            <span>Administration & Governance</span>
            <span aria-hidden="true">·</span>
            <span>Access Control, Audit Trail & System Diagnostics</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
            Employee Accounts, RBAC & System Administration
          </h1>
          <p className="text-slate-500 mt-0.5">
            Admin-only employee provisioning, non-enumerable `/users` directory protection, immutable audit logs, and system diagnostics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && onOpenFirebaseConsole && (
            <button
              onClick={() => onOpenFirebaseConsole('diagnostics')}
              className="px-3 py-2 bg-white border border-slate-300 text-slate-800 rounded-md font-semibold hover:bg-slate-50 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Database className="w-3.5 h-3.5 text-emerald-600" />
              <span>Database Diagnostics & Seed Tools</span>
            </button>
          )}
          <button
            onClick={() => setShowInviteModal(true)}
            disabled={!isAdmin}
            className="px-3.5 py-2 bg-slate-900 text-white rounded-md font-semibold hover:bg-slate-800 transition-colors flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Provision / Approve Employee (Admin Only)</span>
          </button>
        </div>
      </div>

      {actionSuccessMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-md flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-medium">{actionSuccessMsg}</span>
        </div>
      )}

      {actionErrorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-900 rounded-md flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <span className="font-medium">{actionErrorMsg}</span>
        </div>
      )}

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {[
          {
            id: 'approval_queue',
            label: `Employee Approval Queue (${pendingQueueCount} Pending${
              rejectedQueueCount > 0 ? ` · ${rejectedQueueCount} Rejected` : ''
            })`,
            icon: ShieldCheck,
          },
          {
            id: 'directory',
            label: `Employee Directory & RBAC Matrix (${displayedUsers.length})`,
            icon: Users,
          },
          {
            id: 'audit_logs',
            label: `Security Audit Trail (${auditLogs.length})`,
            icon: FileSearch,
          },
          ...(isAdmin
            ? [
                {
                  id: 'diagnostics',
                  label: 'System Diagnostics, Seed & RTDB Architecture (Admin Only)',
                  icon: Terminal,
                },
              ]
            : []),
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`flex items-center gap-1.5 py-2.5 px-3.5 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                active
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.id === 'approval_queue' && pendingQueueCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 font-mono font-bold text-[10px]">
                  {pendingQueueCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* SUB-TAB 0: DEDICATED EMPLOYEE APPROVAL QUEUE */}
      {activeSubTab === 'approval_queue' && (
        <div className="space-y-5">
          {!isAdmin ? (
            <div className="bg-white rounded-lg border-2 border-rose-200 p-6 space-y-2">
              <div className="flex items-center gap-2 text-rose-700 font-bold text-sm">
                <ShieldAlert className="w-4 h-4" />
                <span>Employee Approval Queue Restricted to Authorized Administrators</span>
              </div>
              <p className="text-slate-600 leading-relaxed">
                Your current role (<code>{currentUser.role}</code>) is not authorized to approve or
                reject employee accounts. Only active <strong>Super Administrators</strong> (
                <code>super_admin</code>) and <strong>Higher Authority</strong> (<code>ceo</code>)
                can review and approve pending employee accounts.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-xs">
              {/* Queue Header & Controls */}
              <div className="p-5 bg-slate-50 border-b border-slate-200 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-[#14283F] text-[#F28C28] font-bold">
                        Canonical /users/&#123;uid&#125; Governance
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        Approver: {currentUser.email} ({currentUser.role})
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-slate-900 mt-1">
                      Employee Approval Queue &amp; Access Request Review
                    </h2>
                    <p className="text-slate-500">
                      Review pending employee registrations, verify requested department and role,
                      and persist <code>accountStatus = &quot;active&quot;</code> or{' '}
                      <code>&quot;rejected&quot;</code> to Cloud Firestore and Realtime Database.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={syncEmployeeDirectoryFromDatabases}
                      disabled={syncingQueue}
                      className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 rounded font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncingQueue ? 'animate-spin' : ''}`} />
                      <span>{syncingQueue ? 'Syncing /users...' : 'Sync Queue from Database'}</span>
                    </button>
                  </div>
                </div>

                {/* Search & Status Filters */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <div className="relative flex-1 max-w-md">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={queueSearch}
                      onChange={(e) => setQueueSearch(e.target.value)}
                      placeholder="Search by employee name, email, Firebase UID, role, or department..."
                      className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {[
                      { id: 'all', label: `All (${displayedUsers.length})` },
                      { id: 'pending', label: `Pending Approval (${pendingQueueCount})` },
                      { id: 'rejected', label: `Rejected (${rejectedQueueCount})` },
                      {
                        id: 'active',
                        label: `Active (${
                          displayedUsers.filter((u) => u.accountStatus === 'active').length
                        })`,
                      },
                      {
                        id: 'deactivated',
                        label: `Deactivated (${
                          displayedUsers.filter((u) => u.accountStatus === 'deactivated').length
                        })`,
                      },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setQueueStatusFilter(f.id as any)}
                        className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                          queueStatusFilter === f.id
                            ? 'bg-[#14283F] text-white'
                            : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Queue Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 border-b border-slate-200 uppercase font-semibold text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Employee &amp; Authenticated Email</th>
                      <th className="py-3 px-4">Canonical Firebase UID</th>
                      <th className="py-3 px-4">Requested / Assigned Dept &amp; Role</th>
                      <th className="py-3 px-4">Account Status &amp; Active Access</th>
                      <th className="py-3 px-4">Request Date &amp; Review History</th>
                      <th className="py-3 px-4 text-right">Approval Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredQueueUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500">
                          No employee records match the current filter criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredQueueUsers.map((emp) => {
                        const empUid = emp.uid || emp.id;
                        const isSelf = empUid === currentUser.id || empUid === currentUser.uid;
                        const isPending =
                          emp.accountStatus === 'pending_approval' ||
                          emp.accountStatus === 'pending_invitation';
                        const isRejected = emp.accountStatus === 'rejected';
                        const isActive = emp.accountStatus === 'active';
                        const isDeactivated = emp.accountStatus === 'deactivated';
                        const targetIsSuperAdmin =
                          emp.role === 'super_admin' || emp.legacyRole === 'super_admin';
                        const blockedByTier = !isSuperAdmin && targetIsSuperAdmin;

                        return (
                          <tr
                            key={empUid}
                            className={
                              isPending
                                ? 'bg-amber-50/40 hover:bg-amber-50/70'
                                : isRejected
                                ? 'bg-rose-50/30 hover:bg-rose-50/50'
                                : 'hover:bg-slate-50/80'
                            }
                          >
                            <td className="py-3.5 px-4">
                              <div className="font-bold text-slate-900">
                                {emp.displayName || emp.name || 'Unnamed Employee'}
                                {isSelf && (
                                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-white font-mono">
                                    YOU
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-[11px] text-slate-600 mt-0.5">
                                {emp.email}
                              </div>
                            </td>

                            <td className="py-3.5 px-4 font-mono text-[11px] text-slate-700">
                              <code className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200">
                                {empUid}
                              </code>
                            </td>

                            <td className="py-3.5 px-4">
                              {isActive ? (
                                <div>
                                  <span className="font-mono font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                                    {emp.role}
                                  </span>
                                  <span className="text-slate-500 ml-1.5">
                                    ({emp.rbacGroup || mapRoleToRbacGroup(emp.role)})
                                  </span>
                                  <div className="text-[11px] text-slate-600 mt-0.5">
                                    Dept: <strong>{emp.department}</strong>
                                    {emp.isDepartmentHead ? ' · ★ Dept Head' : ''}
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <div className="text-[11px] text-amber-900">
                                    Requested Role:{' '}
                                    <strong className="font-mono">
                                      {(emp.requestedRole || emp.role || 'sales').toUpperCase()}
                                    </strong>
                                  </div>
                                  <div className="text-[11px] text-slate-600">
                                    Requested Dept:{' '}
                                    <strong>
                                      {emp.requestedDepartment || emp.department || 'Operations'}
                                    </strong>
                                  </div>
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4">
                              {isPending && (
                                <div className="space-y-1">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-mono font-bold text-[10px] uppercase">
                                    <Clock className="w-3 h-3" />
                                    {emp.accountStatus}
                                  </span>
                                  <div className="text-[10px] font-mono text-rose-700 font-semibold">
                                    Active Role: NONE (Blocked)
                                  </div>
                                </div>
                              )}
                              {isRejected && (
                                <div className="space-y-1">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 text-rose-900 font-mono font-bold text-[10px] uppercase">
                                    <XCircle className="w-3 h-3" />
                                    REJECTED
                                  </span>
                                  <div className="text-[10px] font-mono text-rose-700 font-semibold">
                                    Active Role: NONE (Blocked)
                                  </div>
                                </div>
                              )}
                              {isActive && (
                                <div className="space-y-1">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-mono font-bold text-[10px] uppercase">
                                    <CheckCircle2 className="w-3 h-3" />
                                    ACTIVE
                                  </span>
                                  <div className="text-[10px] font-mono text-emerald-700">
                                    Authorized: {emp.role}
                                  </div>
                                </div>
                              )}
                              {isDeactivated && (
                                <div className="space-y-1">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-mono font-bold text-[10px] uppercase">
                                    DEACTIVATED
                                  </span>
                                  <div className="text-[10px] font-mono text-rose-700">
                                    Active Role: NONE
                                  </div>
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-[11px] text-slate-600">
                              <div className="font-mono">
                                Created: {emp.createdAt || '—'}
                              </div>
                              {emp.approvedAt && (
                                <div className="text-[10px] text-emerald-700 font-mono mt-0.5">
                                  Approved by {emp.approvedByEmail || emp.approvedByName || 'Admin'}{' '}
                                  on {String(emp.approvedAt).slice(0, 10)}
                                </div>
                              )}
                              {emp.rejectedAt && (
                                <div className="text-[10px] text-rose-700 font-mono mt-0.5">
                                  Rejected by {emp.rejectedByEmail || emp.rejectedByName || 'Admin'}:{' '}
                                  &ldquo;{emp.rejectionReason || 'No reason'}&rdquo;
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-right">
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                {(isPending || isRejected || isDeactivated) && (
                                  <button
                                    type="button"
                                    disabled={isSelf || blockedByTier}
                                    onClick={(e) => openApproveModal(emp, e)}
                                    title={
                                      isSelf
                                        ? 'Self-Approval Guard: You cannot approve your own account'
                                        : 'Approve employee and assign canonical role & department'
                                    }
                                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer disabled:opacity-40"
                                  >
                                    <Check className="w-3 h-3" />
                                    <span>
                                      {isRejected
                                        ? 'Reconsider & Approve'
                                        : isDeactivated
                                        ? 'Reactivate & Approve'
                                        : 'Approve'}
                                    </span>
                                  </button>
                                )}

                                {(isPending || isActive) && !isSelf && !blockedByTier && (
                                  <button
                                    type="button"
                                    onClick={(e) => openRejectModal(emp, e)}
                                    className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <XCircle className="w-3 h-3" />
                                    <span>Reject</span>
                                  </button>
                                )}

                                {isActive && !isSelf && !blockedByTier && (
                                  <button
                                    type="button"
                                    onClick={(e) => openApproveModal(emp, e)}
                                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded font-semibold text-[11px] cursor-pointer"
                                  >
                                    Change Role / Dept
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 1: DIRECTORY & RBAC MATRIX */}
      {activeSubTab === 'directory' && (
        <div className="space-y-6">
          {/* 3-Tier Authority & Access Control Callout */}
          <div className="p-4 bg-[#14283F] text-slate-200 rounded-lg border-l-4 border-[#F28C28] flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
            <div className="space-y-1">
              <div className="font-bold text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#F28C28]" />
                <span>3-Tier Enterprise Authority Hierarchy &amp; Peer Promotion Governance</span>
              </div>
              <p className="text-slate-300 leading-relaxed">
                <strong>Tier 1 — Super Admin (<code>super_admin</code>):</strong> Full system &amp; authority control.{' '}
                <strong>Tier 2 — Higher Authority (<code>ceo</code> / Management):</strong> Full operational access across all business modules; can provision/manage department employees and promote eligible users to Higher Authority (<code>ceo</code>) without Super Admin intervention, but is strictly blocked from creating or modifying <code>super_admin</code> accounts.{' '}
                <strong>Tier 3 — Department Roles:</strong> Scoped to assigned operational registers.
              </p>
            </div>
            <div className="shrink-0 font-mono text-[11px] bg-slate-800 px-3 py-1.5 rounded border border-slate-700 text-[#F28C28]">
              Authority: {currentUser.role} ({activeRbacGroup})
            </div>
          </div>

          {/* Employee Accounts Grid */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  {canViewDirectory
                    ? `Employee & Authority Directory (/users — ${displayedUsers.length} Profiles)`
                    : `Own Profile View (/users/${currentUser.id} — Directory Enumeration Restricted)`}
                </h2>
                <p className="text-slate-500">
                  {canViewDirectory
                    ? 'Super Admin & Higher Authority (CEO) can manage employee roles, approve access requests, and promote eligible users to Higher Authority (CEO).'
                    : `Role "${activeRbacGroup}" is blocked from enumerating /users and can only read /users/$uid for their own account.`}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(canViewDirectory ? displayedUsers : [currentUser]).map((user) => {
                const isCurrent = user.id === currentUser.id;
                const isDeactivated = user.accountStatus === 'deactivated';
                return (
                  <div
                    key={user.id}
                    onClick={() => onSelectUserRole(user)}
                    className={`p-3.5 rounded-lg border text-left cursor-pointer transition-all ${
                      isCurrent
                        ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                        : isDeactivated
                        ? 'border-rose-200 bg-rose-50/30 text-slate-800 opacity-75'
                        : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-white text-slate-900'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className={`w-7 h-7 rounded flex items-center justify-center font-mono font-bold text-xs ${
                          isCurrent
                            ? 'bg-white text-slate-900'
                            : isDeactivated
                            ? 'bg-rose-700 text-white'
                            : 'bg-slate-900 text-white'
                        }`}
                      >
                        {user.avatarInitials}
                      </span>

                      <div className="flex items-center gap-1.5">
                        {user.accountStatus === 'active' && (
                          <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-mono font-semibold">
                            ACTIVE
                          </span>
                        )}
                        {user.accountStatus === 'deactivated' && (
                          <span className="text-[10px] bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded font-mono font-bold">
                            DEACTIVATED
                          </span>
                        )}
                        {(user.accountStatus === 'pending_invitation' ||
                          user.accountStatus === 'pending_approval') && (
                          <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-mono font-semibold">
                            {user.accountStatus.toUpperCase()}
                          </span>
                        )}
                        {user.accountStatus === 'rejected' && (
                          <span className="text-[10px] bg-rose-100 text-rose-800 px-1.5 py-0.5 rounded font-mono font-bold">
                            REJECTED
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="font-bold text-xs truncate">{user.name}</div>
                    <div
                      className={`text-[11px] truncate ${
                        isCurrent ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {user.roleTitle} · {user.department}
                    </div>
                    <div className="text-[10px] mt-1 font-mono text-slate-400">
                      {user.email} · UID: {user.uid || user.id}
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-slate-200/50 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[10px] font-mono ${
                            isCurrent ? 'text-slate-300' : 'text-slate-500'
                          }`}
                        >
                          {user.accountStatus === 'active'
                            ? `Active Role: ${user.role} (${
                                user.rbacGroup || mapRoleToRbacGroup(user.role)
                              })`
                            : `Active Role: NONE · Requested: ${(
                                user.requestedRole ||
                                user.role ||
                                'sales'
                              ).toUpperCase()}`}
                        </span>
                        {isAdmin &&
                          (user.accountStatus === 'pending_approval' ||
                            user.accountStatus === 'pending_invitation' ||
                            user.accountStatus === 'rejected') &&
                          user.id !== currentUser.id && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1"
                            >
                              <button
                                type="button"
                                onClick={(e) => openApproveModal(user, e)}
                                className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-500 font-semibold cursor-pointer"
                              >
                                Approve
                              </button>
                              {user.accountStatus !== 'rejected' && (
                                <button
                                  type="button"
                                  onClick={(e) => openRejectModal(user, e)}
                                  className="text-[10px] px-2 py-0.5 rounded bg-rose-600 text-white hover:bg-rose-500 font-semibold cursor-pointer"
                                >
                                  Reject
                                </button>
                              )}
                            </div>
                          )}
                        {isAdmin && (
                          <div className="flex items-center gap-1.5">
                            {!isDeactivated && (
                              <button
                                type="button"
                                disabled={pendingUserActionId === user.id}
                                onClick={(e) => handlePasswordReset(user, e)}
                                title="Initiate safe Firebase password reset flow"
                                className={`text-[10px] px-2 py-0.5 rounded font-medium inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50 ${
                                  isCurrent
                                    ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                                    : 'bg-slate-200 text-slate-800 hover:bg-slate-300'
                                }`}
                              >
                                <KeyRound className="w-2.5 h-2.5" />
                                <span>Reset Password</span>
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={pendingUserActionId === user.id}
                              onClick={(e) => handleToggleAccountStatus(user, e)}
                              className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                                isDeactivated
                                  ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                                  : 'bg-rose-100 text-rose-800 hover:bg-rose-200'
                              }`}
                            >
                              {pendingUserActionId === user.id ? (
                                <RefreshCw className="w-2.5 h-2.5 animate-spin inline" />
                              ) : isDeactivated ? (
                                'Reactivate'
                              ) : (
                                'Deactivate'
                              )}
                            </button>
                          </div>
                        )}
                      </div>

                      {isAdmin && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="space-y-2 pt-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <label
                              className={`text-[10px] font-mono ${
                                isCurrent ? 'text-slate-400' : 'text-slate-500'
                              }`}
                            >
                              Canonical Role:
                            </label>
                            <select
                              value={user.role}
                              disabled={
                                pendingUserActionId === user.id ||
                                (!isSuperAdmin &&
                                  (user.role === 'super_admin' ||
                                    user.legacyRole === 'super_admin'))
                              }
                              onChange={(e) =>
                                handleChangeEmployeeRole(
                                  user,
                                  e.target.value as UserRole,
                                  e
                                )
                              }
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border cursor-pointer disabled:opacity-50 ${
                                isCurrent
                                  ? 'bg-slate-800 border-slate-700 text-white'
                                  : 'bg-white border-slate-300 text-slate-800'
                              }`}
                            >
                              {ALL_USER_ROLES.map((r) => (
                                <option
                                  key={r}
                                  value={r}
                                  disabled={!isSuperAdmin && r === 'super_admin'}
                                >
                                  {r} ({mapRoleToRbacGroup(r)})
                                  {!isSuperAdmin && r === 'super_admin'
                                    ? ' — Super Admin Only'
                                    : ''}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Quick Peer Promotion to Higher Authority (CEO) for eligible non-super_admin users */}
                          {user.role !== 'super_admin' &&
                            user.legacyRole !== 'super_admin' &&
                            user.role !== 'ceo' &&
                            user.accountStatus !== 'deactivated' && (
                              <div className="grid grid-cols-2 gap-1.5">
                                <button
                                  type="button"
                                  disabled={pendingUserActionId === user.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const nextHead = !user.isDepartmentHead;
                                    const updated: UserProfile = {
                                      ...user,
                                      isDepartmentHead: nextHead,
                                      managedDepartment: nextHead ? user.department : undefined,
                                    };
                                    setLocalUsers((prev) =>
                                      prev.map((u) => (u.id === user.id ? updated : u))
                                    );
                                    setUsersList((prev) =>
                                      prev.map((u) => (u.id === user.id ? updated : u))
                                    );
                                    setActionSuccessMsg(
                                      `${user.name} (${user.role}) ${
                                        nextHead
                                          ? `designated as Department Head for ${user.department} (Maker≠Checker Verifier)`
                                          : 'removed from Department Head designation'
                                      }.`
                                    );
                                  }}
                                  className={`py-1 px-2 rounded font-semibold text-[10px] flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                                    user.isDepartmentHead
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-slate-200 hover:bg-slate-300 text-slate-800'
                                  }`}
                                >
                                  <span>
                                    {user.isDepartmentHead ? '★ Dept Head (Active)' : 'Set Dept Head'}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  disabled={pendingUserActionId === user.id}
                                  onClick={(e) => handleChangeEmployeeRole(user, 'ceo', e)}
                                  className="py-1 px-2 rounded bg-[#F28C28]/15 hover:bg-[#F28C28]/25 text-[#14283F] border border-[#F28C28]/40 font-semibold text-[10px] flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                                >
                                  <ShieldCheck className="w-3 h-3 text-[#F28C28]" />
                                  <span>Promote to CEO</span>
                                </button>
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detailed Module Permission Matrix */}
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="p-4 border-b">
              <h2 className="text-sm font-bold text-slate-900">
                Realtime Database RBAC Matrix (database.rules.json)
              </h2>
              <p className="text-slate-500">
                All operational, KPI, directory (<code>/users</code>), financial, and audit reads and all writes require{' '}
                <code>auth != null</code> AND{' '}
                <code>
                  root.child(&apos;users&apos;).child(auth.uid).child(&apos;accountStatus&apos;).val() === &apos;active&apos;
                </code>
                .
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b uppercase font-semibold text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">RTDB Path</th>
                    <th className="py-2.5 px-3">Admin</th>
                    <th className="py-2.5 px-3">Management</th>
                    <th className="py-2.5 px-3">Finance</th>
                    <th className="py-2.5 px-3">Sales</th>
                    <th className="py-2.5 px-3">Production</th>
                    <th className="py-2.5 px-3">Deactivated / Unassigned</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {[
                    {
                      path: '/ (Root)',
                      adm: 'DENIED',
                      mgmt: 'DENIED',
                      fin: 'DENIED',
                      sal: 'DENIED',
                      prd: 'DENIED',
                      deact: 'DENIED',
                    },
                    {
                      path: '/users (Directory)',
                      adm: 'READ',
                      mgmt: 'READ',
                      fin: 'DENIED',
                      sal: 'DENIED',
                      prd: 'DENIED',
                      deact: 'DENIED',
                    },
                    {
                      path: '/users/$uid',
                      adm: 'READ / WRITE',
                      mgmt: 'READ ALL',
                      fin: 'READ OWN',
                      sal: 'READ OWN',
                      prd: 'READ OWN',
                      deact: 'READ OWN ONLY',
                    },
                    {
                      path: '/dashboardKpis',
                      adm: 'READ / WRITE',
                      mgmt: 'READ / WRITE',
                      fin: 'READ ONLY',
                      sal: 'READ ONLY',
                      prd: 'READ ONLY',
                      deact: 'DENIED',
                    },
                    {
                      path: '/salesOrders/$orderId',
                      adm: 'READ / WRITE',
                      mgmt: 'READ / WRITE',
                      fin: 'READ ONLY',
                      sal: 'READ / WRITE',
                      prd: 'READ / STATUS',
                      deact: 'DENIED',
                    },
                    {
                      path: '/inventory/* & /quality/* & /dispatch/*',
                      adm: 'READ / WRITE',
                      mgmt: 'READ / WRITE',
                      fin: 'READ ONLY',
                      sal: 'READ ONLY',
                      prd: 'READ / WRITE',
                      deact: 'DENIED',
                    },
                    {
                      path: '/outstandingPayments/$customerId',
                      adm: 'READ / WRITE',
                      mgmt: 'READ ONLY',
                      fin: 'READ / WRITE',
                      sal: 'READ ONLY',
                      prd: 'DENIED',
                      deact: 'DENIED',
                    },
                    {
                      path: '/auditLogs/$logId',
                      adm: 'READ / APPEND',
                      mgmt: 'READ / APPEND',
                      fin: 'APPEND OWN UID',
                      sal: 'APPEND OWN UID',
                      prd: 'APPEND OWN UID',
                      deact: 'DENIED',
                    },
                  ].map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-3 font-bold text-slate-900">{row.path}</td>
                      <td className="py-2.5 px-3 text-emerald-700 font-semibold">{row.adm}</td>
                      <td className="py-2.5 px-3 text-slate-700">{row.mgmt}</td>
                      <td className="py-2.5 px-3 text-slate-700">{row.fin}</td>
                      <td className="py-2.5 px-3 text-slate-700">{row.sal}</td>
                      <td className="py-2.5 px-3 text-slate-700">{row.prd}</td>
                      <td className="py-2.5 px-3 text-rose-700 font-bold">{row.deact}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: IMMUTABLE SECURITY AUDIT LOGS */}
      {activeSubTab === 'audit_logs' && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900">
                Immutable Security & Operational Audit Trail (/auditLogs)
              </h3>
              <p className="text-slate-500">
                Append-only log enforced by <code>!data.exists()</code> and <code>actorUid === auth.uid</code> in <code>database.rules.json</code>. Export restricted to active Admin & Management roles.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-slate-600 mr-1">
                {auditLogs.length} Logged Events
              </span>
              <button
                onClick={() => {
                  const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
                    'Admin',
                    'Management',
                  ]);
                  if (!authCheck.allowed) {
                    setActionErrorMsg(authCheck.reason || 'Export restricted');
                    return;
                  }
                  exportMontexExcelWorkbook(
                    `Montex_Security_Audit_Trail_${new Date().toISOString().split('T')[0]}.xlsx`,
                    [
                      {
                        sheetName: 'Security_Audit_Trail',
                        reportTitle:
                          'MONTEX FORGE — IMMUTABLE SECURITY & OPERATIONAL AUDIT TRAIL (/auditLogs)',
                        reportSubtitle: `Total Events: ${auditLogs.length} | Exported by ${currentUser.name} (${activeRbacGroup})`,
                        headers: [
                          'Audit Entry ID',
                          'ISO Timestamp',
                          'Module / Collection',
                          'Action Code',
                          'Actor Name / Email',
                          'Actor UID',
                          'Target Document ID',
                          'Audit Details Summary',
                        ],
                        rows: auditLogs.map((log) => [
                          log.id,
                          log.timestamp,
                          log.collectionName,
                          log.action,
                          log.userName,
                          log.userId,
                          log.documentId,
                          log.newValueSummary,
                        ]),
                      },
                    ]
                  );
                  setActionSuccessMsg(
                    `Downloaded Security Audit Trail Excel workbook (${auditLogs.length} entries).`
                  );
                  setTimeout(() => setActionSuccessMsg(null), 4000);
                }}
                className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                <span>Export (.xlsx)</span>
              </button>
              <button
                onClick={() => {
                  const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
                    'Admin',
                    'Management',
                  ]);
                  if (!authCheck.allowed) {
                    setActionErrorMsg(authCheck.reason || 'Export restricted');
                    return;
                  }
                  setPreviewPayload({
                    filename: `Montex_Security_Audit_Trail_${new Date().toISOString().split('T')[0]}.pdf`,
                    documentCode: `AUD-LOG-${new Date().toISOString().split('T')[0].replace(/-/g, '')}`,
                    documentTitle: 'IMMUTABLE SECURITY & OPERATIONAL AUDIT TRAIL',
                    documentSubtitle:
                      'Governance & Access Control — Append-Only RTDB Security Audit Log (/auditLogs)',
                    readiness: 'ready',
                    readinessBannerText:
                      'READY TO GENERATE — Verified Append-Only Audit Log (/auditLogs)',
                    metadataGrid: [
                      { label: 'RTDB Path', value: '/auditLogs' },
                      { label: 'Total Logged Events', value: auditLogs.length },
                      { label: 'Export Authorized Role', value: activeRbacGroup },
                      { label: 'Exported By', value: `${currentUser.name} (${currentUser.email})` },
                    ],
                    tables: [
                      {
                        sectionTitle: 'Chronological Security & Operational Audit Entries',
                        headers: [
                          'Timestamp (ISO)',
                          'Module',
                          'Action',
                          'Actor & UID',
                          'Doc Ref',
                          'Audit Details',
                        ],
                        rows: auditLogs.map((log) => [
                          log.timestamp,
                          log.collectionName,
                          log.action,
                          `${log.userName} (${log.userId})`,
                          log.documentId,
                          log.newValueSummary,
                        ]),
                      },
                    ],
                    footerDisclaimer:
                      'CONFIDENTIAL GOVERNANCE AUDIT LOG — Restricted to Montex Forge Admin & Management.',
                    generatedBy: currentUser.name,
                    generatedRole: activeRbacGroup,
                  });
                }}
                className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-indigo-700" />
                <span>Audit PDF</span>
              </button>
              <button
                onClick={() => {
                  const authCheck = verifyExportPermission(currentUser, activeRbacGroup, [
                    'Admin',
                    'Management',
                  ]);
                  if (!authCheck.allowed) {
                    setActionErrorMsg(authCheck.reason || 'Export restricted');
                    return;
                  }
                  exportMontexCsvFile(
                    `Montex_Security_Audit_Trail_${new Date().toISOString().split('T')[0]}.csv`,
                    [
                      'Audit ID',
                      'Timestamp',
                      'Module',
                      'Action',
                      'Actor',
                      'Actor UID',
                      'Document ID',
                      'Summary',
                    ],
                    auditLogs.map((log) => [
                      log.id,
                      log.timestamp,
                      log.collectionName,
                      log.action,
                      log.userName,
                      log.userId,
                      log.documentId,
                      log.newValueSummary,
                    ])
                  );
                  setActionSuccessMsg(`Exported ${auditLogs.length} audit log entries to CSV.`);
                  setTimeout(() => setActionSuccessMsg(null), 4000);
                }}
                className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded font-semibold inline-flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-slate-600" />
                <span>CSV</span>
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-600 border-b uppercase font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-3.5">Timestamp (ISO)</th>
                  <th className="py-3 px-3.5">Module & Action</th>
                  <th className="py-3 px-3.5">Actor Email & Role</th>
                  <th className="py-3 px-3.5">Audit Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">
                      No audit entries recorded in current session or role does not have read access to /auditLogs.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log, i) => (
                    <tr key={log.id || i} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3.5 font-mono text-slate-600 text-[11px]">
                        {log.timestamp}
                      </td>
                      <td className="py-2.5 px-3.5">
                        <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                          {log.collectionName}
                        </span>
                        <div className="font-semibold text-slate-900 mt-0.5">{log.action}</div>
                      </td>
                      <td className="py-2.5 px-3.5">
                        <div className="font-mono text-slate-800">{log.userName}</div>
                        <div className="text-[10px] font-mono text-slate-500">
                          UID: {log.userId} · Doc: {log.documentId}
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 font-mono text-[11px] text-slate-700">
                        {log.newValueSummary}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: ADMIN-ONLY SYSTEM DIAGNOSTICS, SEED TOOLS & RTDB ARCHITECTURE */}
      {activeSubTab === 'diagnostics' && isAdmin && (
        <div className="space-y-6">
          <div className="bg-slate-900 text-slate-200 rounded-lg border border-slate-800 p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs font-bold">
                  <ShieldCheck className="w-4 h-4" />
                  <span>ADMIN-ONLY SYSTEM DIAGNOSTICS & FIREBASE CONSOLE</span>
                </div>
                <p className="text-slate-400 mt-1">
                  Technical Firebase connection telemetry, path-scoped database seeding, and security rule inspection have been isolated to this Admin-only workspace.
                </p>
              </div>
              {onOpenFirebaseConsole && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => onOpenFirebaseConsole('diagnostics')}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-semibold transition-colors cursor-pointer"
                  >
                    Open Read/Write Diagnostics & Seed Tool
                  </button>
                  <button
                    onClick={() => onOpenFirebaseConsole('rules')}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded font-semibold transition-colors cursor-pointer"
                  >
                    Inspect database.rules.json
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-xs">
              <div className="p-3 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block text-[10px]">FIREBASE PROJECT ID</span>
                <span className="text-white font-bold">montex-mis</span>
              </div>
              <div className="p-3 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block text-[10px]">REALTIME DATABASE INSTANCE</span>
                <span className="text-emerald-400 font-bold break-all">
                  https://montex-mis-default-rtdb.firebaseio.com/
                </span>
              </div>
              <div className="p-3 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-500 block text-[10px]">CONNECTION & DATA STATE</span>
                <span className="text-amber-300 font-bold">
                  Status: {isRtdbConnected ? 'connected' : 'standby'} · Mode: {dataSource}
                </span>
              </div>
            </div>
          </div>

          <BlueprintView />
        </div>
      )}

      {/* Provision / Approve Employee Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleInviteEmployee}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-md w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Provision Employee Account (Super Admin)
                </h3>
                <p className="text-slate-500">
                  Provisions a Firebase Authentication account + authoritative{' '}
                  <code>/users/&#123;uid&#125;</code> profile via the trusted backend API.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Joshi"
                  value={newEmployeeName}
                  onChange={(e) => setNewEmployeeName(e.target.value)}
                  className="w-full p-2 border rounded focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Corporate Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="name@montexforge.com"
                  value={newEmployeeEmail}
                  onChange={(e) => setNewEmployeeEmail(e.target.value)}
                  className="w-full p-2 border rounded font-mono focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Canonical Employee Role (8 Granular Roles)
                </label>
                <select
                  value={newEmployeeRole}
                  onChange={(e) => {
                    const role = e.target.value as UserRole;
                    setNewEmployeeRole(role);
                    setNewEmployeeDesignation(ROLE_DISPLAY_LABELS[role]);
                  }}
                  className="w-full p-2 border rounded bg-white font-mono"
                >
                  {assignableRoles.map((role) => (
                    <option key={role} value={role}>
                      {role} — {ROLE_DISPLAY_LABELS[role]} (RBAC: {mapRoleToRbacGroup(role)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Designation / Title
                  </label>
                  <input
                    type="text"
                    required
                    value={newEmployeeDesignation}
                    onChange={(e) => setNewEmployeeDesignation(e.target.value)}
                    className="w-full p-2 border rounded"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">Department</label>
                  <input
                    type="text"
                    required
                    value={newEmployeeDept}
                    onChange={(e) => setNewEmployeeDept(e.target.value)}
                    className="w-full p-2 border rounded"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                disabled={isSubmittingInvite}
                onClick={() => setShowInviteModal(false)}
                className="px-3 py-1.5 border rounded text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingInvite}
                className="px-3.5 py-1.5 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800 cursor-pointer disabled:opacity-50"
              >
                {isSubmittingInvite
                  ? 'Provisioning Employee...'
                  : 'Provision Employee Account'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirm Employee Approval Modal */}
      {approvalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleConfirmApproval}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-lg w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-700 font-bold">
                  Persistent Employee Approval · /users/{approvalTarget.uid || approvalTarget.id}
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">
                  Approve Employee Account &amp; Assign Canonical Role
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setApprovalTarget(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-3 rounded bg-slate-50 border border-slate-200 font-mono text-[11px] space-y-1">
              <div>
                <span className="text-slate-500">Employee:</span>{' '}
                <strong>{approvalTarget.displayName || approvalTarget.name}</strong> (
                {approvalTarget.email})
              </div>
              <div>
                <span className="text-slate-500">Firebase UID:</span>{' '}
                <strong>{approvalTarget.uid || approvalTarget.id}</strong>
              </div>
              <div>
                <span className="text-slate-500">Current Status:</span>{' '}
                <strong className="uppercase">{approvalTarget.accountStatus}</strong> ·{' '}
                <span className="text-slate-500">Requested:</span>{' '}
                <strong>
                  {(approvalTarget.requestedRole || approvalTarget.role || 'sales').toUpperCase()} (
                  {approvalTarget.requestedDepartment || approvalTarget.department})
                </strong>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Approved Canonical Role (8 Canonical Roles)
                </label>
                <select
                  value={approvalRole}
                  onChange={(e) => {
                    const nextRole = e.target.value as UserRole;
                    setApprovalRole(nextRole);
                    setApprovalDesignation(ROLE_DISPLAY_LABELS[nextRole]);
                  }}
                  className="w-full p-2 border rounded bg-white font-mono"
                >
                  {assignableRoles.map((role) => (
                    <option key={role} value={role}>
                      {role} — {ROLE_DISPLAY_LABELS[role]} (Group: {mapRoleToRbacGroup(role)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Assigned Department
                  </label>
                  <input
                    type="text"
                    required
                    value={approvalDept}
                    onChange={(e) => setApprovalDept(e.target.value)}
                    className="w-full p-2 border rounded"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Designation / Role Title
                  </label>
                  <input
                    type="text"
                    required
                    value={approvalDesignation}
                    onChange={(e) => setApprovalDesignation(e.target.value)}
                    className="w-full p-2 border rounded"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={approvalIsDeptHead}
                  onChange={(e) => setApprovalIsDeptHead(e.target.checked)}
                />
                <span className="font-medium text-slate-800">
                  Designate as Department Head (Maker ≠ Checker Supervisor Verifier for{' '}
                  {approvalDept})
                </span>
              </label>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Approval Audit Note (Optional)
                </label>
                <input
                  type="text"
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="e.g. Verified employee identity and department head authorization"
                  className="w-full p-2 border rounded"
                />
              </div>
            </div>

            {actionErrorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-900 rounded flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="font-medium break-words">{actionErrorMsg}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                disabled={isSubmittingApproval}
                onClick={() => setApprovalTarget(null)}
                className="px-3 py-1.5 border rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingApproval}
                className="px-4 py-1.5 bg-emerald-600 text-white rounded font-semibold hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
              >
                {isSubmittingApproval
                  ? 'Persisting Approval...'
                  : 'Confirm & Persist Approval'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirm Employee Rejection Modal */}
      {rejectionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form
            onSubmit={handleConfirmRejection}
            className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-md w-full p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-rose-700 font-bold">
                  Reject Access Request · /users/{rejectionTarget.uid || rejectionTarget.id}
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">
                  Reject Employee Account Request
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRejectionTarget(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-3 rounded bg-rose-50 border border-rose-200 font-mono text-[11px] space-y-1 text-rose-950">
              <div>
                Employee: <strong>{rejectionTarget.displayName || rejectionTarget.name}</strong> (
                {rejectionTarget.email})
              </div>
              <div>UID: {rejectionTarget.uid || rejectionTarget.id}</div>
            </div>

            <div>
              <label className="font-semibold text-slate-700 block mb-1">
                Rejection Reason (Required — Minimum 3 characters, persisted to Audit Trail)
              </label>
              <textarea
                required
                minLength={3}
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Provide the reason for rejecting this access request (at least 3 characters)..."
                className="w-full p-2 border rounded"
              />
            </div>

            {actionErrorMsg && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-900 rounded flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span className="font-medium break-words">{actionErrorMsg}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t">
              <button
                type="button"
                disabled={isSubmittingRejection}
                onClick={() => setRejectionTarget(null)}
                className="px-3 py-1.5 border rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingRejection || rejectionReason.trim().length < 3}
                className="px-4 py-1.5 bg-rose-600 text-white rounded font-semibold hover:bg-rose-700 cursor-pointer disabled:opacity-50"
              >
                {isSubmittingRejection ? 'Persisting Rejection...' : 'Confirm Rejection'}
              </button>
            </div>
          </form>
        </div>
      )}

      <DocumentPreviewModal
        payload={previewPayload}
        onClose={() => setPreviewPayload(null)}
      />
    </div>
  );
};
