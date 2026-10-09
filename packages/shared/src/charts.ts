import { z } from 'zod';
import type { Page } from './employees.js';

/** Chart repository: every chart a person may see, across projects. */

export const chartRepositoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v ? v : undefined)),
  status: z.string().trim().max(32).optional(),
  projectId: z.uuid().optional(),
});
export type ChartRepositoryQuery = z.infer<typeof chartRepositoryQuerySchema>;

export interface ChartRepositoryRecord {
  id: string;
  chartId: string;
  status: string;
  pages: number | null;
  pageBucket: string | null;
  project: { id: string; name: string; client: string };
  /** The coder the chart is with now; null when nobody holds it. */
  coder: { id: string; fullName: string; loginName: string } | null;
  updatedAt: string;
}

export interface ChartRepositoryPage extends Page<ChartRepositoryRecord> {
  /** Charts per status for the same search and project filter (ignoring the status filter), for the filter chips. */
  statusCounts: Record<string, number>;
}

export interface ChartTimeline {
  chart: { id: string; chartId: string; status: string; project: { id: string; name: string; client: string } };
  events: {
    fromStatus: string | null;
    toStatus: string;
    actor: { id: string; fullName: string } | null;
    reason: string | null;
    at: string;
  }[];
}
