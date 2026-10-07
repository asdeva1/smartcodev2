import type { PrismaClient } from '../../src/generated/prisma/client';

/**
 * The SYSTEM seed — the minimum every environment needs and nothing else (Phase 2 §2.22):
 * exactly one Organization. No employees, vendors, clients, projects, charts, audits or any patient-like data,
 * and NO password of any kind. The first Manager is created by the secure bootstrap + activation workflow
 * (Phase 3): an activation link the person uses to choose their own password.
 */
export interface OrganizationSeed {
  slug: string;
  name: string;
  timeZone: string;
}

export const DEFAULT_ORGANIZATION: OrganizationSeed = {
  slug: 'smartclues',
  name: 'SmartClues',
  timeZone: 'Asia/Kolkata',
};

export type SeedOutcome =
  { created: true; organizationId: string } | { created: false; organizationId: string };

/** Idempotent: running it any number of times leaves exactly one organization. */
export async function seedSystem(
  prisma: Pick<PrismaClient, 'organization'>,
  organization: OrganizationSeed = DEFAULT_ORGANIZATION,
): Promise<SeedOutcome> {
  const existing = await prisma.organization.findUnique({ where: { slug: organization.slug } });
  if (existing) return { created: false, organizationId: existing.id };
  const others = await prisma.organization.count();
  if (others > 0) {
    throw new Error(`Refusing to seed: ${others} other organization(s) already exist.`);
  }
  const created = await prisma.organization.create({ data: organization });
  return { created: true, organizationId: created.id };
}
