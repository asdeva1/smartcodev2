'use client';

import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { Page, ProjectListRecord } from '@smartcode/shared';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { ProductionReportPanel, QualityReportPanel } from '../projects/ProjectReports';
import { useResource } from '../projects/shared';

function Reports() {
  const { profile, signOut } = useSession();
  const projects = useResource<Page<ProjectListRecord>>('/projects?pageSize=100');
  const [projectId, setProjectId] = useState('');
  const [tab, setTab] = useState<'production' | 'quality'>('production');
  const items = projects.data?.items ?? [];
  const selected = projectId || items[0]?.id || '';

  return (
    <AppShell
      role={profile.employee.role}
      title="Reports"
      currentPath="/reports"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1300 }}>
        {projects.data && items.length === 0 ? (
          <EmptyState
            title="No projects to report on"
            description="Reports appear here once you are on a project."
          />
        ) : (
          <>
            <TextField
              select
              size="small"
              label="Project"
              value={selected}
              onChange={(e) => setProjectId(e.target.value)}
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
              sx={{ width: 360, flex: 'none' }}
            >
              {items.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.client.name} · {p.name}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="body2" color="text.secondary">
              You see only your own scope. Download any report as Excel, CSV or PDF.
            </Typography>
            <Tabs
              value={tab}
              onChange={(_, v: 'production' | 'quality') => setTab(v)}
              aria-label="Report type"
            >
              <Tab value="production" label="Production report" />
              <Tab value="quality" label="Quality report" />
            </Tabs>
            {selected &&
              (tab === 'production' ? (
                <ProductionReportPanel key={`p-${selected}`} projectId={selected} />
              ) : (
                <QualityReportPanel key={`q-${selected}`} projectId={selected} />
              ))}
          </>
        )}
      </Box>
    </AppShell>
  );
}

/** One place to run and download the reports of any project the person can see. The API enforces scope. */
export function ReportsWorkspace() {
  return (
    <RequireSession permission="report.read">
      <Reports />
    </RequireSession>
  );
}
