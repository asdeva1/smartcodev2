import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { CHART_STATUSES } from '@smartcode/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { StatusChip } from '@/components/StatusChip';
import { env } from '@/env';

export const metadata: Metadata = { title: 'Manager dashboard' };

/**
 * Phase 1 preview of the workspace shell. Authentication (Phase 3) will gate this route; until then it is
 * only served in non-production environments so nothing unauthenticated reaches production.
 */
export default function ManagerDashboardPage() {
  if (env.NEXT_PUBLIC_APP_ENV === 'production') notFound();

  return (
    <AppShell
      role="MANAGER"
      title="Manager dashboard"
      currentPath="/manager"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
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
