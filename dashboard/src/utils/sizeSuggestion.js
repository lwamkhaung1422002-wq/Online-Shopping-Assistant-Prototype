import { getSizeConfig } from '../config/sizeRules.js'

function inRange(value, [min, max]) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return null
  const n = Number(value)
  return n >= min && n <= max
}

function scoreSize(rules, measurements) {
  const { bust, waist, hip, weight } = measurements
  let score = 0
  let checked = 0

  if (bust != null && bust !== '') {
    checked++
    if (inRange(bust, rules.bust)) score++
  }
  if (waist != null && waist !== '') {
    checked++
    if (inRange(waist, rules.waist)) score++
  }
  if (hip != null && hip !== '') {
    checked++
    if (inRange(hip, rules.hip)) score++
  }
  if (weight != null && weight !== '') {
    checked++
    if (inRange(weight, rules.weight)) score++
  }

  return { score, checked, weightMatch: inRange(weight, rules.weight) }
}

export function suggestSize(productId, measurements) {
  const config = getSizeConfig(productId)
  if (!config) return { suggested: null, confidence: null }

  const { bust, waist, hip, weight } = measurements

  if (config.type === 'free-weight-only') {
    const [min, max] = config.weightRange
    const valid = weight != null && weight !== '' && Number(weight) >= min && Number(weight) <= max
    return {
      suggested: 'free',
      confidence: valid ? 'high' : weight ? 'invalid' : null,
      message: valid ? 'Free Size — ကိုယ်အလေးချိန် သင့်တော်ပါသည်' : null,
    }
  }

  if (config.type === 'free-with-measurements') {
    const result = scoreSize(config.rules, measurements)
    const allFilled = bust && waist && hip && weight
    const valid = result.checked > 0 && result.score === result.checked
    return {
      suggested: 'free',
      confidence: allFilled && valid ? 'high' : result.checked > 0 ? 'partial' : null,
      message: valid ? 'Free Size — measurement များ သင့်တော်ပါသည်' : null,
    }
  }

  if (config.type === 'numbered') {
    const sizeIds = config.sizes
    const scores = sizeIds.map((sizeId) => ({
      sizeId,
      ...scoreSize(config.rules[sizeId], measurements),
    }))

    const withWeight = scores.filter((s) => s.weightMatch === true)
    const candidates = withWeight.length > 0 ? withWeight : scores

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.checked - a.checked
    })

    const best = candidates[0]
    if (!best || best.checked === 0) {
      return { suggested: null, confidence: null }
    }

    const allFilled = bust && waist && hip && weight
    const confidence =
      allFilled && best.score === 4 ? 'high' : best.score > 0 ? 'partial' : null

    return {
      suggested: best.sizeId,
      confidence,
      message: confidence ? `အကြံပြု ${config.rules[best.sizeId].label}` : null,
    }
  }

  return { suggested: null, confidence: null }
}

export function validateWeight(productId, weight) {
  const config = getSizeConfig(productId)
  if (!config || weight == null || weight === '') return null

  const w = Number(weight)
  if (Number.isNaN(w)) return 'ကိုယ်အလေးချိန် number ထည့်ပါ'

  if (config.type === 'free-weight-only') {
    const [min, max] = config.weightRange
    if (w < min || w > max) return `ကိုယ်အလေးချိန် ${min}–${max} lb ထဲမှာ ထည့်ပါ`
  }

  if (config.type === 'numbered' || config.type === 'free-with-measurements') {
    const rules = config.type === 'numbered' ? config.rules : config.rules
    const minW = config.type === 'numbered'
      ? Math.min(...Object.values(config.rules).map((r) => r.weight[0]))
      : rules.weight[0]
    const maxW = config.type === 'numbered'
      ? Math.max(...Object.values(config.rules).map((r) => r.weight[1]))
      : rules.weight[1]
    if (w < minW || w > maxW) return `ကိုယ်အလေးချိန် ${minW}–${maxW} lb ထဲမှာ ထည့်ပါ`
  }

  return null
}
