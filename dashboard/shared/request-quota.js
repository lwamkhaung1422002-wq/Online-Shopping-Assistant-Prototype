// Retry-After is a minimum backoff, not a promise that Firebase has recovered.
export function createQuotaBackoff({ now = Date.now } = {}) {
  let until = 0, failure
  return {
    check() {
      if (now() < until) throw failure
    },
    note(response, error) {
      if (error?.code !== 'FIRESTORE_QUOTA_EXCEEDED') return
      const value = response.headers?.get?.('Retry-After')
      const seconds = value ? Number(value) : NaN
      const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 300_000
      until = Math.max(until, now() + Math.min(delay, 86_400_000))
      failure = error
    },
  }
}
