'use client';

import Box from '@mui/material/Box';
import { AppShell } from '@/components/AppShell';
import { RequireSession, useSession } from '@/features/auth/session';
import { env } from '@/env';
import { EmployeeDirectory } from './EmployeeDirectory';

function Workspace() {
  const { profile, signOut } = useSession();
  return (
    <AppShell
      role={profile.employee.role}
      title="Employees"
      currentPath="/manager/employees"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1500 }}>
        <EmployeeDirectory />
      </Box>
    </AppShell>
  );
}

/** The canonical employee-management screen. Every action is also enforced by the API; hiding is only convenience. */
export function EmployeesWorkspace() {
  return (
    <RequireSession permission="employee.read" broader>
      <Workspace />
    </RequireSession>
  );
}
