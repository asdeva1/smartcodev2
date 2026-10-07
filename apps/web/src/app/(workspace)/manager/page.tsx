'use client';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { CHART_STATUSES } from '@smartcode/shared';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { StatusChip } from '@/components/StatusChip';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';

function Dashboard() {
  const { profile, signOut } = useSession();
  return (
    <AppShell
      role="MANAGER"
      title="Manager dashboard"
      currentPath="/manager"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 3, maxWidth: 1100 }}>
        <Paper variant="outlined">
          <EmptyState
            title="No production data yet"
            description="Organization-wide production, audit and vendor performance will appear here once projects are created and charts are imported."
          />
        </Paper>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            Chart statuses
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {CHART_STATUSES.map((status) => (
              <StatusChip key={status} status={status} />
            ))}
          </Box>
        </Paper>
      </Box>
    </AppShell>
  );
}

/** Signed-in Managers only; the API enforces every action, this only decides what to show. */
export default function ManagerDashboardPage() {
  return (
    <RequireSession role="MANAGER">
      <Dashboard />
    </RequireSession>
  );
}
