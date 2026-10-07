import type { Prisma, PrismaClient } from '../../generated/prisma/client';

export type Tx = Prisma.TransactionClient;

export interface ActorContext {
  /** The authenticated employee performing the action (from the access token — never from the request body). */
  actorId: string | null;
  /** Optional reason recorded on the chart timeline for status changes made in this transaction. */
  reason?: string;
}

/**
 * Runs `fn` in ONE database transaction and tells PostgreSQL who is acting (`app.actor_id`, `app.reason`,
 * transaction-local). Database triggers use it to attribute chart status events, so the timeline names the actor
 * even for system follow-ups. Every multi-step workflow (allocate, submit, audit, resolve, rework) uses this wrapper:
 * all-or-nothing, with the integrity triggers as the last line of defence.
 */
export async function withActor<T>(
  prisma: PrismaClient,
  context: ActorContext,
  fn: (tx: Tx) => Promise<T>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.actor_id', ${context.actorId ?? ''}, true), set_config('app.reason', ${context.reason ?? ''}, true)`;
      return fn(tx);
    },
    { timeout: options.timeoutMs ?? 15_000 },
  );
}
