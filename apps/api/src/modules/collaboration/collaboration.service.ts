import { Injectable } from '@nestjs/common';
import {
  type CallToken,
  type CallTokenInput,
  type ChannelCreate,
  type ChannelDetail,
  type ChannelMessages,
  type ChannelPerson,
  type ChannelRecord,
  type CollaborationConfig,
  type MessageCreate,
  type MessageListQuery,
  type MessageRecord,
} from '@smartcode/shared';
import { ActivityLogService } from '../../core/audit/activity-log.service';
import { AuditLogService } from '../../core/audit/audit-log.service';
import type { Principal } from '../../core/auth/principal';
import type { RequestMeta } from '../../core/auth/request-meta';
import { AppConfig } from '../../core/config/app-config.service';
import { ProblemException } from '../../core/errors/problem';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { isUniqueViolation, logEntityChange } from '../organization/entity-log';
import { mintCallToken } from './call-token';

const CHANNEL_INCLUDE = {
  members: { select: { employeeId: true, isOwner: true, lastReadAt: true, joinedAt: true } },
  team: { select: { id: true, name: true, teamLeadId: true, vendorId: true } },
} satisfies Prisma.ChannelInclude;
type ChannelRow = Prisma.ChannelGetPayload<{ include: typeof CHANNEL_INCLUDE }>;

const PERSON_SELECT = { id: true, fullName: true, role: true, vendorId: true, status: true } as const;
const CALL_TTL_SECONDS = 2 * 60 * 60;

const notFound = () => new ProblemException(404, 'NOT_FOUND', 'Channel not found');
const invalid = (field: string, message: string) =>
  new ProblemException(422, 'VALIDATION_FAILED', message, [{ field, message }]);

const person = (e: { id: string; fullName: string; role: string }): ChannelPerson => ({
  id: e.id,
  fullName: e.fullName,
  role: e.role,
});

/**
 * Chat and calls. Every rule that decides who may see a space lives here:
 * - the vendor boundary: vendor staff only meet their own vendor's people and spaces; Managers meet everyone;
 * - public channels are open to everyone inside the boundary, private channels and direct messages to members;
 * - a team's channel follows the team (its Team Lead, members and the Manager).
 */
