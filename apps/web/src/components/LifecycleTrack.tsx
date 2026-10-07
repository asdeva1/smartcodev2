import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { tokens } from '@/theme/tokens';

/**
 * The SmartCode chart lifecycle as a vertical track — the operational spine of the product
 * (docs/08-chart-lifecycle.md). Rework is drawn as a loop back to audit, because that is what it is.
 */
export const LIFECYCLE_STAGES = [
  { key: 'client', label: 'Client', note: 'The healthcare organisation whose charts are coded' },
  { key: 'project', label: 'Project', note: 'Manual or automatic allocation' },
  { key: 'repository', label: 'Chart repository', note: 'Charts imported from the client file' },
  { key: 'allocation', label: 'Allocation', note: 'Manager assigns charts by SmartClues Login Name' },
  { key: 'production', label: 'Production', note: 'Coder records pages, ICDs and DOS' },
  { key: 'audit', label: 'Audit', note: 'Every coded chart is audited' },
  { key: 'completed', label: 'Completed', note: 'Passed audit or approved by a Manager' },
] as const;

export function LifecycleTrack({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const ink = tone === 'dark' ? '#FFFFFF' : tokens.color.ink;
  const muted = tone === 'dark' ? 'rgba(255,255,255,0.72)' : tokens.color.inkMuted;
  const rail = tone === 'dark' ? 'rgba(255,255,255,0.28)' : tokens.color.lineStrong;

  return (
    <Box
      component="ol"
      aria-label="Chart lifecycle"
      sx={{ listStyle: 'none', m: 0, p: 0, position: 'relative' }}
    >
      {LIFECYCLE_STAGES.map((stage, index) => {
        const last = index === LIFECYCLE_STAGES.length - 1;
        const isAudit = stage.key === 'audit';
        return (
          <Box component="li" key={stage.key} sx={{ position: 'relative', pl: 4, pb: last ? 0 : 2.25 }}>
            {!last && (
              <Box
                aria-hidden
                sx={{ position: 'absolute', left: 7, top: 18, bottom: 0, width: 2, bgcolor: rail }}
              />
            )}
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                left: 0,
                top: 4,
                width: 16,
                height: 16,
                borderRadius: '50%',
                border: `2px solid ${last ? tokens.color.complete : tokens.color.progress}`,
                bgcolor: last ? tokens.color.complete : 'transparent',
              }}
            />
            <Typography
              component="span"
              sx={{ display: 'block', fontFamily: tokens.font.heading, fontWeight: 500, color: ink }}
            >
              {stage.label}
            </Typography>
            <Typography component="span" variant="body2" sx={{ display: 'block', color: muted }}>
              {stage.note}
            </Typography>
            {isAudit && (
              <Box
                sx={{
                  mt: 1.25,
                  ml: -0.5,
                  pl: 1.5,
                  py: 0.75,
                  borderLeft: `2px dashed ${tokens.color.attention}`,
                }}
              >
                <Typography
                  component="span"
                  variant="body2"
                  sx={{ display: 'block', color: ink, fontWeight: 600 }}
                >
                  Review required → Manager decides
                </Typography>
                <Typography component="span" variant="body2" sx={{ display: 'block', color: muted }}>
                  Rejected charts go to rework, then back to audit
                </Typography>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
