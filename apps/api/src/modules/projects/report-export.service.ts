import { Injectable } from '@nestjs/common';
import {
  type ExportableReport,
  type ReportExportFormat,
  type ReportQuery,
  reportQuerySchema,
  startsWithFormulaTrigger,
} from '@smartcode/shared';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
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
    if (format === 'pdf') {
      return { filename: `${stem}.pdf`, contentType: 'application/pdf', body: await this.pdf(sheet) };
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

  /** A branded, print-ready table: header band, report details, the table (header repeats on each page) and totals. */
  private pdf(sheet: Sheet): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 36,
        info: { Title: sheet.title, Author: 'SmartCode' },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const width = doc.page.width - left - doc.page.margins.right;
      const bottom = () => doc.page.height - doc.page.margins.bottom - 20;
      const text = (v: Cell) => (v === null ? '' : String(v));
      // The first two columns hold names; the numeric columns share the rest.
      const first = Math.min(190, width * 0.26);
      const second = Math.min(170, width * 0.22);
      const rest = (width - first - second) / Math.max(1, sheet.columns.length - 2);
      const widths = sheet.columns.map((_, i) => (i === 0 ? first : i === 1 ? second : rest));
      const rowHeight = 20;

      const band = () => {
        doc.rect(0, 0, doc.page.width, 34).fill('#0B3C5D');
        doc
          .fillColor('#FFFFFF')
          .font('Helvetica-Bold')
          .fontSize(14)
          .text('SmartCode', left, 10, { lineBreak: false });
        doc
          .font('Helvetica')
          .fontSize(9)
          .text('Powering Smarter Medical Coding', left + 90, 14, { lineBreak: false });
        doc.fillColor('#000000');
      };
      const header = (y: number) => {
        doc.rect(left, y, width, rowHeight).fill('#0B3C5D');
        let x = left;
        sheet.columns.forEach((c, i) => {
          doc
            .fillColor('#FFFFFF')
            .font('Helvetica-Bold')
            .fontSize(8.5)
            .text(c, x + 5, y + 6, {
              width: widths[i]! - 10,
              align: i < 2 ? 'left' : 'right',
              lineBreak: false,
            });
          x += widths[i]!;
        });
        doc.fillColor('#000000');
        return y + rowHeight;
      };
      const row = (cells: Cell[], y: number, opts: { bold?: boolean; shade?: boolean }) => {
        if (opts.shade) doc.rect(left, y, width, rowHeight).fill('#F2F6FA');
        if (opts.bold)
          doc
            .moveTo(left, y)
            .lineTo(left + width, y)
            .lineWidth(0.8)
            .stroke('#0B3C5D');
        let x = left;
        cells.forEach((c, i) => {
          doc
            .fillColor('#14202B')
            .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(9)
            .text(text(c), x + 5, y + 6, {
              width: widths[i]! - 10,
              align: i < 2 ? 'left' : 'right',
              lineBreak: false,
              ellipsis: true,
            });
          x += widths[i]!;
        });
        return y + rowHeight;
      };

      band();
      let y = 52;
      doc.fillColor('#14202B').font('Helvetica-Bold').fontSize(16).text(sheet.title, left, y);
      y += 24;
      doc.font('Helvetica').fontSize(9.5).fillColor('#44515E');
      for (const line of sheet.info) {
        doc.text(line, left, y, { lineBreak: false });
        y += 14;
      }
      y += 8;
      y = header(y);
      sheet.rows.forEach((r, i) => {
        if (y + rowHeight > bottom()) {
          doc.addPage();
          band();
          y = header(52);
        }
        y = row(r, y, { shade: i % 2 === 1 });
      });
      if (sheet.rows.length === 0) {
        doc
          .fillColor('#44515E')
          .font('Helvetica')
          .fontSize(10)
          .text('No work recorded for this period.', left + 5, y + 8, { lineBreak: false });
        y += 30;
      }
      if (sheet.totals) {
        if (y + rowHeight > bottom()) {
          doc.addPage();
          band();
          y = header(52);
        }
        y = row(sheet.totals, y, { bold: true });
      }
      doc
        .fillColor('#6B7785')
        .font('Helvetica')
        .fontSize(8)
        .text(
          `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
          left,
          doc.page.height - doc.page.margins.bottom,
          { lineBreak: false },
        );
      doc.end();
    });
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
