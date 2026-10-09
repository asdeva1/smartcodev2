import { Injectable } from '@nestjs/common';
import {
  type ExportableReport,
  type ReportExportFormat,
  type ReportQuery,
  reportQuerySchema,
  startsWithFormulaTrigger,
} from '@smartcode/shared';
import ExcelJS from 'exceljs';
import type { Principal } from '../../core/auth/principal';
import { ProblemException } from '../../core/errors/problem';
import { ProjectReportsService } from './project-reports.service';
import { ProjectsService } from './projects.service';

type Cell = string | number | null;
interface Sheet {
  title: string;
  /** Period used in the file name, e.g. 2026-10-01_to_2026-10-09. */
  period: string;
  /** Lines shown above the table (project, period, who ran it). */
  info: string[];
  columns: string[];
  rows: Cell[][];
  totals: Cell[] | null;
}

export interface ReportFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A text cell that spreadsheet software could run as a formula is stored as text (CSV / formula injection guard). */
const safeText = (v: string) => (startsWithFormulaTrigger(v) ? `'${v}` : v);
const csvCell = (v: Cell) => {
  if (v === null) return '';
  const text = typeof v === 'number' ? String(v) : safeText(v);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const fileSafe = (v: string) =>
  v
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'report';

/**
 * Downloadable project reports (Excel and CSV). The figures come from the same service the screen uses, so what a
 * person can download is exactly what they are allowed to see: a Coder gets only their own work, a Vendor Admin only
 * their vendor's projects, and so on. Nothing is written to disk.
 */
@Injectable()
export class ReportExportService {
  constructor(
    private readonly reports: ProjectReportsService,
    private readonly projects: ProjectsService,
  ) {}

  async export(
    principal: Principal,
    projectId: string,
    type: ExportableReport,
    query: ReportQuery,
    format: ReportExportFormat,
  ): Promise<ReportFile> {
    const project = await this.projects.load(principal, projectId);
    const sheet =
      type === 'production'
        ? await this.productionSheet(principal, projectId, query, `${project.client.name} · ${project.name}`)
        : await this.qualitySheet(principal, projectId, query, `${project.client.name} · ${project.name}`);
    const stem = `${fileSafe(project.name)}_${type}-report_${sheet.period}`;
    if (format === 'csv') {
      return { filename: `${stem}.csv`, contentType: 'text/csv; charset=utf-8', body: this.csv(sheet) };
    }
    return { filename: `${stem}.xlsx`, contentType: XLSX_TYPE, body: await this.xlsx(sheet) };
  }

  private async productionSheet(p: Principal, id: string, q: ReportQuery, label: string): Promise<Sheet> {
    const r = await this.reports.production(p, id, q);
    return {
      title: 'Production report',
      period: `${r.period.from}_to_${r.period.to}`,
      info: [
        `Project: ${label}`,
        `Period: ${r.period.from} to ${r.period.to}`,
        `Time zone: ${r.period.timeZone}`,
      ],
      columns: ['Coder', 'Client Login', 'Charts', 'Pages', 'ICDs', 'DOS'],
      rows: r.rows.map((x) => [x.coder.fullName, x.coder.loginName, x.charts, x.pages, x.icds, x.dos]),
      totals: ['Total', null, r.totals.charts, r.totals.pages, r.totals.icds, r.totals.dos],
    };
  }

  private async qualitySheet(p: Principal, id: string, q: ReportQuery, label: string): Promise<Sheet> {
    const r = await this.reports.quality(p, id, q);
    const line = (x: {
      audited: number;
      passed: number;
      reviewRequired: number;
      rejected: number;
      auditErrors: number;
      errorExceptions: number;
      totalErrors: number;
    }) => [
      x.audited,
      x.passed,
      x.reviewRequired,
      x.rejected,
      x.auditErrors,
      x.errorExceptions,
      x.totalErrors,
    ];
    return {
      title: 'Quality report',
      period: `${r.period.from}_to_${r.period.to}`,
      info: [
        `Project: ${label}`,
        `Period: ${r.period.from} to ${r.period.to}`,
        `Time zone: ${r.period.timeZone}`,
      ],
      columns: [
        'Coder',
        'Client Login',
        'Audited',
        'Passed',
        'Review required',
        'Rejected',
        'Audit errors',
        'Error exceptions',
        'Total errors',
      ],
      rows: r.rows.map((x) => [x.coder.fullName, x.coder.loginName, ...line(x)]),
      totals: ['Total', null, ...line(r.totals)],
    };
  }

  private csv(sheet: Sheet): Buffer {
    const lines = [
      ...sheet.info.map((l) => csvCell(l)),
      '',
      sheet.columns.map(csvCell).join(','),
      ...sheet.rows.map((r) => r.map(csvCell).join(',')),
      ...(sheet.totals ? [sheet.totals.map(csvCell).join(',')] : []),
    ];
    // The byte-order mark makes Excel read accents and symbols correctly.
    return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
  }

  private async xlsx(sheet: Sheet): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'SmartCode';
    const ws = wb.addWorksheet(sheet.title);
    const title = ws.addRow([sheet.title]);
    title.font = { bold: true, size: 14 };
    for (const line of sheet.info) ws.addRow([safeText(line)]);
    ws.addRow([]);
    const header = ws.addRow(sheet.columns);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3C5D' } };
    for (const r of sheet.rows) ws.addRow(r.map((c) => (typeof c === 'string' ? safeText(c) : c)));
    if (sheet.totals) {
      const total = ws.addRow(sheet.totals);
      total.font = { bold: true };
      total.border = { top: { style: 'thin' } };
    }
    sheet.columns.forEach((name, i) => {
      const widest = Math.max(name.length, ...sheet.rows.map((r) => String(r[i] ?? '').length));
      ws.getColumn(i + 1).width = Math.min(40, Math.max(10, widest + 2));
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}

export const assertExportable = (type: string): ExportableReport => {
  if (type === 'production' || type === 'quality') return type;
  throw new ProblemException(404, 'NOT_FOUND', 'Report not found');
};

// reportQuerySchema is re-exported so the controller validates the period with the screen's own rules.
export { reportQuerySchema };
