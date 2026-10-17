/** Belle Local logo colors, with deeper copper for readable text on light surfaces. */
export const brand = {
  charcoal: '#252420',
  charcoalDeep: '#171714',
  plum: '#49413D',
  ivory: '#FCF8F5',
  cream: '#FFFCFA',
  sand: '#E7D8CE',
  sandLight: '#F5E9E1',
  rose: '#C8957E',
  roseDeep: '#865542',
  roseDark: '#704634',
  gold: '#C8957E',
  goldSoft: '#E8C8B8',
  text: '#292622',
  textMuted: '#6F625A',
  white: '#FFFFFF',
}

export const gradients = {
  header: `linear-gradient(115deg, ${brand.charcoal} 0%, ${brand.plum} 54%, ${brand.roseDark} 100%)`,
  hero: `linear-gradient(130deg, ${brand.cream} 0%, ${brand.sandLight} 50%, #F0DDD1 100%)`,
  goldLine: `linear-gradient(90deg, transparent, ${brand.gold}, transparent)`,
  featured: `linear-gradient(135deg, ${brand.plum} 0%, ${brand.roseDeep} 52%, ${brand.charcoal} 100%)`,
}
