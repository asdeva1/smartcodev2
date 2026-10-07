import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { BrandLogo } from '@/components/BrandLogo';
import { LinkButton } from '@/components/LinkButton';

export default function NotFound() {
  return (
    <Box
      component="main"
      sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3, bgcolor: 'background.paper' }}
    >
      <Box sx={{ maxWidth: 440 }}>
        <BrandLogo width={200} />
        <Typography variant="h2" component="h1" sx={{ mt: 5, mb: 1.5 }}>
          Page not found
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          The address may be mistyped, or the page may need a role you don&apos;t have.
        </Typography>
        <LinkButton href="/" variant="outlined">
          Go to the start page
        </LinkButton>
      </Box>
    </Box>
  );
}
