// Storefront reference palette. POS keeps its independent theme.
export const brand = {
  primary: '#68473d', secondary: '#87584a',
  charcoal: '#24201f', charcoalDeep: '#181615', plum: '#68473d',
  ivory: '#ffffff', cream: '#ffffff', white: '#ffffff',
  sand: '#e8e5e1', sandLight: '#f6f3f0', warm: '#f6f3f0',
  rose: '#bba79b', roseDeep: '#87584a', roseDark: '#68473d',
  gold: '#87584a', goldSoft: '#ece4dd', text: '#24201f', textMuted: '#77716e',
}
export const gradients = {
  header: 'linear-gradient(115deg,#68473d,#87584a)',
  hero: 'linear-gradient(130deg,#fff,#f6f3f0)',
  goldLine: 'linear-gradient(90deg,transparent,#87584a,transparent)',
  featured: 'linear-gradient(135deg,#68473d,#87584a)',
}
export const storefrontWidth = {
  width: { xs: 'calc(100% - 22px)', md: 'calc(100% - 56px)', lg: 'calc(100% - 96px)' },
  maxWidth: 1392, mx: 'auto', minWidth: 0,
  '@media(max-width:360px)': { width: 'calc(100% - 18px)' },
}
