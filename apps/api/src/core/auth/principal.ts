import type { Role } from '@smartcode/shared';

/** The authenticated caller, built only from a verified access token — never from request input. */
export interface Principal {
  employeeId: string;
  organizationId: string;
  role: Role;
  /** null = in-house employee; set = vendor staff (scope is always intersected with this vendor). */
  vendorId: string | null;
  sessionId: string;
  /** Bumped when the permission matrix changes so stale tokens can be rejected. */
  permissionsVersion: number;
}

export const ACCESS_TOKEN_COOKIE = 'sc_at';
export const REFRESH_TOKEN_COOKIE = 'sc_rt';
export const CSRF_COOKIE = 'sc_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Increment when RBAC_MATRIX semantics change. */
export const PERMISSIONS_VERSION = 1;
