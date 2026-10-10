'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  type EmployeeRecord,
  type Page,
  type ProjectDetail,
  type ProjectStatus,
  type TeamRecord,
} from '@smartcode/shared';
import NextLink from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { apiFetch } from '@/lib/api';
import { TeamDashboardPanel } from '../dashboards/TeamLeadWorkspace';
import { FormDialog, useAction } from '../admin/ui';
import { ProjectAllocation } from './ProjectAllocation';
import { LiveTrackingPanel, ProductionReportPanel, QualityReportPanel } from './ProjectReports';
import { AllocationChip, ProjectStatusChip, useResource } from './shared';

const num = { fontVariantNumeric: 'tabular-nums' } as const;

const ROLE_LABEL: Record<string, string> = {
  CODER: 'Coder',
  AUDITOR: 'Auditor',
  GROUP_COACH: 'Group Coach / SME',
  TEAM_LEAD: 'Team Lead',
};

function Summary({ label, value }: { label: string; value: string | number }) {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h4" component="p" sx={{ ...num, mt: 0.25 }}>
        {value}
      </Typography>
    </Box>
  );
}

function LeadDialog({ project, onClose }: { project: ProjectDetail; onClose: (done: boolean) => void }) {
  const [leadId, setLeadId] = useState(project.lead?.id ?? '');
  const leads = useResource<Page<EmployeeRecord>>('/employees?role=TEAM_LEAD&status=ACTIVE&pageSize=100');
  const action = useAction(() => onClose(true));
  return (
    <FormDialog
      title="Project lead"
      onClose={() => onClose(false)}
      busy={action.busy}
      error={action.error}
      onSubmit={() =>
        void action.run(() =>
          apiFetch(`/projects/${project.id}/lead`, {
            method: 'POST',
            body: JSON.stringify({ employeeId: leadId || null }),
          }),
        )
      }
    >
      <TextField
        select
        size="small"
        label="Team Lead"
        value={leadId}
        onChange={(e) => setLeadId(e.target.value)}
      >
        <MenuItem value="">No lead</MenuItem>
        {(leads.data?.items ?? []).map((l) => (
          <MenuItem key={l.id} value={l.id}>
            {l.fullName} ({l.email})
          </MenuItem>
        ))}
      </TextField>
    </FormDialog>
  );
}

function TeamDialog({ project, onClose }: { project: ProjectDetail; onClose: (done: boolean) => void }) {
  const [teamId, setTeamId] = useState(project.team?.id ?? '');
  const teams = useResource<Page<TeamRecord>>('/teams?status=ACTIVE&pageSize=100');
  const action = useAction(() => onClose(true));
  const options = (teams.data?.items ?? []).filter(
    (t) => (t.vendor?.id ?? null) === (project.vendor?.id ?? null),
  );
  return (
    <FormDialog
      title="Project team"
      onClose={() => onClose(false)}
      busy={action.busy}
      error={action.error}
      onSubmit={() =>
        void action.run(() =>
          apiFetch(`/projects/${project.id}/team`, {
            method: 'POST',
            body: JSON.stringify({ teamId: teamId || null }),
          }),
        )
      }
    >
      <TextField
        select
        size="small"
        label="Team"
        value={teamId}
        onChange={(e) => setTeamId(e.target.value)}
        helperText="The team's Team Lead, Coders and Group Coaches become the project's staff, and follow any later change to the team. Auditors are added to the project separately."
      >
        <MenuItem value="">No team</MenuItem>
        {options.map((t) => (
          <MenuItem key={t.id} value={t.id}>
            {t.name}
          </MenuItem>
        ))}
      </TextField>
    </FormDialog>
  );
}

function AddMemberDialog({ project, onClose }: { project: ProjectDetail; onClose: (done: boolean) => void }) {
  const [role, setRole] = useState<'CODER' | 'AUDITOR' | 'GROUP_COACH'>(project.team ? 'AUDITOR' : 'CODER');
  const [employeeId, setEmployeeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const people = useResource<Page<EmployeeRecord>>(`/employees?role=${role}&status=ACTIVE&pageSize=100`);
  const memberIds = new Set(project.members.map((m) => m.employeeId));
  const action = useAction(() => onClose(true));
  return (
    <FormDialog
      title="Add project member"
      onClose={() => onClose(false)}
      submitLabel="Add member"
      busy={action.busy}
      error={action.error}
      onSubmit={() => {
        if (!employeeId) return setError('Choose a person');
        setError(null);
        void action.run(() =>
          apiFetch(`/projects/${project.id}/members`, {
            method: 'POST',
            body: JSON.stringify({ employeeId, projectRole: role }),
          }),
        );
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {project.team
          ? `Coders and Group Coaches join through the team (${project.team.name}). Add Auditors here.`
          : 'Coders are also added automatically when an allocation file gives them charts.'}
      </Typography>
      <TextField
        select
        size="small"
        label="Role"
        value={role}
        onChange={(e) => {
          setRole(e.target.value as typeof role);
          setEmployeeId('');
        }}
      >
        {!project.team && <MenuItem value="CODER">Coder</MenuItem>}
        <MenuItem value="AUDITOR">Auditor</MenuItem>
        {!project.team && <MenuItem value="GROUP_COACH">Group Coach / SME</MenuItem>}
      </TextField>
      <TextField
        select
        size="small"
        label="Person"
        value={employeeId}
        onChange={(e) => setEmployeeId(e.target.value)}
        error={Boolean(error)}
        helperText={error}
      >
        {(people.data?.items ?? [])
          .filter((p) => !memberIds.has(p.id))
          .map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.fullName} ({p.email})
            </MenuItem>
          ))}
      </TextField>
    </FormDialog>
  );
}

