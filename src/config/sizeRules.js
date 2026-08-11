export const NUMBERED_SIZE_RULES = {
  'size-1': {
    label: 'Size 1',
    bust: [32, 36],
    waist: [24, 28],
    hip: [35, 37],
    weight: [100, 125],
    height: "4'11\" – 5'4\"",
  },
  'size-2': {
    label: 'Size 2',
    bust: [35, 40],
    waist: [26, 32],
    hip: [38, 44],
    weight: [125, 145],
    height: "4'11\" – 5'4\"",
  },
}

export const SAKURA_RULES = {
  label: 'Free Size',
  bust: [33, 36],
  waist: [22, 30],
  hip: [34, 40],
  weight: [100, 135],
}

export const PRODUCT_SIZE_CONFIG = {
  elegence: {
    type: 'numbered',
    rules: NUMBERED_SIZE_RULES,
    sizes: ['size-1', 'size-2'],
  },
  'elegence-short': {
    type: 'numbered',
    rules: NUMBERED_SIZE_RULES,
    sizes: ['size-1', 'size-2'],
  },
  sakura: {
    type: 'free-with-measurements',
    rules: SAKURA_RULES,
    sizes: ['free'],
  },
  'lovi-floral': {
    type: 'free-weight-only',
    weightRange: [90, 140],
    sizes: ['free'],
  },
  'pele-top': {
    type: 'free-weight-only',
    weightRange: [100, 125],
    sizes: ['free'],
  },
}

export function getSizeConfig(productId) {
  return PRODUCT_SIZE_CONFIG[productId] ?? null
}

export function getSizeLabel(sizeId, productId) {
  const config = getSizeConfig(productId)
  if (!config) return sizeId
  if (config.type === 'free-weight-only' || sizeId === 'free') {
    return config.rules?.label ?? 'Free Size'
  }
  return config.rules[sizeId]?.label ?? sizeId
}
