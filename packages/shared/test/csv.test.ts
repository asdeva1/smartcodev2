import { describe, expect, it } from 'vitest';
import { CsvError, normaliseHeader, parseCsv, startsWithFormulaTrigger } from '../src/index.js';

describe('CSV reader', () => {
  it('normalises headers regardless of case, spacing and punctuation', () => {
    expect(normaliseHeader(' Employee ID ')).toBe('employeeid');
    expect(normaliseHeader('employee_id')).toBe('employeeid');
    expect(normaliseHeader('﻿Email')).toBe('email');
  });
  it('parses quoted fields, embedded commas, escaped quotes, newlines and CRLF', () => {
    const csv = 'Name,Note\r\n"Doe, Jane","said ""hi"""\r\n"Two\nLines",x\r\n';
    const parsed = parseCsv(csv);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.cells).toEqual({ name: 'Doe, Jane', note: 'said "hi"' });
    expect(parsed.rows[1]?.cells.name).toBe('Two\nLines');
  });
  it('reports the 1-based source line of each record', () => {
    const parsed = parseCsv('a,b\n1,2\n3,4');
    expect(parsed.rows.map((r) => r.line)).toEqual([2, 3]);
  });
  it('trims cells and fills missing trailing cells with empty strings', () => {
    expect(parseCsv('a,b\n  x  ').rows[0]?.cells).toEqual({ a: 'x', b: '' });
  });
  it('rejects empty files, blank or repeated headers, and oversized input', () => {
    expect(() => parseCsv('')).toThrow(CsvError);
    expect(() => parseCsv('a,,b\n1,2,3')).toThrow(/blank column/);
    expect(() => parseCsv('Email,email\n1,2')).toThrow(/repeats/);
    expect(() => parseCsv('a\n1\n2\n3', { maxRows: 2 })).toThrow(/more than 2 rows/);
    expect(() => parseCsv('a\n' + 'x'.repeat(50), { maxBytes: 10 })).toThrow(/larger than/);
  });
  it('flags spreadsheet formula triggers', () => {
    for (const v of ['=SUM(A1)', '+1', '-1', '@x', '\tx']) expect(startsWithFormulaTrigger(v)).toBe(true);
    expect(startsWithFormulaTrigger('Jane')).toBe(false);
  });
});