function Overview({
  project,
  manage,
  onChanged,
  onToast,
}: {
  project: ProjectDetail;
  manage: boolean;
  onChanged: () => void;
  onToast: (message: string) => void;
}) {
  const [dialog, setDialog] = useState<'lead' | 'member' | 'team' | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const remove = useAction(() => {
    onToast('Member removed.');
    onChanged();
  });

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {project.legacyStaffCount > 0 && (
        <Alert severity="warning">
          {project.legacyStaffCount} {project.legacyStaffCount === 1 ? 'person was' : 'people were'} added to
          this project one by one, not through a team.
          {project.team
            ? ' They keep their access. Add them to the team, then remove them here, so the team controls who works this project.'
            : ' Assign a team so the team controls who works this project.'}
        </Alert>
      )}
      <Paper
        variant="outlined"
        sx={{ p: 2.5, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Box>
          <Typography variant="body2" color="text.secondary">
            Team
          </Typography>
          <Typography variant="h6" component="p">
            {project.team?.name ?? 'No team yet'}
          </Typography>
        </Box>
        {manage && (
          <Button size="small" onClick={() => setDialog('team')}>
            {project.team ? 'Change team' : 'Assign team'}
          </Button>
        )}
      </Paper>
      <Paper
        variant="outlined"
        sx={{ p: 2.5, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Box>
          <Typography variant="body2" color="text.secondary">
            Project lead
          </Typography>
          <Typography variant="h6" component="p">
            {project.lead?.fullName ?? 'No lead yet'}
          </Typography>
        </Box>
        {manage && !project.team && (
          <Button size="small" onClick={() => setDialog('lead')}>
            {project.lead ? 'Change lead' : 'Set lead'}
          </Button>
        )}
      </Paper>

      <Paper variant="outlined">
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" component="h3" sx={{ flex: 1 }}>
            Project members ({project.memberCount})
          </Typography>
          {manage && (
            <Button variant="outlined" size="small" onClick={() => setDialog('member')}>
              Add member
            </Button>
          )}
        </Box>
        {(removeError || remove.error) && (
          <Alert severity="error" sx={{ mx: 2, mb: 1 }}>
            {removeError ?? remove.error}
          </Alert>
        )}
        {project.members.length === 0 ? (
          <EmptyState
            title="No members yet"
            description={
              project.allocationType === 'MANUAL'
                ? 'Coders join automatically when you upload an allocation file. You can also add Auditors, Coders and Group Coaches here.'
                : 'Add the Coders, Auditors and Group Coaches who work on this project.'
            }
          />
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Project members">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Login Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell align="right">Charts held</TableCell>
                  {manage && <TableCell align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {project.members.map((m) => (
                  <TableRow key={m.employeeId} hover>
                    <TableCell>{m.fullName}</TableCell>
                    <TableCell>{ROLE_LABEL[m.projectRole] ?? m.projectRole}</TableCell>
                    <TableCell>{m.loginName ?? '—'}</TableCell>
                    <TableCell>{m.email}</TableCell>
                    <TableCell align="right" sx={num}>
                      {m.projectRole === 'CODER' ? m.openCharts : '—'}
                    </TableCell>
                    {manage && m.viaTeam && (
                      <TableCell align="right">
                        <Typography variant="body2" color="text.secondary">
                          From team
                        </Typography>
                      </TableCell>
                    )}
                    {manage && !m.viaTeam && (
                      <TableCell align="right">
                        <Button
                          size="small"
                          color="error"
                          disabled={remove.busy}
                          onClick={() => {
                            setRemoveError(null);
                            void remove.run(() =>
                              apiFetch(`/projects/${project.id}/members/${m.employeeId}`, {
                                method: 'DELETE',
                              }),
                            );
                          }}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {dialog === 'team' && (
        <TeamDialog
          project={project}
          onClose={(done) => {
            setDialog(null);
            if (done) {
              onToast('Project team updated.');
              onChanged();
            }
          }}
        />
      )}
      {dialog === 'lead' && (
        <LeadDialog
          project={project}
          onClose={(done) => {
            setDialog(null);
            if (done) {
              onToast('Project lead updated.');
              onChanged();
            }
          }}
        />
      )}
      {dialog === 'member' && (
        <AddMemberDialog
          project={project}
          onClose={(done) => {
            setDialog(null);
            if (done) {
              onToast('Member added.');
              onChanged();
            }
          }}
        />
      )}
    </Box>
  );
}

type TabKey = 'team' | 'overview' | 'live' | 'production' | 'quality' | 'allocation';

function ProjectDetailView({ id }: { id: string }) {
  const { profile, can, signOut } = useSession();
  const project = useResource<ProjectDetail>(`/projects/${id}`);
  const [chosenTab, setTab] = useState<TabKey | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const p = project.data;
  const manage = can('project.manage');
  const allocate = can('chart.allocate');

  async function changeStatus(status: ProjectStatus) {
    setStatusError(null);
    try {
      await apiFetch(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setToast('Project status updated.');
      project.refresh();
    } catch {
      setStatusError('The status could not be changed.');
    }
  }

  // The Manager opens a project on its team's dashboard.
  const teamTab = profile.employee.role === 'MANAGER' && Boolean(p?.team);
  const tabs: { key: TabKey; label: string }[] = [
    ...(teamTab ? [{ key: 'team' as const, label: p?.team ? `Team: ${p.team.name}` : 'Team' }] : []),
    { key: 'overview', label: 'Overview' },
    { key: 'live', label: 'Live tracking' },
    ...(can('report.read')
      ? [
          { key: 'production' as const, label: 'Production report' },
          { key: 'quality' as const, label: 'Quality report' },
        ]
      : []),
    // Automatic projects are allocated by the system: no chart allocation option.
    ...(p?.allocationType === 'MANUAL' && allocate
      ? [{ key: 'allocation' as const, label: 'Chart allocation' }]
      : []),
  ];

  const preferred: TabKey = teamTab ? 'team' : 'overview';
  const tab: TabKey = tabs.some((t) => t.key === chosenTab) ? (chosenTab as TabKey) : preferred;

  return (
    <AppShell
      role={profile.employee.role}
      title={p ? p.name : 'Project'}
      currentPath="/projects"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1300 }}>
        <NextLink href="/projects" style={{ width: 'fit-content' }}>
          ← All projects
        </NextLink>
        {project.error && (
          <Alert severity="error" role="alert">
            {project.error === 'This could not be loaded.' ? 'This project was not found.' : project.error}
          </Alert>
        )}
        {!p && !project.error && <Typography color="text.secondary">Loading project…</Typography>}
        {p && (
          <>
            <Paper variant="outlined" sx={{ p: 2.5, display: 'grid', gap: 2 }}>
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="h5" component="h2">
                  {p.client.name} · {p.name}
                </Typography>
                <AllocationChip type={p.allocationType} />
                {manage ? (
                  <TextField
                    select
                    size="small"
                    fullWidth={false}
                    aria-label="Project status"
                    value={p.status}
                    onChange={(e) => void changeStatus(e.target.value as ProjectStatus)}
                    sx={{ minWidth: 130 }}
                  >
                    <MenuItem value="ACTIVE">Active</MenuItem>
                    <MenuItem value="ON_HOLD">On hold</MenuItem>
                    <MenuItem value="CLOSED">Closed</MenuItem>
                  </TextField>
                ) : (
                  <ProjectStatusChip status={p.status} />
                )}
              </Box>
              {statusError && <Alert severity="error">{statusError}</Alert>}
              <Box sx={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <Summary label="Team" value={p.team?.name ?? 'No team yet'} />
                <Summary label="Project lead" value={p.lead?.fullName ?? '—'} />
                <Summary label="Project members" value={p.memberCount} />
                <Summary label="Working now" value={p.workingNow} />
                <Summary label="Charts" value={p.chartCount} />
              </Box>
              {p.allocationType === 'AUTOMATIC' && (
                <Typography variant="body2" color="text.secondary">
                  Charts in this project are allocated automatically, so there is no chart allocation file
                  here.
                </Typography>
              )}
            </Paper>

            <Tabs
              value={tab}
              onChange={(_, next: TabKey) => setTab(next)}
              variant="scrollable"
              scrollButtons="auto"
              aria-label="Project sections"
            >
              {tabs.map((t) => (
                <Tab key={t.key} value={t.key} label={t.label} />
              ))}
            </Tabs>

            {tab === 'team' && p.team && <TeamDashboardPanel teamId={p.team.id} />}
            {tab === 'overview' && (
              <Overview
                project={p}
                manage={can('project.assignStaff')}
                onChanged={project.refresh}
                onToast={setToast}
              />
            )}
            {tab === 'live' && <LiveTrackingPanel projectId={p.id} />}
            {tab === 'production' && <ProductionReportPanel projectId={p.id} />}
            {tab === 'quality' && <QualityReportPanel projectId={p.id} />}
            {tab === 'allocation' && p.allocationType === 'MANUAL' && (
              <ProjectAllocation project={p} onChanged={project.refresh} onToast={setToast} />
            )}
          </>
        )}
      </Box>
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={6000}
        onClose={() => setToast(null)}
        message={toast ?? ''}
      />
    </AppShell>
  );
}

function Detail() {
  const params = useParams<{ id: string }>();
  return <ProjectDetailView id={params.id} />;
}

export function ProjectDetailWorkspace() {
  return (
    <RequireSession permission="project.read">
      <Detail />
    </RequireSession>
  );
}
