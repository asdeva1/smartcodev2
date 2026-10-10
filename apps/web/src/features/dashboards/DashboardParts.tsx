'use client';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { CHART_STATUSES, type ManagerDashboard } from '@smartcode/shared';
import type { ReactNode } from 'react';
import { StatusChip } from '@/components/StatusChip';

export const num = (n: number) => n.toLocaleString('en-IN');
export const dash = (n: number | null, suffix = '') => (n === null ? '—' : `${n}${suffix}`);

export function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, flex: '1 1 170px', minWidth: 160 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h3" component="p" sx={{ fontVariantNumeric: 'tabular-nums', mt: 0.5 }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Paper>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ display: 'grid', gap: 1.5 }}>
      <Typography variant="h5" component="h2">
        {title}
      </Typography>
      {children}
    </Box>
  );
}

export const Tiles = ({ children }: { children: ReactNode }) => (
  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>{children}</Box>
);

/** People, production and chart figures shared by the Manager and Vendor dashboards. */
export function FigureSections({ data }: { data: ManagerDashboard }) {
  return (
    <>
      <Section title="People and projects">
        <Tiles>
          <Tile label="Active projects" value={num(data.people.projects)} />
          <Tile label="Teams" value={num(data.people.teams)} />
          <Tile label="Active Team Leads" value={num(data.people.activeTeamLeads)} />
          <Tile label="Active Auditors" value={num(data.people.activeAuditors)} />
          <Tile label="Active Coders" value={num(data.people.activeCoders)} />
        </Tiles>
      </Section>

      <Section title="Production">
        <Tiles>
          <Tile
            label="Charts coded today"
            value={num(data.production.today.charts)}
            hint={`${num(data.production.today.pages)} pages`}
          />
          <Tile
            label="Charts coded this month"
            value={num(data.production.month.charts)}
            hint={`${num(data.production.month.pages)} pages · ${num(data.production.month.icds)} ICDs · ${num(data.production.month.dos)} DOS`}
          />
          <Tile
            label="CPH"
            value={dash(data.performance.cph)}
            hint={`${data.performance.activeHours} active hours this month`}
          />
          <Tile
            label="Audit percentage"
            value={dash(data.performance.auditPercentage, '%')}
            hint={`${num(data.performance.auditedCharts)} audited · ${num(data.performance.totalErrors)} errors`}
          />
        </Tiles>
      </Section>

      <Section title="Charts">
        <Tiles>
          <Tile label="Total charts" value={num(data.charts.total)} />
          <Tile label="Pending allocation" value={num(data.charts.pendingAllocation)} />
          <Tile label="With coders" value={num(data.charts.inProgress)} />
          <Tile label="Pending audit" value={num(data.charts.pendingAudit)} />
          <Tile label="Review required" value={num(data.charts.reviewRequired)} />
          <Tile label="Pending rework" value={num(data.charts.pendingRework)} />
          <Tile label="Completed charts" value={num(data.charts.completed)} />
          <Tile label="Completed audits" value={num(data.audits.completed)} />
        </Tiles>
        <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
          {CHART_STATUSES.map((s) => (
            <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <StatusChip status={s} />
              <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {num(data.charts.byStatus[s] ?? 0)}
              </Typography>
            </Box>
          ))}
        </Paper>
      </Section>
    </>
  );
}
