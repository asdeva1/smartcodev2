import { createTestDb, describeDb, type TestDb } from './harness';
import { names, parseSchema } from './prisma-schema';

/**
 * Stand-in for `prisma migrate diff` (the migration engine binary cannot be downloaded in every environment):
 * everything schema.prisma declares must exist in the migrated database with Prisma's names and types, and the
 * database must hold no plain index / table / column that schema.prisma does not know (that would be drift).
 * CI additionally runs the real `prisma migrate diff --exit-code` check.
 */
describeDb('Prisma schema ↔ migrated database parity (PostgreSQL)', () => {
  let db: TestDb;
  const { models, enums } = parseSchema();

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => db?.close());

  it('parses the schema it is checking', () => {
    expect(models.length).toBeGreaterThanOrEqual(25);
    expect(enums.length).toBeGreaterThanOrEqual(19);
  });

  it('has exactly the declared tables', async () => {
    const rows = await db.sql<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(models.map((m) => m.table).sort());
  });

  it('has exactly the declared enums and values', async () => {
    const rows = await db.sql<{ typname: string; labels: string[] }>(
      `SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = current_schema() GROUP BY t.typname`,
    );
    const database = Object.fromEntries(rows.map((r) => [r.typname, r.labels]));
    const declared = Object.fromEntries(enums.map((e) => [e.dbName, e.values]));
    expect(database).toEqual(declared);
  });

  it('has the declared columns with matching types and nullability', async () => {
    const rows = await db.sql<{
      table_name: string;
      column_name: string;
      is_nullable: string;
      udt_name: string;
      character_maximum_length: number | null;
      datetime_precision: number | null;
    }>(
      `SELECT table_name, column_name, is_nullable, udt_name, character_maximum_length, datetime_precision
         FROM information_schema.columns WHERE table_schema = current_schema()`,
    );
    const enumDb = new Map(enums.map((e) => [e.name, e.dbName]));
    const expected: string[] = [];
    for (const model of models) {
      for (const f of model.fields) {
        let udt: string;
        let length: number | null = null;
        let precision: number | null = null;
        if (enumDb.has(f.type)) udt = enumDb.get(f.type) as string;
        else if (f.type === 'String') {
          const varchar = /^VarChar\((\d+)\)$/.exec(f.dbType ?? '');
          udt = f.dbType === 'Uuid' ? 'uuid' : varchar ? 'varchar' : 'text';
          length = varchar ? Number(varchar[1]) : null;
        } else if (f.type === 'Int') udt = 'int4';
        else if (f.type === 'Boolean') udt = 'bool';
        else if (f.type === 'Json') udt = 'jsonb';
        else {
          udt = 'timestamptz';
          precision = Number(/\((\d)\)/.exec(f.dbType ?? '')?.[1] ?? 3);
        }
        expected.push(
          JSON.stringify([model.table, f.column, f.optional ? 'YES' : 'NO', udt, length, precision]),
        );
      }
    }
    const actual = rows.map((r) =>
      JSON.stringify([
        r.table_name,
        r.column_name,
        r.is_nullable,
        r.udt_name,
        r.character_maximum_length,
        r.udt_name === 'timestamptz' ? r.datetime_precision : null,
      ]),
    );
    expect(actual.sort()).toEqual(expected.sort());
  });

  it('has the declared indexes and unique constraints with Prisma names — and no undeclared plain index', async () => {
    const rows = await db.sql<{
      table_name: string;
      index_name: string;
      is_unique: boolean;
      is_primary: boolean;
      cols: string[];
    }>(
      `SELECT t.relname AS table_name, i.relname AS index_name, ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
              array_agg(a.attname::text ORDER BY k.ord) AS cols
         FROM pg_index ix
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         CROSS JOIN LATERAL unnest(ix.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE n.nspname = current_schema() AND ix.indpred IS NULL AND ix.indexprs IS NULL
        GROUP BY t.relname, i.relname, ix.indisunique, ix.indisprimary`,
    );
    const actual = rows.map(
      (r) => `${r.index_name}|${r.is_primary ? 'pk' : r.is_unique ? 'unique' : 'index'}|${r.cols.join(',')}`,
    );
    const expected: string[] = [];
    for (const m of models) {
      expected.push(`${names.primaryKey(m.table)}|pk|${m.primaryKey.join(',')}`);
      for (const cols of m.indexes) expected.push(`${names.index(m.table, cols)}|index|${cols.join(',')}`);
      for (const cols of m.uniques) expected.push(`${names.unique(m.table, cols)}|unique|${cols.join(',')}`);
    }
    expect(actual.sort()).toEqual(expected.sort());
  });

  it('has the declared foreign keys (RESTRICT on delete, CASCADE on update) — and no undeclared one', async () => {
    const rows = await db.sql<{
      conname: string;
      src: string;
      src_cols: string[];
      dst: string;
      dst_cols: string[];
      del: string;
      upd: string;
    }>(
      `SELECT c.conname, s.relname AS src, dst.relname AS dst, c.confdeltype AS del, c.confupdtype AS upd,
              (SELECT array_agg(a.attname::text ORDER BY u.ord) FROM unnest(c.conkey) WITH ORDINALITY u(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = u.attnum) AS src_cols,
              (SELECT array_agg(a.attname::text ORDER BY u.ord) FROM unnest(c.confkey) WITH ORDINALITY u(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = u.attnum) AS dst_cols
         FROM pg_constraint c
         JOIN pg_class s ON s.oid = c.conrelid JOIN pg_class dst ON dst.oid = c.confrelid JOIN pg_namespace n ON n.oid = s.relnamespace
        WHERE c.contype = 'f' AND n.nspname = current_schema()`,
    );
    const actual = rows.map(
      (r) =>
        `${r.conname}|${r.src}(${r.src_cols.join(',')})->${r.dst}(${r.dst_cols.join(',')})|${r.del}${r.upd}`,
    );
    const expected: string[] = [];
    for (const m of models) {
      for (const rel of m.relations) {
        const target = models.find((x) => x.name === rel.targetModel)!;
        expected.push(
          `${names.foreignKey(m.table, rel.fieldColumns)}|${m.table}(${rel.fieldColumns.join(',')})->${target.table}(${rel.referencedColumns.join(',')})|rc`,
        );
      }
    }
    expect(actual.sort()).toEqual(expected.sort());
  });
});
