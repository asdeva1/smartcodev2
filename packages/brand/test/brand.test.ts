import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import tokens from '../tokens.json' with { type: 'json' };
import { BRAND_COLORS, FAVICONS, LOGO, ORIGINAL_LOGO_SHA256, brandAssetUrl } from '../src/index.js';

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('brand assets', () => {
  it('the supplied original logo is untouched', () => {
    const hash = createHash('sha256')
      .update(readFileSync(join(assetsDir, LOGO.original.path)))
      .digest('hex');
    expect(hash).toBe(ORIGINAL_LOGO_SHA256);
  });

  it.each(Object.entries(LOGO))(
    '%s exists with the declared dimensions (proportions preserved)',
    (_, asset) => {
      expect(pngSize(join(assetsDir, asset.path))).toEqual({ width: asset.width, height: asset.height });
    },
  );

  it('horizontal crops keep the same aspect ratio', () => {
    expect(LOGO.horizontal.width / LOGO.horizontal.height).toBeCloseTo(
      LOGO.horizontalSmall.width / LOGO.horizontalSmall.height,
      2,
    );
  });

  it.each(Object.values(FAVICONS))('favicon %s exists', (path) => {
    expect(existsSync(join(assetsDir, path))).toBe(true);
  });

  it('colour tokens match tokens.json', () => {
    expect(BRAND_COLORS).toEqual(tokens.color);
  });

  it('builds absolute asset URLs from configuration', () => {
    expect(brandAssetUrl('http://localhost:3000/brand/', LOGO.horizontalSmall)).toBe(
      'http://localhost:3000/brand/web/smartcode-logo-horizontal@1x.png',
    );
    expect(brandAssetUrl('https://app.example.test/brand', '/favicon/icon-32.png')).toBe(
      'https://app.example.test/brand/favicon/icon-32.png',
    );
  });
});
