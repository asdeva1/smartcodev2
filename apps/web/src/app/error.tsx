'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

/** Unexpected rendering errors: say what happened and offer the one useful action. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Box
      component="main"
      role="alert"
      sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center', p: 3 }}
    >
      <Box sx={{ maxWidth: 440 }}>
        <Typography variant="h3" component="h1" sx={{ mb: 1.5 }}>
          This page couldn&apos;t load
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Something went wrong while showing this page. Your data has not been changed.
        </Typography>
        <Button variant="contained" onClick={reset}>
          Try again
        </Button>
      </Box>
    </Box>
  );
}
