'use client';

import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  type ClientOption,
  type Page,
  type ProjectDetail,
  type ProjectListRecord,
  type TeamRecord,
  projectCreateSchema,
} from '@smartcode/shared';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/EmptyState';
import { env } from '@/env';
import { RequireSession, useSession } from '@/features/auth/session';
import { apiFetch } from '@/lib/api';
import { FormDialog, useAction, usePagedList } from '../admin/ui';
import { AllocationChip, ProjectStatusChip, useResource } from './shared';

function CreateProjectDialog({ onClose }: { onClose: (createdId: string | null) => void }) {
  const [clientName, setClientName] = useState('');
  const [name, setName] = useState('');
  const [allocationType, setAllocationType] = useState<'MANUAL' | 'AUTOMATIC' | ''>('');
  const [teamId, setTeamId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const clients = useResource<ClientOption[]>('/projects/clients');
  const teams = useResource<Page<TeamRecord>>('/teams?status=ACTIVE&pageSize=100');
  const action = useAction<ProjectDetail>((project) => onClose(project.id));

  function submit() {
    const parsed = projectCreateSchema.safeParse({
      clientName,
      name,
      allocationType: allocationType || undefined,
      ...(teamId ? { teamId } : {}),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      if (next.allocationType) next.allocationType = 'Choose Manual or Automatic';
      setErrors(next);
      return;
    }
    setErrors({});
    void action.run(() =>
      apiFetch<ProjectDetail>('/projects', { method: 'POST', body: JSON.stringify(parsed.data) }),
    );
  }

  return (
    <FormDialog
      title="Create project"
      onClose={() => onClose(null)}
      onSubmit={submit}
      submitLabel="Create project"
      busy={action.busy}
      error={action.error}
    >
      <Autocomplete
        freeSolo
        options={(clients.data ?? []).map((c) => c.name)}
        inputValue={clientName}
        onInputChange={(_, value) => setClientName(value)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Client name"
            required
            size="small"
            error={Boolean(errors.clientName)}
            helperText={errors.clientName ?? 'Pick an existing client or type a new one'}
          />
        )}
      />
      <TextField
        label="Project"
        required
        size="small"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={Boolean(errors.name)}
        helperText={errors.name}
      />
      <TextField
        select
        required
        size="small"
        label="Allocation type"
        value={allocationType}
        onChange={(e) => setAllocationType(e.target.value as 'MANUAL' | 'AUTOMATIC')}
        error={Boolean(errors.allocationType)}
        helperText={
          errors.allocationType ??
          (allocationType === 'AUTOMATIC'
            ? 'Charts are allocated by the system. There is no chart allocation file for this project.'
            : allocationType === 'MANUAL'
              ? 'You upload an allocation file that gives each chart to a coder.'
              : 'Manual: you allocate charts. Automatic: the system allocates them.')
        }
      >
        <MenuItem value="MANUAL">Manual</MenuItem>
        <MenuItem value="AUTOMATIC">Automatic</MenuItem>
      </TextField>
      <TextField
        select
        size="small"
        label="Team"
        value={teamId}
        onChange={(e) => setTeamId(e.target.value)}
        helperText="The team that works this project. Its Team Lead, Coders and Group Coaches become the project's staff. You can set or change this later."
      >
        <MenuItem value="">No team yet</MenuItem>
        {(teams.data?.items ?? []).map((t) => (
          <MenuItem key={t.id} value={t.id}>
            {t.name}
            {t.vendor ? ` (${t.vendor.name})` : ''}
          </MenuItem>
        ))}
      </TextField>
    </FormDialog>
  );
}

function Projects() {
  const { profile, can, signOut } = useSession();
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const list = usePagedList<ProjectListRecord>('/projects', {
    page: page + 1,
    pageSize,
    q: q || undefined,
    allocationType: type || undefined,
    status: status || undefined,
  });
  const manage = can('project.manage');

  return (
    <AppShell
      role={profile.employee.role}
      title="Projects"
      currentPath="/projects"
      appEnv={env.NEXT_PUBLIC_APP_ENV}
      userName={profile.employee.fullName}
      onSignOut={() => void signOut()}
    >
      <Box sx={{ display: 'grid', gap: 2, maxWidth: 1300 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            label="Search client or project"
            fullWidth={false}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            sx={{ minWidth: 280 }}
          />
          <TextField
            size="small"
            select
            label="Allocation type"
            fullWidth={false}
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(0);
            }}
            sx={{ minWidth: 170 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="MANUAL">Manual</MenuItem>
            <MenuItem value="AUTOMATIC">Automatic</MenuItem>
          </TextField>
          <TextField
            size="small"
            select
            label="Status"
            fullWidth={false}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="ACTIVE">Active</MenuItem>
            <MenuItem value="ON_HOLD">On hold</MenuItem>
            <MenuItem value="CLOSED">Closed</MenuItem>
          </TextField>
          <Box sx={{ flex: 1 }} />
          {manage && (
            <Button variant="contained" onClick={() => setCreating(true)}>
              Create project
            </Button>
          )}
        </Box>

        <Paper variant="outlined">
          {list.error ? (
            <Box role="alert" sx={{ p: 3 }}>
              {list.error}
            </Box>
          ) : list.data && list.data.total === 0 ? (
            <EmptyState
              title={q || type || status ? 'No projects match' : 'No projects yet'}
              description={
                manage
                  ? 'Create a project with its client and allocation type. Then assign a team and, for a Manual project, upload the chart allocation file.'
                  : 'Projects you are staffed on appear here.'
              }
              action={
                manage && !q && !type && !status ? (
                  <Button variant="contained" onClick={() => setCreating(true)}>
                    Create project
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <TableContainer>
                <Table size="small" aria-label="Projects">
                  <TableHead>
                    <TableRow>
                      <TableCell>Client</TableCell>
                      <TableCell>Project</TableCell>
                      <TableCell>Allocation type</TableCell>
                      <TableCell>Team</TableCell>
                      <TableCell>Project lead</TableCell>
                      <TableCell align="right">Members</TableCell>
                      <TableCell align="right">Charts</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(list.data?.items ?? []).map((p) => (
                      <TableRow
                        key={p.id}
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => router.push(`/projects/${p.id}`)}
                      >
                        <TableCell>{p.client.name}</TableCell>
                        <TableCell>
                          <NextLink
                            href={`/projects/${p.id}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{ fontWeight: 600 }}
                          >
                            {p.name}
                          </NextLink>
                        </TableCell>
                        <TableCell>
                          <AllocationChip type={p.allocationType} />
                        </TableCell>
                        <TableCell>{p.team?.name ?? 'No team yet'}</TableCell>
                        <TableCell>{p.lead?.fullName ?? '—'}</TableCell>
                        <TableCell align="right">{p.memberCount}</TableCell>
                        <TableCell align="right">{p.chartCount}</TableCell>
                        <TableCell>
                          <ProjectStatusChip status={p.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={list.data?.total ?? 0}
                page={page}
                rowsPerPage={pageSize}
                onPageChange={(_, p) => setPage(p)}
                onRowsPerPageChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                rowsPerPageOptions={[10, 25, 50]}
              />
            </>
          )}
        </Paper>
        {list.data && list.data.total > 0 && (
          <Typography variant="body2" color="text.secondary">
            Open a project to see its team, members, reports and live chart tracking.
          </Typography>
        )}
      </Box>

      {creating && (
        <CreateProjectDialog
          onClose={(id) => {
            setCreating(false);
            if (id) {
              setToast('Project created.');
              router.push(`/projects/${id}`);
            }
          }}
        />
      )}
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={() => setToast(null)}
        message={toast ?? ''}
      />
    </AppShell>
  );
}

/** Projects list and creation. The API enforces `project.read` / `project.manage` and each person's scope. */
export function ProjectsWorkspace() {
  return (
    <RequireSession permission="project.read">
      <Projects />
    </RequireSession>
  );
}
