import { Router, Request, Response, NextFunction } from 'express';
import {
  AdminAuthAdapter,
  EmployeeStoreAdapter,
  createLiveAdminAuthAdapter,
  createLiveEmployeeStoreAdapter,
  isAdminSdkCredentialError,
} from '../config/firebaseAdmin';
import { createVerifyFirebaseTokenMiddleware } from '../middleware/verifyFirebaseToken';
import { createRequireSuperAdminMiddleware } from '../middleware/requireSuperAdmin';
import { EmployeeManagementService } from '../services/employeeService';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory per-IP / per-actor rate limiter for administrative endpoints
 */
function createAdminRateLimiter(maxRequestsPerWindow = 60, windowMs = 60_000) {
  const buckets = new Map<string, RateLimitBucket>();

  return function adminRateLimiter(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = req.authenticatedUser?.uid || req.ip || 'anon';
    const existing = buckets.get(key);

    if (!existing || now > existing.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    existing.count += 1;
    if (existing.count > maxRequestsPerWindow) {
      res.status(429).json({
        success: false,
        code: 'RATE_LIMIT_EXCEEDED',
        error: 'Too many administrative requests. Please wait before retrying.',
      });
      return;
    }

    next();
  };
}

export interface CreateEmployeeRouterOptions {
  authAdapter?: AdminAuthAdapter;
  storeAdapter?: EmployeeStoreAdapter;
  maxRequestsPerMinute?: number;
}

export function createEmployeeRouter(options: CreateEmployeeRouterOptions = {}): Router {
  const authAdapter = options.authAdapter || createLiveAdminAuthAdapter();
  const storeAdapter = options.storeAdapter || createLiveEmployeeStoreAdapter();
  const service = new EmployeeManagementService(authAdapter, storeAdapter);

  const verifyToken = createVerifyFirebaseTokenMiddleware(authAdapter);
  const requireSuperAdmin = createRequireSuperAdminMiddleware(storeAdapter);
  const rateLimiter = createAdminRateLimiter(options.maxRequestsPerMinute ?? 60, 60_000);

  const router = Router();

  // All /api/admin/employees routes require a valid Firebase ID token and rate limiting
  router.use(verifyToken);
  router.use(rateLimiter);

  // POST /api/admin/employees/access-request — Authenticated self-service access request (creates pending_approval profile)
  router.post('/access-request', async (req: Request, res: Response) => {
    try {
      const authUser = req.authenticatedUser;
      if (!authUser || !authUser.uid) {
        res.status(401).json({
          success: false,
          code: 'UNAUTHENTICATED',
          error: 'Authentication required to submit an access request.',
        });
        return;
      }
      const { displayName, department, requestedRole, designation } = req.body || {};
      const result = await service.submitAccessRequest(
        { uid: authUser.uid, email: authUser.email },
        { displayName, department, requestedRole, designation }
      );
      res.status(result.status).json(result);
    } catch (err: any) {
      const isCredentialsIssue = isAdminSdkCredentialError(err);
      res.status(isCredentialsIssue ? 503 : 500).json({
        success: false,
        code: isCredentialsIssue ? 'ADMIN_SDK_CREDENTIALS_UNAVAILABLE' : 'ACCESS_REQUEST_FAILED',
        error: isCredentialsIssue
          ? 'Firebase Admin SDK server credentials are not configured in this environment.'
          : 'Failed to submit employee access request.',
      });
    }
  });

  // Remaining /api/admin/employees routes require active super_admin or Higher Authority (ceo)
  router.use(requireSuperAdmin);

  // GET /api/admin/employees — List employee directory
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const result = await service.listEmployees();
      res.status(result.status).json(result);
    } catch (err: any) {
      const isCredentialsIssue = isAdminSdkCredentialError(err);
      res.status(isCredentialsIssue ? 503 : 500).json({
        success: false,
        code: isCredentialsIssue ? 'ADMIN_SDK_CREDENTIALS_UNAVAILABLE' : 'INTERNAL_ERROR',
        error: isCredentialsIssue
          ? 'Firebase Admin SDK server credentials are not configured in this environment.'
          : 'Failed to list employee profiles.',
      });
    }
  });

  // POST /api/admin/employees — Provision new employee account (or recover partial Auth creation)
  router.post('/', async (req: Request, res: Response) => {
    try {
      const actor = req.callerProfile!;
      const { email, displayName, role, department, designation } = req.body || {};
      const result = await service.provisionEmployee(actor, {
        email,
        displayName,
        role,
        department,
        designation,
      });
      res.status(result.status).json(result);
    } catch (err: any) {
      const isCredentialsIssue = isAdminSdkCredentialError(err);
      res.status(isCredentialsIssue ? 503 : 500).json({
        success: false,
        code: isCredentialsIssue ? 'ADMIN_SDK_CREDENTIALS_UNAVAILABLE' : 'PROVISION_FAILED',
        error: isCredentialsIssue
          ? 'Firebase Admin SDK credentials are not configured on the server.'
          : 'Unexpected server error while provisioning employee account.',
      });
    }
  });

  // PATCH /api/admin/employees/:uid/role — Update canonical employee role
  router.patch('/:uid/role', async (req: Request, res: Response) => {
    try {
      const actor = req.callerProfile!;
      const targetUid = String(req.params.uid || '');
      const { role, department, designation } = req.body || {};
      const result = await service.updateEmployeeRole(actor, targetUid, {
        role,
        department,
        designation,
      });
      res.status(result.status).json(result);
    } catch (err: any) {
      const isCredentialsIssue = isAdminSdkCredentialError(err);
      res.status(isCredentialsIssue ? 503 : 500).json({
        success: false,
        code: isCredentialsIssue ? 'ADMIN_SDK_CREDENTIALS_UNAVAILABLE' : 'ROLE_UPDATE_FAILED',
        error: isCredentialsIssue
          ? 'Firebase Admin SDK credentials are not configured on the server.'
          : 'Unexpected server error while updating employee role.',
      });
    }
  });

  // POST /api/admin/employees/:uid/approve — Approve pending/rejected employee access request with canonical role & department
  router.post('/:uid/approve', async (req: Request, res: Response) => {
    try {
      const actor = req.callerProfile!;
      const targetUid = String(req.params.uid || '');
      const { role, department, designation, isDepartmentHead, notes } = req.body || {};
      const result = await service.approveEmployee(actor, targetUid, {
        role,
        department,
        designation,
        isDepartmentHead,
        notes,
      });
      res.status(result.status).json(result);
    } catch (err: any) {
      const isCredentialsIssue = isAdminSdkCredentialError(err);
      res.status(isCredentialsIssue ? 503 : 500).json({
        success: false,
        code: isCredentialsIssue ? 'ADMIN_SDK_CREDENTIALS_UNAVAILABLE' : 'APPROVAL_WRITE_FAILED',
        error: isCredentialsIssue
          ? 'Firebase Admin SDK credentials are not configured on the server.'
          : 'Unexpected server error while approving employee account.',
      });
    }
  });

  // POST /api/admin/employees/:uid/reject — Reject employee access request with reviewer & reason
  router.post('/:uid/reject', async (req: Request, res: Response) => {
    try {
      const actor = req.callerProfile!;
      const targetUid = String(req.params.uid || '');
      const { reason } = req.body || {};
      const result = await service.rejectEmployee(actor, targetUid, { reason });
      res.status(result.status).json(result);
    } catch (err: any) {
      const isCredentialsIssue = isAdminSdkCredentialError(err);
      res.status(isCredentialsIssue ? 503 : 500).json({
        success: false,
        code: isCredentialsIssue ? 'ADMIN_SDK_CREDENTIALS_UNAVAILABLE' : 'REJECTION_FAILED',
        error: isCredentialsIssue
          ? 'Firebase Admin SDK credentials are not configured on the server.'
          : 'Unexpected server error while rejecting employee account.',
      });
    }
  });

  // POST /api/admin/employees/:uid/deactivate — Disable Auth account, revoke refresh tokens & set status='deactivated'
  router.post('/:uid/deactivate', async (req: Request, res: Response) => {
    try {
      const actor = req.callerProfile!;
      const targetUid = String(req.params.uid || '');
      const { reason } = req.body || {};
      const result = await service.deactivateEmployee(actor, targetUid, reason);
      res.status(result.status).json(result);
    } catch (err: any) {
      const isCredentialsIssue = isAdminSdkCredentialError(err);
      res.status(isCredentialsIssue ? 503 : 500).json({
        success: false,
        code: isCredentialsIssue ? 'ADMIN_SDK_CREDENTIALS_UNAVAILABLE' : 'DEACTIVATION_FAILED',
        error: isCredentialsIssue
          ? 'Firebase Admin SDK credentials are not configured on the server.'
          : 'Unexpected server error while deactivating employee account.',
      });
    }
  });

  // POST /api/admin/employees/:uid/reactivate — Re-enable Auth account & set status='active'
  router.post('/:uid/reactivate', async (req: Request, res: Response) => {
    try {
      const actor = req.callerProfile!;
      const targetUid = String(req.params.uid || '');
      const result = await service.reactivateEmployee(actor, targetUid);
      res.status(result.status).json(result);
    } catch (err: any) {
      const isCredentialsIssue = isAdminSdkCredentialError(err);
      res.status(isCredentialsIssue ? 503 : 500).json({
        success: false,
        code: isCredentialsIssue ? 'ADMIN_SDK_CREDENTIALS_UNAVAILABLE' : 'REACTIVATION_FAILED',
        error: isCredentialsIssue
          ? 'Firebase Admin SDK credentials are not configured on the server.'
          : 'Unexpected server error while reactivating employee account.',
      });
    }
  });

  // POST /api/admin/employees/:uid/password-reset — Initiate safe password reset flow
  router.post('/:uid/password-reset', async (req: Request, res: Response) => {
    try {
      const actor = req.callerProfile!;
      const targetUid = String(req.params.uid || '');
      const result = await service.initiateEmployeePasswordReset(actor, targetUid);
      res.status(result.status).json(result);
    } catch (err: any) {
      const isCredentialsIssue = isAdminSdkCredentialError(err);
      res.status(isCredentialsIssue ? 503 : 500).json({
        success: false,
        code: isCredentialsIssue ? 'ADMIN_SDK_CREDENTIALS_UNAVAILABLE' : 'PASSWORD_RESET_FAILED',
        error: isCredentialsIssue
          ? 'Firebase Admin SDK credentials are not configured on the server.'
          : 'Unexpected server error while initiating password reset.',
      });
    }
  });

  return router;
}
