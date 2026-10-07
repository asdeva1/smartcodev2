import { HttpException } from '@nestjs/common';
import type { PrismaService } from '../../src/core/prisma/prisma.service';
import { ActivityLogService } from '../../src/core/audit/activity-log.service';
import { AuditLogService } from '../../src/core/audit/audit-log.service';
import { isForbiddenLogKey } from '../../src/core/audit/redact';
import { ApprovalService } from '../../src/core/approvals/approval.service';
import { parseDatabaseRuleViolation } from '../../src/core/database/rule-errors';
import { NotificationService } from '../../src/core/notifications/notification.service';
import { withActor } from '../../src/core/prisma/actor-transaction';
import { createTestDb, describeDb, expectPgError, PG, type TestDb } from './harness';
import { Fixtures } from './fixtures';

describeDb('Core data services on PostgreSQL (notifications, approvals, logs, actor transactions)', () => {
  let db: TestDb;
  let fx: Fixtures;
  let prismaService: PrismaService;
  let orgId: string;
  let manager: Awaited<ReturnType<Fixtures['manager']>>;

  beforeAll(async () => {
    db = await createTestDb();
    fx = new Fixtures(db);
    prismaService = { client: db.prisma } as unknown as PrismaService;
  });
  beforeEach(async () => {
    orgId = await fx.org();
    manager = await fx.manager();
  });
  afterAll(async () => db?.close());

  it('notification service: notify, notify many, list, count and mark read (own notifications only)', async () => {
    const notifications = new NotificationService(prismaService);
    const other = await fx.manager();
    const first = await notifications.notify({
      organizationId: orgId,
      recipientId: manager.id,
      type: 'AUDIT.REVIEW_REQUIRED',
      subject: 'Review needed',
    });
    expect(
      await notifications.notifyMany([manager.id, manager.id, other.id], {
        organizationId: orgId,
        type: 'CHART.ALLOCATED',
        subject: 'Charts allocated',
      }),
    ).toBe(2);
    expect(
      await notifications.notifyMany([], { organizationId: orgId, type: 'CHART.ALLOCATED', subject: 'none' }),
    ).toBe(0);

    expect(await notifications.countUnread(manager.id)).toBe(2);
    expect(await notifications.markRead(other.id, first.id)).toBe(false); // not theirs
    expect(await notifications.markRead(manager.id, first.id)).toBe(true);
    expect(await notifications.markRead(manager.id, first.id)).toBe(false); // already read
    expect(await notifications.countUnread(manager.id)).toBe(1);
    expect((await notifications.listFor(manager.id, { unreadOnly: true })).map((n) => n.type)).toEqual([
      'CHART.ALLOCATED',
    ]);
    expect(await notifications.listFor(manager.id, { limit: 1000 })).toHaveLength(2);
  });

  it('approval engine: ordered steps, role/named approvers, rejection, cancel, separation of duties', async () => {
    const approvals = new ApprovalService(prismaService);
    const requester = await fx.employee({ role: 'TEAM_LEAD' });
    const coach = await fx.employee({ role: 'GROUP_COACH' });
    const entityId = requester.id;

    await expect(
      approvals.request({
        organizationId: orgId,
        type: 'EMPLOYEE.DEACTIVATION',
        entityType: 'EMPLOYEE',
        entityId,
        requesterId: requester.id,
        steps: [],
      }),
    ).rejects.toBeInstanceOf(HttpException);

    const request = await approvals.request({
      organizationId: orgId,
      type: 'EMPLOYEE.DEACTIVATION',
      entityType: 'EMPLOYEE',
      entityId,
      requesterId: requester.id,
      comments: 'Synthetic',
      payload: { reason: 'left' },
      steps: [{ approverRole: 'MANAGER' }, { approverId: coach.id }],
    });
    // Step 1 needs a Manager: neither the requester nor the coach may decide it.
    await expect(
      approvals.decide({ requestId: request.id, deciderId: coach.id, decision: 'APPROVED' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      approvals.decide({ requestId: request.id, deciderId: requester.id, decision: 'APPROVED' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await approvals.decide({ requestId: request.id, deciderId: manager.id, decision: 'APPROVED' })).status,
    ).toBe('PENDING');
    const done = await approvals.decide({
      requestId: request.id,
      deciderId: coach.id,
      decision: 'APPROVED',
      comments: 'ok',
    });
    expect(done).toMatchObject({ status: 'APPROVED', decision: 'APPROVED', resolvedById: coach.id });
    await expect(
      approvals.decide({ requestId: request.id, deciderId: manager.id, decision: 'APPROVED' }),
    ).rejects.toMatchObject({ status: 409 });

    const rejected = await approvals.request({
      organizationId: orgId,
      type: 'EMPLOYEE.DEACTIVATION',
      entityType: 'EMPLOYEE',
      entityId,
      requesterId: requester.id,
      steps: [{ approverRole: 'MANAGER' }, { approverRole: 'MANAGER' }],
    });
    expect(
      (
        await approvals.decide({
          requestId: rejected.id,
          deciderId: manager.id,
          decision: 'REJECTED',
          comments: 'no',
        })
      ).status,
    ).toBe('REJECTED');

    const toCancel = await approvals.request({
      organizationId: orgId,
      type: 'PROJECT.CLOSURE',
      entityType: 'PROJECT',
      entityId,
      requesterId: requester.id,
      steps: [{ approverRole: 'MANAGER' }],
    });
    await expect(approvals.cancel(toCancel.id, manager.id)).rejects.toMatchObject({ status: 404 });
    expect((await approvals.cancel(toCancel.id, requester.id)).status).toBe('CANCELLED');
    await expect(approvals.cancel(toCancel.id, requester.id)).rejects.toMatchObject({ status: 409 });
    await expect(
      approvals.decide({
        requestId: '0192f000-0000-7000-8000-00000000dead',
        deciderId: manager.id,
        decision: 'APPROVED',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('activity and audit logs: sanitise payloads, write atomically with a business change, stay append-only', async () => {
    const activity = new ActivityLogService(prismaService);
    const audit = new AuditLogService(prismaService);

    await activity.record({
      organizationId: orgId,
      actorId: manager.id,
      action: 'CHART.ALLOCATED',
      entityType: 'CHART',
      metadata: { count: 3, password: 'must-not-be-stored', nested: { accessToken: 'x' } },
    });
    await audit.record({
      organizationId: orgId,
      actorId: manager.id,
      actorRole: 'MANAGER',
      action: 'AUTH.LOGIN',
      entityType: 'EMPLOYEE',
      entityId: manager.id,
      after: { method: 'password', token: 'x' },
      requestId: 'req-1',
      ipAddress: '203.0.113.7',
    });
    const [activityRow] = await db.sql<{ metadata: unknown }>(
      `SELECT metadata FROM activity_logs WHERE organization_id = $1`,
      [orgId],
    );
    expect(activityRow?.metadata).toEqual({ count: 3, nested: {} });
    const [auditRow] = await db.sql<{ after_data: unknown; outcome: string }>(
      `SELECT after_data, outcome FROM audit_logs WHERE organization_id = $1`,
      [orgId],
    );
    expect(auditRow).toEqual({ after_data: { method: 'password' }, outcome: 'SUCCESS' });

    // A failure inside the transaction rolls the log back with the business change.
    await expect(
      withActor(db.prisma, { actorId: manager.id }, async (tx) => {
        await audit.record(
          { organizationId: orgId, actorId: manager.id, action: 'EMPLOYEE.CREATED', entityType: 'EMPLOYEE' },
          tx,
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(
      await db.sql(`SELECT 1 FROM audit_logs WHERE organization_id = $1 AND action = 'EMPLOYEE.CREATED'`, [
        orgId,
      ]),
    ).toHaveLength(0);
    await expectPgError(
      db.sql(`UPDATE activity_logs SET action = 'X.Y' WHERE organization_id = $1`, [orgId]),
      { code: PG.conflict },
    );
  });

  it('actor transactions attribute chart status changes to the acting employee and surface rule violations', async () => {
    const w = await fx.workspace();
    await fx.allocate(w.chart.id, w.loginName.id, w.coder.id, w.manager.id);
    await withActor(db.prisma, { actorId: w.manager.id, reason: 'Allocated by Manager' }, async (tx) => {
      await tx.chart.update({ where: { id: w.chart.id }, data: { status: 'ALLOCATED' } });
    });
    const events = await db.prisma.chartStatusEvent.findMany({
      where: { chartId: w.chart.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(events.map((e) => [e.fromStatus, e.toStatus, e.actorId, e.reason])).toEqual([
      [null, 'PENDING_ALLOCATION', null, null],
      ['PENDING_ALLOCATION', 'ALLOCATED', w.manager.id, 'Allocated by Manager'],
    ]);

    // The Team Lead resolution attempt from the API's point of view: Prisma error → 403 with a safe message.
    const r = await fx.reviewRequired();
    const lead = await fx.employee({ role: 'TEAM_LEAD' });
    const error = await db.prisma.auditResolution
      .create({ data: { auditId: r.audit.id, decision: 'APPROVED', resolvedById: lead.id } })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(parseDatabaseRuleViolation(error)).toEqual({
      status: 403,
      code: 'FORBIDDEN',
      detail: 'only an active Manager can resolve a REVIEW_REQUIRED audit',
    });
  });

  it('the TypeScript log-key rules agree with the database rules', async () => {
    const keys = [
      'password',
      'newPassword',
      'passwordHash',
      'accessToken',
      'refresh_token',
      'tokenHash',
      'clientSecret',
      'x-api-key',
      'privateKey',
      'Authorization',
      'cookie',
      'set-cookie',
      'patientName',
      'Patient_ID',
      'ssn',
      'MRN',
      'dateOfBirth',
      'DOB',
      'birthDate',
      'socialSecurityNumber',
      'count',
      'method',
      'loginName',
      'employeeId',
      'pageCount',
      'icds',
      'dos',
      'reason',
      'chartRef',
      'status',
      'name',
      'address',
    ];
    for (const key of keys) {
      const [row] = await db.sql<{ forbidden: boolean }>(
        `SELECT sc_json_has_forbidden_key(jsonb_build_object($1::text, 1)) AS forbidden`,
        [key],
      );
      expect({ key, forbidden: row?.forbidden }).toEqual({ key, forbidden: isForbiddenLogKey(key) });
    }
  });
});
