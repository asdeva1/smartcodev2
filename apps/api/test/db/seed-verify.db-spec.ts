import pg from 'pg';
import { seedSystem } from '../../scripts/seed/system-seed';
import { rawObjectsFromMigrations, verifyDatabase } from '../../scripts/verify-lib';
import { createTestDb, DATABASE_URL, describeDb, type TestDb } from './harness';

describeDb('System seed and db:verify (PostgreSQL)', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => db?.close());

  const withSchemaClient = async <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> => {
    const client = new pg.Client({ connectionString: DATABASE_URL, options: `-c search_path=${db.schema}` });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end();
    }
  };

  it('verification finds the migrated schema complete, with no seed yet', async () => {
    const results = await withSchemaClient((c) => verifyDatabase(c, { checkMigrationState: false }));
    expect(results.filter((r) => r.status === 'FAIL')).toEqual([]);
    expect(results.find((r) => r.name === 'System seed')?.status).toBe('WARN');
    expect(results.find((r) => r.name === 'Business data')?.status).toBe('CLEAN');
  });

  it('seeds exactly one organization, idempotently, and nothing else (no people, no passwords)', async () => {
    const first = await seedSystem(db.prisma);
    const second = await seedSystem(db.prisma);
    const third = await seedSystem(db.prisma);
    expect(first.created).toBe(true);
    expect(second).toEqual({ created: false, organizationId: first.organizationId });
    expect(third.created).toBe(false);

    const counts = await db.sql<{ table_name: string; n: number }>(
      `SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text::int AS n
         FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
    );
    const nonEmpty = counts
      .filter((c) => c.n > 0)
      .map((c) => `${c.table_name}:${c.n}`)
      .sort();
    // organizations (1) and the chart lifecycle reference data (14) — nothing else.
    expect(nonEmpty).toEqual(['chart_status_transitions:14', 'organizations:1']);
  });

  it('refuses to seed when a different organization already exists', async () => {
    await expect(
      seedSystem(db.prisma, { slug: 'another', name: 'Another', timeZone: 'UTC' }),
    ).rejects.toThrow(/Refusing to seed/);
  });

  it('verification passes after seeding and detects a missing guarantee', async () => {
    const ok = await withSchemaClient((c) => verifyDatabase(c, { checkMigrationState: false }));
    expect(ok.filter((r) => r.status === 'FAIL')).toEqual([]);
    expect(ok.find((r) => r.name === 'System seed')?.status).toBe('PASS');

    await db.sql(`DROP TRIGGER audit_resolutions_guard ON audit_resolutions`);
    const broken = await withSchemaClient((c) => verifyDatabase(c, { checkMigrationState: false }));
    expect(broken.find((r) => r.name === 'Triggers')).toMatchObject({
      status: 'FAIL',
      detail: expect.stringContaining('audit_resolutions_guard'),
    });
  });

  it('derives its checklist from the migration files', () => {
    const raw = rawObjectsFromMigrations();
    expect(raw.indexes).toEqual(
      expect.arrayContaining([
        'chart_allocations_one_active_per_chart_key',
        'employees_org_employee_code_ci_key',
      ]),
    );
    expect(raw.checks.length).toBeGreaterThan(30);
    expect(raw.triggers.length).toBeGreaterThan(30);
    expect(raw.functions).toEqual(
      expect.arrayContaining(['sc_audit_resolutions_guard', 'sc_json_has_forbidden_key']),
    );
  });
});
