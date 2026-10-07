import { LOGO, LOGO_CONTAINER } from '@smartcode/brand';
import Box from '@mui/material/Box';
import Image from 'next/image';

export interface BrandLogoProps {
  /** `horizontal` = full logo with tagline, `mark` = the "S" mark (collapsed sidebar, small headers). */
  variant?: 'horizontal' | 'mark';
  /** Rendered width in px — height follows the original proportions. */
  width?: number;
  /**
   * `dark` places the original logo inside a light container. The supplied logo has a light background and
   * there is no official dark/transparent version, so none is manufactured (docs/15-branding.md).
   */
  surface?: 'light' | 'dark';
  priority?: boolean;
}

export const BRAND_PUBLIC_PATH = '/brand';

/** The official SmartCode logo, served from /brand (synced from packages/brand). Never redrawn or recoloured. */
export function BrandLogo({
  variant = 'horizontal',
  width = 220,
  surface = 'light',
  priority = false,
}: BrandLogoProps) {
  const asset = variant === 'mark' ? LOGO.mark : width <= 300 ? LOGO.horizontalSmall : LOGO.horizontal;
  const height = Math.round((width * asset.height) / asset.width);
  const image = (
    <Image
      src={`${BRAND_PUBLIC_PATH}/${asset.path}`}
      alt={asset.alt}
      width={width}
      height={height}
      priority={priority}
      style={{ display: 'block', width, height: 'auto' }}
    />
  );
  if (surface === 'light') return image;
  return (
    <Box
      data-testid="brand-logo-container"
      sx={{
        display: 'inline-block',
        alignSelf: 'flex-start',
        bgcolor: LOGO_CONTAINER.background,
        borderRadius: `${LOGO_CONTAINER.borderRadius}px`,
        p: `${LOGO_CONTAINER.padding}px`,
        lineHeight: 0,
      }}
    >
      {image}
    </Box>
  );
}
