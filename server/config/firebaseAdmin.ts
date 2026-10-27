import fs from 'node:fs';
import {
  initializeApp,
  getApps,
  getApp,
  cert,
  applicationDefault,
  App as AdminApp,
} from 'firebase-admin/app';
import { getAuth, Auth as AdminAuth, DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, Firestore as AdminFirestore } from 'firebase-admin/firestore';
import { getDatabase, Database as AdminDatabase } from 'firebase-admin/database';
import appletConfig from '../../firebase-applet-config.json';
import { AuditLogEntry, UserProfile } from '../../src/types/mis';

export const SERVER_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  appletConfig.projectId ||
  'montexforge-7d537';

export const SERVER_FIRESTORE_DATABASE_ID = (
  process.env.FIREBASE_FIRESTORE_DATABASE_ID ||
  process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ||
  appletConfig.firestoreDatabaseId ||
  '(default)'
).trim();

export const SERVER_RTDB_URL =
  process.env.FIREBASE_DATABASE_URL ||
  process.env.VITE_FIREBASE_DATABASE_URL ||
  'https://montexforge-7d537-default-rtdb.firebaseio.com/';

const SENSITIVE_KEY_PATTERN =
  /^(password|pass|plaintextpassword|token|idtoken|refreshtoken|accesstoken|secret|privatekey|private_key|client_secret|apikey|api_key|authorization|resetlink|oobcode)$/i;

/**
 * Recursively redacts any sensitive keys (passwords, tokens, private keys, reset links)
 * from objects before logging or writing to audit logs.
 */
export function redactSensitiveData<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    // Redact Bearer tokens or JWT-like strings
    if (/^Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/i.test(value)) {
      return '[REDACTED_TOKEN]' as unknown as T;
    }
    if (/-----BEGIN (RSA )?PRIVATE KEY-----/.test(value)) {
      return '[REDACTED_PRIVATE_KEY]' as unknown as T;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSensitiveData(v);
      }
    }
    return out as T;
  }
  return value;
}

let cachedAdminApp: AdminApp | null = null;

