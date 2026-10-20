import { useStoreLanguage } from '../services/language.js'
import { useState } from 'react'
import { Alert, Box, Button, CircularProgress, IconButton, InputAdornment, MenuItem, Portal, TextField, Typography } from '@mui/material'
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ProductCard from '../components/ProductCard.jsx'
import { useStore } from '../services/store-context.js'
import { useStorefrontUi } from '../services/storefront-ui.js'
import { sortProducts } from '../../shared/catalog.js'
import { storefrontWidth } from '../theme/palette.js'
export default function CatalogPage() {
  const { t } = useStoreLanguage()
  const { products, categories, collections, loading, error, refresh } = useStore()
  const { searchOpen, closeSearch } = useStorefrontUi()
  const [search, setSearch] = useState(''), [category, setCategory] = useState(''), [collection, setCollection] = useState('')
  if (loading) return <CircularProgress aria-label={t('Loading collection')} />
  if (error) return <Alert severity="error" action={<Button onClick={() => void refresh()}>{t('Retry')}</Button>}>{t(error.message || 'The collection is unavailable.')}</Alert>
  const rows = sortProducts(products.filter(p => (p.name + ' ' + p.description).toLowerCase().includes(search.toLowerCase()) && (!category || p.category_id === category) && (!collection || p.memberships.some(m => m.collection_id === collection))), 'manual')
  return <>
    {searchOpen && <Portal container={() => document.getElementById('storefront-search-slot')}><Box id="storefront-search-panel" sx={{ bgcolor: '#fff', borderBottom: '1px solid', borderColor: 'divider', boxShadow: '0 12px 22px rgba(35,28,26,.06)' }}><Box sx={{ ...storefrontWidth, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 42px', gap: { xs: 1, md: 1.5 }, py: { xs: 1.25, md: 1.75 } }}>
      <TextField autoFocus placeholder={t('Search products…')} value={search} onChange={event => setSearch(event.target.value)} size="small" slotProps={{ htmlInput: { 'aria-label': t('Search products') }, input: { startAdornment: <InputAdornment position="start"><SearchOutlinedIcon sx={{ fontSize: 20 }} /></InputAdornment>, endAdornment: search ? <IconButton aria-label={t('Clear search')} size="small" onClick={() => setSearch('')}><CloseRoundedIcon fontSize="small" /></IconButton> : undefined } }} sx={{ '& .MuiOutlinedInput-root': { height: { xs: 44, md: 46 } } }} />
      <IconButton aria-label={t('Close search')} onClick={closeSearch} sx={{ width: 42, height: 44, borderRadius: 0, bgcolor: '#f6f4f2', gridRow: 1, gridColumn: 2 }}><CloseRoundedIcon /></IconButton>
      {(categories.length > 0 || collections.length > 0) && <Box sx={{ gridColumn: '1/-1', display: 'flex', flexWrap: 'wrap', gap: 1 }}>{categories.length > 0 && <TextField select label={t('Category')} size="small" value={category} onChange={event => setCategory(event.target.value)} sx={{ flex: 1, minWidth: 140 }}><MenuItem value="">{t('All categories')}</MenuItem>{categories.map(value => <MenuItem key={value.id} value={value.id}>{value.name}</MenuItem>)}</TextField>}{collections.length > 0 && <TextField select label={t('Collection')} size="small" value={collection} onChange={event => setCollection(event.target.value)} sx={{ flex: 1, minWidth: 140 }}><MenuItem value="">{t('All collections')}</MenuItem>{collections.map(value => <MenuItem key={value.id} value={value.id}>{value.name}</MenuItem>)}</TextField>}</Box>}
    </Box></Box></Portal>}
    <Typography component="h1" sx={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }} aria-live="polite">{t('{count} styles', { count: rows.length })}</Typography>
    <Box component="section" aria-label={t('Products')} sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,minmax(0,1fr))', md: 'repeat(3,minmax(0,1fr))', lg: 'repeat(4,minmax(0,1fr))' }, columnGap: { xs: '10px', md: '16px', lg: '19px' }, rowGap: { xs: '25px', md: '36px' } }}>{rows.map(product => <ProductCard key={product.id} product={product} />)}</Box>
    {!rows.length && <Box sx={{ border: '1px solid', borderColor: 'divider', p: '65px 22px', textAlign: 'center' }}><Typography variant="h2" sx={{ mb: 2 }}>{t('No matching styles')}</Typography><Button variant="outlined" onClick={() => { setSearch(''); setCategory(''); setCollection('') }}>{t('Show all products')}</Button></Box>}
  </>
}
