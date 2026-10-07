# 15 — Branding

The logo supplied by SmartClues is the **branding source of truth**. It is stored unmodified and every other asset is a straight crop/resize of it — nothing is redrawn, recoloured or regenerated.

## Assets (`packages/brand/assets`)

| File                                                                       | What it is                                                    | Use                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `source/smartcode-horizontal-light.original.png`                           | Original upload, 1536 × 410, untouched                        | Archive / source of truth                                            |
| `web/smartcode-logo-horizontal.png`                                        | Original cropped to the artwork with even margin (1192 × 350) | Login, activation, reset, landing page, header, reports, PDF, emails |
| `web/smartcode-logo-horizontal@1x.png`                                     | Same, half size (596 × 175)                                   | Sidebar (expanded), emails                                           |
| `web/smartcode-mark.png`                                                   | The "S" mark cropped from the original (262 × 262)            | Collapsed sidebar, mobile header, app icon                           |
| `favicon/favicon.ico`, `icon-16/32/48/180/192.png`, `apple-touch-icon.png` | Downscaled from the mark                                      | Browser tab, bookmarks, PWA manifest                                 |

Proportions are always preserved (`object-fit: contain`, width or height set, never both).

## Observations on the supplied file (D-13)

1. **Light background, no transparency** — the file is RGB on an off-white background. **Final rule:** on any dark surface the original logo is placed inside a light logo container (`BrandLogo` component, `surface="dark"`). No transparent or dark version is manufactured. The crops in `web/` and `favicon/` are technical derivatives, **not** official alternate logos.
2. **Stray dark bar** — the original has a dark strip along the bottom-left edge (~3 px, x 0–760). It looks like an export artefact, so the cropped web asset excludes it. The original is kept unchanged.
3. **Largest icon** — the mark is only 262 px in the source, so 512 px PWA icons are not produced (upscaling would blur). A higher-resolution or vector (SVG) original would fix this.

## Colour tokens (sampled from the logo — confirm against official brand guide)

| Token         | Hex       | Sampled from                                            |
| ------------- | --------- | ------------------------------------------------------- |
| `brand.navy`  | `#011030` | "SMART" wordmark                                        |
| `brand.blue`  | `#0C70F9` | "SmartClues" in tagline                                 |
| `brand.royal` | `#0241B2` | S mark (deep blue)                                      |
| `brand.azure` | `#0272DB` | "CODE" wordmark (blue)                                  |
| `brand.cyan`  | `#00AAE6` | S mark / "CODE" (cyan)                                  |
| `brand.green` | `#1FDB92` | S mark (green)                                          |
| `brand.slate` | `#6B87A7` | tagline (anti-aliased sample; true value likely darker) |

These become the MUI theme (`primary` = blue, `secondary` = green, text = navy) in Phase 1, with contrast checked for WCAG AA.

## Where the logo appears

Login · Activation · Password reset · Public landing page · Sidebar · Header · Manager / Vendor / Team Lead / Auditor / Coder dashboards (via the shared app shell) · Reports (screen header) · PDF reports (header) · Email templates (header, absolute URL from `BRAND_ASSET_BASE_URL`) · Favicon / app icon.
