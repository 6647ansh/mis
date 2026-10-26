import { Request, Response, NextFunction } from 'express';
import {
  EmployeeStoreAdapter,
  createLiveEmployeeStoreAdapter,
  isAdminSdkCredentialError,
} from '../config/firebaseAdmin';
import {
  isAccountStatusActive,
  normalizeRoleInput,
} from '../../src/types/roles';

/**
 * Factory for Super Admin authorization middleware.
 * - Requires `req.authenticatedUser` populated by `verifyFirebaseToken`.
 * - Fetches the caller's authoritative `/users/{uid}` profile from the database.
 * - Rejects missing profiles, non-active accounts (`deactivated`, `suspended`, `inactive`, `pending_approval`),
 *   and any caller whose canonical role is not `super_admin`.
 */
export function createRequireSuperAdminMiddleware(
  storeAdapter: EmployeeStoreAdapter = createLiveEmployeeStoreAdapter(),
  options: { allowHigherAuthority?: boolean } = { allowHigherAuthority: true }
) {
  const allowHigherAuthority = options.allowHigherAuthority ?? true;

  return async function requireSuperAdmin(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const authUser = req.authenticatedUser;
    if (!authUser || !authUser.uid) {
      res.status(401).json({
        success: false,
        code: 'UNAUTHENTICATED',
        error: 'Authentication required before checking administrator permissions.',
      });
      return;
    }

    try {
      const callerProfile = await storeAdapter.getEmployeeProfile(authUser.uid);

      if (!callerProfile) {
        res.status(403).json({
          success: false,
          code: 'PROFILE_NOT_FOUND',
          error: 'Access denied. No provisioned employee profile exists for your UID in /users.',
        });
        return;
      }

      if (!isAccountStatusActive(callerProfile.accountStatus)) {
        res.status(403).json({
          success: false,
          code: 'ACCOUNT_INACTIVE',
          error: `Access denied. Your employee account status is "${callerProfile.accountStatus}". Only active accounts may perform administrative actions.`,
        });
        return;
      }

      const canonicalRole =
        normalizeRoleInput(callerProfile.legacyRole) ||
        normalizeRoleInput(callerProfile.role);

      const isAuthorized =
        canonicalRole === 'super_admin' ||
        (allowHigherAuthority && canonicalRole === 'ceo');

      if (!isAuthorized || !canonicalRole) {
        res.status(403).json({
          success: false,
          code: 'INSUFFICIENT_ROLE_PRIVILEGE',
          error: `Access denied. Only an active Super Administrator (super_admin) or Higher Authority (ceo) can manage employee accounts. Current role: "${canonicalRole || callerProfile.role}".`,
        });
        return;
      }

      req.callerProfile = {
        ...callerProfile,
        id: callerProfile.id || authUser.uid,
        uid: callerProfile.uid || authUser.uid,
        role: canonicalRole,
        legacyRole: canonicalRole,
        rbacGroup: canonicalRole === 'super_admin' ? 'Admin' : 'Management',
      };

      next();
    } catch (err: any) {
      const isCredentialsIssue = isAdminSdkCredentialError(err);

      res.status(isCredentialsIssue ? 503 : 500).json({
        success: false,
        code: isCredentialsIssue ? 'ADMIN_SDK_CREDENTIALS_UNAVAILABLE' : 'AUTHORIZATION_CHECK_FAILED',
        error: isCredentialsIssue
          ? 'Firebase Admin SDK server credentials are not configured in this environment to verify /users/{uid}.'
          : 'Failed to verify administrator profile in /users.',
      });
    }
  };
}
