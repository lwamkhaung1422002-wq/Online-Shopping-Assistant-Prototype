import { createTheme, alpha } from '@mui/material/styles'
import { brand } from './palette.js'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: brand.charcoal, light: brand.plum, dark: brand.charcoalDeep, contrastText: brand.cream },
    secondary: { main: brand.roseDeep, light: brand.rose, dark: brand.roseDark, contrastText: brand.cream },
    background: { default: brand.ivory, paper: brand.cream },
    text: { primary: brand.text, secondary: brand.textMuted },
    divider: brand.sand,
    success: { main: '#44644F', contrastText: brand.cream },
  },
  typography: {
    fontFamily: '"Noto Sans Myanmar", "Roboto", sans-serif',
    fontSize: 16,
    h1: {
      fontFamily: '"Cormorant Garamond", "Noto Sans Myanmar", Georgia, serif',
      fontSize: 'clamp(2rem, 3vw, 3.25rem)',
      fontWeight: 600,
      letterSpacing: '0.01em',
      lineHeight: 1.5,
      color: brand.text,
    },
    h2: {
      fontFamily: '"Cormorant Garamond", "Noto Sans Myanmar", Georgia, serif',
      fontSize: 'clamp(1.375rem, 2vw, 1.75rem)',
      fontWeight: 600,
      letterSpacing: '0.01em',
      lineHeight: 1.6,
    },
    h3: {
      fontFamily: '"Cormorant Garamond", "Noto Sans Myanmar", Georgia, serif',
      fontSize: '1.35rem',
      fontWeight: 600,
      lineHeight: 1.6,
    },
    h4: { fontSize: 'clamp(1.25rem, 2vw, 1.625rem)', fontWeight: 600, lineHeight: 1.6 },
    h5: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.6 },
    h6: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.65 },
    subtitle1: { fontSize: '1rem', fontWeight: 500, lineHeight: 1.7 },
    subtitle2: { fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.7 },
    body1: { fontSize: '1rem', fontWeight: 400, lineHeight: 1.75 },
    body2: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.75 },
    caption: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.7 },
    overline: { fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.8, letterSpacing: '0.04em' },
    button: { textTransform: 'none', fontWeight: 500, fontSize: '1rem', lineHeight: 1.6, letterSpacing: 0 },
  },
  shape: { borderRadius: 12 },
  shadows: [
    'none',
    '0 1px 2px rgba(37, 36, 32, 0.04)',
    '0 4px 14px rgba(37, 36, 32, 0.06)',
    '0 8px 24px rgba(37, 36, 32, 0.08)',
    ...Array(21).fill('0 8px 24px rgba(37, 36, 32, 0.08)'),
  ],
  components: {
    MuiCssBaseline: { styleOverrides: { body: { lineHeight: 1.75 }, '.MuiTypography-root': { overflowWrap: 'anywhere' } } },
    MuiInputLabel: { styleOverrides: { root: { fontWeight: 500 } } },
    MuiFormHelperText: { styleOverrides: { root: { fontSize: '0.875rem', lineHeight: 1.7 } } },
    MuiTableCell: { styleOverrides: { root: { fontSize: '0.875rem', lineHeight: 1.7 }, head: { fontWeight: 600 } } },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          padding: '13px 28px',
          boxShadow: 'none',
          '&:hover': { boxShadow: '0 4px 14px rgba(37, 36, 32, 0.12)' },
        },
        outlined: {
          borderColor: brand.sand,
          color: brand.text,
          borderWidth: 1.5,
          '&:hover': {
            borderColor: brand.gold,
            backgroundColor: alpha(brand.gold, 0.06),
          },
        },
        text: {
          color: brand.plum,
          '&:hover': { backgroundColor: alpha(brand.rose, 0.08) },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0 10px 30px rgba(37, 36, 32, 0.1)',
          border: `1px solid ${brand.sand}`,
          borderRadius: 16,
          overflow: 'hidden',
          backgroundColor: brand.cream,
          transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
          '&:hover': {
            transform: 'translateY(-4px)',
            boxShadow: '0 18px 42px rgba(37, 36, 32, 0.16)',
            borderColor: brand.goldSoft,
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        outlined: {
          borderColor: brand.sand,
          borderRadius: 14,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontFamily: '"Noto Sans Myanmar", sans-serif',
          borderRadius: 8,
          fontSize: '0.875rem',
          fontWeight: 500,
          height: 'auto',
          minHeight: 32,
          '& .MuiChip-label': { whiteSpace: 'normal', py: .5, lineHeight: 1.7 },
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 12,
            backgroundColor: brand.white,
            '& fieldset': { borderColor: brand.sand },
            '&:hover fieldset': { borderColor: brand.goldSoft },
            '&.Mui-focused fieldset': { borderColor: brand.roseDeep },
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        standardInfo: {
          backgroundColor: brand.sandLight,
          color: brand.text,
          border: `1px solid ${brand.sand}`,
        },
      },
    },
  },
})

export default theme
