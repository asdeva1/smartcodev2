import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import { type CheckResult, migrationState } from './lib';
import { localMigrations, MIGRATIONS_DIR } from './migrations';

/**
 * Structural verification used by `pnpm db:verify` (and by the database tests). The database must contain
 *   - every table / enum / foreign key the schema declares,
 *   - every raw integrity object (partial & expression unique indexes, CHECKs, triggers, functions) that the
 *     migration files define — read from the migration files themselves — and
 *   - the named guarantees below, listed explicitly so deleting one from a migration is also caught.
 * Everything is read-only and uses current_schema(), so it works against any schema.
 */

export const REQUIRED_TABLES = [
  'organizations',
  'employees',
  'credentials',
  'auth_tokens',
  'sessions',
  'vendors',
  'teams',
  'team_memberships',
  'login_names',
  'login_name_assignments',
  'clients',
  'projects',
  'project_assignments',
  'charts',
  'chart_status_transitions',
  'chart_status_events',
  'chart_allocations',
  'production_entries',
  'audits',
  'audit_resolutions',
  'reworks',
  'notifications',
  'approval_requests',
  'approval_steps',
  'visitors',
  'visits',
  'internal_audit_reviews',
  'activity_logs',
  'audit_logs',
] as const;

export const REQUIRED_ENUMS = [
  'organization_status',
  'role',
  'employee_status',
  'active_status',
  'project_status',
  'allocation_type',
  'project_role',
  'auth_token_type',
  'login_name_end_reason',
  'chart_status',
  'allocation_source',
  'allocation_status',
  'assignment_end_reason',
  'production_status',
  'audit_result',
  'visit_status',
  'internal_review_outcome',
  'audit_status',
  'resolution_decision',
  'rework_status',
  'approval_status',
] as const;

/** The integrity guarantees of Phase 2 §2.21, by name. */
export const CRITICAL_INDEXES = [
  'employees_organization_id_employee_code_key', // unique Employee ID
  'employees_org_employee_code_ci_key', //          … regardless of letter case
  'employees_email_key', //                         unique email identity
  'login_names_org_value_ci_key', //                unique Login Name
  'login_name_assignments_one_active_per_employee_key', // one active Login Name per employee
  'login_name_assignments_one_active_per_login_name_key', // one active employee per Login Name
  'charts_project_id_chart_ref_key', //             UNIQUE(project_id, chart_id)
  'chart_allocations_one_active_per_chart_key', //  one ACTIVE allocation per chart
  'production_entries_one_current_per_chart_key', // one current production version
  'production_entries_chart_id_version_key',
  'audits_production_entry_id_key', //              one audit per production version
  'audits_chart_id_sequence_key',
  'audit_resolutions_audit_id_key', //              one Manager resolution per audit
  'reworks_audit_id_key', //                        one rework per rejected audit
  'reworks_one_open_per_chart_key',
] as const;

export const CRITICAL_TRIGGERS = [
  'employees_guard',
  'login_name_assignments_guard',
  'project_assignments_guard',
  'charts_guard',
  'chart_allocations_guard',
  'production_entries_guard',
  'audits_guard',
  'audit_resolutions_guard', //                     Manager-only resolution
  'audit_resolutions_apply',
  'audit_resolutions_append_only',
  'reworks_guard',
  'audit_logs_append_only',
  'activity_logs_append_only',
  'chart_status_events_append_only',
] as const;

export interface RawObjects {
  indexes: string[];
  checks: string[];
  triggers: string[];
  functions: string[];
}

/** Names of the raw (non-Prisma) objects defined by the migration files. */
export function rawObjectsFromMigrations(): RawObjects {
  const sql = localMigrations()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'))
    .join('\n')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const all = (re: RegExp) => [...sql.matchAll(re)].map((m) => m[1] as string);
  // Only the indexes written by hand (partial or expression) — Prisma-style plain indexes are checked by the schema parity test.
  const indexes = [
    ...sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)" ON [^;]*?(?:\blower\(|\bWHERE\b)[^;]*;/g),
  ].map((m) => m[1] as string);
  return {
    indexes,
    checks: all(/CONSTRAINT "([^"]+)" CHECK/g),
    triggers: all(/CREATE TRIGGER "([^"]+)"/g),
    functions: all(/CREATE FUNCTION "([^"]+)"/g),
  };
}

const BUSINESS_TABLES = [
  'employees',
  'vendors',
  'teams',
  'login_names',
  'clients',
  'projects',
  'charts',
  'chart_allocations',
  'production_entries',
  'audits',
  'reworks',
] as const;

export interface VerifyOptions {
  /** Check Prisma's migration bookkeeping (not present in throw-away test schemas). */
  checkMigrationState?: boolean;
}

