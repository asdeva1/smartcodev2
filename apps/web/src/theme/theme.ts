'use client';

import { createTheme } from '@mui/material/styles';
import { tokens } from './tokens';

const { color, font, radius } = tokens;

export const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'light',
    primary: { main: color.action, dark: color.actionStrong, contrastText: '#FFFFFF' },
    secondary: { main: color.complete, contrastText: color.ink },
    info: { main: color.progress },
    warning: { main: color.attention },
    error: { main: color.danger },
    success: { main: color.completeInk },
    text: { primary: color.ink, secondary: color.inkMuted },
    background: { default: color.canvas, paper: color.surface },
    divider: color.line,
  },
  shape: { borderRadius: radius.control },
  typography: {
    fontFamily: font.body,
    // Modular scale (ratio 1.25) from a 15px base — dense enough for operational tables, calm for reading.
    fontSize: 15,
    h1: {
      fontFamily: font.heading,
      fontWeight: 600,
      fontSize: '2.44rem',
      lineHeight: 1.15,
      letterSpacing: '-0.01em',
    },
    h2: { fontFamily: font.heading, fontWeight: 600, fontSize: '1.95rem', lineHeight: 1.2 },
    h3: { fontFamily: font.heading, fontWeight: 500, fontSize: '1.56rem', lineHeight: 1.25 },
    h4: { fontFamily: font.heading, fontWeight: 500, fontSize: '1.25rem', lineHeight: 1.3 },
    h5: { fontFamily: font.heading, fontWeight: 500, fontSize: '1.05rem', lineHeight: 1.35 },
    h6: { fontFamily: font.heading, fontWeight: 500, fontSize: '0.95rem', lineHeight: 1.4 },
    body1: { fontSize: '0.95rem', lineHeight: 1.6 },
    body2: { fontSize: '0.875rem', lineHeight: 1.55 },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
    overline: { textTransform: 'none', letterSpacing: 0, fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { fontVariantNumeric: 'tabular-nums' },
        ':focus-visible': { outline: `2px solid ${color.action}`, outlineOffset: 2 },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            transitionDuration: '0.01ms !important',
          },
        },
      },
    },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      // Panels use variant="outlined"; Drawer and AppBar surfaces keep square edges.
      variants: [
        { props: { variant: 'outlined' }, style: { borderColor: color.line, borderRadius: radius.panel } },
      ],
    },
    MuiTextField: { defaultProps: { fullWidth: true } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600, borderRadius: radius.control } } },
  },
});
