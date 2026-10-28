import { auth } from '../lib/firebase';
import appletConfig from '../../firebase-applet-config.json';

// The admin server runs separately from the website once hosted (Render). Locally it is the
// same origin, so the base stays empty.
const ADMIN_API_BASE = String(
  ((import.meta as any).env?.VITE_ADMIN_API_URL as string | undefined) ||
    (appletConfig as { adminApiUrl?: string }).adminApiUrl ||
    ''
).replace(/\/+$/, '');

const apiUrl = (path: string) => `${ADMIN_API_BASE}${path}`;

/** The free admin server sleeps when idle; call this when an admin screen opens so it is awake by the first action. */
export function wakeAdminApi(): void {
  if (!ADMIN_API_BASE) return;
  fetch(apiUrl('/api/health')).catch(() => {});
}
import { UserProfile, UserRole } from '../types/mis';

export interface AdminApiResult<T = any> {
  success: boolean;
  status: number;
  code: string;
  message: string;
  data?: T;
  isUnauthenticatedPreview?: boolean;
}

async function getBearerAuthHeaders(): Promise<{
  headers: Record<string, string> | null;
  error?: string;
}> {
  const user = auth.currentUser;
  if (!user) {
    return {
      headers: null,
      error: 'Not signed in to Firebase Authentication.',
    };
  }
  try {
    const idToken = await user.getIdToken();
    return {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    };
  } catch (err: any) {
    return {
      headers: null,
      error: err?.message || 'Failed to retrieve Firebase ID token.',
    };
  }
}

async function requestAdminEndpoint<T>(
  path: string,
  options: RequestInit
): Promise<AdminApiResult<T>> {
  const authHeaderResult = await getBearerAuthHeaders();
  if (!authHeaderResult.headers) {
    return {
      success: false,
      status: 401,
      code: 'CLIENT_NOT_AUTHENTICATED',
      message:
        authHeaderResult.error ||
        'Sign in with an active Super Administrator Firebase account to call the trusted provisioning backend.',
      isUnauthenticatedPreview: true,
    };
  }

  try {
    const response = await fetch(apiUrl(path), {
      ...options,
      headers: {
        ...authHeaderResult.headers,
        ...(options.headers || {}),
      },
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      return {
        success: false,
        status: response.status,
        code: payload?.code || `HTTP_${response.status}`,
        message:
          payload?.message ||
          payload?.error ||
          `Server returned HTTP ${response.status} during employee administration request.`,
        data: payload?.data,
      };
    }

    return {
      success: true,
      status: response.status,
      code: payload.code || 'OK',
      message: payload.message || 'Operation completed successfully.',
      data: payload.data as T,
    };
  } catch (err: any) {
    return {
      success: false,
      status: 503,
      code: 'NETWORK_ERROR',
      message: ADMIN_API_BASE
        ? 'The admin server is starting up. Wait a minute and try again.'
        : err?.message || 'Could not reach the admin server.',
    };
  }
}

export async function adminCreateEmployeeViaApi(input: {
  email: string;
  displayName: string;
  role: UserRole;
  department: string;
  designation?: string;
}): Promise<
  AdminApiResult<{
    employee: UserProfile;
    recoveredFromPartialAuth: boolean;
    passwordSetupInitiated: boolean;
    partialFailure?: boolean;
    authUid?: string;
    retryable?: boolean;
  }>
> {
  return requestAdminEndpoint('/api/admin/employees', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function adminUpdateEmployeeRoleViaApi(
  targetUid: string,
  input: {
    role: UserRole;
    department?: string;
    designation?: string;
  }
): Promise<AdminApiResult<{ employee: UserProfile }>> {
  return requestAdminEndpoint(
    `/api/admin/employees/${encodeURIComponent(targetUid)}/role`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    }
  );
}

export async function adminDeactivateEmployeeViaApi(
  targetUid: string,
  reason?: string
): Promise<AdminApiResult<{ employee: UserProfile }>> {
  return requestAdminEndpoint(
    `/api/admin/employees/${encodeURIComponent(targetUid)}/deactivate`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );
}

export async function adminReactivateEmployeeViaApi(
  targetUid: string
): Promise<AdminApiResult<{ employee: UserProfile }>> {
  return requestAdminEndpoint(
    `/api/admin/employees/${encodeURIComponent(targetUid)}/reactivate`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
}

export async function adminInitiatePasswordResetViaApi(
  targetUid: string
): Promise<AdminApiResult<{ targetEmail: string; resetInitiated: boolean }>> {
  return requestAdminEndpoint(
    `/api/admin/employees/${encodeURIComponent(targetUid)}/password-reset`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
}

export async function adminListEmployeesViaApi(): Promise<
  AdminApiResult<{ employees: UserProfile[] }>
> {
  return requestAdminEndpoint('/api/admin/employees', {
    method: 'GET',
  });
}

export async function adminApproveEmployeeViaApi(
  targetUid: string,
  input: {
    role: UserRole;
    department?: string;
    designation?: string;
    isDepartmentHead?: boolean;
    notes?: string;
  }
): Promise<AdminApiResult<{ employee: UserProfile }>> {
  return requestAdminEndpoint(
    `/api/admin/employees/${encodeURIComponent(targetUid)}/approve`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
}

export async function adminRejectEmployeeViaApi(
  targetUid: string,
  input: {
    reason: string;
  }
): Promise<AdminApiResult<{ employee: UserProfile }>> {
  return requestAdminEndpoint(
    `/api/admin/employees/${encodeURIComponent(targetUid)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    }
  );
}

export async function submitAccessRequestViaApi(input: {
  displayName: string;
  department: string;
  requestedRole?: UserRole;
  designation?: string;
}): Promise<AdminApiResult<{ profile: UserProfile; employee: UserProfile }>> {
  return requestAdminEndpoint('/api/admin/employees/access-request', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

