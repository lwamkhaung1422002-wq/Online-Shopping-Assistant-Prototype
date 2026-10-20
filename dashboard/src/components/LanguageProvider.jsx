import { useCallback, useEffect, useMemo, useState } from 'react'
import { LanguageContext } from '../services/language.js'
import { translate } from '../services/translations.js'

export default function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    try { return localStorage.getItem('belle-dashboard-language') === 'my' ? 'my' : 'en' } catch { return 'en' }
  })
  useEffect(() => {
    document.documentElement.lang = language
    try { localStorage.setItem('belle-dashboard-language', language) } catch { /* Language still works in memory. */ }
  }, [language])
  const t = useCallback((key, values) => translate(language, key, values), [language])
  const value = useMemo(() => ({ language, setLanguage, t, dateLocale: language === 'my' ? 'my-MM' : 'en-US' }), [language, t])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
