/**
 * SmartCode brand definitions (docs/15-branding.md).
 *
 * The supplied logo in `assets/source/` is the source of truth and is never modified.
 * Files in `assets/web/` and `assets/favicon/` are technical crops/resizes of that original — they are
 * NOT official alternate logos. There is no transparent or dark version: on dark surfaces the original
 * is shown inside a light container (see `LOGO_CONTAINER`).
 */

export const PRODUCT = {
  name: 'SmartCode',
  fullName: 'SmartCode Enterprise',
  tagline: 'Powering Smarter Medical Coding.',
  company: 'SmartClues',
  attribution: 'A SmartClues Technology Product',
} as const;

/** Colours sampled from the logo — confirm against the official SmartClues brand guide. */
export const BRAND_COLORS = {
  navy: '#011030',
  blue: '#0C70F9',
  royal: '#0241B2',
  azure: '#0272DB',
  cyan: '#00AAE6',
  green: '#1FDB92',
  slate: '#6B87A7',
} as const;

export interface LogoAsset {
  /** Path relative to the public brand root (served at `/brand/...` by the web app). */
  path: string;
  width: number;
  height: number;
  alt: string;
}

const LOGO_ALT = `${PRODUCT.name} — ${PRODUCT.tagline} ${PRODUCT.attribution}`;

export const LOGO = {
  /** Untouched original upload (1536 × 410). Kept for archive / source of truth. */
  original: {
    path: 'source/smartcode-horizontal-light.original.png',
    width: 1536,
    height: 410,
    alt: LOGO_ALT,
  },
  /** Original cropped to the artwork with even margin (removes the stray export bar). */
  horizontal: { path: 'web/smartcode-logo-horizontal.png', width: 1192, height: 350, alt: LOGO_ALT },
  /** Same crop at half size for sidebars and emails. */
  horizontalSmall: { path: 'web/smartcode-logo-horizontal@1x.png', width: 596, height: 175, alt: LOGO_ALT },
  /** The "S" mark cropped from the original — collapsed sidebar, mobile header. */
  mark: { path: 'web/smartcode-mark.png', width: 262, height: 262, alt: `${PRODUCT.name} logo mark` },
} as const satisfies Record<string, LogoAsset>;

export const FAVICONS = {
  ico: 'favicon/favicon.ico',
  png16: 'favicon/icon-16.png',
  png32: 'favicon/icon-32.png',
  png48: 'favicon/icon-48.png',
  png192: 'favicon/icon-192.png',
  appleTouch: 'favicon/apple-touch-icon.png',
} as const;

/** SHA-256 of the supplied original logo. A test fails if the file is ever altered. */
export const ORIGINAL_LOGO_SHA256 = '899cc592b4b8d26523f528579f99bcfbe74ff312911738a63a44abe13bad3343';

/** The original artwork has a light background; on dark surfaces render it inside this container. */
export const LOGO_CONTAINER = {
  background: '#FFFFFF',
  borderRadius: 8,
  padding: 8,
} as const;

/** Builds an absolute asset URL (emails, PDFs) from a configured base such as `${APP_URL}/brand`. */
export function brandAssetUrl(baseUrl: string, asset: Pick<LogoAsset, 'path'> | string): string {
  const path = typeof asset === 'string' ? asset : asset.path;
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
