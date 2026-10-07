import { Button, Heading, Link, Text } from 'react-email';
import { BRAND_COLORS } from '@smartcode/brand';
import type { ReactNode } from 'react';

/** Small building blocks shared by every transactional template. */
const textStyle = { color: BRAND_COLORS.navy, fontSize: 15, lineHeight: '24px', margin: '0 0 14px' } as const;

export function EmailHeading({ children }: { children: ReactNode }) {
  return (
    <Heading as="h1" style={{ color: BRAND_COLORS.navy, fontSize: 22, margin: '0 0 16px' }}>
      {children}
    </Heading>
  );
}

export function EmailParagraph({ children }: { children: ReactNode }) {
  return <Text style={textStyle}>{children}</Text>;
}

export function EmailNote({ children }: { children: ReactNode }) {
  return (
    <Text style={{ ...textStyle, color: BRAND_COLORS.slate, fontSize: 13, lineHeight: '20px' }}>
      {children}
    </Text>
  );
}

/** Primary action plus the plain link, so the message still works where buttons are stripped. */
export function EmailAction({ label, url }: { label: string; url: string }) {
  return (
    <>
      <Button
        href={url}
        style={{
          backgroundColor: BRAND_COLORS.blue,
          borderRadius: 8,
          color: '#FFFFFF',
          fontSize: 15,
          fontWeight: 600,
          padding: '12px 20px',
        }}
      >
        {label}
      </Button>
      <Text
        style={{ ...textStyle, color: BRAND_COLORS.slate, fontSize: 12, lineHeight: '18px', marginTop: 16 }}
      >
        If the button does not work, copy this address into your browser:
        <br />
        <Link href={url} style={{ color: BRAND_COLORS.blue, wordBreak: 'break-all' }}>
          {url}
        </Link>
      </Text>
    </>
  );
}
