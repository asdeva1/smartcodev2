import Chip from '@mui/material/Chip';
import { CHART_STATUS_LABELS, type ChartStatus } from '@smartcode/shared';
import { CHART_STATUS_TONE, tokens } from '@/theme/tokens';

const TONE_STYLES = {
  neutral: { bgcolor: '#EEF2F7', color: tokens.color.inkMuted },
  progress: { bgcolor: '#E6F6FC', color: '#05607F' },
  attention: { bgcolor: tokens.color.attentionBg, color: tokens.color.attention },
  complete: { bgcolor: '#E3FAF0', color: tokens.color.completeInk },
} as const;

/** Chart status with consistent wording and colour everywhere (labels from packages/shared). */
export function StatusChip({ status, size = 'small' }: { status: ChartStatus; size?: 'small' | 'medium' }) {
  const tone = CHART_STATUS_TONE[status];
  return <Chip label={CHART_STATUS_LABELS[status]} size={size} data-tone={tone} sx={TONE_STYLES[tone]} />;
}
