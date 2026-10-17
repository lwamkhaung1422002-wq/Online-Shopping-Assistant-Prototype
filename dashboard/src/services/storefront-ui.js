import { createContext, useContext } from 'react'
export const StorefrontUiContext = createContext({ searchOpen: false, closeSearch: () => {}, overlayState: { backgroundLocation: { pathname: '/' } } })
export const useStorefrontUi = () => useContext(StorefrontUiContext)
