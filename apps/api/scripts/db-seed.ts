/**
 * pnpm db:seed — idempotent SYSTEM seed only (docs/02): the single organization.
 * Never creates employees, vendors, projects, charts or any business data. The first Manager is created
 * by the separate bootstrap command (Phase 3), never by this seed.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { describeDatabase, requireDatabaseUrl } from './lib';

const ORGANIZATION = {
  slug: process.env.SEED_ORGANIZATION_SLUG ?? 'smartclues',
  name: process.env.SEED_ORGANIZATION_NAME ?? 'SmartClues',
  timeZone: process.env.SEED_ORGANIZATION_TIME_ZONE ?? 'Asia/Kolkata',
};

async function main(): Promise<void> {
  const url = requireDatabaseUrl();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
  try {
    const existing = await prisma.organization.findUnique({ where: { slug: ORGANIZATION.slug } });
    if (existing) {
      console.log(
        `System seed: organization "${existing.name}" already present on ${describeDatabase(url)} — nothing to do.`,
      );
      return;
    }
    const others = await prisma.organization.count();
    if (others > 0) {
      throw new Error(`Refusing to seed: ${others} other organization(s) already exist.`);
    }
    const org = await prisma.organization.create({ data: ORGANIZATION });
    console.log(`System seed: created organization "${org.name}" on ${describeDatabase(url)}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
