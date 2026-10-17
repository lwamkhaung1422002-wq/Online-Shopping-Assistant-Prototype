import { getSizeLabel } from '../config/sizeRules.js'

export function formatOrderMessage({ shop, product, order, channel }) {
  const channelLabels = {
    telegram: 'Telegram',
    tiktok: 'TikTok',
    messenger: 'Messenger',
  }

  const lines = [
    `🛒 ${shop.name} — Order အသစ်`,
    '',
    `📦 Product: ${product.name}`,
  ]

  if (order.size) {
    const sizeLabel = getSizeLabel(order.size, product.id)
    let sizeLine = `📏 Size: ${sizeLabel}`
    if (order.suggestedSize && order.suggestedSize !== order.size) {
      sizeLine += ` (System အကြံ: ${getSizeLabel(order.suggestedSize, product.id)})`
    } else if (order.suggestedSize) {
      sizeLine += ` (System အကြံ)`
    }
    lines.push(sizeLine)
  }

  const hasMeasurements = order.bust || order.waist || order.hip
  if (hasMeasurements) {
    const parts = []
    if (order.bust) parts.push(`ရင် ${order.bust}`)
    if (order.waist) parts.push(`ခါး ${order.waist}`)
    if (order.hip) parts.push(`တင် ${order.hip}`)
    lines.push(`📐 Measurements: ${parts.join(' / ')}`)
  }

  if (order.weight) {
    lines.push(`⚖️ Weight: ${order.weight} lb`)
  }

  lines.push(
    '',
    `👤 အမည်: ${order.name}`,
    `🏙️ မြို့: ${order.city}`,
    `📍 လိပ်စာ: ${order.address}`,
    `📱 ဖုန်း: ${order.phone}`,
    '',
    `📲 Source: ${channelLabels[channel] ?? channel}`,
    '---',
    'Webapp မှ order တင်ထားပါတယ်',
  )

  return lines.join('\n')
}
