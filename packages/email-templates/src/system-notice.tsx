import { Button, Heading, Text } from 'react-email';
import { BRAND_COLORS } from '@smartcode/brand';
import { BrandedEmailLayout } from './layout.js';

export interface SystemNoticeEmailProps {
  brandAssetBaseUrl: string;
  recipientName: string;
  heading: string;
  message: string;
  action?: { label: string; url: string };
}

/** Generic notification email — the base the module-specific templates (activation, reset, audit) build on. */
export function SystemNoticeEmail({
  brandAssetBaseUrl,
  recipientName,
  heading,
  message,
  action,
}: SystemNoticeEmailProps) {
  return (
    <BrandedEmailLayout brandAssetBaseUrl={brandAssetBaseUrl} preview={heading}>
      <Heading as="h1" style={{ color: BRAND_COLORS.navy, fontSize: 22, margin: '0 0 16px' }}>
        {heading}
      </Heading>
      <Text style={{ color: BRAND_COLORS.navy, fontSize: 15, lineHeight: '24px' }}>
        Hello {recipientName},
      </Text>
      <Text style={{ color: BRAND_COLORS.navy, fontSize: 15, lineHeight: '24px' }}>{message}</Text>
      {action ? (
        <Button
          href={action.url}
          style={{
            backgroundColor: BRAND_COLORS.blue,
            borderRadius: 8,
            color: '#FFFFFF',
            fontSize: 15,
            fontWeight: 600,
            padding: '12px 20px',
          }}
        >
          {action.label}
        </Button>
      ) : null}
    </BrandedEmailLayout>
  );
}
