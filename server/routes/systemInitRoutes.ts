import { Router, Request, Response } from 'express';
import {
  AdminAuthAdapter,
  EmployeeStoreAdapter,
  createLiveAdminAuthAdapter,
  createLiveEmployeeStoreAdapter,
  getAdminFirestoreInstance,
  isAdminSdkCredentialError,
  redactSensitiveData,
} from '../config/firebaseAdmin';
import { createVerifyFirebaseTokenMiddleware } from '../middleware/verifyFirebaseToken';
import { createRequireSuperAdminMiddleware } from '../middleware/requireSuperAdmin';
import {
  buildCleanProductionSystemConfigs,
  FirestoreSystemConfigDoc,
} from '../../src/services/firestoreService';

export interface SystemConfigStoreAdapter {
  getSystemConfig(configId: string): Promise<FirestoreSystemConfigDoc | null>;
  createSystemConfigIfAbsent(doc: FirestoreSystemConfigDoc): Promise<boolean>;
}

export function createLiveSystemConfigStoreAdapter(): SystemConfigStoreAdapter {
  const firestore = getAdminFirestoreInstance();
  return {
    async getSystemConfig(
      configId: string
    ): Promise<FirestoreSystemConfigDoc | null> {
      const snap = await firestore.collection('systemConfig').doc(configId).get();
      if (!snap.exists) return null;
      return snap.data() as FirestoreSystemConfigDoc;
    },
    async createSystemConfigIfAbsent(
      docData: FirestoreSystemConfigDoc
    ): Promise<boolean> {
      const docRef = firestore.collection('systemConfig').doc(docData.configId);
      try {
        await firestore.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          if (snap.exists) {
            const err: any = new Error('ALREADY_EXISTS');
            err.code = 'ALREADY_EXISTS';
            throw err;
          }
          tx.create(docRef, docData);
        });
        return true;
      } catch (err: any) {
        if (err?.code === 'ALREADY_EXISTS' || err?.code === 6) {
          return false;
        }
        throw err;
      }
    },
  };
}

export interface CreateSystemInitRouterOptions {
  authAdapter?: AdminAuthAdapter;
  storeAdapter?: EmployeeStoreAdapter;
  systemConfigAdapter?: SystemConfigStoreAdapter;
}

/**
 * Trusted server-side router for clean-production Firestore initialization (`POST /api/admin/system/initialize`).
 * - Requires a valid Firebase ID token and an active `super_admin` profile in `/users/{uid}`.
 * - Initializes ONLY `/systemConfig/{dashboardKpis, productionSummary, alertThresholds}` when absent.
 * - Never overwrites existing configuration or business documents.
 * - Never seeds mock/demo business records (`businessCollectionsSeededCount: 0`).
 * - Never auto-creates or promotes a `super_admin`.
 */
export function createSystemInitRouter(
  options: CreateSystemInitRouterOptions = {}
): Router {
  const authAdapter = options.authAdapter || createLiveAdminAuthAdapter();
  const storeAdapter = options.storeAdapter || createLiveEmployeeStoreAdapter();
  const systemConfigAdapter =
    options.systemConfigAdapter || createLiveSystemConfigStoreAdapter();

  const verifyToken = createVerifyFirebaseTokenMiddleware(authAdapter);
  const requireSuperAdmin = createRequireSuperAdminMiddleware(storeAdapter);

  const router = Router();
  router.use(verifyToken);
  router.use(requireSuperAdmin);

  router.post('/initialize', async (req: Request, res: Response) => {
    try {
      const actor = req.callerProfile!;
      const actorUid = actor.uid || actor.id;
      const nowIso = new Date().toISOString();
      const cleanConfigs = buildCleanProductionSystemConfigs(actorUid, nowIso);

      const createdConfigs: string[] = [];
      const skippedExistingConfigs: string[] = [];

      for (const configId of [
        'dashboardKpis',
        'productionSummary',
        'alertThresholds',
      ] as const) {
        const existing = await systemConfigAdapter.getSystemConfig(configId);
        if (existing) {
          skippedExistingConfigs.push(configId);
          continue;
        }

        const created = await systemConfigAdapter.createSystemConfigIfAbsent(
          cleanConfigs[configId]
        );
        if (created) {
          createdConfigs.push(configId);
        } else {
          skippedExistingConfigs.push(configId);
        }
      }

      if (createdConfigs.length > 0) {
        const logId = `AUD-INIT-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)
          .toUpperCase()}`;
        await storeAdapter.appendAuditLog(
          redactSensitiveData({
            id: logId,
            timestamp: nowIso,
            collectionName: 'systemConfig',
            module: 'systemConfig',
            documentId: createdConfigs.join(','),
            action: 'CLEAN_PRODUCTION_SYSTEM_CONFIG_INITIALIZED',
            actorUid,
            actorRole: 'super_admin',
            userId: actorUid,
            userName: `${actor.name} (${actor.email})`,
            outcome: 'SUCCESS',
            newValueSummary: `Initialized clean production /systemConfig documents [${createdConfigs.join(
              ', '
            )}] with zeroed KPIs and 0 demo records.`,
            details: `Initialized clean production /systemConfig documents [${createdConfigs.join(
              ', '
            )}] with zeroed KPIs and 0 demo records.`,
            dataOrigin: 'production',
          })
        );
      }

      res.status(200).json({
        success: true,
        code: 'CLEAN_PRODUCTION_INITIALIZED',
        message:
          createdConfigs.length > 0
            ? `Initialized ${createdConfigs.length} clean systemConfig document(s) (${createdConfigs.join(
                ', '
              )}); skipped ${skippedExistingConfigs.length} existing.`
            : `All 3 systemConfig documents (${skippedExistingConfigs.join(
                ', '
              )}) already exist. Nothing overwritten.`,
        data: {
          createdConfigs,
          skippedExistingConfigs,
          businessCollectionsSeededCount: 0,
          superAdminAutoCreated: false,
        },
      });
    } catch (err: any) {
      const isCredentialsIssue = isAdminSdkCredentialError(err);

      res.status(isCredentialsIssue ? 503 : 500).json({
        success: false,
        code: isCredentialsIssue
          ? 'ADMIN_SDK_CREDENTIALS_UNAVAILABLE'
          : 'SYSTEM_INIT_FAILED',
        error: isCredentialsIssue
          ? 'Firebase Admin SDK credentials are not configured on the server.'
          : 'Failed to initialize production systemConfig documents.',
      });
    }
  });

  return router;
}
