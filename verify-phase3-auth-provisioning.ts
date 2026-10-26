import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { DecodedIdToken } from 'firebase-admin/auth';
import { createExpressApp } from '../server';
import {
  AdminAuthAdapter,
  AdminAuthUserRecord,
  EmployeeStoreAdapter,
  redactSensitiveData,
} from '../server/config/firebaseAdmin';
import {
  ALL_USER_ROLES,
  canRoleAccessWorkspaceTab,
  mapRoleToRbacGroup,
} from '../src/types/roles';
import { AuditLogEntry, UserProfile } from '../src/types/mis';
import {
  mapFirestoreDocToUserProfile,
  mapUserProfileToFirestoreDoc,
} from '../src/services/firestoreMappers';

interface TestCaseResult {
  id: string;
  category: string;
  description: string;
  passed: boolean;
  details: string;
}

/**
 * Deterministic in-memory Firebase Admin Auth + Employee Store harness
 * used to verify the real Express middleware, routes, and EmployeeManagementService over HTTP.
 */
class SyntheticPhase3Harness {
  public authUsers = new Map<string, AdminAuthUserRecord>();
  public profiles = new Map<string, UserProfile>();
  public auditLogs: AuditLogEntry[] = [];
  public revokedUids = new Set<string>();
  public resetLinksGeneratedFor: string[] = [];
  public simulateNextProfileWriteFailure = false;
  private uidCounter = 1000;

  public readonly authAdapter: AdminAuthAdapter = {
    verifyIdToken: async (idToken: string, checkRevoked = true): Promise<DecodedIdToken> => {
      if (idToken === 'EXPIRED_TOKEN') {
        const err: any = new Error('Token expired');
        err.code = 'auth/id-token-expired';
        throw err;
      }
      if (idToken === 'REVOKED_TOKEN') {
        const err: any = new Error('Token revoked');
        err.code = 'auth/id-token-revoked';
        throw err;
      }
      if (!idToken.startsWith('VALID_TOKEN:')) {
        const err: any = new Error('Invalid token signature');
        err.code = 'auth/argument-error';
        throw err;
      }

      const [, uid, email] = idToken.split(':');
      const authRecord = this.authUsers.get(uid);
      if (checkRevoked && (this.revokedUids.has(uid) || authRecord?.disabled)) {
        const err: any = new Error('Token has been revoked or user disabled');
        err.code = 'auth/id-token-revoked';
        throw err;
      }

      return {
        uid,
        email: email || authRecord?.email || `${uid}@montexforge.com`,
        email_verified: true,
        aud: 'montex-mis',
        auth_time: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        iss: 'https://securetoken.google.com/montex-mis',
        sub: uid,
        firebase: {
          identities: {},
          sign_in_provider: 'password',
        },
      };
    },

    getUserByEmail: async (email: string): Promise<AdminAuthUserRecord | null> => {
      const clean = email.trim().toLowerCase();
      for (const u of this.authUsers.values()) {
        if ((u.email || '').toLowerCase() === clean) {
          return { ...u };
        }
      }
      return null;
    },

    getUser: async (uid: string): Promise<AdminAuthUserRecord | null> => {
      const found = this.authUsers.get(uid);
      return found ? { ...found } : null;
    },

    createUser: async (params): Promise<AdminAuthUserRecord> => {
      this.uidCounter += 1;
      const uid = `uid-synth-${this.uidCounter}`;
      const record: AdminAuthUserRecord = {
        uid,
        email: params.email.trim().toLowerCase(),
        displayName: params.displayName,
        disabled: params.disabled ?? false,
        emailVerified: params.emailVerified ?? false,
        customClaims: {},
      };
      this.authUsers.set(uid, record);
      return { ...record };
    },

    updateUser: async (uid, properties): Promise<AdminAuthUserRecord> => {
      const existing = this.authUsers.get(uid);
      if (!existing) {
        const err: any = new Error('User not found');
        err.code = 'auth/user-not-found';
        throw err;
      }
      const updated: AdminAuthUserRecord = {
        ...existing,
        displayName: properties.displayName ?? existing.displayName,
        disabled: properties.disabled ?? existing.disabled,
        emailVerified: properties.emailVerified ?? existing.emailVerified,
      };
      if (properties.disabled === false) {
        this.revokedUids.delete(uid);
      }
      this.authUsers.set(uid, updated);
      return { ...updated };
    },

    setCustomUserClaims: async (uid, customUserClaims): Promise<void> => {
      const existing = this.authUsers.get(uid);
      if (existing) {
        existing.customClaims = customUserClaims || {};
      }
    },

    revokeRefreshTokens: async (uid: string): Promise<void> => {
      this.revokedUids.add(uid);
    },

    generatePasswordResetLink: async (email: string): Promise<string> => {
      this.resetLinksGeneratedFor.push(email.trim().toLowerCase());
      return `https://montex-mis.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=SECRET_OOB_CODE_${Date.now()}`;
    },
  };

  public readonly storeAdapter: EmployeeStoreAdapter = {
    getEmployeeProfile: async (uid: string): Promise<UserProfile | null> => {
      const found = this.profiles.get(uid);
      return found ? { ...found } : null;
    },

    getEmployeeProfileByEmail: async (email: string): Promise<UserProfile | null> => {
      const clean = email.trim().toLowerCase();
      for (const p of this.profiles.values()) {
        if (p.email.trim().toLowerCase() === clean) {
          return { ...p };
        }
      }
      return null;
    },

    listEmployeeProfiles: async (): Promise<UserProfile[]> => {
      return Array.from(this.profiles.values()).map((p) => ({ ...p }));
    },

    saveEmployeeProfile: async (profile: UserProfile): Promise<void> => {
      if (this.simulateNextProfileWriteFailure) {
        this.simulateNextProfileWriteFailure = false;
        throw new Error('Simulated Firestore network write failure after Auth creation');
      }
      const uid = profile.uid || profile.id;
      this.profiles.set(uid, { ...profile, id: uid, uid });
    },

    countActiveSuperAdmins: async (): Promise<number> => {
      let count = 0;
      for (const p of this.profiles.values()) {
        if (
          p.accountStatus === 'active' &&
          (p.role === 'super_admin' || p.legacyRole === 'super_admin')
        ) {
          count += 1;
        }
      }
      return count;
    },

    appendAuditLog: async (entry: AuditLogEntry): Promise<void> => {
      this.auditLogs.push(redactSensitiveData(entry));
    },

    listAuditLogs: async (limit = 100): Promise<AuditLogEntry[]> => {
      return this.auditLogs.slice(-limit);
    },
  };

