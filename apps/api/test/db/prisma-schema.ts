import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A deliberately small reader for prisma/schema.prisma — just enough to derive, using Prisma's own naming rules,
 * the tables, columns, enums, indexes, unique constraints and foreign keys the schema declares. The parity test
 * compares that to the migrated database, which stands in for `prisma migrate diff` where the migration engine
 * cannot be downloaded (CI runs the real drift check as well).
 */
export interface ParsedField {
  name: string;
  column: string;
  type: string;
  optional: boolean;
  list: boolean;
  dbType?: string;
}
export interface ParsedRelation {
  fieldColumns: string[];
  targetModel: string;
  referencedColumns: string[];
}
export interface ParsedModel {
  name: string;
  table: string;
  fields: ParsedField[];
  /** Index/unique definitions as column lists. */
  indexes: string[][];
  uniques: string[][];
  primaryKey: string[];
  relations: ParsedRelation[];
}
export interface ParsedEnum {
  name: string;
  dbName: string;
  values: string[];
}

const SCALARS = new Set(['String', 'Int', 'Boolean', 'DateTime', 'Json', 'BigInt', 'Float', 'Decimal']);

export function parseSchema(path = join(__dirname, '..', '..', 'prisma', 'schema.prisma')) {
  const text = readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/"\{\}"/g, '"EMPTY_OBJECT"'); // the Json default would otherwise end a model block early
  const enums: ParsedEnum[] = [];
  const models: ParsedModel[] = [];

  const enumRe = /enum\s+(\w+)\s*\{([^}]*)\}/g;
  for (let m = enumRe.exec(text); m; m = enumRe.exec(text)) {
    const body = m[2] ?? '';
    const dbName = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? (m[1] as string);
    const values = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[A-Z][A-Z0-9_]*$/.test(l));
    enums.push({ name: m[1] as string, dbName, values });
  }
  const enumNames = new Set(enums.map((e) => e.name));
  const modelNames = new Set([...text.matchAll(/model\s+(\w+)\s*\{/g)].map((m) => m[1] as string));

  const modelRe = /model\s+(\w+)\s*\{([^}]*)\}/g;
  for (let m = modelRe.exec(text); m; m = modelRe.exec(text)) {
    const body = m[2] ?? '';
    const model: ParsedModel = {
      name: m[1] as string,
      table: /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? (m[1] as string),
      fields: [],
      indexes: [],
      uniques: [],
      primaryKey: [],
      relations: [],
    };
    const columnOf = new Map<string, string>();
    const lines = body
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    // First pass: scalar fields.
    for (const line of lines) {
      const f = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
      if (!f || line.startsWith('@@')) continue;
      const name = f[1] as string;
      const type = f[2] as string;
      const list = f[3];
      const optional = f[4];
      const rest = f[5] ?? '';
      if (modelNames.has(type)) continue; // relation field
      if (!SCALARS.has(type) && !enumNames.has(type)) continue;
      const column = /@map\("([^"]+)"\)/.exec(rest)?.[1] ?? name;
      columnOf.set(name, column);
      model.fields.push({
        name,
        column,
        type,
        optional: Boolean(optional),
        list: Boolean(list),
        dbType: /@db\.(\w+(?:\(\d+\))?)/.exec(rest)?.[1],
      });
      if (/@id\b/.test(rest)) model.primaryKey = [column];
      if (/@unique\b/.test(rest)) model.uniques.push([column]);
    }
    const cols = (list: string) =>
      list
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((n) => columnOf.get(n) ?? n);
    for (const line of lines) {
      const idx = /^@@index\(\[([^\]]+)\]/.exec(line);
      if (idx) model.indexes.push(cols(idx[1] as string));
      const uq = /^@@unique\(\[([^\]]+)\]/.exec(line);
      if (uq) model.uniques.push(cols(uq[1] as string));
      const id = /^@@id\(\[([^\]]+)\]/.exec(line);
      if (id) model.primaryKey = cols(id[1] as string);
      const rel = /@relation\([^)]*fields:\s*\[([^\]]+)\][^)]*references:\s*\[([^\]]+)\]/.exec(line);
      if (rel) {
        const target = /^\w+\s+(\w+)/.exec(line)?.[1] as string;
        model.relations.push({
          fieldColumns: cols(rel[1] as string),
          targetModel: target,
          referencedColumns: [],
        });
        (model.relations.at(-1) as ParsedRelation & { referencedFields?: string[] }).referencedFields = (
          rel[2] as string
        )
          .split(',')
          .map((s) => s.trim());
      }
    }
    models.push(model);
  }

  // Resolve referenced field names to column names of the target model.
  for (const model of models) {
    for (const rel of model.relations as (ParsedRelation & { referencedFields?: string[] })[]) {
      const target = models.find((x) => x.name === rel.targetModel);
      rel.referencedColumns = (rel.referencedFields ?? []).map(
        (f) => target?.fields.find((tf) => tf.name === f)?.column ?? f,
      );
    }
  }
  return { models, enums };
}

/** Prisma's default object names. */
export const names = {
  index: (table: string, cols: string[]) => `${table}_${cols.join('_')}_idx`,
  unique: (table: string, cols: string[]) => `${table}_${cols.join('_')}_key`,
  foreignKey: (table: string, cols: string[]) => `${table}_${cols.join('_')}_fkey`,
  primaryKey: (table: string) => `${table}_pkey`,
};
