'use client';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { type Permission, type Role, type Scope } from '@smartcode/shared';
import { useRouter } from 'next/navigation';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api';

export interface Profile {
  employee: {
    id: string;
    employeeCode: string;
    fullName: string;
    email: string;
    role: Role;
    status: string;
    vendorId: string | null;
    loginName: string | null;
    loginNameEligible: boolean;
  };
  permissions: Partial<Record<Permission, Scope>>;
}

interface SessionValue {
  profile: Profile;
  can: (permission: Permission) => boolean;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <RequireSession>');
  return value;
}

/** Where each role lands after signing in. Only the Manager workspace exists in Phase 3. */
export function homeFor(role: Role): string {
  return role === 'MANAGER' ? '/manager' : '/';
}

/**
 * Gate for authenticated pages. The server enforces every permission; this only decides what to show and where to
 * send a visitor who is not signed in (frontend hiding is not security).
 */
export function RequireSession({
  children,
  role,
  permission,
  broader,
}: {
  children: ReactNode;
  role?: Role;
  permission?: Permission;
  /** Require more than "my own record": a Coder holds employee.read for SELF only and must not reach the directory. */
  broader?: boolean;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'anonymous' | 'forbidden' | 'unreachable'>(
    'loading',
  );

  useEffect(() => {
    let cancelled = false;
    apiFetch<Profile>('/auth/me')
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        const wrongRole = role !== undefined && p.employee.role !== role;
        const scope = permission === undefined ? 'ORG' : p.permissions[permission];
        const lacking = scope === undefined || (broader === true && scope === 'SELF');
        setState(wrongRole || lacking ? 'forbidden' : 'ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState(error instanceof ApiError && error.status === 0 ? 'unreachable' : 'anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, [role, permission, broader]);

  useEffect(() => {
    if (state === 'anonymous') router.push('/login');
  }, [state, router]);

  const signOut = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  }, [router]);

  const value = useMemo<SessionValue | null>(
    () =>
      profile
        ? { profile, can: (permission) => profile.permissions[permission] !== undefined, signOut }
        : null,
    [profile, signOut],
  );

  if (state === 'ready' && value)
    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
  if (state === 'forbidden') {
    return (
      <Box role="alert" sx={{ p: 6, textAlign: 'center' }}>
        You do not have access to this page.
      </Box>
    );
  }
  if (state === 'unreachable') {
    return (
      <Box role="alert" sx={{ p: 6, textAlign: 'center' }}>
        SmartCode could not reach the server. Check your connection and reload.
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }} aria-busy="true">
      <CircularProgress aria-label="Loading" />
    </Box>
  );
}