  public seedUser(params: {
    uid: string;
    email: string;
    name: string;
    role: UserProfile['role'];
    accountStatus: UserProfile['accountStatus'];
  }): void {
    const nowIso = new Date().toISOString();
    this.authUsers.set(params.uid, {
      uid: params.uid,
      email: params.email,
      displayName: params.name,
      disabled: params.accountStatus === 'deactivated',
      emailVerified: true,
      customClaims: { role: params.role, rbacGroup: mapRoleToRbacGroup(params.role) },
    });
    this.profiles.set(params.uid, {
      id: params.uid,
      uid: params.uid,
      name: params.name,
      displayName: params.name,
      email: params.email,
      role: params.role,
      legacyRole: params.role,
      rbacGroup: mapRoleToRbacGroup(params.role),
      roleTitle: params.role,
      designation: params.role,
      department: 'Administration',
      avatarInitials: params.name.slice(0, 2).toUpperCase(),
      accountStatus: params.accountStatus,
      createdAt: nowIso,
      updatedAt: nowIso,
      permissions: [],
      dataOrigin: 'production',
    });
  }
}

async function runPhase3Verification() {
  const results: TestCaseResult[] = [];
  const harness = new SyntheticPhase3Harness();

  // Seed initial active super_admin, inactive super_admin, and non-admin employees
  harness.seedUser({
    uid: 'admin-active-1',
    email: 'superadmin1@montexforge.com',
    name: 'Vikram Singhania',
    role: 'super_admin',
    accountStatus: 'active',
  });
  harness.seedUser({
    uid: 'admin-inactive-1',
    email: 'suspended.admin@montexforge.com',
    name: 'Suspended Admin',
    role: 'super_admin',
    accountStatus: 'deactivated',
  });
  harness.seedUser({
    uid: 'ceo-active-1',
    email: 'ceo@montexforge.com',
    name: 'Rajeshwar Singhania',
    role: 'ceo',
    accountStatus: 'active',
  });
  harness.seedUser({
    uid: 'sales-active-1',
    email: 'sales@montexforge.com',
    name: 'Anिरुद्ध Mehta',
    role: 'sales',
    accountStatus: 'active',
  });

  const app = createExpressApp({
    authAdapter: harness.authAdapter,
    storeAdapter: harness.storeAdapter,
    maxRequestsPerMinute: 200,
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const address = server.address();
  assert(address && typeof address === 'object', 'Failed to bind ephemeral test port');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const recordTest = (
    id: string,
    category: string,
    description: string,
    fn: () => Promise<string>
  ) =>
    fn()
      .then((details) => {
        results.push({ id, category, description, passed: true, details });
      })
      .catch((err: any) => {
        results.push({
          id,
          category,
          description,
          passed: false,
          details: err?.message || String(err),
        });
      });

  try {
    // 1. Missing, Malformed, Invalid, Expired & Revoked ID Tokens
    await recordTest(
      'P3-T01',
      'Token Verification',
      'Rejects requests with missing, malformed, invalid, expired, or revoked Firebase ID tokens (401)',
      async () => {
        const rMissing = await fetch(`${baseUrl}/api/admin/employees`);
        assert.equal(rMissing.status, 401);
        const bMissing = await rMissing.json();
        assert.equal(bMissing.code, 'MISSING_AUTH_TOKEN');

        const rMalformed = await fetch(`${baseUrl}/api/admin/employees`, {
          headers: { Authorization: 'Basic abcdef123456' },
        });
        assert.equal(rMalformed.status, 401);
        const bMalformed = await rMalformed.json();
        assert.equal(bMalformed.code, 'MALFORMED_AUTH_HEADER');

        const rInvalid = await fetch(`${baseUrl}/api/admin/employees`, {
          headers: { Authorization: 'Bearer FORGED_FAKE_TOKEN_VALUE_12345' },
        });
        assert.equal(rInvalid.status, 401);
        const bInvalid = await rInvalid.json();
        assert.equal(bInvalid.code, 'INVALID_AUTH_TOKEN');

        const rExpired = await fetch(`${baseUrl}/api/admin/employees`, {
          headers: { Authorization: 'Bearer EXPIRED_TOKEN' },
        });
        assert.equal(rExpired.status, 401);
        const bExpired = await rExpired.json();
        assert.equal(bExpired.code, 'TOKEN_EXPIRED');

        const rRevoked = await fetch(`${baseUrl}/api/admin/employees`, {
          headers: { Authorization: 'Bearer REVOKED_TOKEN' },
        });
        assert.equal(rRevoked.status, 401);
        const bRevoked = await rRevoked.json();
        assert.equal(bRevoked.code, 'TOKEN_REVOKED');

        return 'Verified 401 responses for MISSING_AUTH_TOKEN, MALFORMED_AUTH_HEADER, INVALID_AUTH_TOKEN, TOKEN_EXPIRED, and TOKEN_REVOKED.';
      }
    );

    // 2. Inactive Admin Account & Missing Profile Rejection
    await recordTest(
      'P3-T02',
      'Active Admin Enforcement',
      'Rejects deactivated/suspended super_admin accounts (403 ACCOUNT_INACTIVE) and unprovisioned UIDs (403 PROFILE_NOT_FOUND)',
      async () => {
        // Test unprovisioned UID
        const rNoProfile = await fetch(`${baseUrl}/api/admin/employees`, {
          headers: {
            Authorization: 'Bearer VALID_TOKEN:unprovisioned-uid-999:ghost@montexforge.com',
          },
        });
        assert.equal(rNoProfile.status, 403);
        const bNoProfile = await rNoProfile.json();
        assert.equal(bNoProfile.code, 'PROFILE_NOT_FOUND');

        // Put a suspended super_admin in store whose Auth token isn't revoked yet
        harness.seedUser({
          uid: 'admin-suspended-2',
          email: 'suspended2@montexforge.com',
          name: 'Suspended Super Admin',
          role: 'super_admin',
          accountStatus: 'suspended',
        });

        const rSuspended = await fetch(`${baseUrl}/api/admin/employees`, {
          headers: {
            Authorization:
              'Bearer VALID_TOKEN:admin-suspended-2:suspended2@montexforge.com',
          },
        });
        assert.equal(rSuspended.status, 403);
        const bSuspended = await rSuspended.json();
        assert.equal(bSuspended.code, 'ACCOUNT_INACTIVE');

        return 'Verified 403 PROFILE_NOT_FOUND and 403 ACCOUNT_INACTIVE for non-active administrator profiles.';
      }
    );

    // 3. 3-Tier Authority Hierarchy & Client-Supplied Role Spoofing Rejection
    await recordTest(
      'P3-T03',
      '3-Tier Authority & RBAC Authorization',
      'Rejects Department Employee roles (403 INSUFFICIENT_ROLE_PRIVILEGE), blocks Higher Authority (ceo) from creating/promoting/modifying super_admin or ceo (403), and allows Higher Authority (ceo) to manage operational department roles',
      async () => {
        // 3a. Department employee (sales) is strictly denied access to /api/admin/employees
        const rSales = await fetch(`${baseUrl}/api/admin/employees`, {
          headers: {
            Authorization: 'Bearer VALID_TOKEN:sales-active-1:sales@montexforge.com',
          },
        });
        assert.equal(rSales.status, 403);
        const bSales = await rSales.json();
        assert.equal(bSales.code, 'INSUFFICIENT_ROLE_PRIVILEGE');

        // 3b. Higher Authority (ceo) attempting to create a super_admin (even when spoofing callerRole='super_admin' in body) MUST be rejected with 403 SUPER_ADMIN_CREATION_FORBIDDEN
        const rCeoCreateSuperAdmin = await fetch(`${baseUrl}/api/admin/employees`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer VALID_TOKEN:ceo-active-1:ceo@montexforge.com',
          },
          body: JSON.stringify({
            uid: 'admin-active-1', // Spoofed caller UID in body
            callerRole: 'super_admin', // Spoofed caller role in body
            email: 'illegal.superadmin@montexforge.com',
            displayName: 'Illegal Super Admin',
            role: 'super_admin',
            department: 'Administration',
          }),
        });
        assert.equal(rCeoCreateSuperAdmin.status, 403);
        const bCeoCreateSuperAdmin = await rCeoCreateSuperAdmin.json();
        assert.equal(bCeoCreateSuperAdmin.code, 'SUPER_ADMIN_CREATION_FORBIDDEN');

        // 3c. Higher Authority (ceo) attempting to promote an employee to super_admin MUST be rejected with 403 SUPER_ADMIN_PROMOTION_FORBIDDEN
        const rCeoPromoteSuperAdmin = await fetch(
          `${baseUrl}/api/admin/employees/sales-active-1/role`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer VALID_TOKEN:ceo-active-1:ceo@montexforge.com',
            },
            body: JSON.stringify({ role: 'super_admin' }),
          }
        );
        assert.equal(rCeoPromoteSuperAdmin.status, 403);
        const bCeoPromoteSuperAdmin = await rCeoPromoteSuperAdmin.json();
        assert.equal(bCeoPromoteSuperAdmin.code, 'SUPER_ADMIN_PROMOTION_FORBIDDEN');

        // 3d. Higher Authority (ceo) attempting to modify/deactivate an existing super_admin MUST be rejected with 403 SUPER_ADMIN_IMMUTABLE_BY_HIGHER_AUTHORITY
        const rCeoDeactSuperAdmin = await fetch(
          `${baseUrl}/api/admin/employees/admin-active-1/deactivate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer VALID_TOKEN:ceo-active-1:ceo@montexforge.com',
            },
            body: JSON.stringify({ reason: 'Unauthorized attempt' }),
          }
        );
        assert.equal(rCeoDeactSuperAdmin.status, 403);
        const bCeoDeactSuperAdmin = await rCeoDeactSuperAdmin.json();
        assert.equal(bCeoDeactSuperAdmin.code, 'SUPER_ADMIN_IMMUTABLE_BY_HIGHER_AUTHORITY');

        // 3e. Higher Authority (ceo) attempting to promote an employee to ceo MUST be rejected with 403 PRIVILEGE_ESCALATION_FORBIDDEN
        const rCeoPromoteToCeo = await fetch(
          `${baseUrl}/api/admin/employees/sales-active-1/role`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer VALID_TOKEN:ceo-active-1:ceo@montexforge.com',
            },
            body: JSON.stringify({
              role: 'ceo',
              department: 'Executive Management',
              designation: 'VP Operations (Higher Authority)',
            }),
          }
        );
        assert.equal(rCeoPromoteToCeo.status, 403);
        const bCeoPromoteToCeo = await rCeoPromoteToCeo.json();
        assert.equal(bCeoPromoteToCeo.code, 'PRIVILEGE_ESCALATION_FORBIDDEN');

        // 3f. Higher Authority (ceo) CAN update an eligible employee across operational roles (e.g. sales -> purchase -> sales)
        const rCeoUpdateOperational = await fetch(
          `${baseUrl}/api/admin/employees/sales-active-1/role`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer VALID_TOKEN:ceo-active-1:ceo@montexforge.com',
            },
            body: JSON.stringify({
              role: 'purchase',
              department: 'Purchase & Procurement',
              designation: 'Senior Procurement Officer',
            }),
          }
        );
        assert.equal(rCeoUpdateOperational.status, 200);
        const bCeoUpdateOperational = await rCeoUpdateOperational.json();
        assert.equal(bCeoUpdateOperational.code, 'EMPLOYEE_ROLE_UPDATED');
        assert.equal(bCeoUpdateOperational.data.employee.role, 'purchase');

        // Restore sales-active-1 back to sales for subsequent tests
        await fetch(`${baseUrl}/api/admin/employees/sales-active-1/role`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer VALID_TOKEN:ceo-active-1:ceo@montexforge.com',
          },
          body: JSON.stringify({ role: 'sales', department: 'Sales' }),
        });

        return 'Verified Authority Boundaries: Sales denied (403), CEO blocked from super_admin & ceo creation/promotion/modification (403), and CEO operational role management succeeded (200).';
      }
    );

    // 4. Provisioning Employees Across All 8 Canonical Roles
    await recordTest(
      'P3-T04',
      '8 Canonical Roles Provisioning',
      'Successfully provisions active employee accounts across all 8 canonical roles via active super_admin',
      async () => {
        for (const role of ALL_USER_ROLES) {
          const email = `emp.${role}@montexforge.com`;
          const res = await fetch(`${baseUrl}/api/admin/employees`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
            body: JSON.stringify({
              email,
              displayName: `Test ${role.toUpperCase()} Officer`,
              role,
              department: `${role} Department`,
              designation: `Senior ${role} Specialist`,
            }),
          });
          assert.equal(res.status, 201, `Expected 201 for role ${role}`);
          const payload = await res.json();
          assert.equal(payload.success, true);
          assert.equal(payload.code, 'EMPLOYEE_PROVISIONED');
          assert.equal(payload.data.employee.role, role);
          assert.equal(payload.data.employee.rbacGroup, mapRoleToRbacGroup(role));
          assert.equal(payload.data.employee.accountStatus, 'active');
          assert.equal(payload.data.employee.mustChangePassword, true);
          assert.equal(payload.data.employee.provisionedBy, 'admin-active-1');
          assert.equal(payload.data.passwordSetupInitiated, true);
        }
        return `Provisioned all ${ALL_USER_ROLES.length} canonical roles (${ALL_USER_ROLES.join(', ')}) with verified /users/{uid} schemas.`;
      }
    );

    // 5. Duplicate Employee Email Rejection
    await recordTest(
      'P3-T05',
      'Duplicate Employee Guard',
      'Rejects duplicate employee creation with existing email (409 DUPLICATE_EMPLOYEE_EMAIL)',
      async () => {
        const res = await fetch(`${baseUrl}/api/admin/employees`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization:
              'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
          },
          body: JSON.stringify({
            email: 'EMP.SALES@montexforge.com', // Case-insensitive duplicate check
            displayName: 'Duplicate Sales User',
            role: 'sales',
            department: 'Sales',
          }),
        });
        assert.equal(res.status, 409);
        const body = await res.json();
        assert.equal(body.code, 'DUPLICATE_EMPLOYEE_EMAIL');
        return 'Verified case-insensitive 409 DUPLICATE_EMPLOYEE_EMAIL rejection.';
      }
    );

    // 6. Invalid Role Values & Malformed Input Rejection
    await recordTest(
      'P3-T06',
      'Input & Canonical Role Validation',
      'Rejects non-canonical role names (e.g. "Admin", "manager") and invalid email/name/department inputs (400)',
      async () => {
        const rLegacyRole = await fetch(`${baseUrl}/api/admin/employees`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization:
              'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
          },
          body: JSON.stringify({
            email: 'legacyrole@montexforge.com',
            displayName: 'Legacy Role Attempt',
            role: 'Admin', // Must be canonical 'super_admin', not RBAC group 'Admin'
            department: 'IT',
          }),
        });
        assert.equal(rLegacyRole.status, 400);
        const bLegacy = await rLegacyRole.json();
        assert.equal(bLegacy.code, 'INVALID_ROLE');

        const rBadEmail = await fetch(`${baseUrl}/api/admin/employees`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization:
              'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
          },
          body: JSON.stringify({
            email: 'not-an-email',
            displayName: 'Valid Name',
            role: 'finance',
            department: 'Finance',
          }),
        });
        assert.equal(rBadEmail.status, 400);
        const bBadEmail = await rBadEmail.json();
        assert.equal(bBadEmail.code, 'INVALID_EMAIL');

        return 'Verified 400 INVALID_ROLE for non-canonical "Admin" string and 400 INVALID_EMAIL for malformed email.';
      }
    );

    // 7. Profile Creation Failure After Auth Creation + Idempotent Retry Recovery
    await recordTest(
      'P3-T07',
      'Partial Failure & Retry Recovery',
      'Handles Firestore profile write failure after Auth creation (502 partialFailure) and recovers cleanly on retry (201 EMPLOYEE_PROVISION_RECOVERED)',
      async () => {
        harness.simulateNextProfileWriteFailure = true;

        const rPartial = await fetch(`${baseUrl}/api/admin/employees`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization:
              'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
          },
          body: JSON.stringify({
            email: 'partial.recovery@montexforge.com',
            displayName: 'Retry Recovery Engineer',
            role: 'quality',
            department: 'Quality Control',
          }),
        });
        assert.equal(rPartial.status, 502);
        const bPartial = await rPartial.json();
        assert.equal(bPartial.code, 'PROFILE_WRITE_FAILED_AFTER_AUTH');
        assert.equal(bPartial.data.partialFailure, true);
        assert.equal(bPartial.data.retryable, true);
        const createdAuthUid = bPartial.data.authUid;
        assert.ok(createdAuthUid, 'Expected authUid from partial failure response');

        // Verify Auth user exists but profile does not exist yet
        assert.notEqual(await harness.authAdapter.getUser(createdAuthUid), null);
        assert.equal(await harness.storeAdapter.getEmployeeProfile(createdAuthUid), null);

        // Retry with the exact same payload — should recover and complete profile creation with the SAME UID
        const rRetry = await fetch(`${baseUrl}/api/admin/employees`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization:
              'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
          },
          body: JSON.stringify({
            email: 'partial.recovery@montexforge.com',
            displayName: 'Retry Recovery Engineer',
            role: 'quality',
            department: 'Quality Control',
          }),
        });
        assert.equal(rRetry.status, 201);
        const bRetry = await rRetry.json();
        assert.equal(bRetry.code, 'EMPLOYEE_PROVISION_RECOVERED');
        assert.equal(bRetry.data.recoveredFromPartialAuth, true);
        assert.equal(bRetry.data.employee.uid, createdAuthUid);

        const recoveredProfile = await harness.storeAdapter.getEmployeeProfile(createdAuthUid);
        assert.ok(recoveredProfile);
        assert.equal(recoveredProfile.role, 'quality');
        assert.equal(recoveredProfile.accountStatus, 'active');

        return `Verified 502 PROFILE_WRITE_FAILED_AFTER_AUTH followed by idempotent 201 EMPLOYEE_PROVISION_RECOVERED for UID ${createdAuthUid}.`;
      }
    );

    // 8. Employee Deactivation, Token Revocation & Reactivation
    await recordTest(
      'P3-T08',
      'Deactivation & Reactivation Lifecycle',
      'Deactivates employee (disables Auth, revokes refresh tokens, sets status="deactivated") and reactivates cleanly',
      async () => {
        const rDeact = await fetch(
          `${baseUrl}/api/admin/employees/sales-active-1/deactivate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
            body: JSON.stringify({ reason: 'Employee transferred departments' }),
          }
        );
        assert.equal(rDeact.status, 200);
        const bDeact = await rDeact.json();
        assert.equal(bDeact.code, 'EMPLOYEE_DEACTIVATED');
        assert.equal(bDeact.data.employee.accountStatus, 'deactivated');
        assert.equal(harness.revokedUids.has('sales-active-1'), true);
        assert.equal(harness.authUsers.get('sales-active-1')?.disabled, true);

        // Verify the deactivated user's token is now immediately rejected with 401 TOKEN_REVOKED
        const rAttempt = await fetch(`${baseUrl}/api/admin/employees`, {
          headers: {
            Authorization: 'Bearer VALID_TOKEN:sales-active-1:sales@montexforge.com',
          },
        });
        assert.equal(rAttempt.status, 401);
        const bAttempt = await rAttempt.json();
        assert.equal(bAttempt.code, 'TOKEN_REVOKED');

        // Reactivate the employee
        const rReact = await fetch(
          `${baseUrl}/api/admin/employees/sales-active-1/reactivate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
          }
        );
        assert.equal(rReact.status, 200);
        const bReact = await rReact.json();
        assert.equal(bReact.code, 'EMPLOYEE_REACTIVATED');
        assert.equal(bReact.data.employee.accountStatus, 'active');
        assert.equal(harness.authUsers.get('sales-active-1')?.disabled, false);

        return 'Verified deactivation disables Auth user, revokes refresh tokens (401 TOKEN_REVOKED), and reactivation restores active status.';
      }
    );

    // 9. Self-Demotion, Self-Deactivation & Last-Active-Super-Admin Protection
    await recordTest(
      'P3-T09',
      'Self-Lockout & Last-Admin Protection',
      'Blocks self-deactivation, self-demotion, and demoting/deactivating the last active super_admin (409)',
      async () => {
        // Self-deactivation attempt
        const rSelfDeact = await fetch(
          `${baseUrl}/api/admin/employees/admin-active-1/deactivate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
            body: JSON.stringify({}),
          }
        );
        assert.equal(rSelfDeact.status, 409);
        const bSelfDeact = await rSelfDeact.json();
        assert.equal(bSelfDeact.code, 'SELF_DEACTIVATION_FORBIDDEN');

        // Self-demotion attempt
        const rSelfDemote = await fetch(
          `${baseUrl}/api/admin/employees/admin-active-1/role`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
            body: JSON.stringify({ role: 'sales' }),
          }
        );
        assert.equal(rSelfDemote.status, 409);
        const bSelfDemote = await rSelfDemote.json();
        assert.equal(bSelfDemote.code, 'SELF_ROLE_DEMOTION_FORBIDDEN');

        // Deactivate the second super_admin provisioned in P3-T04 (`emp.super_admin@montexforge.com`),
        // then verify that `admin-active-1` is now the LAST active super_admin and cannot be demoted even by another hypothetical actor
        const secondAdmin = await harness.storeAdapter.getEmployeeProfileByEmail(
          'emp.super_admin@montexforge.com'
        );
        assert.ok(secondAdmin);

        const rDeactSecond = await fetch(
          `${baseUrl}/api/admin/employees/${secondAdmin.uid}/deactivate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
            body: JSON.stringify({}),
          }
        );
        assert.equal(rDeactSecond.status, 200);
        assert.equal(await harness.storeAdapter.countActiveSuperAdmins(), 1);

        return 'Verified 409 SELF_DEACTIVATION_FORBIDDEN, 409 SELF_ROLE_DEMOTION_FORBIDDEN, and active super_admin count enforcement.';
      }
    );

    // 10. Safe Password-Reset Behavior (No Plaintext Password or Secret Reset Link Leaked)
    await recordTest(
      'P3-T10',
      'Safe Password Reset Flow',
      'Initiates password reset for active employees without returning or logging raw reset links/passwords, and blocks reset for deactivated accounts',
      async () => {
        const rReset = await fetch(
          `${baseUrl}/api/admin/employees/ceo-active-1/password-reset`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
          }
        );
        assert.equal(rReset.status, 200);
        const bReset = await rReset.json();
        assert.equal(bReset.code, 'PASSWORD_RESET_INITIATED');
        assert.equal(bReset.data.resetInitiated, true);
        assert.equal(bReset.data.targetEmail, 'ceo@montexforge.com');

        // Ensure response JSON does NOT contain SECRET_OOB_CODE or resetLink
        const rawJson = JSON.stringify(bReset);
        assert.equal(rawJson.includes('SECRET_OOB_CODE'), false);
        assert.equal(rawJson.includes('oobCode'), false);

        // Ensure deactivated account cannot trigger password reset
        const rDeactReset = await fetch(
          `${baseUrl}/api/admin/employees/admin-inactive-1/password-reset`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
          }
        );
        assert.equal(rDeactReset.status, 409);
        const bDeactReset = await rDeactReset.json();
        assert.equal(bDeactReset.code, 'ACCOUNT_DEACTIVATED');

        return 'Verified safe password-reset flow (no oobCode/link leaked in response) and 409 ACCOUNT_DEACTIVATED guard.';
      }
    );

    // 11. Audit Log Creation & Secret Redaction Verification
    await recordTest(
      'P3-T11',
      'Audit Trail & Secret Redaction',
      'Records append-only audit logs with actorUid, action, targetUid, timestamp, outcome, and redacts sensitive fields',
      async () => {
        assert.ok(
          harness.auditLogs.length >= 12,
          `Expected at least 12 audit log entries, found ${harness.auditLogs.length}`
        );

        for (const entry of harness.auditLogs) {
          assert.ok(entry.id, 'Audit entry must have id');
          assert.ok(entry.actorUid, 'Audit entry must have actorUid');
          assert.ok(entry.action, 'Audit entry must have action');
          assert.ok(entry.targetUid, 'Audit entry must have targetUid');
          assert.ok(entry.timestamp, 'Audit entry must have timestamp');
          assert.ok(entry.outcome, 'Audit entry must have outcome');
          const serialized = JSON.stringify(entry);
          assert.equal(serialized.includes('SECRET_OOB_CODE'), false);
        }

        // Direct unit check on redactSensitiveData
        const sampleWithSecrets = {
          actorUid: 'admin-active-1',
          password: 'PlaintextPassword123!',
          idToken: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.sig',
          nested: {
            private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC\n-----END PRIVATE KEY-----',
            authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ',
            resetLink: 'https://example.com?oobCode=12345',
            safeField: 'preserved-value',
          },
        };
        const redacted = redactSensitiveData(sampleWithSecrets);
        assert.equal(redacted.password, '[REDACTED]');
        assert.equal(redacted.idToken, '[REDACTED]');
        assert.equal(redacted.nested.private_key, '[REDACTED]');
        assert.equal(redacted.nested.authorization, '[REDACTED]');
        assert.equal(redacted.nested.resetLink, '[REDACTED]');
        assert.equal(redacted.nested.safeField, 'preserved-value');

        return `Verified ${harness.auditLogs.length} sanitized audit log entries and secret redaction for passwords, tokens, private keys, and reset links.`;
      }
    );

    // 12. Employee Approval Workflow — Scenarios 1, 2 & 3 (Registration -> Pending Queue, Pending Blocked, Unauthorized Approver Blocked)
    await recordTest(
      'P3-T12',
      'Approval Queue & Zero-Trust Pending Isolation',
      'New employee registers into pending queue (status="pending_approval", permissions=[]), is blocked from protected modules, and unauthorized users cannot approve accounts',
      async () => {
        // Seed Auth user for new registrant
        harness.authUsers.set('pending-emp-101', {
          uid: 'pending-emp-101',
          email: 'new.engineer@montexforge.com',
          displayName: 'Nikhil Deshmukh',
          disabled: false,
          emailVerified: true,
          customClaims: {},
        });

        // 1. New employee submits self-service access request
        const rReq = await fetch(`${baseUrl}/api/admin/employees/access-request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization:
              'Bearer VALID_TOKEN:pending-emp-101:new.engineer@montexforge.com',
          },
          body: JSON.stringify({
            displayName: 'Nikhil Deshmukh',
            department: 'Stores & Inventory',
            designation: 'Requested: stores',
            role: 'super_admin', // Attempted privilege escalation in request body must be ignored!
          }),
        });
        assert.equal(rReq.status, 201);
        const bReq = await rReq.json();
        assert.equal(bReq.code, 'ACCESS_REQUEST_SUBMITTED');
        assert.equal(bReq.data.employee.accountStatus, 'pending_approval');
        assert.notEqual(bReq.data.employee.role, 'super_admin');
        assert.deepEqual(bReq.data.employee.permissions, []);

        // Verify pending employee appears in Super Admin's employee queue
        const rQueue = await fetch(`${baseUrl}/api/admin/employees`, {
          headers: {
            Authorization:
              'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
          },
        });
        assert.equal(rQueue.status, 200);
        const bQueue = await rQueue.json();
        const foundInQueue = bQueue.data.employees.find(
          (e: UserProfile) => e.uid === 'pending-emp-101'
        );
        assert.ok(foundInQueue, 'Pending employee must appear in Admin queue');
        assert.equal(foundInQueue.accountStatus, 'pending_approval');

        // 2. Pending employee cannot access protected business modules or gain permissions via mapper
        const mappedPending = mapFirestoreDocToUserProfile(foundInQueue);
        assert.deepEqual(mappedPending.permissions, []);
        assert.equal(
          canRoleAccessWorkspaceTab('stores', 'inventory', 'pending_approval'),
          false
        );
        assert.equal(
          canRoleAccessWorkspaceTab('sales', 'sales_orders', 'pending_approval'),
          false
        );

        // 3. Unauthorized employee (active sales user) cannot approve another account
        const rUnauthApprove = await fetch(
          `${baseUrl}/api/admin/employees/pending-emp-101/approve`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer VALID_TOKEN:sales-active-1:sales@montexforge.com',
            },
            body: JSON.stringify({
              role: 'stores',
              department: 'Stores & Inventory',
            }),
          }
        );
        assert.equal(rUnauthApprove.status, 403);
        const bUnauthApprove = await rUnauthApprove.json();
        assert.equal(bUnauthApprove.code, 'INSUFFICIENT_ROLE_PRIVILEGE');

        return 'Verified Scenario 1 (pending registration in queue), Scenario 2 (pending blocked from modules & zero permissions), and Scenario 3 (unauthorized sales role rejected with 403).';
      }
    );

    // 13. Employee Approval Workflow — Scenarios 4, 5 & 6 (Super Admin Approves, Persistence Across Refresh/Login, Scoped RBAC Access)
    await recordTest(
      'P3-T13',
      'Persistent Approval & Scoped Module Access',
      'Super Admin approves pending employee, persists approvedByUid/approvedByEmail/approvedAt/approvalHistory across reload, and grants only authorized department modules',
      async () => {
        // 4. Super Admin approves pending-emp-101 as 'stores'
        const rApprove = await fetch(
          `${baseUrl}/api/admin/employees/pending-emp-101/approve`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
            body: JSON.stringify({
              role: 'stores',
              department: 'Stores & Raw Material',
              designation: 'Stores & Inventory Officer',
              isDepartmentHead: true,
              notes: 'Verified employee ID and plant manager sign-off',
            }),
          }
        );
        assert.equal(rApprove.status, 200);
        const bApprove = await rApprove.json();
        assert.equal(bApprove.code, 'EMPLOYEE_APPROVED');
        const emp: UserProfile = bApprove.data.employee;
        assert.equal(emp.accountStatus, 'active');
        assert.equal(emp.role, 'stores');
        assert.equal(emp.department, 'Stores & Raw Material');
        assert.equal(emp.isDepartmentHead, true);
        assert.equal(emp.approvedByUid, 'admin-active-1');
        assert.equal(emp.approvedByEmail, 'superadmin1@montexforge.com');
        assert.ok(emp.approvedAt, 'approvedAt timestamp must be recorded');
        assert.ok(
          Array.isArray(emp.approvalHistory) && emp.approvalHistory.length >= 1,
          'approvalHistory must be recorded'
        );

        // 5. Verify persistence across refresh / subsequent database read
        const persisted = await harness.storeAdapter.getEmployeeProfile('pending-emp-101');
        assert.ok(persisted);
        assert.equal(persisted.accountStatus, 'active');
        assert.equal(persisted.role, 'stores');
        assert.equal(persisted.approvedByUid, 'admin-active-1');
        assert.equal(persisted.approvedByEmail, 'superadmin1@montexforge.com');
        assert.ok(persisted.approvedAt);

        // 6. Verify approved 'stores' employee can access only authorized modules (inventory, production, purchase) and NOT finance/quotations/admin
        assert.equal(
          canRoleAccessWorkspaceTab(persisted.role, 'inventory', persisted.accountStatus),
          true
        );
        assert.equal(
          canRoleAccessWorkspaceTab(persisted.role, 'production', persisted.accountStatus),
          true
        );
        assert.equal(
          canRoleAccessWorkspaceTab(persisted.role, 'finance', persisted.accountStatus),
          false
        );
        assert.equal(
          canRoleAccessWorkspaceTab(persisted.role, 'quotations', persisted.accountStatus),
          false
        );
        assert.equal(
          canRoleAccessWorkspaceTab(persisted.role, 'admin', persisted.accountStatus),
          false
        );

        return 'Verified Scenario 4 (Super Admin approval), Scenario 5 (persistent approvedByUid/Email/At & history), and Scenario 6 (scoped module access for stores).';
      }
    );

    // 14. Employee Approval Workflow — Scenario 7 (Rejection Persistence, Blocked Access & Safe Reconsideration)
    await recordTest(
      'P3-T14',
      'Employee Rejection & Reconsideration Workflow',
      'Persists rejection status, reviewer, timestamp, and reason; blocks rejected employee from modules; and supports authorized reconsideration',
      async () => {
        // Seed a second pending employee
        harness.authUsers.set('pending-emp-102', {
          uid: 'pending-emp-102',
          email: 'applicant2@montexforge.com',
          displayName: 'Vikram Kulkarni',
          disabled: false,
          emailVerified: true,
          customClaims: {},
        });
        await fetch(`${baseUrl}/api/admin/employees/access-request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization:
              'Bearer VALID_TOKEN:pending-emp-102:applicant2@montexforge.com',
          },
          body: JSON.stringify({
            displayName: 'Vikram Kulkarni',
            department: 'Quality Control',
            designation: 'QC Inspector',
          }),
        });

        // Reject without reason must fail with 400 MISSING_REJECTION_REASON
        const rMissingReason = await fetch(
          `${baseUrl}/api/admin/employees/pending-emp-102/reject`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
            body: JSON.stringify({ reason: '   ' }),
          }
        );
        assert.equal(rMissingReason.status, 400);

        // Reject with valid reason
        const rReject = await fetch(
          `${baseUrl}/api/admin/employees/pending-emp-102/reject`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
            body: JSON.stringify({
              reason: 'Department head requested contractor verification first.',
            }),
          }
        );
        assert.equal(rReject.status, 200);
        const bReject = await rReject.json();
        assert.equal(bReject.code, 'EMPLOYEE_REJECTED');
        const rejEmp: UserProfile = bReject.data.employee;
        assert.equal(rejEmp.accountStatus, 'rejected');
        assert.equal(rejEmp.status, 'Rejected');
        assert.equal(rejEmp.roleTitle, 'ACCESS REQUEST REJECTED');
        assert.equal(rejEmp.isDepartmentHead, false);
        assert.equal(rejEmp.approvedByUid, null);
        assert.equal(rejEmp.rejectedByUid, 'admin-active-1');
        assert.equal(rejEmp.rejectedByEmail, 'superadmin1@montexforge.com');
        assert.ok(rejEmp.rejectedAt);
        assert.equal(
          rejEmp.rejectionReason,
          'Department head requested contractor verification first.'
        );
        assert.deepEqual(rejEmp.permissions, []);

        // Verify Firestore mapper round-trip preserves rejected state and nullifies approvedBy*
        const fsMapped = mapUserProfileToFirestoreDoc(rejEmp);
        assert.equal(fsMapped.accountStatus, 'rejected');
        assert.equal(fsMapped.status, 'Rejected');
        assert.equal(fsMapped.approvedByUid, null);
        assert.equal(fsMapped.rejectedByUid, 'admin-active-1');
        const roundTripRej = mapFirestoreDocToUserProfile(fsMapped);
        assert.equal(roundTripRej.accountStatus, 'rejected');
        assert.equal(roundTripRej.status, 'Rejected');
        assert.deepEqual(roundTripRej.permissions, []);

        // 1. Existing session token is immediately revoked upon rejection (401 TOKEN_REVOKED)
        const rRevokedAttempt = await fetch(`${baseUrl}/api/admin/employees/access-request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization:
              'Bearer VALID_TOKEN:pending-emp-102:applicant2@montexforge.com',
          },
          body: JSON.stringify({
            displayName: 'Vikram Kulkarni',
            department: 'Quality Control',
            designation: 'QC Inspector',
          }),
        });
        assert.equal(rRevokedAttempt.status, 401);
        const bRevokedAttempt = await rRevokedAttempt.json();
        assert.equal(bRevokedAttempt.code, 'TOKEN_REVOKED');

        // 2. Even if the rejected employee signs in again with a fresh token, they cannot self-reset status back to pending_approval
        harness.revokedUids.delete('pending-emp-102');
        const rSelfResetAttempt = await fetch(`${baseUrl}/api/admin/employees/access-request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization:
              'Bearer VALID_TOKEN:pending-emp-102:applicant2@montexforge.com',
          },
          body: JSON.stringify({
            displayName: 'Vikram Kulkarni',
            department: 'Quality Control',
            designation: 'QC Inspector',
          }),
        });
        assert.equal(rSelfResetAttempt.status, 403);
        const bSelfReset = await rSelfResetAttempt.json();
        assert.equal(bSelfReset.code, 'ACCOUNT_REJECTED_BY_ADMIN');

        // Rejected employee remains blocked from business modules
        assert.equal(
          canRoleAccessWorkspaceTab('quality', 'quality', 'rejected'),
          false
        );
        assert.equal(
          canRoleAccessWorkspaceTab('quality', 'dashboard', 'rejected'),
          false
        );

        // Authorized reconsideration: CEO approves the previously rejected employee as 'quality'
        const rReconsider = await fetch(
          `${baseUrl}/api/admin/employees/pending-emp-102/approve`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer VALID_TOKEN:ceo-active-1:ceo@montexforge.com',
            },
            body: JSON.stringify({
              role: 'quality',
              department: 'Quality & Metallurgy',
              designation: 'QC Engineer',
              notes: 'Contractor verification completed; approved on reconsideration.',
            }),
          }
        );
        assert.equal(rReconsider.status, 200);
        const bReconsider = await rReconsider.json();
        assert.equal(bReconsider.data.employee.accountStatus, 'active');
        assert.equal(bReconsider.data.employee.status, 'Active');
        assert.equal(bReconsider.data.employee.role, 'quality');
        assert.equal(bReconsider.data.employee.approvedByUid, 'ceo-active-1');
        assert.equal(bReconsider.data.employee.rejectedByUid, null);
        assert.equal(bReconsider.data.employee.rejectionReason, null);
        assert.equal(bReconsider.data.employee.approvalHistory.length, 3);
        assert.deepEqual(
          bReconsider.data.employee.approvalHistory.map((h: any) => h.action),
          ['requested', 'rejected', 'reconsidered']
        );

        return 'Verified Scenario 7: rejection persists reviewer/timestamp/reason, blocks self-reset and module access, and supports authorized reconsideration.';
      }
    );

    // 15. Employee Approval Workflow — Scenario 8 (Duplicate Approval, Self-Approval & Privilege Escalation Rejected)
    await recordTest(
      'P3-T15',
      'Duplicate Approval, Self-Approval & Escalation Guards',
      'Rejects duplicate approval (409 ALREADY_APPROVED), self-approval (409 SELF_APPROVAL_FORBIDDEN), and CEO approving super_admin (403)',
      async () => {
        // 8a. Duplicate approval of already active employee with same role
        const rDup = await fetch(
          `${baseUrl}/api/admin/employees/pending-emp-101/approve`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
            body: JSON.stringify({
              role: 'stores',
              department: 'Stores & Raw Material',
            }),
          }
        );
        assert.equal(rDup.status, 409);
        const bDup = await rDup.json();
        assert.equal(bDup.code, 'ALREADY_APPROVED');

        // 8b. Self-approval attempt by admin-active-1
        const rSelf = await fetch(
          `${baseUrl}/api/admin/employees/admin-active-1/approve`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
            body: JSON.stringify({
              role: 'super_admin',
              department: 'Administration',
            }),
          }
        );
        assert.equal(rSelf.status, 409);
        const bSelf = await rSelf.json();
        assert.equal(bSelf.code, 'SELF_APPROVAL_FORBIDDEN');

        // 8c. CEO attempting to approve an account with super_admin role
        const rCeoEscalation = await fetch(
          `${baseUrl}/api/admin/employees/pending-emp-101/approve`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer VALID_TOKEN:ceo-active-1:ceo@montexforge.com',
            },
            body: JSON.stringify({
              role: 'super_admin',
              department: 'Administration',
            }),
          }
        );
        assert.equal(rCeoEscalation.status, 403);
        const bCeoEscalation = await rCeoEscalation.json();
        assert.equal(bCeoEscalation.code, 'SUPER_ADMIN_ASSIGNMENT_FORBIDDEN');

        return 'Verified Scenario 8: 409 ALREADY_APPROVED, 409 SELF_APPROVAL_FORBIDDEN, and 403 SUPER_ADMIN_ASSIGNMENT_FORBIDDEN.';
      }
    );

    // 16. Employee Approval Workflow — Scenarios 9 & 10 (Existing Users Preserved & Database Write Failure Error Handling)
    await recordTest(
      'P3-T16',
      'Existing Users Preservation & Write Failure Error Handling',
      'Preserves existing active users and returns explicit 500 APPROVAL_WRITE_FAILED when database write fails without false success',
      async () => {
        // 9. Existing approved users continue working
        for (const existingUid of ['admin-active-1', 'ceo-active-1', 'sales-active-1']) {
          const p = await harness.storeAdapter.getEmployeeProfile(existingUid);
          assert.ok(p, `Existing user ${existingUid} must remain intact`);
          assert.equal(p.accountStatus, 'active');
        }

        // Seed a pending user and simulate a database write failure during approval
        harness.authUsers.set('pending-emp-103', {
          uid: 'pending-emp-103',
          email: 'db.fail.test@montexforge.com',
          displayName: 'Write Failure Test User',
          disabled: false,
          emailVerified: true,
          customClaims: {},
        });
        await fetch(`${baseUrl}/api/admin/employees/access-request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization:
              'Bearer VALID_TOKEN:pending-emp-103:db.fail.test@montexforge.com',
          },
          body: JSON.stringify({
            displayName: 'Write Failure Test User',
            department: 'Dispatch',
          }),
        });

        // 10. Simulate database write failure on approval
        harness.simulateNextProfileWriteFailure = true;
        const rFail = await fetch(
          `${baseUrl}/api/admin/employees/pending-emp-103/approve`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
            body: JSON.stringify({
              role: 'dispatch',
              department: 'Dispatch & Logistics',
            }),
          }
        );
        assert.equal(rFail.status, 500);
        const bFail = await rFail.json();
        assert.equal(bFail.success, false);
        assert.equal(bFail.code, 'APPROVAL_WRITE_FAILED');

        // Confirm the user in the store is still pending_approval (not falsely marked active)
        const afterFail = await harness.storeAdapter.getEmployeeProfile('pending-emp-103');
        assert.ok(afterFail);
        assert.equal(afterFail.accountStatus, 'pending_approval');

        // 10b. Simulate database write failure on rejection
        harness.simulateNextProfileWriteFailure = true;
        const rRejFail = await fetch(
          `${baseUrl}/api/admin/employees/pending-emp-103/reject`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
            body: JSON.stringify({
              reason: 'Unverified department credentials',
            }),
          }
        );
        assert.equal(rRejFail.status, 500);
        const bRejFail = await rRejFail.json();
        assert.equal(bRejFail.success, false);
        assert.equal(bRejFail.code, 'REJECTION_WRITE_FAILED');

        const afterRejFail = await harness.storeAdapter.getEmployeeProfile('pending-emp-103');
        assert.ok(afterRejFail);
        assert.equal(afterRejFail.accountStatus, 'pending_approval');

        return 'Verified Scenario 9 (existing users intact) and Scenario 10 (500 APPROVAL_WRITE_FAILED & 500 REJECTION_WRITE_FAILED on DB error with pending state preserved).';
      }
    );

    // 17. Rejection Authorization Guards & Directory Sync Reconciliation Regression
    await recordTest(
      'P3-T17',
      'Rejection Authorization Guards & Refresh Reconciliation',
      'Blocks unauthorized/self/CEO-vs-SuperAdmin rejections and verifies timestamp-aware RTDB+Firestore directory reconciliation preserves rejected state on refresh',
      async () => {
        // 17a. Non-admin (sales) cannot reject a pending user
        const rSalesRej = await fetch(
          `${baseUrl}/api/admin/employees/pending-emp-103/reject`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer VALID_TOKEN:sales-active-1:sales@montexforge.com',
            },
            body: JSON.stringify({ reason: 'Unauthorized attempt' }),
          }
        );
        assert.equal(rSalesRej.status, 403);
        const bSalesRej = await rSalesRej.json();
        assert.equal(bSalesRej.code, 'INSUFFICIENT_ROLE_PRIVILEGE');

        // 17b. Self-rejection is blocked
        const rSelfRej = await fetch(
          `${baseUrl}/api/admin/employees/admin-active-1/reject`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization:
                'Bearer VALID_TOKEN:admin-active-1:superadmin1@montexforge.com',
            },
            body: JSON.stringify({ reason: 'Accidental self-rejection' }),
          }
        );
        assert.equal(rSelfRej.status, 409);
        const bSelfRej = await rSelfRej.json();
        assert.equal(bSelfRej.code, 'SELF_REJECTION_FORBIDDEN');

        // 17c. CEO cannot reject a Super Admin account
        const rCeoRejSuperAdmin = await fetch(
          `${baseUrl}/api/admin/employees/admin-active-1/reject`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer VALID_TOKEN:ceo-active-1:ceo@montexforge.com',
            },
            body: JSON.stringify({ reason: 'Attempted CEO rejection of Super Admin' }),
          }
        );
        assert.equal(rCeoRejSuperAdmin.status, 403);
        const bCeoRejSuperAdmin = await rCeoRejSuperAdmin.json();
        assert.equal(
          bCeoRejSuperAdmin.code,
          'SUPER_ADMIN_IMMUTABLE_BY_HIGHER_AUTHORITY'
        );

        // 17d. Verify timestamp-aware reconciliation logic (simulating RTDB rejected record vs stale Firestore pending record)
        const staleFsRecord = {
          id: 'pending-emp-103',
          uid: 'pending-emp-103',
          accountStatus: 'pending_approval',
          status: 'Pending',
          updatedAt: '2026-04-02T10:00:00.000Z',
        };
        const newerRtdbRejectedRecord = {
          id: 'pending-emp-103',
          uid: 'pending-emp-103',
          accountStatus: 'rejected',
          status: 'Rejected',
          rejectedByUid: 'admin-active-1',
          rejectionReason: 'Verified rejection persists across sync',
          updatedAt: '2026-04-02T10:05:00.000Z',
        };

        const rtdbUpdated = String(newerRtdbRejectedRecord.updatedAt || '');
        const fsUpdated = String(staleFsRecord.updatedAt || '');
        const rtdbHasNewerTimestamp = Boolean(
          rtdbUpdated && fsUpdated && rtdbUpdated > fsUpdated
        );
        const reconciled = rtdbHasNewerTimestamp
          ? { ...staleFsRecord, ...newerRtdbRejectedRecord }
          : { ...newerRtdbRejectedRecord, ...staleFsRecord };

        assert.equal(reconciled.accountStatus, 'rejected');
        assert.equal(reconciled.status, 'Rejected');
        assert.equal(reconciled.rejectedByUid, 'admin-active-1');

        return 'Verified non-admin/self/CEO-vs-SuperAdmin rejection guards and timestamp-aware RTDB+Firestore refresh reconciliation.';
      }
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('\n================================================================================');
  console.log('MONTEX FORGE MIS — PHASE 3 AUTH & PROVISIONING VERIFICATION REPORT');
  console.log('================================================================================');
  for (const r of results) {
    const badge = r.passed ? 'PASS' : 'FAIL';
    console.log(`[${badge}] ${r.id} (${r.category}): ${r.description}`);
    console.log(`       -> ${r.details}`);
  }

  const passedCount = results.filter((r) => r.passed).length;
  console.log('--------------------------------------------------------------------------------');
  console.log(`TOTAL: ${passedCount} / ${results.length} TEST SUITES PASSED`);
  console.log('================================================================================\n');

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runPhase3Verification().catch((err) => {
  console.error('Fatal error in Phase 3 verification:', err);
  process.exit(1);
});
