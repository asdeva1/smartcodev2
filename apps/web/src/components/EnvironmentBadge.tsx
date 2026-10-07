import Box from '@mui/material/Box';
import { tokens } from '@/theme/tokens';

const LABELS = { development: 'Development', test: 'Test', staging: 'Staging' } as const;

/** Visible on every non-production environment so nobody mistakes staging for production. */
export function EnvironmentBadge({ appEnv }: { appEnv: string }) {
  if (!(appEnv in LABELS)) return null;
  return (
    <Box
      component="span"
      sx={{
        px: 1,
        py: 0.25,
        borderRadius: `${tokens.radius.control}px`,
        bgcolor: tokens.color.attentionBg,
        color: tokens.color.attention,
        fontSize: '0.75rem',
        fontWeight: 600,
      }}
    >
      {LABELS[appEnv as keyof typeof LABELS]}
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
        {' environment'}
      </Box>
    </Box>
  );
}
