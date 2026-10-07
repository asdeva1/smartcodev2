import { render } from '@react-email/render';
import type { ReactElement } from 'react';

export { BrandedEmailLayout, type BrandedEmailLayoutProps } from './layout.js';
export { SystemNoticeEmail, type SystemNoticeEmailProps } from './system-notice.js';

export interface RenderedEmail {
  html: string;
  text: string;
}

/** Renders a template to HTML plus a plain-text alternative (both are sent). */
export async function renderEmail(element: ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}
