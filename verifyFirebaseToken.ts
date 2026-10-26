import { Request, Response, NextFunction } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import {
  AdminAuthAdapter,
  createLiveAdminAuthAdapter,
  isAdminSdkCredentialError,
} from '../config/firebaseAdmin';
import { UserProfile } from '../../src/types/mis';

export interface AuthenticatedUserContext {
  uid: string;
  email: string;
  emailVerified: boolean;
  claims: DecodedIdToken;
}

declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: AuthenticatedUserContext;
      callerProfile?: UserProfile;
    }
  }
}

/**
 * Factory for Firebase ID Token verification middleware.
 * - Strictly extracts the identity from `Authorization: Bearer <idToken>`.
 * - Never trusts `uid`, `email`, or `role` passed in request body, query params, or headers.
 * - Verifies token signature, expiration, and revocation (`checkRevoked = true`).
 */
export function createVerifyFirebaseTokenMiddleware(
  authAdapter: AdminAuthAdapter = createLiveAdminAuthAdapter()
) {
  return async function verifyFirebaseToken(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const authHeader = req.headers.authorization;

    if (!authHeader || typeof authHeader !== 'string') {
      res.status(401).json({
        success: false,
        code: 'MISSING_AUTH_TOKEN',
        error: 'Authentication required. Missing Authorization Bearer token.',
      });
      return;
    }

    const parts = authHeader.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer' || !parts[1]) {
      res.status(401).json({
        success: false,
        code: 'MALFORMED_AUTH_HEADER',
        error: 'Malformed Authorization header. Expected format: "Bearer <Firebase_ID_Token>".',
      });
      return;
    }

    const idToken = parts[1].trim();
    if (idToken.length < 10 || idToken.length > 8192) {
      res.status(401).json({
        success: false,
        code: 'INVALID_AUTH_TOKEN',
        error: 'Invalid Firebase ID token length.',
      });
      return;
    }

    try {
      const decoded = await authAdapter.verifyIdToken(idToken, true);

      if (!decoded || !decoded.uid) {
        res.status(401).json({
          success: false,
          code: 'INVALID_AUTH_TOKEN',
          error: 'Verified token did not contain a valid subject UID.',
        });
        return;
      }

      req.authenticatedUser = {
        uid: decoded.uid,
        email: (decoded.email || '').trim().toLowerCase(),
        emailVerified: Boolean(decoded.email_verified),
        claims: decoded,
      };

      next();
    } catch (err: any) {
      const errCode = String(err?.code || '');
      if (errCode === 'auth/id-token-revoked' || errCode === 'auth/user-disabled') {
        res.status(401).json({
          success: false,
          code: 'TOKEN_REVOKED',
          error: 'Your authentication session has been revoked or your account is disabled.',
        });
        return;
      }
      if (errCode === 'auth/id-token-expired') {
        res.status(401).json({
          success: false,
          code: 'TOKEN_EXPIRED',
          error: 'Your authentication token has expired. Please sign in again.',
        });
        return;
      }
      if (isAdminSdkCredentialError(err)) {
        res.status(503).json({
          success: false,
          code: 'ADMIN_SDK_CREDENTIALS_UNAVAILABLE',
          error: 'Firebase Admin SDK server credentials are not configured in this environment.',
        });
        return;
      }

      res.status(401).json({
        success: false,
        code: 'INVALID_AUTH_TOKEN',
        error: 'Invalid or unverifiable Firebase ID token.',
      });
    }
  };
}
