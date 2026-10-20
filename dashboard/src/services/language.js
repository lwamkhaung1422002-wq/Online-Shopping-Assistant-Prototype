import { createContext, useContext } from 'react'
import { translate } from './translations.js'

export const LanguageContext = createContext({ language: 'en', setLanguage: () => {}, dateLocale: 'en-US', t: (key, values) => translate('en', key, values) })
export function useStoreLanguage() {
  const value = useContext(LanguageContext)
  if (!value) throw new Error('LanguageProvider is required.')
  return value
}
