import { z } from 'zod';

/**
 * Collaboration: channels, direct messages, team channels and calls. Messages are plain text. Patient information
 * (PHI) must not be shared in chat; the screens say so.
 */

export const CHANNEL_KINDS = ['PUBLIC', 'PRIVATE', 'DIRECT', 'TEAM'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

const uuid = z.string().uuid();

export const MESSAGE_MAX_LENGTH = 4000;

export const channelCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name the channel')
    .max(60, 'Use at most 60 characters')
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u, 'Use letters, numbers, spaces, - or _'),
  topic: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined)),
  kind: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  memberIds: z.array(uuid).max(200).default([]),
});
export type ChannelCreate = z.infer<typeof channelCreateSchema>;

export const directChannelSchema = z.object({ employeeId: uuid });
export type DirectChannelInput = z.infer<typeof directChannelSchema>;

export const channelMemberAddSchema = z.object({ employeeId: uuid });
export type ChannelMemberAdd = z.infer<typeof channelMemberAddSchema>;

export const messageCreateSchema = z.object({
  body: z.string().trim().min(1, 'Write a message').max(MESSAGE_MAX_LENGTH, 'Use at most 4000 characters'),
});
export type MessageCreate = z.infer<typeof messageCreateSchema>;

export const messageListQuerySchema = z.object({
  /** Only messages newer than this message id (used by the live refresh). */
  after: uuid.optional(),
  /** Only messages older than this message id (scroll back). */
  before: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;

export const peopleQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type PeopleQuery = z.infer<typeof peopleQuerySchema>;

export const callTokenSchema = z.object({
  /** Join with the camera on. Audio is always allowed; the person can switch devices on and off in the call. */
  video: z.boolean().default(true),
  /** True when the person starts the call: the channel gets a message so the others know to join. */
  announce: z.boolean().default(false),
});
export type CallTokenInput = z.infer<typeof callTokenSchema>;

export interface ChannelPerson {
  id: string;
  fullName: string;
  role: string;
}

export interface ChannelRecord {
  id: string;
  kind: ChannelKind;
  /** The channel name; for a direct message, the other person's name. */
  name: string;
  topic: string | null;
  teamId: string | null;
  /** DIRECT only. */
  otherPerson: ChannelPerson | null;
  unread: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  memberCount: number;
  /** True when the caller can add and remove people. */
  canManage: boolean;
  /** True when the caller is a member (public channels can be browsed before joining). */
  joined: boolean;
  archived: boolean;
}

export interface MessageRecord {
  id: string;
  channelId: string;
  author: ChannelPerson;
  /** Empty for a deleted message. */
  body: string;
  deleted: boolean;
  edited: boolean;
  createdAt: string;
}

export interface ChannelMessages {
  items: MessageRecord[];
  /** True when older messages exist before the first item. */
  hasMore: boolean;
}

export interface ChannelMemberRecord extends ChannelPerson {
  isOwner: boolean;
}

export interface ChannelDetail extends ChannelRecord {
  members: ChannelMemberRecord[];
}

export interface CollaborationConfig {
  /** False until the call service is set up; chat works without it. */
  callsEnabled: boolean;
  /** The call service's WebSocket address the browser connects to. */
  callsUrl: string | null;
}

export interface CallToken {
  url: string;
  token: string;
  room: string;
  expiresAt: string;
}
