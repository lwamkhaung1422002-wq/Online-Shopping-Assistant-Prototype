import test from 'node:test'
import assert from 'node:assert/strict'
import { getContrastRatio } from '../dashboard/node_modules/@mui/material/styles/index.js'
import theme from '../dashboard/src/theme/theme.js'
import { brand } from '../dashboard/src/theme/palette.js'

test('Dashboard hierarchy keeps readable body/secondary text and Myanmar line height', () => {
  assert.equal(theme.typography.body1.fontSize, '1rem')
  assert.equal(theme.typography.body1.fontWeight, 400)
  for (const name of ['body2', 'caption', 'subtitle2']) assert.ok(parseFloat(theme.typography[name].fontSize) >= .875)
  for (const name of ['body1', 'body2', 'caption', 'h2', 'h3', 'h4', 'h5', 'h6']) assert.ok(theme.typography[name].lineHeight >= 1.6, name)
  for (const name of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) assert.equal(theme.typography[name].fontWeight, 600)
  assert.ok(theme.typography.h1.fontFamily.includes('Noto Sans Myanmar'))
})
test('small essential text and action colors meet 4.5:1 on actual surfaces', () => {
  for (const background of [brand.cream, brand.ivory, brand.sandLight, brand.white]) {
    for (const foreground of [brand.text, brand.textMuted, brand.roseDeep]) assert.ok(getContrastRatio(foreground, background) >= 4.5, `${foreground} on ${background}`)
  }
  for (const name of ['primary', 'secondary', 'success']) {
    const color = theme.palette[name]
    assert.ok(getContrastRatio(color.main, color.contrastText) >= 4.5, name)
  }
})