export async function verifyDatabase(client: pg.Client, options: VerifyOptions = {}): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const names = async (sql: string) => new Set((await client.query<{ n: string }>(sql)).rows.map((r) => r.n));
  const missing = (required: readonly string[], present: Set<string>) =>
    required.filter((r) => !present.has(r));
  const report = (name: string, missingItems: string[], total: number, extra = '') =>
    results.push({
      name,
      status: missingItems.length ? 'FAIL' : 'PASS',
      detail: missingItems.length ? `missing: ${missingItems.join(', ')}` : `${total}/${total}${extra}`,
    });

  if (options.checkMigrationState !== false) {
    const state = await migrationState(client, localMigrations());
    results.push({
      name: 'Migrations',
      status: state.failed.length || state.pending.length ? 'FAIL' : 'PASS',
      detail: `${state.applied.length} applied, ${state.pending.length} pending, ${state.failed.length} failed`,
    });
  }

  const tables = await names(
    `SELECT table_name AS n FROM information_schema.tables WHERE table_schema = current_schema()`,
  );
  report('Required tables', missing(REQUIRED_TABLES, tables), REQUIRED_TABLES.length);

  const enums = await names(
    `SELECT t.typname AS n FROM pg_type t JOIN pg_namespace ns ON ns.oid = t.typnamespace WHERE t.typtype = 'e' AND ns.nspname = current_schema()`,
  );
  report('Enums', missing(REQUIRED_ENUMS, enums), REQUIRED_ENUMS.length);

  const raw = rawObjectsFromMigrations();
  const indexes = await names(`SELECT indexname AS n FROM pg_indexes WHERE schemaname = current_schema()`);
  const indexList = [...new Set([...CRITICAL_INDEXES, ...raw.indexes])];
  report('Unique / partial indexes', missing(indexList, indexes), indexList.length);

  const checks = await names(
    `SELECT c.conname AS n FROM pg_constraint c JOIN pg_namespace ns ON ns.oid = c.connamespace WHERE c.contype = 'c' AND ns.nspname = current_schema()`,
  );
  report('Check constraints', missing(raw.checks, checks), raw.checks.length);

  const triggers = await names(
    `SELECT t.tgname AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE NOT t.tgisinternal AND ns.nspname = current_schema()`,
  );
  const triggerList = [...new Set([...CRITICAL_TRIGGERS, ...raw.triggers])];
  report(
    'Triggers',
    missing(triggerList, triggers),
    triggerList.length,
    ' (state machine, append-only, Manager-only resolution)',
  );

  const functions = await names(
    `SELECT p.proname AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = current_schema()`,
  );
  report('Functions', missing(raw.functions, functions), raw.functions.length);

  const fks = await client.query<{ total: string; unvalidated: string }>(
    `SELECT count(*)::text AS total, count(*) FILTER (WHERE NOT c.convalidated)::text AS unvalidated
       FROM pg_constraint c JOIN pg_namespace ns ON ns.oid = c.connamespace WHERE c.contype = 'f' AND ns.nspname = current_schema()`,
  );
  const fkTotal = Number(fks.rows[0]?.total ?? 0);
  results.push({
    name: 'Foreign keys / orphans',
    status: fkTotal === 0 || Number(fks.rows[0]?.unvalidated ?? 0) > 0 ? 'FAIL' : 'PASS',
    detail: `${fkTotal} validated foreign keys (ON DELETE RESTRICT)`,
  });

  if (
    tables.has('employees') &&
    tables.has('charts') &&
    tables.has('chart_allocations') &&
    tables.has('login_name_assignments')
  ) {
    const dup = await client.query<{ what: string; n: string }>(
      `SELECT 'employee id' AS what, count(*)::text AS n FROM (SELECT 1 FROM employees GROUP BY organization_id, lower(employee_code) HAVING count(*) > 1) x
       UNION ALL SELECT 'email', count(*)::text FROM (SELECT 1 FROM employees GROUP BY lower(email) HAVING count(*) > 1) x
       UNION ALL SELECT 'chart id per project', count(*)::text FROM (SELECT 1 FROM charts GROUP BY project_id, chart_ref HAVING count(*) > 1) x
       UNION ALL SELECT 'active allocations per chart', count(*)::text FROM (SELECT 1 FROM chart_allocations WHERE status = 'ACTIVE' GROUP BY chart_id HAVING count(*) > 1) x
       UNION ALL SELECT 'active login names per employee', count(*)::text FROM (SELECT 1 FROM login_name_assignments WHERE ended_at IS NULL GROUP BY employee_id HAVING count(*) > 1) x
       UNION ALL SELECT 'active employees per login name', count(*)::text FROM (SELECT 1 FROM login_name_assignments WHERE ended_at IS NULL GROUP BY login_name_id HAVING count(*) > 1) x`,
    );
    const bad = dup.rows.filter((r) => Number(r.n) > 0).map((r) => `${r.what}: ${r.n}`);
    results.push({
      name: 'Duplicates',
      status: bad.length ? 'FAIL' : 'PASS',
      detail: bad.join('; ') || 'none',
    });
  }

  if (tables.has('chart_status_transitions')) {
    const transitions = await client.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM chart_status_transitions',
    );
    const n = Number(transitions.rows[0]?.n ?? 0);
    results.push({
      name: 'Chart lifecycle data',
      status: n === 14 ? 'PASS' : 'FAIL',
      detail: `${n} legal transitions (expected 14)`,
    });
  }

  if (tables.has('organizations')) {
    const orgs = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM organizations');
    const count = Number(orgs.rows[0]?.n ?? 0);
    results.push({
      name: 'System seed',
      status: count === 1 ? 'PASS' : count === 0 ? 'WARN' : 'FAIL',
      detail:
        count === 1
          ? '1 organization'
          : count === 0
            ? 'not seeded yet — run pnpm db:seed'
            : `${count} organizations (expected 1)`,
    });
  }

  if (BUSINESS_TABLES.every((t) => tables.has(t))) {
    const counts = await client.query<Record<string, string>>(
      `SELECT ${BUSINESS_TABLES.map((t) => `(SELECT count(*) FROM ${t})::text AS ${t}`).join(', ')}`,
    );
    const row = counts.rows[0] ?? {};
    const nonEmpty = BUSINESS_TABLES.filter((t) => Number(row[t] ?? 0) > 0);
    results.push({
      name: 'Business data',
      status: nonEmpty.length ? 'PASS' : 'CLEAN',
      detail: nonEmpty.length
        ? nonEmpty.map((t) => `${row[t]} ${t}`).join(', ')
        : '0 employees, 0 vendors, 0 projects, 0 charts — fresh deployment',
    });
  }
  return results;
}
