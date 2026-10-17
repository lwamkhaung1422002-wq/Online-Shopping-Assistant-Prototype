import { createTheme } from '@mui/material/styles'
import { brand } from './palette.js'
const serif = 'Georgia, "Times New Roman", "Noto Sans Myanmar", serif'
const theme = createTheme({
  breakpoints: { values: { xs: 0, sm: 600, md: 761, lg: 1121, xl: 1440 } },
  palette: {
    mode: 'light',
    primary: { main: brand.primary, light: brand.secondary, dark: '#50372f', contrastText: '#fff' },
    secondary: { main: brand.secondary, dark: brand.primary, contrastText: '#fff' },
    background: { default: '#fff', paper: '#fff' },
    text: { primary: brand.text, secondary: brand.textMuted }, divider: brand.sand,
    success: { main: '#356443' },
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Arial, "Noto Sans Myanmar", sans-serif',
    fontSize: 14,
    h1: { fontFamily: serif, fontSize: 'clamp(27px,3vw,36px)', fontWeight: 400, lineHeight: 1.18, letterSpacing: '-.03em' },
    h2: { fontFamily: serif, fontSize: 27, fontWeight: 400, lineHeight: 1.3 },
    h3: { fontFamily: serif, fontSize: 17, fontWeight: 400, lineHeight: 1.35 },
    h4: { fontFamily: serif, fontSize: 24, fontWeight: 400 },
    h5: { fontFamily: serif, fontSize: 21, fontWeight: 400 },
    h6: { fontSize: 16, fontWeight: 600, lineHeight: 1.5 },
    body1: { fontSize: 14, lineHeight: 1.75, fontWeight: 400 },
    body2: { fontSize: 13, lineHeight: 1.75, fontWeight: 400 },
    caption: { fontSize: 11, lineHeight: 1.6 },
    button: { fontSize: 13, fontWeight: 600, textTransform: 'none', lineHeight: 1.5 },
  },
  shape: { borderRadius: 0 },
  components: {
    MuiCssBaseline: { styleOverrides: { body: { backgroundColor: '#fff' }, 'img': { display: 'block' }, 'button:focus-visible,a:focus-visible': { outline: '2px solid #8f5c4a', outlineOffset: 3 } } },
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: {
      root: { borderRadius: 0, minHeight: 44, padding: '10px 18px', boxShadow: 'none' },
      outlined: { borderColor: '#d4cbc5', color: brand.text },
      contained: { backgroundColor: brand.charcoal, color: '#fff', '&:hover': { backgroundColor: brand.primary } },
    } },
    MuiIconButton: { styleOverrides: { root: { minWidth: 40, minHeight: 40 } } },
    MuiInputBase: { styleOverrides: { input: { fontSize: 13 } } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 0, backgroundColor: '#fff' }, notchedOutline: { borderColor: '#dcd6d1' } } },
    MuiInputLabel: { styleOverrides: { root: { fontSize: 13 } } },
    MuiPaper: { styleOverrides: { outlined: { borderColor: brand.sand } } },
    MuiCard: { styleOverrides: { root: { boxShadow: 'none', borderRadius: 0, border: 0 } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 0, fontSize: 11, fontWeight: 600 } } },
    MuiTableCell: { styleOverrides: { root: { fontSize: 12, padding: 9, borderColor: brand.sand }, head: { fontWeight: 600 } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 0 } } },
    MuiAlert: { styleOverrides: { root: { fontSize: 13, borderRadius: 0 } } },
  },
})
export default theme
