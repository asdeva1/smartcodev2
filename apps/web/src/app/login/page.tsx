import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { PRODUCT } from '@smartcode/brand';
import type { Metadata } from 'next';
import { BrandLogo } from '@/components/BrandLogo';
import { LifecycleTrack } from '@/components/LifecycleTrack';
import { LoginForm } from '@/features/auth/LoginForm';
import { tokens } from '@/theme/tokens';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(360px, 0.9fr) 1.1fr' },
      }}
    >
      <Box
        component="aside"
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          bgcolor: tokens.color.ink,
          color: '#FFFFFF',
          p: 6,
        }}
      >
        {/* The original logo has a light background, so on navy it sits in a light container. */}
        <BrandLogo width={260} surface="dark" priority />
        <Box sx={{ maxWidth: 380 }}>
          <LifecycleTrack tone="dark" />
        </Box>
        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.72)' }}>
          {PRODUCT.attribution}
        </Typography>
      </Box>

      <Box
        component="main"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: { xs: 3, sm: 6 },
          bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 400 }}>
          <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 5 }}>
            <BrandLogo width={240} priority />
          </Box>
          <Typography variant="h2" component="h1" sx={{ mb: 1 }}>
            Sign in
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 4 }}>
            Use the work email your Manager registered for you.
          </Typography>
          <LoginForm />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 4 }}>
            New to SmartCode? Open the activation link from your invitation email to set your password.
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
