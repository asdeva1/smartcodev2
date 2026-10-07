import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { PRODUCT } from '@smartcode/brand';
import { BrandLogo } from '@/components/BrandLogo';
import { LinkButton } from '@/components/LinkButton';
import { LifecycleTrack } from '@/components/LifecycleTrack';
import { tokens } from '@/theme/tokens';

/** Public entry point. SmartCode is an internal operations platform, so this page leads straight to sign-in. */
export default function LandingPage() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.paper' }}>
      <Container maxWidth="lg" sx={{ py: { xs: 4, md: 8 } }}>
        <Box component="header" sx={{ mb: { xs: 6, md: 10 } }}>
          <BrandLogo width={320} priority />
        </Box>
        <Box
          component="main"
          sx={{
            display: 'grid',
            gap: { xs: 6, md: 10 },
            gridTemplateColumns: { xs: '1fr', md: '1.1fr 0.9fr' },
            alignItems: 'start',
          }}
        >
          <Box sx={{ maxWidth: 560 }}>
            <Typography variant="h1" sx={{ mb: 3 }}>
              Every chart, from client file to completed audit.
            </Typography>
            <Typography sx={{ color: 'text.secondary', mb: 4, fontSize: '1.05rem' }}>
              SmartCode runs medical coding operations for {PRODUCT.company}: chart allocation, coder
              production, audits, Manager review and rework — in-house and with vendors, in one traceable
              workflow.
            </Typography>
            <LinkButton href="/login" variant="contained" size="large">
              Sign in
            </LinkButton>
          </Box>
          <Box
            component="section"
            aria-labelledby="lifecycle-heading"
            sx={{ borderLeft: { md: `1px solid ${tokens.color.line}` }, pl: { md: 6 } }}
          >
            <Typography id="lifecycle-heading" variant="h5" component="h2" sx={{ mb: 3 }}>
              How a chart moves through SmartCode
            </Typography>
            <LifecycleTrack />
          </Box>
        </Box>
        <Typography component="footer" variant="body2" color="text.secondary" sx={{ mt: { xs: 8, md: 12 } }}>
          {PRODUCT.fullName} · {PRODUCT.attribution}
        </Typography>
      </Container>
    </Box>
  );
}
