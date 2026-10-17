import shop from '../config/shop.json'

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function buildTelegramUrl(message) {
  const username = shop.telegram.replace('@', '')
  return `https://t.me/${username}?text=${encodeURIComponent(message)}`
}

export function buildMessengerUrl(message) {
  return `https://m.me/${shop.messenger}?text=${encodeURIComponent(message)}`
}

export function buildTikTokUrl() {
  const username = shop.tiktok.replace('@', '')
  return `https://www.tiktok.com/@${username}`
}

export async function sendViaChannel(channel, message) {
  switch (channel) {
    case 'telegram': {
      const url = buildTelegramUrl(message)
      window.open(url, '_blank', 'noopener,noreferrer')
      return { success: true, method: 'prefill', url }
    }
    case 'messenger': {
      const url = buildMessengerUrl(message)
      window.open(url, '_blank', 'noopener,noreferrer')
      return { success: true, method: 'prefill', url }
    }
    case 'tiktok': {
      const copied = await copyToClipboard(message)
      const url = buildTikTokUrl()
      window.open(url, '_blank', 'noopener,noreferrer')
      return { success: copied, method: 'copy-open', url, needsPaste: true }
    }
    default:
      return { success: false, method: 'unknown' }
  }
}

export function getChannelInfo(channel) {
  const info = {
    telegram: {
      label: 'Telegram',
      description: 'Message ကို auto-fill လုပ်ပြီး Send နှိပ်ရုံ',
      recommended: true,
    },
    tiktok: {
      label: 'TikTok',
      description: 'Message copy လုပ်ပြီး profile မှာ paste ပို့ပါ',
      recommended: true,
    },
    messenger: {
      label: 'Messenger',
      description: shop.messengerNote,
      recommended: false,
      inactive: true,
    },
  }
  return info[channel]
}
