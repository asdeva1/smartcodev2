import { Body, Container, Head, Hr, Html, Img, Preview, Section, Text } from 'react-email';
import { BRAND_COLORS, LOGO, PRODUCT, brandAssetUrl } from '@smartcode/brand';
import type { ReactNode } from 'react';

export interface BrandedEmailLayoutProps {
  /** Absolute base URL of the brand assets, e.g. `${APP_URL}/brand` (BRAND_ASSET_BASE_URL). */
  brandAssetBaseUrl: string;
  /** Inbox preview line. */
  preview: string;
  children: ReactNode;
}

const styles = {
  body: {
    backgroundColor: '#F4F7FB',
    fontFamily: 'Inter, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
    margin: 0,
  },
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    margin: '32px auto',
    maxWidth: 560,
    padding: '32px 40px',
  },
  footer: { color: BRAND_COLORS.slate, fontSize: 12, lineHeight: '18px' },
  hr: { borderColor: '#E3E9F2', margin: '24px 0' },
} as const;

/** Shared shell for every SmartCode email: the official logo (light background, original proportions) + footer. */
export function BrandedEmailLayout({ brandAssetBaseUrl, preview, children }: BrandedEmailLayoutProps) {
  const logo = LOGO.horizontalSmall;
  const width = 240;
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section>
            <Img
              src={brandAssetUrl(brandAssetBaseUrl, logo)}
              alt={logo.alt}
              width={width}
              height={Math.round((width * logo.height) / logo.width)}
            />
          </Section>
          <Hr style={styles.hr} />
          {children}
          <Hr style={styles.hr} />
          <Text style={styles.footer}>
            {PRODUCT.fullName} · {PRODUCT.attribution}
            <br />
            This is an automated message. Please do not reply.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
