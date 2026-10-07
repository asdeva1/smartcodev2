import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { PRODUCT } from '@smartcode/brand';
import type { ReactNode } from 'react';
import { BrandLogo } from '@/components/BrandLogo';

/** Centered single-column frame shared by the public account pages (activate, forgot, reset). */
export function AccountPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <Box
      component="main"
      sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: { xs: 3, sm: 6 } }}
    >
      <Box sx={{ width: '100%', maxWidth: 440 }}>
        <Box sx={{ mb: 5 }}>
          <BrandLogo width={240} priority />
        </Box>
        <Typography variant="h2" component="h1" sx={{ mb: 1 }}>
          {title}
        </Typography>
        {intro && (
          <Typography color="text.secondary" sx={{ mb: 4 }}>
            {intro}
          </Typography>
        )}
        {children}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 6 }}>
          {PRODUCT.attribution}
        </Typography>
      </Box>
    </Box>
  );
}
