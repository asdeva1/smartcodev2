'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { type MyAccount, ROLE_LABELS, type Role } from '@smartcode/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { EmployeeStatusChip, formatDate, problemText } from '@/features/employees/common';
import { apiFetch } from '@/lib/api';

const PROJECT_ROLE_LABELS: Record<string, string> = {
  TEAM_LEAD: 'Team Lead',
  AUDITOR: 'Auditor',
  CODER: 'Coder',
  GROUP_COACH: 'Group Coach',
};

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '200px 1fr' }, gap: { xs: 0.25, sm: 2 } }}
    >
      <Typography variant="body2" color="text.secondary" component="dt">
        {label}
      </Typography>
      <Typography component="dd" sx={{ m: 0, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Box>
  );
}

function Account() {
  const { profile, signOut } = useSession();
  const [account, setAccount] = useState<MyAccount | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<MyAccount>('/auth/my-account')
      .then((a) => {
        if (!cancelled) setAccount(a);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(problemText(e, 'Your account details could not be loaded.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const none = (
    <Typography component="span" color="text.secondary">
      —
    </Typography>
  );

  return (
    <AppShell
      role={profile.employee.role}
      title="My account"
      currentPath="/my-account"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 3, maxWidth: 760 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {account && (
          <>
            <Paper variant="outlined" sx={{ p: 3, display: 'grid', gap: 2 }}>
              <Typography variant="h5" component="h2">
                Profile
              </Typography>
              <Box component="dl" sx={{ m: 0, display: 'grid', gap: 1.5 }}>
                <Detail label="Name">{account.fullName}</Detail>
                <Detail label="Emp ID">{account.employeeCode}</Detail>
                <Detail label="Email">{account.email}</Detail>
                <Detail label="Role">{ROLE_LABELS[account.role as Role] ?? account.role}</Detail>
                <Detail label="Status">
                  <EmployeeStatusChip status={account.status} />
                </Detail>
                <Detail label="Client Login">{account.loginName ?? none}</Detail>
                <Detail label="Vendor">{account.vendor?.name ?? 'In-house'}</Detail>
                <Detail label="Team">
                  {account.team
                    ? `${account.team.name}${account.team.teamLead ? ` · Lead: ${account.team.teamLead}` : ''}`
                    : none}
                </Detail>
                <Detail label="Joined">{formatDate(account.activatedAt ?? account.createdAt)}</Detail>
              </Box>
            </Paper>
            <Paper variant="outlined" sx={{ p: 3, display: 'grid', gap: 2 }}>
              <Typography variant="h5" component="h2">
                My projects
              </Typography>
              {account.projects.length === 0 ? (
                <Typography color="text.secondary">You are not on a project yet.</Typography>
              ) : (
                <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'grid', gap: 0.75 }}>
                  {account.projects.map((p) => (
                    <li key={p.id}>
                      {p.client} · {p.name}{' '}
                      <Typography component="span" color="text.secondary">
                        ({PROJECT_ROLE_LABELS[p.projectRole] ?? p.projectRole})
                      </Typography>
                    </li>
                  ))}
                </Box>
              )}
            </Paper>
          </>
        )}
      </Box>
    </AppShell>
  );
}

export function MyAccountWorkspace() {
  return (
    <RequireSession>
      <Account />
    </RequireSession>
  );
}
