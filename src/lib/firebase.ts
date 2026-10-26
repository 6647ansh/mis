import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, Auth } from 'firebase/auth';
import {
  getFirestore,
  Firestore,
  doc,
  getDocFromServer,
} from 'firebase/firestore';
import appletConfig from '../../firebase-applet-config.json';

export const DEFAULT_RTDB_URL = 'https://montex-mis-default-rtdb.firebaseio.com/';
export const DEFAULT_FIRESTORE_DATABASE_ID =
  appletConfig.firestoreDatabaseId || '(default)';

const metaEnv = (import.meta as any).env || {};

export const databaseURL: string =
  metaEnv.VITE_FIREBASE_DATABASE_URL || DEFAULT_RTDB_URL;

export const firestoreDatabaseId: string =
  (
    metaEnv.VITE_FIREBASE_FIRESTORE_DATABASE_ID ||
    appletConfig.firestoreDatabaseId ||
    DEFAULT_FIRESTORE_DATABASE_ID
  ).trim();

const firebaseConfig = {
  apiKey: metaEnv.VITE_FIREBASE_API_KEY || appletConfig.apiKey,
  authDomain: metaEnv.VITE_FIREBASE_AUTH_DOMAIN || appletConfig.authDomain,
  databaseURL,
  projectId: metaEnv.VITE_FIREBASE_PROJECT_ID || appletConfig.projectId,
  storageBucket: metaEnv.VITE_FIREBASE_STORAGE_BUCKET || appletConfig.storageBucket,
  messagingSenderId:
    metaEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || appletConfig.messagingSenderId,
  appId: metaEnv.VITE_FIREBASE_APP_ID || appletConfig.appId,
};

function validateFirestoreConfig(
  projectId: string | undefined,
  dbId: string | undefined
): { valid: boolean; reason?: string } {
  if (!projectId || typeof projectId !== 'string' || projectId.trim().length === 0) {
    return {
      valid: false,
      reason: 'Missing Firebase projectId in configuration.',
    };
  }
  if (!dbId || typeof dbId !== 'string' || dbId.trim().length === 0) {
    return {
      valid: false,
      reason: 'Missing Firestore database ID in configuration.',
    };
  }
  if (dbId !== '(default)' && !/^[a-z0-9][a-z0-9-]{2,61}[a-z0-9]$/.test(dbId)) {
    return {
      valid: false,
      reason: `Invalid Firestore database ID format: "${dbId}".`,
    };
  }
  return { valid: true };
}

export const firestoreConfigValidation = validateFirestoreConfig(
  firebaseConfig.projectId,
  firestoreDatabaseId
);

// Initialize Firebase only once (Singleton pattern)
export const app: FirebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Connect to Firebase Authentication
export const auth: Auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();


