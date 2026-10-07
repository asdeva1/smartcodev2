import { describe, expect, it } from 'vitest';
import { SystemNoticeEmail, renderEmail } from '../src/index.js';

describe('email templates', () => {
  it('renders the official logo from the configured brand URL with HTML and text parts', async () => {
    const { html, text } = await renderEmail(
      <SystemNoticeEmail
        brandAssetBaseUrl="http://localhost:3000/brand"
        recipientName="Test Coder"
        heading="Welcome to SmartCode"
        message="Your SmartCode account is ready."
        action={{ label: 'Open SmartCode', url: 'http://localhost:3000/login' }}
      />,
    );
    expect(html).toContain('src="http://localhost:3000/brand/web/smartcode-logo-horizontal@1x.png"');
    expect(html).toContain('width="240"');
    expect(html).toContain('height="70"');
    expect(html).toContain('A SmartClues Technology Product');
    expect(html).toContain('href="http://localhost:3000/login"');
    expect(text).toContain('Hello Test Coder');
    expect(text).not.toContain('<');
  });

  it('omits the action button when there is no action', async () => {
    const { html } = await renderEmail(
      <SystemNoticeEmail
        brandAssetBaseUrl="https://app.example.test/brand"
        recipientName="Test"
        heading="Notice"
        message="Informational."
      />,
    );
    expect(html).not.toContain('<a');
  });
});
