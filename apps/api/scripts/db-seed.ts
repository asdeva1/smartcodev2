/**
 * pnpm db:seed — idempotent SYSTEM seed only (docs/02): the single organization.
 * Never creates employees, vendors, projects, charts or any business data, and never any password.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { describeDatabase, requireDatabaseUrl } from './lib';
import { DEFAULT_ORGANIZATION, seedSystem } from './seed/system-seed';

async function main(): Promise<void> {
  const url = requireDatabaseUrl();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
  try {
    const outcome = await seedSystem(prisma, {
      slug: process.env.SEED_ORGANIZATION_SLUG ?? DEFAULT_ORGANIZATION.slug,
      name: process.env.SEED_ORGANIZATION_NAME ?? DEFAULT_ORGANIZATION.name,
      timeZone: process.env.SEED_ORGANIZATION_TIME_ZONE ?? DEFAULT_ORGANIZATION.timeZone,
    });
    console.log(
      outcome.created
        ? `System seed: created the organization on ${describeDatabase(url)}.`
        : `System seed: organization already present on ${describeDatabase(url)} — nothing to do.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
