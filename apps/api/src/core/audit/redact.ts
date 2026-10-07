/**
 * Keeps credentials, tokens and PHI-identifying keys out of activity / audit log payloads (D-05, docs/16).
 * The rules are IDENTICAL to the database function `sc_json_has_forbidden_key` (a database test proves the two
 * agree): keys are normalised (lower-case, letters and digits only) and matched against these patterns.
 * Services DROP such keys so logging never fails a business action; PostgreSQL rejects them if one slips through.
 */
const CONTAINS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'privatekey',
  'patient',
  'socialsecurity',
] as const;
const EXACT = new Set([
  'authorization',
  'cookie',
  'setcookie',
  'ssn',
  'mrn',
  'dob',
  'dateofbirth',
  'birthdate',
]);

export function isForbiddenLogKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return EXACT.has(normalised) || CONTAINS.some((part) => normalised.includes(part));
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Returns a deep copy without forbidden keys. Non-JSON values (undefined, functions, symbols) are dropped. */
export function sanitizeLogPayload(value: unknown): JsonValue | undefined {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => sanitizeLogPayload(v) ?? null);
  if (typeof value === 'object') {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenLogKey(key)) continue;
      const clean = sanitizeLogPayload(v);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }
  return undefined;
}
