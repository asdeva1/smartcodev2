'use client';

import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AppShell } from '@/components/AppShell';
import { RequireSession, useSession } from '@/features/auth/session';
import { env } from '@/env';
import { EmployeeDirectory } from './EmployeeDirectory';
import { LoginNamesPanel } from './LoginNamesPanel';

function Workspace() {
  const { profile, can, signOut } = useSession();
  const router = useRouter();
  const tab =
    useSearchParams().get('tab') === 'login-names' && can('loginName.assign') ? 'login-names' : 'employees';
  const currentPath = tab === 'login-names' ? '/manager/employees?tab=login-names' : '/manager/employees';
  return (
    <AppShell
      role={profile.employee.role}
      title="Employees"
      currentPath={currentPath}
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1500 }}>
        {can('loginName.assign') && (
          <Tabs
            value={tab}
            onChange={(_, value: string) =>
              router.push(
                value === 'login-names' ? '/manager/employees?tab=login-names' : '/manager/employees',
              )
            }
            aria-label="Employee sections"
          >
            <Tab value="employees" label="Directory" />
            <Tab value="login-names" label="Login Names" />
          </Tabs>
        )}
        {tab === 'login-names' ? <LoginNamesPanel /> : <EmployeeDirectory />}
      </Box>
    </AppShell>
  );
}

/** The canonical employee-management screen. Every action is also enforced by the API; hiding is only convenience. */
export function EmployeesWorkspace() {
  return (
    <RequireSession permission="employee.read" broader>
      <Suspense>
        <Workspace />
      </Suspense>
    </RequireSession>
  );
}
