import '@fontsource-variable/lexend';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { FAVICONS, PRODUCT } from '@smartcode/brand';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { env } from '@/env';
import { Providers } from './providers';

const brand = (path: string) => `/brand/${path}`;

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
  title: { default: PRODUCT.fullName, template: `%s · ${PRODUCT.name}` },
  description: `${PRODUCT.tagline} ${PRODUCT.attribution}.`,
  applicationName: PRODUCT.name,
  // Not a public website: keep every environment out of search engines.
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: brand(FAVICONS.ico), sizes: '16x16 32x32 48x48' },
      { url: brand(FAVICONS.png32), type: 'image/png', sizes: '32x32' },
      { url: brand(FAVICONS.png192), type: 'image/png', sizes: '192x192' },
    ],
    apple: { url: brand(FAVICONS.appleTouch), sizes: '180x180' },
  },
};

export const viewport: Viewport = { themeColor: '#FFFFFF', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider options={{ key: 'sc' }}>
          <Providers>{children}</Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