export function getFirebaseAdminApp(): AdminApp {
  if (cachedAdminApp) {
    return cachedAdminApp;
  }
  if (getApps().length > 0) {
    cachedAdminApp = getApp();
    return cachedAdminApp;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (serviceAccountJson && serviceAccountJson.trim().startsWith('{')) {
    const parsed = JSON.parse(serviceAccountJson);
    cachedAdminApp = initializeApp({
      credential: cert(parsed),
      projectId: SERVER_PROJECT_ID,
      databaseURL: SERVER_RTDB_URL,
    });
    return cachedAdminApp;
  }

  if (credentialsPath && fs.existsSync(credentialsPath)) {
    const parsed = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    cachedAdminApp = initializeApp({
      credential: cert(parsed),
      projectId: SERVER_PROJECT_ID,
      databaseURL: SERVER_RTDB_URL,
    });
    return cachedAdminApp;
  }

  try {
    cachedAdminApp = initializeApp({
      credential: applicationDefault(),
      projectId: SERVER_PROJECT_ID,
      databaseURL: SERVER_RTDB_URL,
    });
  } catch {
    cachedAdminApp = initializeApp({
      projectId: SERVER_PROJECT_ID,
      databaseURL: SERVER_RTDB_URL,
    });
  }

  return cachedAdminApp;
}

export function getAdminAuthInstance(): AdminAuth {
  return getAuth(getFirebaseAdminApp());
}

export function getAdminFirestoreInstance(): AdminFirestore {
  const app = getFirebaseAdminApp();
  return SERVER_FIRESTORE_DATABASE_ID && SERVER_FIRESTORE_DATABASE_ID !== '(default)'
    ? getFirestore(app, SERVER_FIRESTORE_DATABASE_ID)
    : getFirestore(app);
}

export function getAdminRtdbInstance(): AdminDatabase {
  return getDatabase(getFirebaseAdminApp());
}

/**
 * Adapter interfaces for Firebase Admin Auth and Employee/Audit Persistence.
 * Used by production routes (via live Firebase Admin SDK) and by deterministic Phase 3 test suites.
 */
export interface AdminAuthUserRecord {
  uid: string;
  email?: string;
  displayName?: string;
  disabled: boolean;
  emailVerified: boolean;
  customClaims?: Record<string, any>;
}

export interface AdminAuthAdapter {
  verifyIdToken(idToken: string, checkRevoked?: boolean): Promise<DecodedIdToken>;
  getUserByEmail(email: string): Promise<AdminAuthUserRecord | null>;
  getUser(uid: string): Promise<AdminAuthUserRecord | null>;
  createUser(params: {
    email: string;
    displayName: string;
    disabled?: boolean;
    emailVerified?: boolean;
  }): Promise<AdminAuthUserRecord>;
  updateUser(
    uid: string,
    properties: {
      displayName?: string;
      disabled?: boolean;
      emailVerified?: boolean;
    }
  ): Promise<AdminAuthUserRecord>;
  setCustomUserClaims(uid: string, customUserClaims: Record<string, any> | null): Promise<void>;
  revokeRefreshTokens(uid: string): Promise<void>;
  generatePasswordResetLink(email: string): Promise<string>;
}

export interface EmployeeStoreAdapter {
  getEmployeeProfile(uid: string): Promise<UserProfile | null>;
  getEmployeeProfileByEmail(email: string): Promise<UserProfile | null>;
  listEmployeeProfiles(): Promise<UserProfile[]>;
  saveEmployeeProfile(profile: UserProfile): Promise<void>;
  countActiveSuperAdmins(): Promise<number>;
  appendAuditLog(entry: AuditLogEntry): Promise<void>;
  listAuditLogs(limit?: number): Promise<AuditLogEntry[]>;
}

export function isAdminSdkCredentialError(err: any): boolean {
  const code = String(err?.code || '');
  const message = String(err?.message || '');
  return (
    code === 'app/invalid-credential' ||
    code === 'auth/insufficient-permission' ||
    code === 'auth/project-not-found' ||
    message.includes('Could not load the default credentials') ||
    message.includes('PERMISSION_DENIED') ||
    message.includes('UNAUTHENTICATED') ||
    message.includes('Credential implementation provided to initializeApp()') ||
    message.includes('Error fetching access token') ||
    message.includes('missing required authentication credential')
  );
}

/**
 * Production Firebase Admin Auth Adapter wrapping `firebase-admin/auth`
 */
export function createLiveAdminAuthAdapter(): AdminAuthAdapter {
  const auth = getAdminAuthInstance();
  return {
    async verifyIdToken(idToken: string, checkRevoked = true): Promise<DecodedIdToken> {
      // 1. Always perform full cryptographic JWT verification (RSA signature via Google public x509 certs, exp, aud, iss, sub)
      const decoded = await auth.verifyIdToken(idToken, false);

      // 2. If revocation check is requested, query the live user record when Admin SDK credentials are available
      if (checkRevoked && decoded?.uid) {
        try {
          const userRecord = await auth.getUser(decoded.uid);
          if (userRecord.disabled) {
            const disabledErr: any = new Error('The user record is disabled.');
            disabledErr.code = 'auth/user-disabled';
            throw disabledErr;
          }
          if (userRecord.tokensValidAfterTime) {
            const validAfterMs = new Date(userRecord.tokensValidAfterTime).getTime();
            const authTimeMs = Number(decoded.auth_time || decoded.iat || 0) * 1000;
            if (!Number.isNaN(validAfterMs) && authTimeMs > 0 && authTimeMs < validAfterMs) {
              const revokedErr: any = new Error('The Firebase ID token has been revoked.');
              revokedErr.code = 'auth/id-token-revoked';
              throw revokedErr;
            }
          }
        } catch (revocationErr: any) {
          const code = String(revocationErr?.code || '');
          if (code === 'auth/id-token-revoked' || code === 'auth/user-disabled') {
            throw revocationErr;
          }
          // If getUser() failed strictly because service-account credentials are not configured in this host container,
          // preserve the cryptographically verified JWT and allow downstream requireSuperAdmin to handle credential availability.
          if (!isAdminSdkCredentialError(revocationErr)) {
            throw revocationErr;
          }
        }
      }

      return decoded;
    },
    async getUserByEmail(email: string): Promise<AdminAuthUserRecord | null> {
      try {
        const u = await auth.getUserByEmail(email);
        return {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          disabled: u.disabled,
          emailVerified: u.emailVerified,
          customClaims: u.customClaims,
        };
      } catch (err: any) {
        if (err?.code === 'auth/user-not-found') {
          return null;
        }
        throw err;
      }
    },
    async getUser(uid: string): Promise<AdminAuthUserRecord | null> {
      try {
        const u = await auth.getUser(uid);
        return {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          disabled: u.disabled,
          emailVerified: u.emailVerified,
          customClaims: u.customClaims,
        };
      } catch (err: any) {
        if (err?.code === 'auth/user-not-found') {
          return null;
        }
        throw err;
      }
    },
    async createUser(params): Promise<AdminAuthUserRecord> {
      const created = await auth.createUser({
        email: params.email,
        displayName: params.displayName,
        disabled: params.disabled ?? false,
        emailVerified: params.emailVerified ?? false,
      });
      return {
        uid: created.uid,
        email: created.email,
        displayName: created.displayName,
        disabled: created.disabled,
        emailVerified: created.emailVerified,
        customClaims: created.customClaims,
      };
    },
    async updateUser(uid, properties): Promise<AdminAuthUserRecord> {
      const updated = await auth.updateUser(uid, properties);
      return {
        uid: updated.uid,
        email: updated.email,
        displayName: updated.displayName,
        disabled: updated.disabled,
        emailVerified: updated.emailVerified,
        customClaims: updated.customClaims,
      };
    },
    async setCustomUserClaims(uid, customUserClaims): Promise<void> {
      await auth.setCustomUserClaims(uid, customUserClaims);
    },
    async revokeRefreshTokens(uid): Promise<void> {
      await auth.revokeRefreshTokens(uid);
    },
    async generatePasswordResetLink(email): Promise<string> {
      return auth.generatePasswordResetLink(email);
    },
  };
}

/**
 * Production Employee Store Adapter writing authoritative employee profiles and audit logs
 * to Cloud Firestore (`/users/{uid}`, `/auditLogs/{logId}`) and mirroring to RTDB while Phase 3 bridges both.
 */
export function createLiveEmployeeStoreAdapter(): EmployeeStoreAdapter {
  const firestore = getAdminFirestoreInstance();
  const rtdb = getAdminRtdbInstance();

  return {
    async getEmployeeProfile(uid: string): Promise<UserProfile | null> {
      let firestoreErr: unknown = null;
      try {
        const docSnap = await firestore.collection('users').doc(uid).get();
        if (docSnap.exists) {
          const data = docSnap.data() as any;
          return {
            ...data,
            id: data.id || data.uid || uid,
            uid: data.uid || data.id || uid,
            name: data.name || data.displayName || '',
            displayName: data.displayName || data.name || '',
            role: data.legacyRole || data.role,
          } as UserProfile;
        }
      } catch (err) {
        firestoreErr = err;
      }

      try {
        const rtdbSnap = await rtdb.ref(`users/${uid}`).get();
        if (rtdbSnap.exists()) {
          const val = rtdbSnap.val();
          return {
            ...val,
            id: val.id || val.uid || uid,
            uid: val.uid || val.id || uid,
            name: val.name || val.displayName || '',
            displayName: val.displayName || val.name || '',
            role: val.legacyRole || val.role,
          } as UserProfile;
        }
      } catch (rtdbErr) {
        if (firestoreErr) {
          throw firestoreErr;
        }
        throw rtdbErr;
      }

      if (firestoreErr) {
        const msg = firestoreErr instanceof Error ? firestoreErr.message : String(firestoreErr);
        if (
          msg.includes('Could not load the default credentials') ||
          msg.includes('UNAUTHENTICATED') ||
          msg.includes('PERMISSION_DENIED') ||
          msg.includes('invalid-credential')
        ) {
          throw firestoreErr;
        }
      }
      return null;
    },

    async getEmployeeProfileByEmail(email: string): Promise<UserProfile | null> {
      const normalizedEmail = email.trim().toLowerCase();
      let firestoreErr: unknown = null;
      try {
        const snap = await firestore
          .collection('users')
          .where('email', '==', normalizedEmail)
          .limit(1)
          .get();
        if (!snap.empty) {
          const data = snap.docs[0].data() as any;
          return {
            ...data,
            id: data.id || data.uid || snap.docs[0].id,
            uid: data.uid || data.id || snap.docs[0].id,
            name: data.name || data.displayName || '',
            displayName: data.displayName || data.name || '',
            role: data.legacyRole || data.role,
          } as UserProfile;
        }
      } catch (err) {
        firestoreErr = err;
      }

      try {
        const rtdbSnap = await rtdb.ref('users').get();
        if (rtdbSnap.exists()) {
          const all = Object.values(rtdbSnap.val() as Record<string, any>);
          const match = all.find(
            (u) => String(u?.email || '').trim().toLowerCase() === normalizedEmail
          );
          if (match) {
            return {
              ...match,
              id: match.id || match.uid,
              uid: match.uid || match.id,
              role: match.legacyRole || match.role,
            } as UserProfile;
          }
        }
      } catch (rtdbErr) {
        if (firestoreErr) {
          throw firestoreErr;
        }
        throw rtdbErr;
      }
      return null;
    },

    async listEmployeeProfiles(): Promise<UserProfile[]> {
      let firestoreErr: unknown = null;
      try {
        const snap = await firestore.collection('users').get();
        if (!snap.empty) {
          return snap.docs.map((d) => {
            const data = d.data() as any;
            return {
              ...data,
              id: data.id || data.uid || d.id,
              uid: data.uid || data.id || d.id,
              name: data.name || data.displayName || '',
              displayName: data.displayName || data.name || '',
              role: data.legacyRole || data.role,
            } as UserProfile;
          });
        }
      } catch (err) {
        firestoreErr = err;
      }

      try {
        const rtdbSnap = await rtdb.ref('users').get();
        if (!rtdbSnap.exists()) return [];
        return Object.values(rtdbSnap.val() as Record<string, any>).map((val) => ({
          ...val,
          id: val.id || val.uid,
          uid: val.uid || val.id,
          name: val.name || val.displayName || '',
          displayName: val.displayName || val.name || '',
          role: val.legacyRole || val.role,
        })) as UserProfile[];
      } catch (rtdbErr) {
        if (firestoreErr) throw firestoreErr;
        throw rtdbErr;
      }
    },

    async saveEmployeeProfile(profile: UserProfile): Promise<void> {
      const uid = profile.uid || profile.id;
      const firestorePayload: Record<string, any> = {
        id: uid,
        uid,
        name: profile.name,
        displayName: profile.displayName || profile.name,
        email: profile.email.trim().toLowerCase(),
        role: profile.role,
        legacyRole: profile.role,
        requestedRole: profile.requestedRole || profile.role,
        requestedDepartment: profile.requestedDepartment || profile.department,
        rbacGroup: profile.rbacGroup,
        roleTitle: profile.roleTitle,
        designation: profile.designation || profile.roleTitle,
        department: profile.department,
        avatarInitials: profile.avatarInitials,
        accountStatus: profile.accountStatus,
        isDepartmentHead: Boolean(profile.isDepartmentHead),
        ...(profile.managedDepartment ? { managedDepartment: profile.managedDepartment } : {}),
        mustChangePassword: Boolean(profile.mustChangePassword),
        invitedBy: profile.invitedBy || profile.provisionedBy || 'Super Admin',
        provisionedBy: profile.provisionedBy || profile.invitedBy || 'Super Admin',
        provisionedAt: profile.provisionedAt || profile.createdAt,
        approvedByUid: profile.approvedByUid ?? null,
        approvedByEmail: profile.approvedByEmail ?? null,
        approvedByName: profile.approvedByName ?? null,
        approvedAt: profile.approvedAt ?? null,
        rejectedByUid: profile.rejectedByUid ?? null,
        rejectedByEmail: profile.rejectedByEmail ?? null,
        rejectedByName: profile.rejectedByName ?? null,
        rejectedAt: profile.rejectedAt ?? null,
        rejectionReason: profile.rejectionReason ?? null,
        approvalHistory: Array.isArray(profile.approvalHistory) ? profile.approvalHistory : [],
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt || new Date().toISOString(),
        disabledAt: profile.disabledAt ?? null,
        deactivatedBy: profile.deactivatedBy ?? null,
        deactivationReason: profile.deactivationReason ?? null,
        permissions: profile.permissions || [],
        dataOrigin: profile.dataOrigin || 'production',
      };

      // Primary write to authoritative Firestore `/users/{uid}`
      await firestore.collection('users').doc(uid).set(firestorePayload, { merge: true });

      // Non-blocking mirror to RTDB `/users/{uid}` so Phase 3 RTDB UI remains synchronized
      try {
        await rtdb.ref(`users/${uid}`).set({
          ...firestorePayload,
          role: profile.rbacGroup,
          legacyRole: profile.role,
        });
      } catch {
        // Non-blocking mirror
      }
    },

    async countActiveSuperAdmins(): Promise<number> {
      const all = await this.listEmployeeProfiles();
      return all.filter(
        (u) =>
          u.accountStatus === 'active' &&
          (u.role === 'super_admin' || u.legacyRole === 'super_admin')
      ).length;
    },

    async appendAuditLog(entry: AuditLogEntry): Promise<void> {
      const safeEntry = redactSensitiveData(entry);
      await firestore.collection('auditLogs').doc(safeEntry.id).create(safeEntry);
      try {
        await rtdb.ref(`auditLogs/${safeEntry.id}`).set(safeEntry);
      } catch {
        // Non-blocking mirror to RTDB
      }
    },

    async listAuditLogs(limit = 100): Promise<AuditLogEntry[]> {
      const snap = await firestore
        .collection('auditLogs')
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => d.data() as AuditLogEntry);
    },
  };
}
