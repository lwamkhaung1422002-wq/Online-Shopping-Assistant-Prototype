import { useEffect, useRef, useState } from 'react'
import { Alert, Box } from '@mui/material'

const scriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise
function loadScript() {
  if (window.turnstile) return Promise.resolve()
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = scriptUrl; script.async = true
    script.onload = resolve; script.onerror = () => { scriptPromise = undefined; reject(new Error('Verification could not load. Please refresh.')) }
    document.head.appendChild(script)
  })
  return scriptPromise
}
export default function CheckoutVerification({ onToken, resetKey }) {
  const container = useRef(null); const callback = useRef(onToken); const [error, setError] = useState('')
  useEffect(() => { callback.current = onToken }, [onToken])
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY
  useEffect(() => {
    if (!siteKey) return
    let alive = true; let widget
    loadScript().then(() => {
      if (!alive) return
      widget = window.turnstile.render(container.current, { sitekey: siteKey, action: 'checkout', theme: 'light',
        callback: (token) => { setError(''); callback.current(token) }, 'expired-callback': () => callback.current(''),
        'error-callback': () => { callback.current(''); setError('Verification failed. Please refresh and try again.') },
      })
    }).catch((error) => { if (alive) setError(error.message) })
    return () => { alive = false; if (widget != null) window.turnstile?.remove(widget) }
  }, [siteKey, resetKey])
  return <Box>{error && <Alert severity="error">{error}</Alert>}<Box ref={container} /></Box>
}