@Injectable()
export class CollaborationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly activity: ActivityLogService,
    private readonly config: AppConfig,
  ) {}

  // ───────── access rules ─────────

  private inBoundary(principal: Principal, vendorId: string | null): boolean {
    return principal.role === 'MANAGER' || vendorId === principal.vendorId;
  }

  private async isTeamMember(principal: Principal, teamId: string, teamLeadId: string | null) {
    if (teamLeadId === principal.employeeId) return true;
    const m = await this.prisma.client.teamMembership.findFirst({
      where: { teamId, employeeId: principal.employeeId, endedAt: null },
      select: { id: true },
    });
    return Boolean(m);
  }

  private async canRead(principal: Principal, c: ChannelRow): Promise<boolean> {
    if (c.organizationId !== principal.organizationId) return false;
    const member = c.members.some((m) => m.employeeId === principal.employeeId);
    switch (c.kind) {
      case 'PUBLIC':
        return this.inBoundary(principal, c.vendorId);
      case 'PRIVATE':
      case 'DIRECT':
        return member;
      case 'TEAM':
        if (!c.team) return false;
        if (principal.role === 'MANAGER') return true;
        return (
          this.inBoundary(principal, c.vendorId) &&
          (await this.isTeamMember(principal, c.team.id, c.team.teamLeadId))
        );
    }
  }

  private async load(principal: Principal, id: string): Promise<ChannelRow> {
    const c = await this.prisma.client.channel.findUnique({ where: { id }, include: CHANNEL_INCLUDE });
    if (!c || !(await this.canRead(principal, c))) throw notFound();
    return c;
  }

  private canManage(principal: Principal, c: ChannelRow): boolean {
    if (c.kind === 'DIRECT' || c.kind === 'TEAM') return false;
    if (principal.role === 'MANAGER' && c.kind === 'PUBLIC') return true;
    return c.members.some((m) => m.employeeId === principal.employeeId && m.isOwner);
  }

  // ───────── channel list ─────────

  /** Makes sure the team's channel exists and that the caller has a read marker in it. */
  private async ensureTeamChannel(
    principal: Principal,
    team: { id: string; name: string; vendorId: string | null },
  ) {
    const existing = await this.prisma.client.channel.findUnique({
      where: { teamId: team.id },
      select: { id: true },
    });
    let id = existing?.id;
    if (!id) {
      try {
        const created = await this.prisma.client.channel.create({
          data: {
            organizationId: principal.organizationId,
            vendorId: team.vendorId,
            kind: 'TEAM',
            name: team.name,
            teamId: team.id,
            createdById: principal.employeeId,
          },
          select: { id: true },
        });
        id = created.id;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        id = (
          await this.prisma.client.channel.findUniqueOrThrow({
            where: { teamId: team.id },
            select: { id: true },
          })
        ).id;
      }
    }
    await this.prisma.client.channelMember
      .create({ data: { channelId: id, employeeId: principal.employeeId, lastReadAt: new Date() } })
      .catch((error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
      });
  }

  private async syncTeamChannels(principal: Principal) {
    const db = this.prisma.client;
    const teams =
      principal.role === 'MANAGER'
        ? await db.team.findMany({
            where: { organizationId: principal.organizationId, status: 'ACTIVE' },
            select: { id: true, name: true, vendorId: true },
            take: 500,
          })
        : await db.team.findMany({
            where: {
              organizationId: principal.organizationId,
              status: 'ACTIVE',
              OR: [
                { teamLeadId: principal.employeeId },
                { memberships: { some: { employeeId: principal.employeeId, endedAt: null } } },
              ],
            },
            select: { id: true, name: true, vendorId: true },
          });
    for (const team of teams) await this.ensureTeamChannel(principal, team);
  }

  async list(principal: Principal): Promise<ChannelRecord[]> {
    await this.syncTeamChannels(principal);
    const db = this.prisma.client;
    const rows = await db.channel.findMany({
      where: {
        organizationId: principal.organizationId,
        archivedAt: null,
        OR: [
          { kind: 'PUBLIC', ...(principal.role === 'MANAGER' ? {} : { vendorId: principal.vendorId }) },
          { kind: { in: ['PRIVATE', 'DIRECT'] }, members: { some: { employeeId: principal.employeeId } } },
          { kind: 'TEAM' },
        ],
      },
      include: CHANNEL_INCLUDE,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
      take: 500,
    });
    const visible: ChannelRow[] = [];
    for (const c of rows) if (await this.canRead(principal, c)) visible.push(c);
    return this.toRecords(principal, visible);
  }

  private async toRecords(principal: Principal, rows: ChannelRow[]): Promise<ChannelRecord[]> {
    const db = this.prisma.client;
    const ids = rows.map((r) => r.id);
    const directOthers = new Map<string, ChannelPerson>();
    const otherIds = rows
      .filter((r) => r.kind === 'DIRECT')
      .map(
        (r) =>
          r.members.find((m) => m.employeeId !== principal.employeeId)?.employeeId ?? principal.employeeId,
      );
    if (otherIds.length) {
      const people = await db.employee.findMany({ where: { id: { in: otherIds } }, select: PERSON_SELECT });
      const byId = new Map(people.map((p) => [p.id, p]));
      for (const r of rows.filter((x) => x.kind === 'DIRECT')) {
        const otherId =
          r.members.find((m) => m.employeeId !== principal.employeeId)?.employeeId ?? principal.employeeId;
        const p = byId.get(otherId);
        if (p) directOthers.set(r.id, person(p));
      }
    }
    const unread = new Map<string, number>();
    const previews = new Map<string, string | null>();
    await Promise.all(
      rows.map(async (r) => {
        const mine = r.members.find((m) => m.employeeId === principal.employeeId);
        const since = mine?.lastReadAt ?? mine?.joinedAt;
        const [count, last] = await Promise.all([
          mine && since
            ? db.channelMessage.count({
                where: {
                  channelId: r.id,
                  createdAt: { gt: since },
                  authorId: { not: principal.employeeId },
                  deletedAt: null,
                },
              })
            : Promise.resolve(0),
          db.channelMessage.findFirst({
            where: { channelId: r.id, deletedAt: null },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { body: true },
          }),
        ]);
        unread.set(r.id, count);
        previews.set(r.id, last ? last.body.slice(0, 120) : null);
      }),
    );
    void ids;
    return rows.map((r) => {
      const other = directOthers.get(r.id) ?? null;
      return {
        id: r.id,
        kind: r.kind,
        name: r.kind === 'DIRECT' ? (other?.fullName ?? 'Direct message') : (r.name ?? 'Channel'),
        topic: r.topic,
        teamId: r.teamId,
        otherPerson: other,
        unread: unread.get(r.id) ?? 0,
        lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
        lastMessagePreview: previews.get(r.id) ?? null,
        memberCount: r.kind === 'TEAM' ? 0 : r.members.length,
        canManage: this.canManage(principal, r),
        joined: r.members.some((m) => m.employeeId === principal.employeeId),
        archived: r.archivedAt !== null,
      };
    });
  }

  async get(principal: Principal, id: string): Promise<ChannelDetail> {
    const c = await this.load(principal, id);
    const [record] = await this.toRecords(principal, [c]);
    const memberIds =
      c.kind === 'TEAM' && c.team
        ? (
            await this.prisma.client.teamMembership.findMany({
              where: { teamId: c.team.id, endedAt: null },
              select: { employeeId: true },
            })
          ).map((m) => m.employeeId)
        : c.members.map((m) => m.employeeId);
    if (c.kind === 'TEAM' && c.team?.teamLeadId) memberIds.push(c.team.teamLeadId);
    const people = await this.prisma.client.employee.findMany({
      where: { id: { in: [...new Set(memberIds)] } },
      select: PERSON_SELECT,
      orderBy: { fullName: 'asc' },
    });
    const owners = new Set(c.members.filter((m) => m.isOwner).map((m) => m.employeeId));
    return {
      ...record!,
      memberCount: people.length,
      members: people.map((p) => ({ ...person(p), isOwner: owners.has(p.id) })),
    };
  }

  // ───────── people ─────────

  async people(principal: Principal, q?: string): Promise<ChannelPerson[]> {
    const rows = await this.prisma.client.employee.findMany({
      where: {
        organizationId: principal.organizationId,
        status: { not: 'INACTIVE' },
        id: { not: principal.employeeId },
        ...(principal.role === 'MANAGER'
          ? {}
          : { OR: [{ vendorId: principal.vendorId }, { role: 'MANAGER' }] }),
        ...(q ? { fullName: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      select: PERSON_SELECT,
      orderBy: { fullName: 'asc' },
      take: 20,
    });
    return rows.map(person);
  }

  private async assertMeetable(principal: Principal, employeeId: string) {
    const e = await this.prisma.client.employee.findFirst({
      where: { id: employeeId, organizationId: principal.organizationId },
      select: PERSON_SELECT,
    });
    if (!e || e.status === 'INACTIVE') throw invalid('employeeId', 'Person not found');
    if (principal.role !== 'MANAGER' && e.role !== 'MANAGER' && e.vendorId !== principal.vendorId) {
      throw invalid('employeeId', 'Person not found');
    }
    return e;
  }

  // ───────── channels: create, direct, members ─────────

  async create(principal: Principal, input: ChannelCreate, meta: RequestMeta): Promise<ChannelDetail> {
    const vendorId = principal.role === 'MANAGER' ? null : principal.vendorId;
    const memberIds = [...new Set(input.memberIds.filter((id) => id !== principal.employeeId))];
    for (const id of memberIds) {
      const e = await this.assertMeetable(principal, id);
      if (e.role !== 'MANAGER' && e.vendorId !== vendorId) throw invalid('memberIds', 'Person not found');
    }
    let channelId: string;
    try {
      channelId = await this.prisma.transaction(
        { actorId: principal.employeeId, reason: 'channel created' },
        async (tx) => {
          const channel = await tx.channel.create({
            data: {
              organizationId: principal.organizationId,
              vendorId,
              kind: input.kind,
              name: input.name,
              topic: input.topic ?? null,
              createdById: principal.employeeId,
              members: {
                create: [
                  { employeeId: principal.employeeId, isOwner: true, lastReadAt: new Date() },
                  ...memberIds.map((employeeId) => ({ employeeId })),
                ],
              },
            },
            select: { id: true },
          });
          await logEntityChange(
            { audit: this.audit, activity: this.activity },
            tx,
            principal,
            meta,
            'CHANNEL.CREATED',
            { type: 'Channel', id: channel.id },
            { after: { kind: input.kind, name: input.name, members: memberIds.length + 1 } },
          );
          return channel.id;
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ProblemException(409, 'CONFLICT', 'A channel with this name already exists', [
          { field: 'name', message: 'A channel with this name already exists' },
        ]);
      }
      throw error;
    }
    return this.get(principal, channelId);
  }

  async direct(principal: Principal, employeeId: string): Promise<ChannelDetail> {
    if (employeeId === principal.employeeId) throw invalid('employeeId', 'Choose someone else');
    await this.assertMeetable(principal, employeeId);
    const directKey = [principal.employeeId, employeeId].sort().join(':');
    const db = this.prisma.client;
    let channel = await db.channel.findUnique({ where: { directKey }, select: { id: true } });
    if (!channel) {
      try {
        channel = await db.channel.create({
          data: {
            organizationId: principal.organizationId,
            vendorId: null,
            kind: 'DIRECT',
            directKey,
            createdById: principal.employeeId,
            members: {
              create: [{ employeeId: principal.employeeId, lastReadAt: new Date() }, { employeeId }],
            },
          },
          select: { id: true },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        channel = await db.channel.findUniqueOrThrow({ where: { directKey }, select: { id: true } });
      }
    }
    return this.get(principal, channel.id);
  }

  async join(principal: Principal, id: string): Promise<ChannelDetail> {
    const c = await this.load(principal, id);
    if (c.kind !== 'PUBLIC') throw notFound();
    await this.markJoined(principal, c.id);
    return this.get(principal, id);
  }

  private async markJoined(principal: Principal, channelId: string) {
    await this.prisma.client.channelMember
      .create({ data: { channelId, employeeId: principal.employeeId, lastReadAt: new Date() } })
      .catch((error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
      });
  }

  async addMember(
    principal: Principal,
    id: string,
    employeeId: string,
    meta: RequestMeta,
  ): Promise<ChannelDetail> {
    const c = await this.load(principal, id);
    if (!this.canManage(principal, c))
      throw new ProblemException(403, 'FORBIDDEN', 'Only a channel owner can add people');
    const e = await this.assertMeetable(principal, employeeId);
    if (e.role !== 'MANAGER' && e.vendorId !== c.vendorId) throw invalid('employeeId', 'Person not found');
    if (!c.members.some((m) => m.employeeId === employeeId)) {
      await this.prisma.transaction(
        { actorId: principal.employeeId, reason: 'channel member added' },
        async (tx) => {
          await tx.channelMember.create({ data: { channelId: id, employeeId } });
          await logEntityChange(
            { audit: this.audit, activity: this.activity },
            tx,
            principal,
            meta,
            'CHANNEL.MEMBER_ADDED',
            { type: 'Channel', id },
            { after: { employeeId } },
          );
        },
      );
    }
    return this.get(principal, id);
  }

  async removeMember(principal: Principal, id: string, employeeId: string, meta: RequestMeta): Promise<void> {
    const c = await this.load(principal, id);
    if (c.kind === 'DIRECT' || c.kind === 'TEAM')
      throw new ProblemException(409, 'CONFLICT', 'People cannot leave this conversation');
    const self = employeeId === principal.employeeId;
    if (!self && !this.canManage(principal, c)) {
      throw new ProblemException(403, 'FORBIDDEN', 'Only a channel owner can remove people');
    }
    const target = c.members.find((m) => m.employeeId === employeeId);
    if (!target) throw new ProblemException(404, 'NOT_FOUND', 'That person is not in this channel');
    await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'channel member removed' },
      async (tx) => {
        await tx.channelMember.deleteMany({ where: { channelId: id, employeeId } });
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'CHANNEL.MEMBER_REMOVED',
          { type: 'Channel', id },
          { after: { employeeId } },
        );
      },
    );
  }

  async archive(principal: Principal, id: string, meta: RequestMeta): Promise<void> {
    const c = await this.load(principal, id);
    if (!this.canManage(principal, c))
      throw new ProblemException(403, 'FORBIDDEN', 'Only a channel owner can archive it');
    await this.prisma.transaction(
      { actorId: principal.employeeId, reason: 'channel archived' },
      async (tx) => {
        await tx.channel.update({ where: { id }, data: { archivedAt: new Date() } });
        await logEntityChange(
          { audit: this.audit, activity: this.activity },
          tx,
          principal,
          meta,
          'CHANNEL.ARCHIVED',
          { type: 'Channel', id },
        );
      },
    );
  }

  // ───────── messages ─────────

  private toMessage(m: {
    id: string;
    channelId: string;
    body: string;
    editedAt: Date | null;
    deletedAt: Date | null;
    createdAt: Date;
    author: { id: string; fullName: string; role: string };
  }): MessageRecord {
    return {
      id: m.id,
      channelId: m.channelId,
      author: person(m.author),
      body: m.deletedAt ? '' : m.body,
      deleted: m.deletedAt !== null,
      edited: m.editedAt !== null,
      createdAt: m.createdAt.toISOString(),
    };
  }

  async messages(principal: Principal, id: string, query: MessageListQuery): Promise<ChannelMessages> {
    await this.load(principal, id);
    const db = this.prisma.client;
    const cursorId = query.after ?? query.before;
    let cursorWhere: Prisma.ChannelMessageWhereInput = {};
    if (cursorId) {
      const cursor = await db.channelMessage.findFirst({
        where: { id: cursorId, channelId: id },
        select: { createdAt: true },
      });
      if (cursor) {
        const t = cursor.createdAt;
        cursorWhere = query.after
          ? { OR: [{ createdAt: { gt: t } }, { createdAt: t, id: { gt: cursorId } }] }
          : { OR: [{ createdAt: { lt: t } }, { createdAt: t, id: { lt: cursorId } }] };
      }
    }
    const newestFirst = !query.after;
    const rows = await db.channelMessage.findMany({
      where: { channelId: id, ...cursorWhere },
      orderBy: newestFirst ? [{ createdAt: 'desc' }, { id: 'desc' }] : [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      include: { author: { select: { id: true, fullName: true, role: true } } },
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    if (newestFirst) page.reverse();
    return { items: page.map((m) => this.toMessage(m)), hasMore: newestFirst ? hasMore : false };
  }

  async post(principal: Principal, id: string, input: MessageCreate): Promise<MessageRecord> {
    const c = await this.load(principal, id);
    if (c.archivedAt) throw new ProblemException(409, 'CONFLICT', 'This channel is archived');
    if (!c.members.some((m) => m.employeeId === principal.employeeId)) await this.markJoined(principal, id);
    return this.createMessage(principal, id, input.body);
  }

  private async createMessage(principal: Principal, channelId: string, body: string): Promise<MessageRecord> {
    const now = new Date();
    const [message] = await this.prisma.client.$transaction([
      this.prisma.client.channelMessage.create({
        data: { channelId, authorId: principal.employeeId, body, createdAt: now },
        include: { author: { select: { id: true, fullName: true, role: true } } },
      }),
      this.prisma.client.channel.update({ where: { id: channelId }, data: { lastMessageAt: now } }),
      this.prisma.client.channelMember.updateMany({
        where: { channelId, employeeId: principal.employeeId },
        data: { lastReadAt: now },
      }),
    ]);
    return this.toMessage(message);
  }

  async edit(principal: Principal, messageId: string, input: MessageCreate): Promise<MessageRecord> {
    const m = await this.ownMessage(principal, messageId);
    if (m.deletedAt) throw new ProblemException(409, 'CONFLICT', 'This message was deleted');
    const updated = await this.prisma.client.channelMessage.update({
      where: { id: messageId },
      data: { body: input.body, editedAt: new Date() },
      include: { author: { select: { id: true, fullName: true, role: true } } },
    });
    return this.toMessage(updated);
  }

  async remove(principal: Principal, messageId: string): Promise<void> {
    const m = await this.prisma.client.channelMessage.findUnique({
      where: { id: messageId },
      select: { id: true, authorId: true, channelId: true },
    });
    if (!m) throw new ProblemException(404, 'NOT_FOUND', 'Message not found');
    await this.load(principal, m.channelId);
    if (m.authorId !== principal.employeeId && principal.role !== 'MANAGER') {
      throw new ProblemException(403, 'FORBIDDEN', 'You can delete only your own messages');
    }
    await this.prisma.client.channelMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), body: '' },
    });
  }

  private async ownMessage(principal: Principal, messageId: string) {
    const m = await this.prisma.client.channelMessage.findUnique({ where: { id: messageId } });
    if (!m) throw new ProblemException(404, 'NOT_FOUND', 'Message not found');
    await this.load(principal, m.channelId);
    if (m.authorId !== principal.employeeId) {
      throw new ProblemException(403, 'FORBIDDEN', 'You can edit only your own messages');
    }
    return m;
  }

  async markRead(principal: Principal, id: string): Promise<void> {
    await this.load(principal, id);
    const now = new Date();
    const updated = await this.prisma.client.channelMember.updateMany({
      where: { channelId: id, employeeId: principal.employeeId },
      data: { lastReadAt: now },
    });
    if (updated.count === 0) await this.markJoined(principal, id);
  }

  // ───────── calls ─────────

  settings(): CollaborationConfig {
    const enabled = Boolean(
      this.config.get('LIVEKIT_URL') &&
      this.config.get('LIVEKIT_KEY_ID') &&
      this.config.get('LIVEKIT_SIGNING_KEY'),
    );
    return { callsEnabled: enabled, callsUrl: enabled ? (this.config.get('LIVEKIT_URL') ?? null) : null };
  }

  /** A short-lived token for the channel's call room. Only people who can read the channel receive one. */
  async callToken(
    principal: Principal,
    id: string,
    input: CallTokenInput,
    meta: RequestMeta,
  ): Promise<CallToken> {
    const url = this.config.get('LIVEKIT_URL');
    const keyId = this.config.get('LIVEKIT_KEY_ID');
    const signingKey = this.config.get('LIVEKIT_SIGNING_KEY');
    if (!url || !keyId || !signingKey) {
      throw new ProblemException(503, 'SERVICE_UNAVAILABLE', 'Calls are not set up yet');
    }
    const c = await this.load(principal, id);
    if (c.archivedAt) throw new ProblemException(409, 'CONFLICT', 'This channel is archived');
    const me = await this.prisma.client.employee.findUniqueOrThrow({
      where: { id: principal.employeeId },
      select: { fullName: true },
    });
    const room = `sc-${id}`;
    const { token, expiresAt } = mintCallToken({
      keyId,
      signingKey,
      room,
      identity: principal.employeeId,
      name: me.fullName,
      ttlSeconds: CALL_TTL_SECONDS,
    });
    await this.prisma.transaction({ actorId: principal.employeeId, reason: 'call joined' }, (tx) =>
      logEntityChange(
        { audit: this.audit, activity: this.activity },
        tx,
        principal,
        meta,
        'CALL.JOINED',
        { type: 'Channel', id },
        { after: { video: input.video } },
      ),
    );
    if (input.announce) {
      await this.createMessage(
        principal,
        id,
        input.video
          ? 'Started a video call. Press Join call to take part.'
          : 'Started an audio call. Press Join call to take part.',
      );
    }
    return { url, token, room, expiresAt: expiresAt.toISOString() };
  }
}
