import { useEffect, useState } from 'react'
import {useQueries} from '@tanstack/react-query'
import { useStore } from '../services/store-context.js'
import { CartContext } from '../services/cart-context.js'
import { api,shopId } from '../services/client.js'
import { addCartItem, cleanCart } from '../../shared/cart.js'
import { available } from '../../shared/catalog.js'
import {cartKey,recipeSelection} from '../../shared/recipe.js'
const storageKey = `os-cart:${shopId || 'preview'}`
export default function CartProvider({ children }) {
  const { products, configured } = useStore()
  const [cart, setCart] = useState(() => { try { return cleanCart(JSON.parse(localStorage.getItem(storageKey) || '[]')) } catch { return [] } })
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(cart)) } catch { /* Keep an in-memory cart when storage is blocked. */ } }, [cart])
  const resolve = (id) => { for (const product of products) { const variant = product.variants.find((v) => v.id === id); if (variant) return { product, variant } } return null }
  function add(item) {
    if (!configured) throw new Error('Online ordering is not available yet.')
    const match = resolve(item.variant_id)
    if (!match) throw new Error('This variant is no longer available.')
    if(!recipeSelection(match.variant,item.modifier_option_ids).valid)throw new Error('Choose the required recipe options.')
    setCart(cleanCart(addCartItem(cart, item, item.stock_available??available(match.variant))))
  }
  function update(key, quantity) {
    const line=cart.find(line=>cartKey(line)===key),match=resolve(line?.variant_id)
    const current=lines.find(line=>cartKey(line)===key)
    if (!match || current?.stock_loading || !Number.isInteger(quantity) || quantity < 1 || quantity > Math.min(100, available(current?.variant||match.variant))) throw new Error('Quantity exceeds current available stock.')
    setCart(cart.map((line) => cartKey(line) === key ? { ...line, quantity } : line))
  }
  const resolved=cart.map(line=>({...line,...resolve(line.variant_id)}))
  const quotes=useQueries({queries:resolved.map(line=>({queryKey:['public-recipe-stock',line.variant_id,[...(line.modifier_option_ids||[])].sort()],enabled:configured&&!!line.variant?.recipe&&recipeSelection(line.variant,line.modifier_option_ids).valid,queryFn:()=>api(`stock/availability?variant_id=${encodeURIComponent(line.variant_id)}&modifier_option_ids=${encodeURIComponent([...(line.modifier_option_ids||[])].sort().join(','))}`),refetchInterval:query=>query.state.error?.code==='FIRESTORE_QUOTA_EXCEEDED'?false:10_000}))})
  const lines = resolved.map((line,index)=>{const choice=recipeSelection(line.variant,line.modifier_option_ids),quote=quotes[index];return {...line,selection:choice,stock_loading:!!line.variant?.recipe&&!quote.isSuccess,stock_error:line.variant?.recipe&&quote.isError?quote.error.message:null,selected_price:choice.price,...(line.variant?.recipe&&quote.isSuccess?{variant:{...line.variant,available:quote.data.available},selected_price:Math.max(0,quote.data.price)}:{})}})
  return <CartContext.Provider value={{ cart, lines, add, update, remove: (key) => setCart(cart.filter((line) => cartKey(line) !== key)), clear: () => setCart([]), count: cart.reduce((sum, line) => sum + line.quantity, 0) }}>{children}</CartContext.Provider>
}
