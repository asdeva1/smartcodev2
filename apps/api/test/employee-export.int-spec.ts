import type { INestApplication } from '@nestjs/common';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import { as, bootstrapAndSignInManager, createActiveEmployee, type Session } from './auth-helpers';

jest.setTimeout(120_000);

describeDb('Employee directory export and timeline (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let coder: { id: string; session: Session };
  let lead: { id: string; session: Session };

  beforeAll(async () => {
    db = await createTestDb();
    await new Fixtures(db).org();
    app = await createDbApp(db);
    ({ session: manager } = await bootstrapAndSignInManager(app));
    coder = await createActiveEmployee(app, manager, {
      employeeCode: 'EX-C',
      fullName: '=HYPERLINK("x")',
      email: 'exc@example.test',
      role: 'CODER',
    });
    lead = await createActiveEmployee(app, manager, {
      employeeCode: 'EX-TL',
      fullName: 'Tina, Lead',
      email: 'extl@example.test',
      role: 'TEAM_LEAD',
    });
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  it('exports the directory as CSV with the same filters, and neutralises formula-looking cells', async () => {
    const all = await as(app, manager).get('/employees/export').expect(200);
    expect(all.headers['content-type']).toContain('text/csv');
    expect(all.headers['content-disposition']).toMatch(
      /attachment; filename="employees_\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const text = all.text.replace(/^\uFEFF/, '');
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Employee ID,Name,Email,Role,Team,Team Lead,Projects,Vendor,Status,Login Name,Created,Activated',
    );
    expect(lines).toHaveLength(4); // header + manager + coder + lead
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(text).toContain('"Tina, Lead"');

    const onlyCoders = await as(app, manager).get('/employees/export?role=CODER').expect(200);
    expect(onlyCoders.text.trim().split('\r\n')).toHaveLength(2);
  });

  it('shows who did what to a person, and only to people who may read them', async () => {
    await as(app, manager)
      .post(`/employees/${coder.id}/deactivate`, { reason: 'Left the company' })
      .expect(200);
    const timeline = await as(app, manager).get(`/employees/${coder.id}/timeline`).expect(200);
    const actions = timeline.body.map((e: { action: string }) => e.action);
    expect(actions[0]).toBe('EMPLOYEE.DEACTIVATED');
    expect(actions).toContain('EMPLOYEE.CREATED');
    expect(timeline.body[0].actor).toMatchObject({ fullName: 'Test Manager' });
    expect(JSON.stringify(timeline.body)).not.toMatch(/password|token|hash/i);

    // A Team Lead outside the person's team cannot see their history.
    await as(app, lead.session).get(`/employees/${coder.id}/timeline`).expect(404);
  });
});
