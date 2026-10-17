import { useQuery } from '@tanstack/react-query'
import { fetchCatalog, fetchSettings, fetchTaxonomy } from '../services/catalog.js'
import { configured } from '../services/client.js'
import { previewProducts, previewSettings } from '../services/preview.js'
import { StoreContext } from '../services/store-context.js'
export default function StoreProvider({ children }) {
  const products = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog, enabled: configured, refetchInterval: 60000, refetchOnWindowFocus: true })
  const settings = useQuery({ queryKey: ['store-settings'], queryFn: fetchSettings, enabled: configured })
  const categories = useQuery({ queryKey: ['store-categories'], queryFn: () => fetchTaxonomy('categories'), enabled: configured })
  const collections = useQuery({ queryKey: ['store-collections'], queryFn: () => fetchTaxonomy('collections'), enabled: configured })
  const queries = [products, settings, categories, collections]
  return <StoreContext.Provider value={{ products: configured ? products.data || [] : previewProducts, settings: configured ? settings.data : previewSettings,
    categories: categories.data || [], collections: collections.data || [], configured,
    loading: configured && queries.some((q) => q.isPending), error: queries.find((q) => q.isError)?.error,
    refresh: () => Promise.all(queries.map(query => query.refetch())) }}>{children}</StoreContext.Provider>
}
