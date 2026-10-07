import { BRAND_COLORS } from '@smartcode/brand';
import type { ChartStatus } from '@smartcode/shared';

/**
 * Design tokens. Colours come from the official logo (packages/brand); neutrals are cool-toned to sit with it.
 * Green is reserved for completion so "done" is unmistakable on dense operational screens.
 */
export const tokens = {
  color: {
    ink: BRAND_COLORS.navy,
    inkMuted: '#4A5B78',
    action: BRAND_COLORS.blue,
    actionStrong: BRAND_COLORS.royal,
    progress: BRAND_COLORS.cyan,
    complete: BRAND_COLORS.green,
    completeInk: '#0B6B47',
    attention: '#B54708',
    attentionBg: '#FEF3E7',
    danger: '#B42318',
    canvas: '#F5F8FC',
    surface: '#FFFFFF',
    line: '#DCE4EF',
    lineStrong: '#C3CFDF',
  },
  font: {
    heading: '"Lexend Variable", "Lexend", system-ui, sans-serif',
    body: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  radius: { control: 6, panel: 10 },
  sidebarWidth: 264,
} as const;

/** Status → colour role for chips and timelines (docs/08-chart-lifecycle.md). */
export const CHART_STATUS_TONE: Readonly<
  Record<ChartStatus, 'neutral' | 'progress' | 'attention' | 'complete'>
> = {
  PENDING_ALLOCATION: 'neutral',
  ALLOCATED: 'progress',
  IN_PRODUCTION: 'progress',
  CODED: 'progress',
  PENDING_AUDIT: 'progress',
  REVIEW_REQUIRED: 'attention',
  REWORK: 'attention',
  RE_AUDIT: 'progress',
  AUDITED: 'complete',
  COMPLETED: 'complete',
};
