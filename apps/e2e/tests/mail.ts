import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The API runs with MAIL_TRANSPORT=file in E2E, so every email lands as a JSON file. Reading the link from there
 * exercises the real token flow exactly as a person would (the stand-in for Mailpit in docs/13 §2).
 */
export const MAIL_DIR = process.env.E2E_MAIL_DIR ?? '.mail-outbox';

interface Sent {
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

function all(): Sent[] {
  try {
    return readdirSync(MAIL_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(MAIL_DIR, f), 'utf8')) as Sent);
  } catch {
    return [];
  }
}

/** Waits for a message to `to` whose subject matches, sent after `since`, and returns the link inside it. */
export async function linkFromEmail(
  to: string,
  subject: RegExp,
  since: Date,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = all()
      .filter((m) => m.to === to.toLowerCase() && subject.test(m.subject) && new Date(m.sentAt) >= since)
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
    if (match) {
      const url = /https?:\/\/\S+?token=[A-Za-z0-9_-]+/.exec(match.text)?.[0];
      if (url) return url;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No "${subject}" email arrived for ${to}`);
}

export function emailsTo(to: string, subject: RegExp, since: Date): number {
  return all().filter(
    (m) => m.to === to.toLowerCase() && subject.test(m.subject) && new Date(m.sentAt) >= since,
  ).length;
}
