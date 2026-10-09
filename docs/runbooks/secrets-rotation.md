# Rotate secrets

All runtime secrets live in one Secrets Manager secret per environment (output `AppSecretArn`): `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`. They are never in source, task definitions or logs.

## Schedule

| Secret                    | Rotate                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| Database passwords        | Every 90 days, and when anyone with access leaves                    |
| JWT signing key pair      | Every 12 months, or immediately on suspected exposure                |
| GitHub / AWS deploy roles | Use OIDC (no stored keys); review role trust policies every 6 months |

## Database password

1. RDS → modify the user's password (or Secrets Manager rotation for the database credentials).
2. Update `DATABASE_URL` / `DATABASE_MIGRATION_URL` in the app secret.
3. Force a new ECS deployment; confirm `/health/ready` is 200.

## JWT key pair

Rotating the key signs every user out (they sign in again); this is acceptable and expected.

1. Generate a new key pair on a trusted machine: `pnpm --filter @smartcode/api exec tsx scripts/generate-dev-keys.ts` (the script prints the keys; do not save them to a file in the repository).
2. Put the new values in the app secret (`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`) through the AWS console.
3. Force a new ECS deployment.
4. Verify sign-in works; old sessions are rejected (401) and users sign in again.

## Suspected exposure

Treat as an incident: [incident-response.md](incident-response.md). Rotate first, investigate second.
