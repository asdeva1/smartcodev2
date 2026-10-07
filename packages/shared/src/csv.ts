/**
 * Minimal RFC 4180 CSV reader used by every bulk workflow (docs/10-csv-framework.md). It only parses; validation
 * belongs to the per-type validators. Pure and dependency-free so the web preview and the API share it.
 */
export const CSV_LIMITS = { maxBytes: 2 * 1024 * 1024, maxRows: 5000 } as const;

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvError';
  }
}

export interface ParsedCsv {
  /** Header cells as written. */
  headers: string[];
  /** Data rows keyed by normalised header; `line` is the 1-based source line of the record start. */
  rows: { line: number; cells: Record<string, string> }[];
}

/** "Employee ID" / "employee_id" / " EMPLOYEE-ID " → "employeeid". */
export function normaliseHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function splitRecords(text: string): { line: number; fields: string[] }[] {
  const records: { line: number; fields: string[] }[] = [];
  let field = '';
  let fields: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let sawAny = false;

  const endField = () => {
    fields.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    if (!(fields.length === 1 && fields[0] === '' && !sawAny)) records.push({ line: recordLine, fields });
    fields = [];
    sawAny = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      sawAny = true;
    } else if (ch === ',') {
      sawAny = true;
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      sawAny = true;
      field += ch;
    }
  }
  if (inQuotes) throw new CsvError('The file has an unclosed quoted value');
  if (field !== '' || fields.length > 0 || sawAny) endRecord();
  return records;
}

export function parseCsv(text: string, options: { maxRows?: number; maxBytes?: number } = {}): ParsedCsv {
  const maxBytes = options.maxBytes ?? CSV_LIMITS.maxBytes;
  const maxRows = options.maxRows ?? CSV_LIMITS.maxRows;
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new CsvError(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
  }
  const records = splitRecords(text.replace(/^\uFEFF/, ''));
  const head = records[0];
  if (!head) throw new CsvError('The file is empty');
  const keys = head.fields.map(normaliseHeader);
  if (keys.some((k) => k === '')) throw new CsvError('The header row contains a blank column name');
  if (new Set(keys).size !== keys.length) throw new CsvError('The header row repeats a column name');
  const dataRecords = records.slice(1);
  if (dataRecords.length > maxRows) throw new CsvError(`The file has more than ${maxRows} rows`);
  return {
    headers: head.fields,
    rows: dataRecords.map((record) => ({
      line: record.line,
      cells: Object.fromEntries(keys.map((key, i) => [key, (record.fields[i] ?? '').trim()])),
    })),
  };
}

/** Values that spreadsheet software would execute as formulas — refused on import, neutralised on export. */
export function startsWithFormulaTrigger(value: string): boolean {
  return /^[=+\-@\t\r]/.test(value);
}
