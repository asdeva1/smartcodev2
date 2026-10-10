'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { HrIntegrationStatus } from '@smartcode/shared';
import { AppShell } from '@/components/AppShell';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { useResource } from '../projects/shared';

function HrIntegration() {
  const { profile, signOut } = useSession();
  const status = useResource<HrIntegrationStatus>('/hr-integration/status');
  const s = status.data;
  return (
    <AppShell
      role={profile.employee.role}
      title="Smart HRMS"
      currentPath="/hr-integration"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1000 }}>
        {status.error && <Alert severity="error">{status.error}</Alert>}
        {s && (
          <Alert severity={s.configured ? 'success' : 'info'}>
            {s.message} People are matched on Employee ID.
          </Alert>
        )}
        {s && (
          <>
            <Typography variant="body2" color="text.secondary">
              These are the places where SmartCode will exchange data with Smart HRMS once it is connected.
            </Typography>
            <Paper variant="outlined">
              <TableContainer>
                <Table size="small" aria-label="Integration points">
                  <TableHead>
                    <TableRow>
                      <TableCell>Integration point</TableCell>
                      <TableCell>What it will do</TableCell>
                      <TableCell>Direction</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {s.points.map((p) => (
                      <TableRow key={p.key}>
                        <TableCell component="th" scope="row">
                          {p.title}
                        </TableCell>
                        <TableCell>{p.purpose}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={p.direction === 'HRMS_TO_SMARTCODE' ? 'From HRMS' : 'To HRMS'}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </>
        )}
      </Box>
    </AppShell>
  );
}

export function HrIntegrationWorkspace() {
  return (
    <RequireSession permission="hrIntegration.read">
      <HrIntegration />
    </RequireSession>
  );
}
