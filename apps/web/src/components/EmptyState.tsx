import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

/** Empty screens point to the next action instead of just saying "nothing here". */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Box role="status" sx={{ py: 8, px: 3, textAlign: 'center', maxWidth: 520, mx: 'auto' }}>
      <Typography variant="h4" component="h2" gutterBottom>
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: action ? 3 : 0 }}>
        {description}
      </Typography>
      {action}
    </Box>
  );
}