// Initialize Cloud Firestore using the project's configured named database ID
function initFirestoreInstance(
  firebaseApp: FirebaseApp,
  configuredDbId: string
): Firestore {
  if (!firestoreConfigValidation.valid) {
    console.warn(
      `[Montex Firestore] Configuration warning: ${firestoreConfigValidation.reason}`
    );
  }
  try {
    return configuredDbId && configuredDbId !== '(default)'
      ? getFirestore(firebaseApp, configuredDbId)
      : getFirestore(firebaseApp);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[Montex Firestore] Failed to initialize named database "${configuredDbId}": ${message}`
    );
    throw new Error(
      `Firestore initialization failed for database "${configuredDbId}": ${message}`
    );
  }
}

export const firestore: Firestore = initFirestoreInstance(app, firestoreDatabaseId);
export const db: Firestore = firestore;

export const FIREBASE_CONFIG_METADATA = {
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain,
  databaseURL: firebaseConfig.databaseURL,
  firestoreDatabaseId,
  storageBucket: firebaseConfig.storageBucket,
  isConfigured: Boolean(
    firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.databaseURL
  ),
  isFirestoreConfigured: Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.projectId &&
      firestoreConfigValidation.valid
  ),
};

export const isFirebaseConfigured: boolean = FIREBASE_CONFIG_METADATA.isConfigured;
export const isFirestoreConfigured: boolean = FIREBASE_CONFIG_METADATA.isFirestoreConfigured;

export function getFirebaseConnectionDiagnostics() {
  return FIREBASE_CONFIG_METADATA;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

/**
 * Structured Firestore error handler that logs and throws a sanitized JSON payload
 * conforming to FirestoreErrorInfo without exposing API keys or secrets.
 */
export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface FirestoreConnectionHealthResult {
  reachable: boolean;
  status:
    | 'connected'
    | 'reachable_rules_enforced'
    | 'offline'
    | 'database_not_found'
    | 'misconfigured'
    | 'error';
  projectId: string;
  databaseId: string;
  checkedPath: string;
  timestamp: string;
  message: string;
}

/**
 * Safe, non-destructive Firestore connection health-check helper.
 * Performs a read-only server probe (`getDocFromServer`) against `/systemConfig/connection_probe`.
 * Does NOT write production data and does NOT expose secrets or API keys.
 */
export async function checkFirestoreConnectionHealth(): Promise<FirestoreConnectionHealthResult> {
  const checkedPath = 'systemConfig/connection_probe';
  const timestamp = new Date().toISOString();

  if (!firestoreConfigValidation.valid) {
    return {
      reachable: false,
      status: 'misconfigured',
      projectId: firebaseConfig.projectId || 'unknown',
      databaseId: firestoreDatabaseId || 'unknown',
      checkedPath,
      timestamp,
      message:
        firestoreConfigValidation.reason ||
        'Firestore configuration validation failed.',
    };
  }

  try {
    await getDocFromServer(doc(firestore, 'systemConfig', 'connection_probe'));
    return {
      reachable: true,
      status: 'connected',
      projectId: firebaseConfig.projectId,
      databaseId: firestoreDatabaseId,
      checkedPath,
      timestamp,
      message: 'Firestore server responded to read-only probe.',
    };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as { code?: string })?.code || '';

    // Permission-denied proves the Firestore endpoint & database exist and Security Rules evaluated the request
    if (
      errorCode === 'permission-denied' ||
      rawMessage.includes('Missing or insufficient permissions')
    ) {
      return {
        reachable: true,
        status: 'reachable_rules_enforced',
        projectId: firebaseConfig.projectId,
        databaseId: firestoreDatabaseId,
        checkedPath,
        timestamp,
        message:
          'Firestore server is reachable and Security Rules are actively enforcing access control.',
      };
    }

    if (
      errorCode === 'not-found' ||
      rawMessage.toLowerCase().includes('database') &&
        rawMessage.toLowerCase().includes('not found')
    ) {
      return {
        reachable: false,
        status: 'database_not_found',
        projectId: firebaseConfig.projectId,
        databaseId: firestoreDatabaseId,
        checkedPath,
        timestamp,
        message: `Configured Firestore database "${firestoreDatabaseId}" was not found on project "${firebaseConfig.projectId}".`,
      };
    }

    if (
      errorCode === 'unavailable' ||
      rawMessage.includes('the client is offline')
    ) {
      console.error(
        '[Montex Firestore] Client is offline or unable to reach Firestore backend. Please check your Firebase configuration.'
      );
      return {
        reachable: false,
        status: 'offline',
        projectId: firebaseConfig.projectId,
        databaseId: firestoreDatabaseId,
        checkedPath,
        timestamp,
        message:
          'Firestore client is offline or backend is unreachable. Check Firebase configuration or network connectivity.',
      };
    }

    return {
      reachable: false,
      status: 'error',
      projectId: firebaseConfig.projectId,
      databaseId: firestoreDatabaseId,
      checkedPath,
      timestamp,
      message: `Firestore health check encountered an error (${errorCode || 'unknown'}): ${rawMessage}`,
    };
  }
}

export const testFirestoreConnection = checkFirestoreConnectionHealth;

