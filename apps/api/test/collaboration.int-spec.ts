import type { INestApplication } from '@nestjs/common';
import type { Role } from '@smartcode/shared';
import { Fixtures } from './db/fixtures';
import { createTestDb, describeDb, type TestDb } from './db/harness';
import { createDbApp } from './helpers';
import { as, bootstrapAndSignInManager, createActiveEmployee, type Session } from './auth-helpers';

jest.setTimeout(120_000);

describeDb('Collaboration — channels, direct messages, team channels, calls (HTTP + PostgreSQL)', () => {
  let db: TestDb;
  let app: INestApplication;
  let manager: Session;
  let coderA: { id: string; session: Session };
  let coderB: { id: string; session: Session };
  let outsider: { id: string; session: Session };
  let vendorCoder: { id: string; session: Session };
  let vendorId: string;
  let team: { id: string };

  const mk = (role: Role, code: string, name: string, vendor?: string) =>
    createActiveEmployee(app, manager, {
      employeeCode: code,
      fullName: name,
      email: `${code}@example.test`,
      role,
      ...(vendor ? { vendorId: vendor } : {}),
    });

  beforeAll(async () => {
    db = await createTestDb();
    await new Fixtures(db).org();
    app = await createDbApp(db, {
      env: {
        LIVEKIT_URL: 'wss://calls.example.test',
        LIVEKIT_KEY_ID: 'k',
        LIVEKIT_SIGNING_KEY: 's'.repeat(32),
      },
    });
    ({ session: manager } = await bootstrapAndSignInManager(app));
    coderA = await mk('CODER', 'co-a', 'Coder Ann');
    coderB = await mk('CODER', 'co-b', 'Coder Bob');
    outsider = await mk('AUDITOR', 'au-x', 'Audrey Outsider');
    const vendor = (
      await as(app, manager)
        .post('/vendors', {
          code: 'CV1',
          name: 'Collab Vendor',
          admin: { employeeCode: 'cv-va', fullName: 'Vera Vendor', email: 'cv-va@example.test' },
          sendActivation: false,
        })
        .expect(201)
    ).body as { id: string };
    vendorId = vendor.id;
    vendorCoder = await mk('CODER', 'cv-co', 'Vendor Vic', vendorId);
    team = (await as(app, manager).post('/teams', { name: 'Chat Team' }).expect(201)).body;
    await as(app, manager).post(`/teams/${team.id}/members`, { employeeId: coderA.id }).expect(200);
    await as(app, manager).post(`/teams/${team.id}/members`, { employeeId: coderB.id }).expect(200);
  });

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  const names = (body: { name: string }[]) => body.map((c) => c.name);

  it('every route needs a signed-in person', async () => {
    const { default: request } = await import('supertest');
    await request(app.getHttpServer()).get('/api/v1/collab/channels').expect(401);
  });

  it('a team gets its own channel, open to its members and the Manager only', async () => {
    const a = (await as(app, coderA.session).get('/collab/channels').expect(200)).body;
    const teamChannel = a.find((c: { kind: string }) => c.kind === 'TEAM');
    expect(teamChannel.name).toBe('Chat Team');
    const posted = await as(app, coderA.session)
      .post(`/collab/channels/${teamChannel.id}/messages`, { body: 'Morning team' })
      .expect(201);
    expect(posted.body.author.fullName).toBe('Coder Ann');
    await as(app, coderB.session).get(`/collab/channels/${teamChannel.id}`).expect(200);
    await as(app, outsider.session).get(`/collab/channels/${teamChannel.id}`).expect(404);
    await as(app, outsider.session)
      .post(`/collab/channels/${teamChannel.id}/messages`, { body: 'let me in' })
      .expect(404);
    await as(app, manager).get(`/collab/channels/${teamChannel.id}/messages`).expect(200);
    expect(names((await as(app, outsider.session).get('/collab/channels').expect(200)).body)).not.toContain(
      'Chat Team',
    );
  });

  it('public channels are open inside the vendor boundary; private channels only to members', async () => {
    const pub = (
      await as(app, manager).post('/collab/channels', { name: 'general', kind: 'PUBLIC' }).expect(201)
    ).body;
    await as(app, manager).post('/collab/channels', { name: 'General', kind: 'PUBLIC' }).expect(409);
    await as(app, coderA.session).get(`/collab/channels/${pub.id}`).expect(200);
    await as(app, vendorCoder.session).get(`/collab/channels/${pub.id}`).expect(404);
    await as(app, coderA.session)
      .post(`/collab/channels/${pub.id}/messages`, { body: 'hello all' })
      .expect(201);
    expect((await as(app, coderA.session).get(`/collab/channels/${pub.id}`).expect(200)).body.joined).toBe(
      true,
    );

    const priv = (
      await as(app, coderA.session)
        .post('/collab/channels', { name: 'secret-plans', kind: 'PRIVATE', memberIds: [coderB.id] })
        .expect(201)
    ).body;
    await as(app, coderB.session).get(`/collab/channels/${priv.id}`).expect(200);
    await as(app, outsider.session).get(`/collab/channels/${priv.id}`).expect(404);
    // Even the Manager does not read a private channel they are not in.
    await as(app, manager).get(`/collab/channels/${priv.id}`).expect(404);
    await as(app, coderB.session)
      .post(`/collab/channels/${priv.id}/members`, { employeeId: outsider.id })
      .expect(403);
    await as(app, coderA.session)
      .post(`/collab/channels/${priv.id}/members`, { employeeId: outsider.id })
      .expect(200);
    await as(app, outsider.session).get(`/collab/channels/${priv.id}`).expect(200);
    await as(app, coderA.session)
      .post(`/collab/channels/${priv.id}/members`, { employeeId: vendorCoder.id })
      .expect(422);
    await as(app, outsider.session).delete(`/collab/channels/${priv.id}/members/${outsider.id}`).expect(204);
    await as(app, outsider.session).get(`/collab/channels/${priv.id}`).expect(404);
  });

  it('direct messages are one conversation per pair, private to the pair, and respect the vendor boundary', async () => {
    const one = (await as(app, coderA.session).post('/collab/direct', { employeeId: coderB.id }).expect(200))
      .body;
    const two = (await as(app, coderB.session).post('/collab/direct', { employeeId: coderA.id }).expect(200))
      .body;
    expect(two.id).toBe(one.id);
    expect(one.name).toBe('Coder Bob');
    expect(two.name).toBe('Coder Ann');
    await as(app, outsider.session).get(`/collab/channels/${one.id}`).expect(404);
    await as(app, manager).get(`/collab/channels/${one.id}`).expect(404);
    await as(app, coderA.session).post('/collab/direct', { employeeId: vendorCoder.id }).expect(422);
    await as(app, coderA.session).post('/collab/direct', { employeeId: coderA.id }).expect(422);
    await as(app, manager).post('/collab/direct', { employeeId: vendorCoder.id }).expect(200);
    const found = await as(app, vendorCoder.session).get('/collab/people').expect(200);
    expect(found.body.map((p: { fullName: string }) => p.fullName)).not.toContain('Coder Ann');
    const search = await as(app, coderA.session).get('/collab/people?q=bob').expect(200);
    expect(search.body.map((p: { fullName: string }) => p.fullName)).toEqual(['Coder Bob']);
  });

  it('messages page forwards and backwards, track unread, and can be edited and deleted by their author', async () => {
    const dm = (await as(app, coderA.session).post('/collab/direct', { employeeId: coderB.id }).expect(200))
      .body;
    const ids: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const m = await as(app, coderA.session)
        .post(`/collab/channels/${dm.id}/messages`, { body: `message ${i}` })
        .expect(201);
      ids.push(m.body.id);
    }
    const bobList = (await as(app, coderB.session).get('/collab/channels').expect(200)).body;
    expect(bobList.find((c: { id: string }) => c.id === dm.id).unread).toBe(5);
    const latest = (
      await as(app, coderB.session).get(`/collab/channels/${dm.id}/messages?limit=2`).expect(200)
    ).body;
    expect(latest.items.map((m: { body: string }) => m.body)).toEqual(['message 4', 'message 5']);
    expect(latest.hasMore).toBe(true);
    const older = (
      await as(app, coderB.session)
        .get(`/collab/channels/${dm.id}/messages?limit=2&before=${latest.items[0].id}`)
        .expect(200)
    ).body;
    expect(older.items.map((m: { body: string }) => m.body)).toEqual(['message 2', 'message 3']);
    const fresh = (
      await as(app, coderB.session).get(`/collab/channels/${dm.id}/messages?after=${ids[3]}`).expect(200)
    ).body;
    expect(fresh.items.map((m: { body: string }) => m.body)).toEqual(['message 5']);

    await as(app, coderB.session).post(`/collab/channels/${dm.id}/read`).expect(204);
    const after = (await as(app, coderB.session).get('/collab/channels').expect(200)).body;
    expect(after.find((c: { id: string }) => c.id === dm.id).unread).toBe(0);

    await as(app, coderB.session).patch(`/collab/messages/${ids[0]}`, { body: 'hacked' }).expect(403);
    const edited = await as(app, coderA.session)
      .patch(`/collab/messages/${ids[0]}`, { body: 'message one' })
      .expect(200);
    expect(edited.body).toMatchObject({ body: 'message one', edited: true });
    await as(app, coderB.session).delete(`/collab/messages/${ids[1]}`).expect(403);
    await as(app, coderA.session).delete(`/collab/messages/${ids[1]}`).expect(204);
    const list = (await as(app, coderB.session).get(`/collab/channels/${dm.id}/messages`).expect(200)).body;
    expect(list.items.find((m: { id: string }) => m.id === ids[1])).toMatchObject({
      deleted: true,
      body: '',
    });
    await as(app, coderA.session).post(`/collab/channels/${dm.id}/messages`, { body: '   ' }).expect(422);
    await as(app, coderA.session)
      .post(`/collab/channels/${dm.id}/messages`, { body: 'x'.repeat(4001) })
      .expect(422);
  });

  it('calls: a token for one room is issued only to people who can read the channel', async () => {
    const config = (await as(app, coderA.session).get('/collab/config').expect(200)).body;
    expect(config).toEqual({ callsEnabled: true, callsUrl: 'wss://calls.example.test' });
    const teamChannel = (await as(app, coderA.session).get('/collab/channels').expect(200)).body.find(
      (c: { kind: string }) => c.kind === 'TEAM',
    );
    const call = (
      await as(app, coderA.session)
        .post(`/collab/channels/${teamChannel.id}/call`, { video: true, announce: true })
        .expect(200)
    ).body;
    expect(call.room).toBe(`sc-${teamChannel.id}`);
    expect(call.url).toBe('wss://calls.example.test');
    expect(call.token.split('.')).toHaveLength(3);
    const msgs = (
      await as(app, coderB.session).get(`/collab/channels/${teamChannel.id}/messages`).expect(200)
    ).body;
    expect(msgs.items.at(-1).body).toContain('Started a video call');
    await as(app, outsider.session)
      .post(`/collab/channels/${teamChannel.id}/call`, { video: false })
      .expect(404);
    const audit = await db.sql(`SELECT 1 FROM audit_logs WHERE action = 'CALL.JOINED'`);
    expect(audit.length).toBeGreaterThan(0);
  });

  it('archiving closes a channel to new messages', async () => {
    const ch = (
      await as(app, coderA.session).post('/collab/channels', { name: 'old-news', kind: 'PUBLIC' }).expect(201)
    ).body;
    await as(app, coderB.session).post(`/collab/channels/${ch.id}/archive`).expect(403);
    await as(app, coderA.session).post(`/collab/channels/${ch.id}/archive`).expect(204);
    await as(app, coderA.session).post(`/collab/channels/${ch.id}/messages`, { body: 'late' }).expect(409);
  });
});
