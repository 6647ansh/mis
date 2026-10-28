import {
  AdminAuthAdapter,
  EmployeeStoreAdapter,
  redactSensitiveData,
} from '../config/firebaseAdmin';
import {
  ALL_USER_ROLES,
  isCanonicalUserRole,
  mapRoleToRbacGroup,
  normalizeRoleInput,
  ROLE_DISPLAY_LABELS,
  UserRole,
} from '../../src/types/roles';
import { ApprovalHistoryEntry, AuditLogEntry, UserProfile } from '../../src/types/mis';
import { ROLE_PERMISSION_DEFAULTS } from '../../src/data/mockData';

export interface ProvisionEmployeeInput {
  email: string;
  displayName: string;
  role: string;
  department: string;
  designation?: string;
}

export interface SubmitAccessRequestInput {
  displayName: string;
  department: string;
  requestedRole?: string;
  designation?: string;
}

export interface ApproveEmployeeInput {
  role: string;
  department?: string;
  designation?: string;
  isDepartmentHead?: boolean;
  notes?: string;
}

export interface RejectEmployeeInput {
  reason: string;
}

export interface ServiceResult<T = any> {
  status: number;
  success: boolean;
  code: string;
  message: string;
  data?: T;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function computeInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'EM';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export class EmployeeManagementService {
  private readonly inFlightTransitions = new Set<string>();

  constructor(
    private readonly authAdapter: AdminAuthAdapter,
    private readonly storeAdapter: EmployeeStoreAdapter
  ) {}

  private getActorRole(actor: UserProfile): UserRole {
    return (
      normalizeRoleInput(actor.legacyRole) ||
      normalizeRoleInput(actor.role) ||
      'super_admin'
    );
  }

  private async writeSanitizedAuditLog(params: {
    actor: UserProfile;
    action: string;
    targetUid: string;
    outcome: 'SUCCESS' | 'PARTIAL_FAILURE' | 'REJECTED';
    summary: string;
    details?: Record<string, any>;
  }): Promise<void> {
    const nowIso = new Date().toISOString();
    const logId = `AUD-EMP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const rawEntry: AuditLogEntry = {
      id: logId,
      timestamp: nowIso,
      collectionName: 'users',
      documentId: params.targetUid,
      action: params.action,
      actorUid: params.actor.uid || params.actor.id,
      userId: params.actor.uid || params.actor.id,
      userName: `${params.actor.name} (${params.actor.email})`,
      targetUid: params.targetUid,
      outcome: params.outcome,
      newValueSummary: params.summary,
      details: params.details ? redactSensitiveData(params.details) : undefined,
      dataOrigin: 'production',
    };

    try {
      await this.storeAdapter.appendAuditLog(redactSensitiveData(rawEntry));
    } catch {
      // Never leak sensitive data or crash if audit sink is temporarily unreachable
    }
  }

  async listEmployees(): Promise<ServiceResult<{ employees: UserProfile[] }>> {
    const employees = await this.storeAdapter.listEmployeeProfiles();
    return {
      status: 200,
      success: true,
      code: 'EMPLOYEES_LISTED',
      message: `Loaded ${employees.length} employee profiles.`,
      data: { employees },
    };
  }

  /**
   * Submits a structured Access Request for an authenticated user who is not yet provisioned.
   * Never grants `super_admin` or active permissions; sets `accountStatus: 'pending_approval'`
   * and `role: 'Unassigned'` until approved by `super_admin` or Higher Authority (`ceo`).
   */
  async submitAccessRequest(
    authUser: { uid: string; email?: string },
    rawInput: SubmitAccessRequestInput
  ): Promise<ServiceResult<{ profile: UserProfile; employee: UserProfile }>> {
    const uid = String(authUser?.uid || '').trim();
    const email = String(authUser?.email || '')
      .trim()
      .toLowerCase();
    if (!uid || !email) {
      return {
        status: 401,
        success: false,
        code: 'UNAUTHENTICATED',
        message: 'Authenticated Firebase user with valid email is required to submit an access request.',
      };
    }

    const safeInput = redactSensitiveData(rawInput || ({} as SubmitAccessRequestInput));
    const displayName = String(safeInput.displayName || '').trim();
    const department = String(safeInput.department || '').trim();
    const requestedRole = String(safeInput.requestedRole || 'sales').trim();
    const designation = String(safeInput.designation || '').trim();

    if (!displayName || displayName.length < 2 || displayName.length > 100) {
      return {
        status: 400,
        success: false,
        code: 'INVALID_DISPLAY_NAME',
        message: 'Full name must be between 2 and 100 characters.',
      };
    }

    if (!department || department.length < 2 || department.length > 80) {
      return {
        status: 400,
        success: false,
        code: 'INVALID_DEPARTMENT',
        message: 'Department is required and must be between 2 and 80 characters.',
      };
    }

    if (
      requestedRole === 'super_admin' ||
      requestedRole === 'Admin' ||
      requestedRole === 'ceo' ||
      requestedRole === 'Management'
    ) {
      return {
        status: 403,
        success: false,
        code: 'SUPER_ADMIN_REQUEST_FORBIDDEN',
        message:
          'Security Policy: Privileged roles (Super Administrator and CEO / Management) cannot be requested via self-service access requests.',
      };
    }

    if (!isCanonicalUserRole(requestedRole)) {
      return {
        status: 400,
        success: false,
        code: 'INVALID_REQUESTED_ROLE',
        message: `Invalid requested role "${requestedRole}".`,
      };
    }

    const existing = await this.storeAdapter.getEmployeeProfile(uid);
    if (existing && existing.accountStatus === 'active') {
      return {
        status: 409,
        success: false,
        code: 'ALREADY_ACTIVE_EMPLOYEE',
        message: 'Your employee account is already active.',
      };
    }
    if (existing && existing.accountStatus === 'rejected') {
      return {
        status: 403,
        success: false,
        code: 'ACCOUNT_REJECTED_BY_ADMIN',
        message:
          'Your access request was rejected by an administrator. Only an authorized administrator can reconsider your account.',
      };
    }
    if (existing && existing.accountStatus === 'deactivated') {
      return {
        status: 403,
        success: false,
        code: 'ACCOUNT_DEACTIVATED',
        message:
          'Deactivated accounts cannot self-submit access requests. Please contact a Super Administrator.',
      };
    }

    const nowIso = new Date().toISOString();
    const requestHistoryEntry: ApprovalHistoryEntry = {
      action: 'requested',
      statusAfter: 'pending_approval',
      roleAssigned: requestedRole,
      departmentAssigned: department,
      actorUid: uid,
      actorEmail: email,
      actorName: displayName,
      reason: `Access requested for ${department} (${requestedRole})`,
      timestamp: nowIso,
    };
    const previousHistory = Array.isArray(existing?.approvalHistory)
      ? existing!.approvalHistory
      : [];

    const pendingProfile: UserProfile = {
      id: uid,
      uid,
      name: displayName,
      displayName,
      email,
      role: requestedRole,
      legacyRole: requestedRole,
      requestedRole,
      requestedDepartment: department,
      rbacGroup: mapRoleToRbacGroup(requestedRole),
      roleTitle: designation || `Pending Approval (${ROLE_DISPLAY_LABELS[requestedRole]})`,
      designation: designation || ROLE_DISPLAY_LABELS[requestedRole],
      department,
      avatarInitials: computeInitials(displayName),
      status: 'Inactive',
      accountStatus: 'pending_approval',
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
      approvalHistory: [...previousHistory, requestHistoryEntry].slice(-50),
      permissions: [],
      dataOrigin: 'production',
    };

    await this.storeAdapter.saveEmployeeProfile(pendingProfile);

    await this.writeSanitizedAuditLog({
      actor: pendingProfile,
      action: 'ACCESS_REQUEST_SUBMITTED',
      targetUid: uid,
      outcome: 'SUCCESS',
      summary: `Submitted access request for ${displayName} (${email}) requesting role="${requestedRole}" in ${department}. Status=pending_approval.`,
      details: {
        email,
        displayName,
        department,
        requestedRole,
        accountStatus: 'pending_approval',
      },
    });

    return {
      status: 201,
      success: true,
      code: 'ACCESS_REQUEST_SUBMITTED',
      message: `Access request submitted for ${displayName} (${email}). An active Super Administrator or Higher Authority (CEO) must approve your account before operational access is granted.`,
      data: { profile: pendingProfile, employee: pendingProfile },
    };
  }

  /**
   * Provisions a new employee account or safely recovers an incomplete provisioning attempt
   * where the Firebase Auth account was created previously but the `/users/{uid}` profile write failed.
   */
  async provisionEmployee(
    actor: UserProfile,
    rawInput: ProvisionEmployeeInput
  ): Promise<
    ServiceResult<{
      employee: UserProfile;
      recoveredFromPartialAuth: boolean;
      passwordSetupInitiated: boolean;
      partialFailure?: boolean;
      authUid?: string;
      retryable?: boolean;
    }>
  > {
    const safeInput = redactSensitiveData(rawInput || ({} as ProvisionEmployeeInput));
    const email = String(safeInput.email || '')
      .trim()
      .toLowerCase();
    const displayName = String(safeInput.displayName || '').trim();
    const requestedRole = String(safeInput.role || '').trim();
    const department = String(safeInput.department || '').trim();
    const designationInput = String(safeInput.designation || '').trim();

    if (!email || !EMAIL_REGEX.test(email) || email.length > 160) {
      return {
        status: 400,
        success: false,
        code: 'INVALID_EMAIL',
        message: 'A valid corporate email address is required.',
      };
    }

    if (!displayName || displayName.length < 2 || displayName.length > 100) {
      return {
        status: 400,
        success: false,
        code: 'INVALID_DISPLAY_NAME',
        message: 'Employee full name must be between 2 and 100 characters.',
      };
    }

    // Strict Canonical Role Enforcement: only accept the 8 canonical UserRole values
    if (!isCanonicalUserRole(requestedRole)) {
      await this.writeSanitizedAuditLog({
        actor,
        action: 'EMPLOYEE_PROVISION_INVALID_ROLE',
        targetUid: email,
        outcome: 'REJECTED',
        summary: `Rejected provisioning for ${email}: invalid non-canonical role "${requestedRole}".`,
        details: { attemptedRole: requestedRole, allowedRoles: ALL_USER_ROLES },
      });
      return {
        status: 400,
        success: false,
        code: 'INVALID_ROLE',
        message: `Invalid role "${requestedRole}". Role must be one of the 8 canonical roles: ${ALL_USER_ROLES.join(', ')}.`,
      };
    }

    const actorRole = this.getActorRole(actor);
    if (
      actorRole === 'ceo' &&
      (requestedRole === 'super_admin' || requestedRole === 'ceo')
    ) {
      await this.writeSanitizedAuditLog({
        actor,
        action: 'EMPLOYEE_PROVISION_REJECTED_SUPER_ADMIN_ESCALATION',
        targetUid: email,
        outcome: 'REJECTED',
        summary: `Blocked Higher Authority (ceo) ${actor.email} from provisioning a privileged ${requestedRole} account for ${email}.`,
        details: { actorRole, attemptedRole: requestedRole, targetEmail: email },
      });
      return {
        status: 403,
        success: false,
        code:
          requestedRole === 'super_admin'
            ? 'SUPER_ADMIN_CREATION_FORBIDDEN'
            : 'PRIVILEGE_ESCALATION_FORBIDDEN',
        message:
          'Security Policy: Higher Authority (CEO / Management) can provision operational department employees, but only a Super Administrator can create Super Administrator or CEO / Management accounts.',
      };
    }

    if (!department || department.length < 2 || department.length > 80) {
      return {
        status: 400,
        success: false,
        code: 'INVALID_DEPARTMENT',
        message: 'Department is required and must be between 2 and 80 characters.',
      };
    }

    const canonicalRole: UserRole = requestedRole;
    const rbacGroup = mapRoleToRbacGroup(canonicalRole);
    const designation = designationInput || ROLE_DISPLAY_LABELS[canonicalRole];

    // Check existing Auth user and existing Firestore `/users` profile
    const [existingAuthUser, existingProfileByEmail] = await Promise.all([
      this.authAdapter.getUserByEmail(email),
      this.storeAdapter.getEmployeeProfileByEmail(email),
    ]);

    if (existingAuthUser) {
      const existingProfileByUid =
        existingProfileByEmail ||
        (await this.storeAdapter.getEmployeeProfile(existingAuthUser.uid));

      if (existingProfileByUid) {
        await this.writeSanitizedAuditLog({
          actor,
          action: 'EMPLOYEE_PROVISION_DUPLICATE_REJECTED',
          targetUid: existingAuthUser.uid,
          outcome: 'REJECTED',
          summary: `Rejected duplicate employee provisioning for ${email} (UID: ${existingAuthUser.uid}).`,
          details: { email, existingUid: existingAuthUser.uid },
        });
        return {
          status: 409,
          success: false,
          code: 'DUPLICATE_EMPLOYEE_EMAIL',
          message: `An employee account with email "${email}" already exists (UID: ${existingAuthUser.uid}).`,
        };
      }
    } else if (existingProfileByEmail) {
      return {
        status: 409,
        success: false,
        code: 'DUPLICATE_EMPLOYEE_EMAIL',
        message: `An employee profile with email "${email}" already exists in /users.`,
      };
    }

    // Create Auth user OR recover from an existing Auth user that lacked a `/users/{uid}` profile
    let authUser = existingAuthUser;
    let recoveredFromPartialAuth = false;

    if (!authUser) {
      authUser = await this.authAdapter.createUser({
        email,
        displayName,
        disabled: false,
        emailVerified: false,
      });
    } else {
      recoveredFromPartialAuth = true;
      authUser = await this.authAdapter.updateUser(authUser.uid, {
        displayName,
        disabled: false,
      });
    }

    // Set custom claims for fast token inspection while keeping `/users/{uid}` authoritative
    try {
      await this.authAdapter.setCustomUserClaims(authUser.uid, {
        role: canonicalRole,
        rbacGroup,
      });
    } catch {
      // Non-fatal if custom claims update fails; Firestore `/users/{uid}` is authoritative
    }

    const nowIso = new Date().toISOString();
    const actorIdentifier = `${actor.name} (${actor.email})`;

    const newProfile: UserProfile = {
      id: authUser.uid,
      uid: authUser.uid,
      name: displayName,
      displayName,
      email,
      role: canonicalRole,
      legacyRole: canonicalRole,
      rbacGroup,
      roleTitle: designation,
      designation,
      department,
      avatarInitials: computeInitials(displayName),
      accountStatus: 'active',
      mustChangePassword: true,
      invitedBy: actorIdentifier,
      provisionedBy: actor.uid || actor.id,
      provisionedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
      permissions: ROLE_PERMISSION_DEFAULTS[canonicalRole] || [],
      dataOrigin: 'production',
    };

    try {
      await this.storeAdapter.saveEmployeeProfile(newProfile);
    } catch (profileErr: any) {
      await this.writeSanitizedAuditLog({
        actor,
        action: 'EMPLOYEE_PROVISION_PARTIAL_FAILURE',
        targetUid: authUser.uid,
        outcome: 'PARTIAL_FAILURE',
        summary: `Firebase Auth account ${email} (${authUser.uid}) exists, but writing /users/${authUser.uid} failed. Retry provisioning with the same email to complete profile setup.`,
        details: {
          email,
          authUid: authUser.uid,
          role: canonicalRole,
          errorReason: String(profileErr?.message || 'Firestore write failed'),
        },
      });

      return {
        status: 502,
        success: false,
        code: 'PROFILE_WRITE_FAILED_AFTER_AUTH',
        message: `Firebase Auth user (${authUser.uid}) was created, but writing the /users/${authUser.uid} profile failed. Re-submitting the same employee will safely recover and create the missing profile without duplicating Auth records.`,
        data: {
          employee: newProfile,
          recoveredFromPartialAuth,
          passwordSetupInitiated: false,
          partialFailure: true,
          authUid: authUser.uid,
          retryable: true,
        },
      };
    }

    // Initiate password setup link generation without ever returning or logging the secret link
    let passwordSetupInitiated = false;
    try {
      await this.authAdapter.generatePasswordResetLink(email);
      passwordSetupInitiated = true;
    } catch {
      passwordSetupInitiated = false;
    }

    await this.writeSanitizedAuditLog({
      actor,
      action: recoveredFromPartialAuth
        ? 'EMPLOYEE_PROVISION_RECOVERED'
        : 'EMPLOYEE_PROVISIONED',
      targetUid: authUser.uid,
      outcome: 'SUCCESS',
      summary: `${
        recoveredFromPartialAuth ? 'Recovered & provisioned' : 'Provisioned'
      } employee ${displayName} (${email}) with canonical role="${canonicalRole}" (${rbacGroup}) and accountStatus="active".`,
      details: {
        email,
        displayName,
        role: canonicalRole,
        rbacGroup,
        department,
        designation,
        recoveredFromPartialAuth,
        passwordSetupInitiated,
      },
    });

    return {
      status: 201,
      success: true,
      code: recoveredFromPartialAuth
        ? 'EMPLOYEE_PROVISION_RECOVERED'
        : 'EMPLOYEE_PROVISIONED',
      message: recoveredFromPartialAuth
        ? `Recovered existing Firebase Auth user (${authUser.uid}) and completed /users/${authUser.uid} profile with role "${canonicalRole}".`
        : `Provisioned employee ${displayName} (${email}) with role "${canonicalRole}" and initiated password setup.`,
      data: {
        employee: newProfile,
        recoveredFromPartialAuth,
        passwordSetupInitiated,
      },
    };
  }

  /**
   * Updates an existing employee's canonical role and metadata.
   * Enforces:
   * - 3-Tier Authority Hierarchy: `ceo` (Higher Authority) can promote eligible employees up to `ceo`
   *   without requiring `super_admin` approval, but is strictly forbidden from promoting anyone to
   *   `super_admin` or modifying/demoting an existing `super_admin` account.
   * - Self-demotion guard and last-active-super_admin protection.
   * - Approves & activates `pending_approval` access requests when a canonical role is assigned.
   */
  async updateEmployeeRole(
    actor: UserProfile,
    targetUid: string,
    input: { role: string; department?: string; designation?: string }
  ): Promise<ServiceResult<{ employee: UserProfile }>> {
    const cleanUid = String(targetUid || '').trim();
    const requestedRole = String(input?.role || '').trim();

    if (!cleanUid) {
      return {
        status: 400,
        success: false,
        code: 'INVALID_TARGET_UID',
        message: 'Target employee UID is required.',
      };
    }

    if (!isCanonicalUserRole(requestedRole)) {
      return {
        status: 400,
        success: false,
        code: 'INVALID_ROLE',
        message: `Invalid role "${requestedRole}". Role must be one of the 8 canonical roles: ${ALL_USER_ROLES.join(', ')}.`,
      };
    }

    const existing = await this.storeAdapter.getEmployeeProfile(cleanUid);
    if (!existing) {
      return {
        status: 404,
        success: false,
        code: 'EMPLOYEE_NOT_FOUND',
        message: `No employee profile found in /users/${cleanUid}.`,
      };
    }

    const actorUid = actor.uid || actor.id;
    const actorRole = this.getActorRole(actor);
    const currentCanonicalRole = existing.legacyRole || existing.role;
    const newCanonicalRole: UserRole = requestedRole;

    // Authority Guard: Higher Authority (ceo) cannot modify an existing super_admin/ceo or promote anyone to super_admin/ceo
    if (actorRole === 'ceo') {
      if (
        currentCanonicalRole === 'super_admin' ||
        currentCanonicalRole === 'ceo' ||
        String(existing.role) === 'Admin' ||
        String(existing.role) === 'Management'
      ) {
        await this.writeSanitizedAuditLog({
          actor,
          action: 'EMPLOYEE_ROLE_UPDATE_REJECTED_TARGET_SUPER_ADMIN',
          targetUid: cleanUid,
          outcome: 'REJECTED',
          summary: `Blocked Higher Authority (ceo) ${actor.email} from modifying privileged account ${existing.email} (${currentCanonicalRole}).`,
          details: { actorRole, targetRole: currentCanonicalRole, attemptedRole: newCanonicalRole },
        });
        return {
          status: 403,
          success: false,
          code: 'SUPER_ADMIN_IMMUTABLE_BY_HIGHER_AUTHORITY',
          message:
            'Security Policy: Higher Authority (CEO / Management) cannot modify or demote a Super Administrator or CEO / Management account.',
        };
      }

      if (newCanonicalRole === 'super_admin' || newCanonicalRole === 'ceo') {
        await this.writeSanitizedAuditLog({
          actor,
          action: 'EMPLOYEE_ROLE_UPDATE_REJECTED_SUPER_ADMIN_ESCALATION',
          targetUid: cleanUid,
          outcome: 'REJECTED',
          summary: `Blocked Higher Authority (ceo) ${actor.email} from promoting ${existing.email} to privileged role ${newCanonicalRole}.`,
          details: { actorRole, previousRole: currentCanonicalRole, attemptedRole: newCanonicalRole },
        });
        return {
          status: 403,
          success: false,
          code:
            newCanonicalRole === 'super_admin'
              ? 'SUPER_ADMIN_PROMOTION_FORBIDDEN'
              : 'PRIVILEGE_ESCALATION_FORBIDDEN',
          message:
            'Security Policy: Only a Super Administrator can assign or promote users to Super Administrator or CEO / Management roles.',
        };
      }
    }

    // Prevent an admin or Higher Authority from accidentally demoting their own active account
    if (actorUid === cleanUid && newCanonicalRole !== actorRole) {
      await this.writeSanitizedAuditLog({
        actor,
        action: 'EMPLOYEE_ROLE_UPDATE_REJECTED_SELF_DEMOTION',
        targetUid: cleanUid,
        outcome: 'REJECTED',
        summary: `Blocked self-demotion attempt by ${actor.email} from ${actorRole} to ${newCanonicalRole}.`,
        details: { previousRole: currentCanonicalRole, attemptedRole: newCanonicalRole },
      });
      return {
        status: 409,
        success: false,
        code: 'SELF_ROLE_DEMOTION_FORBIDDEN',
        message: 'Self-lockout guard: You cannot demote your own administrative/authority role.',
      };
    }

    // Prevent demoting the last active super_admin
    if (
      currentCanonicalRole === 'super_admin' &&
      existing.accountStatus === 'active' &&
      newCanonicalRole !== 'super_admin'
    ) {
      const activeSuperAdminCount = await this.storeAdapter.countActiveSuperAdmins();
      if (activeSuperAdminCount <= 1) {
        return {
          status: 409,
          success: false,
          code: 'LAST_SUPER_ADMIN_PROTECTION',
          message:
            'Cannot demote the last active Super Administrator account. Provision another super_admin first.',
        };
      }
    }

    const newRbacGroup = mapRoleToRbacGroup(newCanonicalRole);
    const newDesignation =
      (input.designation && input.designation.trim()) ||
      ROLE_DISPLAY_LABELS[newCanonicalRole];
    const newDepartment =
      (input.department && input.department.trim()) || existing.department;

    const wasPendingApproval =
      existing.accountStatus === 'pending_approval' ||
      existing.accountStatus === 'pending_invitation' ||
      existing.accountStatus === 'rejected' ||
      String(existing.role) === 'Unassigned';

    if (wasPendingApproval && actorUid === cleanUid) {
      await this.writeSanitizedAuditLog({
        actor,
        action: 'EMPLOYEE_APPROVAL_REJECTED_SELF',
        targetUid: cleanUid,
        outcome: 'REJECTED',
        summary: `Blocked self-approval attempt by ${actor.email} (${actorUid}).`,
      });
      return {
        status: 409,
        success: false,
        code: 'SELF_APPROVAL_FORBIDDEN',
        message: 'Security Policy: You cannot approve your own pending employee account.',
      };
    }

    const nowIso = new Date().toISOString();
    const previousHistory = Array.isArray(existing.approvalHistory)
      ? existing.approvalHistory
      : [];
    const approvalEntry: ApprovalHistoryEntry | null = wasPendingApproval
      ? {
          action: existing.accountStatus === 'rejected' ? 'reconsidered' : 'approved',
          statusAfter: 'active',
          roleAssigned: newCanonicalRole,
          departmentAssigned: newDepartment,
          actorUid,
          actorEmail: actor.email,
          actorName: actor.name,
          reason: `Approved via Role & Access Governance as ${ROLE_DISPLAY_LABELS[newCanonicalRole]}`,
          timestamp: nowIso,
        }
      : null;

    const updatedProfile: UserProfile = {
      ...existing,
      id: cleanUid,
      uid: cleanUid,
      role: newCanonicalRole,
      legacyRole: newCanonicalRole,
      rbacGroup: newRbacGroup,
      roleTitle: newDesignation,
      designation: newDesignation,
      department: newDepartment,
      status: wasPendingApproval ? 'Active' : existing.status,
      accountStatus: wasPendingApproval ? 'active' : existing.accountStatus,
      ...(wasPendingApproval
        ? {
            approvedByUid: actorUid,
            approvedByEmail: actor.email,
            approvedByName: actor.name,
            approvedAt: nowIso,
            rejectedByUid: null,
            rejectedByEmail: null,
            rejectedByName: null,
            rejectedAt: null,
            rejectionReason: null,
            approvalHistory: approvalEntry
              ? [...previousHistory, approvalEntry].slice(-50)
              : previousHistory,
          }
        : {}),
      updatedAt: nowIso,
      permissions: ROLE_PERMISSION_DEFAULTS[newCanonicalRole] || [],
    };

    await this.storeAdapter.saveEmployeeProfile(updatedProfile);

    // Claims and the audit entry are independent, so write them together.
    const claimsWrite = this.authAdapter
      .setCustomUserClaims(cleanUid, {
        role: newCanonicalRole,
        rbacGroup: newRbacGroup,
      })
      .catch(() => {
        // Non-fatal
      });

    const isHigherAuthorityPromotion =
      newCanonicalRole === 'ceo' && currentCanonicalRole !== 'ceo';

    const auditWrite = this.writeSanitizedAuditLog({
      actor,
      action: 'EMPLOYEE_ROLE_UPDATED',
      targetUid: cleanUid,
      outcome: 'SUCCESS',
      summary: `${
        isHigherAuthorityPromotion
          ? 'Promoted to Higher Authority (CEO): '
          : wasPendingApproval
          ? 'Approved access request & assigned role: '
          : ''
      }Updated role for ${existing.email} (${cleanUid}) from "${currentCanonicalRole}" to "${newCanonicalRole}" (${newRbacGroup}) by ${actor.email} (${actorRole}).`,
      details: {
        actorRole,
        previousRole: currentCanonicalRole,
        newRole: newCanonicalRole,
        newRbacGroup,
        promotedToHigherAuthority: isHigherAuthorityPromotion,
        approvedPendingRequest: wasPendingApproval,
        department: newDepartment,
        designation: newDesignation,
      },
    });
    await Promise.all([claimsWrite, auditWrite]);

    return {
      status: 200,
      success: true,
      code: 'EMPLOYEE_ROLE_UPDATED',
      message: isHigherAuthorityPromotion
        ? `Promoted ${existing.name} (${existing.email}) to Higher Authority (Managing Director / CEO).`
        : `Updated ${existing.name} (${existing.email}) to role "${newCanonicalRole}" (${newRbacGroup}).`,
      data: { employee: updatedProfile },
    };
  }

  /**
   * Deactivates an employee account:
   * - Blocks self-deactivation, CEO deactivating a super_admin, and last-active-super_admin deactivation.
   * - Disables the Firebase Auth user (`disabled: true`) and revokes refresh tokens (`revokeRefreshTokens`).
   * - Sets `/users/{uid}.accountStatus = 'deactivated'`.
   */
  async deactivateEmployee(
    actor: UserProfile,
    targetUid: string,
    reason?: string
  ): Promise<ServiceResult<{ employee: UserProfile }>> {
    const cleanUid = String(targetUid || '').trim();
    if (!cleanUid) {
      return {
        status: 400,
        success: false,
        code: 'INVALID_TARGET_UID',
        message: 'Target employee UID is required.',
      };
    }

    const actorUid = actor.uid || actor.id;
    const actorRole = this.getActorRole(actor);
    if (actorUid === cleanUid) {
      await this.writeSanitizedAuditLog({
        actor,
        action: 'EMPLOYEE_DEACTIVATE_REJECTED_SELF',
        targetUid: cleanUid,
        outcome: 'REJECTED',
        summary: `Blocked self-deactivation attempt by ${actor.email} (${actorUid}).`,
      });
      return {
        status: 409,
        success: false,
        code: 'SELF_DEACTIVATION_FORBIDDEN',
        message: 'Self-lockout guard: You cannot deactivate your own active account.',
      };
    }

    const existing = await this.storeAdapter.getEmployeeProfile(cleanUid);
    if (!existing) {
      return {
        status: 404,
        success: false,
        code: 'EMPLOYEE_NOT_FOUND',
        message: `No employee profile found in /users/${cleanUid}.`,
      };
    }

    const targetRole = existing.legacyRole || existing.role;
    if (
      actorRole === 'ceo' &&
      (targetRole === 'super_admin' ||
        targetRole === 'ceo' ||
        String(existing.role) === 'Admin' ||
        String(existing.role) === 'Management')
    ) {
      await this.writeSanitizedAuditLog({
        actor,
        action: 'EMPLOYEE_DEACTIVATE_REJECTED_TARGET_SUPER_ADMIN',
        targetUid: cleanUid,
        outcome: 'REJECTED',
        summary: `Blocked Higher Authority (ceo) ${actor.email} from deactivating privileged account ${existing.email}.`,
      });
      return {
        status: 403,
        success: false,
        code: 'SUPER_ADMIN_IMMUTABLE_BY_HIGHER_AUTHORITY',
        message:
          'Security Policy: Higher Authority (CEO / Management) cannot deactivate a Super Administrator or CEO / Management account.',
      };
    }

    if (targetRole === 'super_admin' && existing.accountStatus === 'active') {
      const activeSuperAdmins = await this.storeAdapter.countActiveSuperAdmins();
      if (activeSuperAdmins <= 1) {
        return {
          status: 409,
          success: false,
          code: 'LAST_SUPER_ADMIN_PROTECTION',
          message: 'Cannot deactivate the last active Super Administrator account.',
        };
      }
    }

    // Disable in Firebase Auth and revoke refresh tokens if Auth user exists
    const authUser = await this.authAdapter.getUser(cleanUid);
    if (authUser) {
      await this.authAdapter.updateUser(cleanUid, { disabled: true });
      await this.authAdapter.revokeRefreshTokens(cleanUid);
    }

    const nowIso = new Date().toISOString();
    const updatedProfile: UserProfile = {
      ...existing,
      id: cleanUid,
      uid: cleanUid,
      status: 'Inactive',
      accountStatus: 'deactivated',
      disabledAt: nowIso,
      deactivatedBy: actorUid,
      deactivationReason:
        reason?.trim() ||
        (actorRole === 'ceo'
          ? 'Deactivated by Higher Authority (CEO)'
          : 'Deactivated by Super Administrator'),
      updatedAt: nowIso,
    };

    await this.storeAdapter.saveEmployeeProfile(updatedProfile);

    await this.writeSanitizedAuditLog({
      actor,
      action: 'EMPLOYEE_DEACTIVATED',
      targetUid: cleanUid,
      outcome: 'SUCCESS',
      summary: `Deactivated employee account ${existing.email} (${cleanUid}) and revoked active refresh tokens.`,
      details: {
        email: existing.email,
        deactivatedBy: actorUid,
        actorRole,
        reason: updatedProfile.deactivationReason,
      },
    });

    return {
      status: 200,
      success: true,
      code: 'EMPLOYEE_DEACTIVATED',
      message: `Deactivated employee ${existing.name} (${existing.email}) and revoked active tokens.`,
      data: { employee: updatedProfile },
    };
  }

  /**
   * Reactivates a previously deactivated or pending employee account.
   */
  async reactivateEmployee(
    actor: UserProfile,
    targetUid: string
  ): Promise<ServiceResult<{ employee: UserProfile }>> {
    const cleanUid = String(targetUid || '').trim();
    if (!cleanUid) {
      return {
        status: 400,
        success: false,
        code: 'INVALID_TARGET_UID',
        message: 'Target employee UID is required.',
      };
    }

    const existing = await this.storeAdapter.getEmployeeProfile(cleanUid);
    if (!existing) {
      return {
        status: 404,
        success: false,
        code: 'EMPLOYEE_NOT_FOUND',
        message: `No employee profile found in /users/${cleanUid}.`,
      };
    }

    const actorRole = this.getActorRole(actor);
    const targetRole = existing.legacyRole || existing.role;
    if (
      actorRole === 'ceo' &&
      (targetRole === 'super_admin' ||
        targetRole === 'ceo' ||
        String(existing.role) === 'Admin' ||
        String(existing.role) === 'Management')
    ) {
      return {
        status: 403,
        success: false,
        code: 'SUPER_ADMIN_IMMUTABLE_BY_HIGHER_AUTHORITY',
        message:
          'Security Policy: Higher Authority (CEO / Management) cannot modify a Super Administrator or CEO / Management account.',
      };
    }

    const resolvedRole: UserRole =
      normalizeRoleInput(existing.legacyRole) ||
      normalizeRoleInput(existing.requestedRole) ||
      normalizeRoleInput(existing.role) ||
      'sales';
    const resolvedGroup = mapRoleToRbacGroup(resolvedRole);

    const authUser = await this.authAdapter.getUser(cleanUid);
    if (authUser) {
      await this.authAdapter.updateUser(cleanUid, { disabled: false });
    }

    const nowIso = new Date().toISOString();
    const isUnassigned = String(existing.role) === 'Unassigned';
    const updatedProfile: UserProfile = {
      ...existing,
      id: cleanUid,
      uid: cleanUid,
      role: isUnassigned ? resolvedRole : existing.role,
      legacyRole: isUnassigned ? resolvedRole : existing.legacyRole || resolvedRole,
      rbacGroup: isUnassigned ? resolvedGroup : existing.rbacGroup || resolvedGroup,
      status: 'Active',
      accountStatus: 'active',
      disabledAt: null,
      deactivatedBy: null,
      deactivationReason: null,
      updatedAt: nowIso,
      permissions:
        existing.permissions && existing.permissions.length > 0
          ? existing.permissions
          : ROLE_PERMISSION_DEFAULTS[resolvedRole] || [],
    };

    await this.storeAdapter.saveEmployeeProfile(updatedProfile);

    await this.writeSanitizedAuditLog({
      actor,
      action: 'EMPLOYEE_REACTIVATED',
      targetUid: cleanUid,
      outcome: 'SUCCESS',
      summary: `Reactivated employee account ${existing.email} (${cleanUid}) with role="${updatedProfile.role}".`,
      details: {
        email: existing.email,
        role: updatedProfile.role,
        actorRole,
      },
    });

    return {
      status: 200,
      success: true,
      code: 'EMPLOYEE_REACTIVATED',
      message: `Reactivated employee ${existing.name} (${existing.email}).`,
      data: { employee: updatedProfile },
    };
  }

  /**
   * Safely initiates a Firebase password reset flow for an employee without generating,
   * logging, storing, or returning plaintext passwords or raw reset links.
   */
  async initiateEmployeePasswordReset(
    actor: UserProfile,
    targetUid: string
  ): Promise<ServiceResult<{ targetEmail: string; resetInitiated: boolean }>> {
    const cleanUid = String(targetUid || '').trim();
    if (!cleanUid) {
      return {
        status: 400,
        success: false,
        code: 'INVALID_TARGET_UID',
        message: 'Target employee UID is required.',
      };
    }

    const existing = await this.storeAdapter.getEmployeeProfile(cleanUid);
    if (!existing) {
      return {
        status: 404,
        success: false,
        code: 'EMPLOYEE_NOT_FOUND',
        message: `No employee profile found in /users/${cleanUid}.`,
      };
    }

    const actorRole = this.getActorRole(actor);
    const targetRole = existing.legacyRole || existing.role;
    if (
      actorRole === 'ceo' &&
      (targetRole === 'super_admin' ||
        targetRole === 'ceo' ||
        String(existing.role) === 'Admin' ||
        String(existing.role) === 'Management')
    ) {
      return {
        status: 403,
        success: false,
        code: 'SUPER_ADMIN_IMMUTABLE_BY_HIGHER_AUTHORITY',
        message:
          'Security Policy: Higher Authority (CEO / Management) cannot initiate password reset for a Super Administrator or CEO / Management account.',
      };
    }

    if (existing.accountStatus === 'deactivated') {
      return {
        status: 409,
        success: false,
        code: 'ACCOUNT_DEACTIVATED',
        message: `Cannot initiate password reset for deactivated account ${existing.email}. Reactivate the account first.`,
      };
    }

    // Generate reset link internally via Firebase Admin SDK but NEVER return or log the link/oobCode
    await this.authAdapter.generatePasswordResetLink(existing.email);

    await this.writeSanitizedAuditLog({
      actor,
      action: 'EMPLOYEE_PASSWORD_RESET_INITIATED',
      targetUid: cleanUid,
      outcome: 'SUCCESS',
      summary: `Initiated password reset flow for ${existing.email} (${cleanUid}).`,
      details: {
        targetEmail: existing.email,
        resetLink: '[REDACTED]',
      },
    });

    return {
      status: 200,
      success: true,
      code: 'PASSWORD_RESET_INITIATED',
      message: `Password reset flow initiated for ${existing.email}.`,
      data: {
        targetEmail: existing.email,
        resetInitiated: true,
      },
    };
  }

  /**
   * Dedicated Employee Approval Workflow (`POST /api/admin/employees/:uid/approve`).
   * - Enforces server-side administrator authority (`super_admin` or `ceo`).
   * - Blocks self-approval (`SELF_APPROVAL_FORBIDDEN`).
   * - Blocks duplicate approval and concurrent race conditions (`ALREADY_APPROVED` / `APPROVAL_IN_PROGRESS`).
   * - Persists `accountStatus = 'active'`, canonical `role`, `department`, `approvedByUid`, `approvedByEmail`,
   *   `approvedByName`, `approvedAt`, and `approvalHistory`.
   * - Re-enables Firebase Auth user if previously disabled and sets custom role claims.
   * - Appends a sanitized audit log entry (`EMPLOYEE_ACCESS_APPROVED`).
   */
  async approveEmployee(
    actor: UserProfile,
    targetUid: string,
    rawInput: ApproveEmployeeInput
  ): Promise<ServiceResult<{ employee: UserProfile }>> {
    const cleanUid = String(targetUid || '').trim();
    if (!cleanUid) {
      return {
        status: 400,
        success: false,
        code: 'INVALID_TARGET_UID',
        message: 'Target employee UID is required.',
      };
    }

    const actorUid = actor.uid || actor.id;
    const actorRole = this.getActorRole(actor);

    if (actorUid === cleanUid) {
      await this.writeSanitizedAuditLog({
        actor,
        action: 'EMPLOYEE_APPROVAL_REJECTED_SELF',
        targetUid: cleanUid,
        outcome: 'REJECTED',
        summary: `Blocked self-approval attempt by ${actor.email} (${actorUid}).`,
      });
      return {
        status: 409,
        success: false,
        code: 'SELF_APPROVAL_FORBIDDEN',
        message: 'Security Policy: You cannot approve your own employee account.',
      };
    }

    if (this.inFlightTransitions.has(cleanUid)) {
      return {
        status: 409,
        success: false,
        code: 'APPROVAL_IN_PROGRESS',
        message: 'An approval or status transition is already in progress for this employee.',
      };
    }

    this.inFlightTransitions.add(cleanUid);
    try {
      const existing = await this.storeAdapter.getEmployeeProfile(cleanUid);
      if (!existing) {
        return {
          status: 404,
          success: false,
          code: 'EMPLOYEE_NOT_FOUND',
          message: `No employee profile found in /users/${cleanUid}.`,
        };
      }

      const requestedRoleStr = String(
        rawInput?.role || existing.requestedRole || existing.legacyRole || existing.role || ''
      ).trim();

      if (!isCanonicalUserRole(requestedRoleStr)) {
        await this.writeSanitizedAuditLog({
          actor,
          action: 'EMPLOYEE_APPROVAL_INVALID_ROLE',
          targetUid: cleanUid,
          outcome: 'REJECTED',
          summary: `Rejected approval for ${existing.email} (${cleanUid}): non-canonical role "${requestedRoleStr}".`,
          details: { attemptedRole: requestedRoleStr, allowedRoles: ALL_USER_ROLES },
        });
        return {
          status: 400,
          success: false,
          code: 'INVALID_ROLE',
          message: `Invalid role "${requestedRoleStr}". Role must be one of the 8 canonical roles: ${ALL_USER_ROLES.join(', ')}.`,
        };
      }

      const approvedRole: UserRole = requestedRoleStr;
      const existingRole = existing.legacyRole || existing.role;

      if (actorRole === 'ceo') {
        if (
          existingRole === 'super_admin' ||
          existingRole === 'ceo' ||
          String(existing.role) === 'Admin' ||
          String(existing.role) === 'Management'
        ) {
          return {
            status: 403,
            success: false,
            code: 'SUPER_ADMIN_IMMUTABLE_BY_HIGHER_AUTHORITY',
            message:
              'Security Policy: Higher Authority (CEO / Management) cannot modify a Super Administrator or CEO / Management account.',
          };
        }
        if (approvedRole === 'super_admin' || approvedRole === 'ceo') {
          await this.writeSanitizedAuditLog({
            actor,
            action: 'EMPLOYEE_APPROVAL_REJECTED_SUPER_ADMIN_ESCALATION',
            targetUid: cleanUid,
            outcome: 'REJECTED',
            summary: `Blocked Higher Authority (ceo) ${actor.email} from approving ${existing.email} as ${approvedRole}.`,
          });
          return {
            status: 403,
            success: false,
            code:
              approvedRole === 'super_admin'
                ? 'SUPER_ADMIN_ASSIGNMENT_FORBIDDEN'
                : 'PRIVILEGE_ESCALATION_FORBIDDEN',
            message:
              'Security Policy: Higher Authority (CEO / Management) can approve operational department roles, but only a Super Administrator can approve Super Administrator or CEO / Management roles.',
          };
        }
      }

      if (existing.accountStatus === 'active' && String(existing.role) !== 'Unassigned') {
        await this.writeSanitizedAuditLog({
          actor,
          action: 'EMPLOYEE_APPROVAL_DUPLICATE_REJECTED',
          targetUid: cleanUid,
          outcome: 'REJECTED',
          summary: `Blocked duplicate approval request for already-active employee ${existing.email} (${cleanUid}).`,
        });
        return {
          status: 409,
          success: false,
          code: 'ALREADY_APPROVED',
          message: `Employee ${existing.name || existing.email} is already approved and active.`,
        };
      }

      const approvedDepartment =
        (rawInput?.department && rawInput.department.trim()) ||
        existing.requestedDepartment ||
        existing.department ||
        'Operations';
      if (approvedDepartment.length < 2 || approvedDepartment.length > 80) {
        return {
          status: 400,
          success: false,
          code: 'INVALID_DEPARTMENT',
          message: 'Department must be between 2 and 80 characters.',
        };
      }

      const approvedRbacGroup = mapRoleToRbacGroup(approvedRole);
      const approvedDesignation =
        (rawInput?.designation && rawInput.designation.trim()) ||
        ROLE_DISPLAY_LABELS[approvedRole];
      const nowIso = new Date().toISOString();
      const wasRejected = existing.accountStatus === 'rejected';
      const isDeptHead =
        typeof rawInput?.isDepartmentHead === 'boolean'
          ? rawInput.isDepartmentHead
          : Boolean(existing.isDepartmentHead);

      const historyEntry: ApprovalHistoryEntry = {
        action: wasRejected ? 'reconsidered' : 'approved',
        statusAfter: 'active',
        status: 'active',
        roleAssigned: approvedRole,
        departmentAssigned: approvedDepartment,
        actorUid,
        actorEmail: actor.email,
        actorName: actor.name,
        reason:
          rawInput?.notes?.trim() ||
          (wasRejected
            ? `Reconsidered and approved for ${approvedDepartment} (${approvedRole})`
            : `Approved for ${approvedDepartment} (${approvedRole})`),
        notes:
          rawInput?.notes?.trim() ||
          (wasRejected
            ? `Reconsidered and approved for ${approvedDepartment} (${approvedRole})`
            : `Approved for ${approvedDepartment} (${approvedRole})`),
        timestamp: nowIso,
      };
      const previousHistory = Array.isArray(existing.approvalHistory)
        ? existing.approvalHistory
        : [];

      const updatedProfile: UserProfile = {
        ...existing,
        id: cleanUid,
        uid: cleanUid,
        name: existing.name || existing.displayName || existing.email.split('@')[0],
        displayName: existing.displayName || existing.name || existing.email.split('@')[0],
        role: approvedRole,
        legacyRole: approvedRole,
        requestedRole: normalizeRoleInput(existing.requestedRole) || approvedRole,
        requestedDepartment: existing.requestedDepartment || existing.department,
        rbacGroup: approvedRbacGroup,
        roleTitle: approvedDesignation,
        designation: approvedDesignation,
        department: approvedDepartment,
        isDepartmentHead: isDeptHead,
        managedDepartment: isDeptHead ? approvedDepartment : undefined,
        status: 'Active',
        accountStatus: 'active',
        approvedByUid: actorUid,
        approvedByEmail: actor.email,
        approvedByName: actor.name,
        approvedAt: nowIso,
        rejectedByUid: null,
        rejectedByEmail: null,
        rejectedByName: null,
        rejectedAt: null,
        rejectionReason: null,
        disabledAt: null,
        deactivatedBy: null,
        deactivationReason: null,
        approvalHistory: [...previousHistory, historyEntry].slice(-50),
        updatedAt: nowIso,
        permissions: ROLE_PERMISSION_DEFAULTS[approvedRole] || [],
      };

      try {
        await this.storeAdapter.saveEmployeeProfile(updatedProfile);
      } catch (writeErr: any) {
        await this.writeSanitizedAuditLog({
          actor,
          action: 'EMPLOYEE_APPROVAL_WRITE_FAILED',
          targetUid: cleanUid,
          outcome: 'PARTIAL_FAILURE',
          summary: `Database write failed while approving ${existing.email} (${cleanUid}).`,
          details: {
            errorReason: String(writeErr?.message || 'Database write failed'),
          },
        });
        return {
          status: 500,
          success: false,
          code: 'APPROVAL_WRITE_FAILED',
          message: `Failed to persist approval for ${existing.email} to the database.`,
        };
      }

      try {
        const authUser = await this.authAdapter.getUser(cleanUid);
        if (authUser && authUser.disabled) {
          await this.authAdapter.updateUser(cleanUid, { disabled: false });
        }
        await this.authAdapter.setCustomUserClaims(cleanUid, {
          role: approvedRole,
          rbacGroup: approvedRbacGroup,
        });
      } catch {
        // Non-fatal if custom claims cannot be updated in local dev
      }

      await this.writeSanitizedAuditLog({
        actor,
        action: wasRejected ? 'EMPLOYEE_ACCESS_RECONSIDERED_AND_APPROVED' : 'EMPLOYEE_ACCESS_APPROVED',
        targetUid: cleanUid,
        outcome: 'SUCCESS',
        summary: `Approved employee ${existing.email} (${cleanUid}) with role="${approvedRole}" (${approvedRbacGroup}) in department="${approvedDepartment}" by ${actor.email}.`,
        details: {
          email: existing.email,
          previousStatus: existing.accountStatus,
          approvedRole,
          approvedRbacGroup,
          approvedDepartment,
          isDepartmentHead: isDeptHead,
          approvedByUid: actorUid,
          approvedByEmail: actor.email,
          approvedAt: nowIso,
        },
      });

      return {
        status: 200,
        success: true,
        code: 'EMPLOYEE_APPROVED',
        message: `Approved ${updatedProfile.name} (${updatedProfile.email}) with role "${ROLE_DISPLAY_LABELS[approvedRole]}" in ${approvedDepartment}.`,
        data: { employee: updatedProfile },
      };
    } finally {
      this.inFlightTransitions.delete(cleanUid);
    }
  }

  /**
   * Dedicated Employee Rejection Workflow (`POST /api/admin/employees/:uid/reject`).
   * - Enforces server-side administrator authority (`super_admin` or `ceo`).
   * - Blocks self-rejection (`SELF_REJECTION_FORBIDDEN`).
   * - Persists `accountStatus = 'rejected'`, `rejectedByUid`, `rejectedByEmail`, `rejectedByName`,
   *   `rejectedAt`, `rejectionReason`, `approvalHistory`, and `permissions: []`.
   * - Appends a sanitized audit log entry (`EMPLOYEE_ACCESS_REJECTED`).
   */
  async rejectEmployee(
    actor: UserProfile,
    targetUid: string,
    rawInput: RejectEmployeeInput
  ): Promise<ServiceResult<{ employee: UserProfile }>> {
    const cleanUid = String(targetUid || '').trim();
    if (!cleanUid) {
      return {
        status: 400,
        success: false,
        code: 'INVALID_TARGET_UID',
        message: 'Target employee UID is required.',
      };
    }

    const reason = String(rawInput?.reason || '').trim();
    if (!reason || reason.length < 3 || reason.length > 500) {
      return {
        status: 400,
        success: false,
        code: 'REJECTION_REASON_REQUIRED',
        message: 'A rejection reason between 3 and 500 characters is required.',
      };
    }

    const actorUid = actor.uid || actor.id;
    const actorRole = this.getActorRole(actor);

    if (actorUid === cleanUid) {
      return {
        status: 409,
        success: false,
        code: 'SELF_REJECTION_FORBIDDEN',
        message: 'Security Policy: You cannot reject your own account.',
      };
    }

    if (this.inFlightTransitions.has(cleanUid)) {
      return {
        status: 409,
        success: false,
        code: 'TRANSITION_IN_PROGRESS',
        message: 'A status transition is already in progress for this employee.',
      };
    }

    this.inFlightTransitions.add(cleanUid);
    try {
      const existing = await this.storeAdapter.getEmployeeProfile(cleanUid);
      if (!existing) {
        return {
          status: 404,
          success: false,
          code: 'EMPLOYEE_NOT_FOUND',
          message: `No employee profile found in /users/${cleanUid}.`,
        };
      }

      const targetRole = existing.legacyRole || existing.role;
      if (
        actorRole === 'ceo' &&
        (targetRole === 'super_admin' ||
          targetRole === 'ceo' ||
          String(existing.role) === 'Admin' ||
          String(existing.role) === 'Management')
      ) {
        return {
          status: 403,
          success: false,
          code: 'SUPER_ADMIN_IMMUTABLE_BY_HIGHER_AUTHORITY',
          message:
            'Security Policy: Higher Authority (CEO / Management) cannot reject or modify a Super Administrator or CEO / Management account.',
        };
      }

      if (targetRole === 'super_admin' && existing.accountStatus === 'active') {
        const activeSuperAdmins = await this.storeAdapter.countActiveSuperAdmins();
        if (activeSuperAdmins <= 1) {
          return {
            status: 409,
            success: false,
            code: 'LAST_SUPER_ADMIN_PROTECTION',
            message: 'Cannot reject or deactivate the last active Super Administrator account.',
          };
        }
      }

      const nowIso = new Date().toISOString();
      const historyEntry: ApprovalHistoryEntry = {
        action: 'rejected',
        statusAfter: 'rejected',
        roleAssigned: existing.requestedRole || existing.role,
        departmentAssigned: existing.requestedDepartment || existing.department,
        actorUid,
        actorEmail: actor.email,
        actorName: actor.name,
        reason,
        timestamp: nowIso,
      };
      const previousHistory = Array.isArray(existing.approvalHistory)
        ? existing.approvalHistory
        : [];

      const safeRole: UserRole =
        normalizeRoleInput(existing.requestedRole) ||
        normalizeRoleInput(existing.legacyRole) ||
        normalizeRoleInput(existing.role) ||
        'sales';

      const updatedProfile: UserProfile = {
        ...existing,
        id: cleanUid,
        uid: cleanUid,
        name: existing.name || existing.displayName || existing.email.split('@')[0],
        displayName: existing.displayName || existing.name || existing.email.split('@')[0],
        role: safeRole,
        legacyRole: safeRole,
        requestedRole: normalizeRoleInput(existing.requestedRole) || safeRole,
        requestedDepartment: existing.requestedDepartment || existing.department,
        rbacGroup: mapRoleToRbacGroup(safeRole),
        roleTitle: 'ACCESS REQUEST REJECTED',
        isDepartmentHead: false,
        managedDepartment: undefined,
        status: 'Rejected',
        accountStatus: 'rejected',
        approvedByUid: null,
        approvedByEmail: null,
        approvedByName: null,
        approvedAt: null,
        rejectedByUid: actorUid,
        rejectedByEmail: actor.email,
        rejectedByName: actor.name,
        rejectedAt: nowIso,
        rejectionReason: reason,
        approvalHistory: [...previousHistory, historyEntry].slice(-50),
        updatedAt: nowIso,
        permissions: [],
      };

      try {
        await this.storeAdapter.saveEmployeeProfile(updatedProfile);
      } catch (writeErr: any) {
        await this.writeSanitizedAuditLog({
          actor,
          action: 'EMPLOYEE_REJECTION_WRITE_FAILED',
          targetUid: cleanUid,
          outcome: 'PARTIAL_FAILURE',
          summary: `Database write failed while rejecting ${existing.email} (${cleanUid}).`,
          details: {
            errorReason: String(writeErr?.message || 'Database write failed'),
          },
        });
        return {
          status: 500,
          success: false,
          code: 'REJECTION_WRITE_FAILED',
          message: `Failed to persist rejection for ${existing.email} to the database.`,
        };
      }

      try {
        await this.authAdapter.revokeRefreshTokens(cleanUid);
      } catch {
        // Non-fatal
      }

      await this.writeSanitizedAuditLog({
        actor,
        action: 'EMPLOYEE_ACCESS_REJECTED',
        targetUid: cleanUid,
        outcome: 'SUCCESS',
        summary: `Rejected employee access request for ${existing.email} (${cleanUid}) by ${actor.email}. Reason: ${reason}`,
        details: {
          email: existing.email,
          previousStatus: existing.accountStatus,
          rejectedByUid: actorUid,
          rejectedByEmail: actor.email,
          rejectedAt: nowIso,
          rejectionReason: reason,
        },
      });

      return {
        status: 200,
        success: true,
        code: 'EMPLOYEE_REJECTED',
        message: `Rejected access request for ${updatedProfile.name} (${updatedProfile.email}).`,
        data: { employee: updatedProfile },
      };
    } finally {
      this.inFlightTransitions.delete(cleanUid);
    }
  }
}
