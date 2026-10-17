import { useState } from 'react'
import { Alert, Box, Button, CircularProgress, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import ProductCard from '../components/ProductCard.jsx'
import { useStore } from '../services/store-context.js'
import { sortProducts } from '../../shared/catalog.js'
import { gradients } from '../theme/palette.js'
export default function CatalogPage() {
  const { products, settings, categories, collections, loading, error, configured, refresh } = useStore()
  const [search, setSearch] = useState(''); const [category, setCategory] = useState(''); const [collection, setCollection] = useState(''); const [sort, setSort] = useState('manual')
  if (loading) return <CircularProgress aria-label="Loading collection" />
  if (error) return <Alert severity="error" action={<Button onClick={() => void refresh()}>Retry</Button>}>{error.message || 'The collection is unavailable. Please try again or contact the shop.'}</Alert>
  const rows = sortProducts(products.filter((p) => (p.name + ' ' + p.description).toLowerCase().includes(search.toLowerCase())
    && (!category || p.category_id === category) && (!collection || p.memberships.some((m) => m.collection_id === collection))), sort)
  return <Stack spacing={3}>
    {!configured && <Alert severity="info">Store preview · Online ordering is not available yet.</Alert>}
    <Paper variant="outlined" sx={{ p: { xs: 3, md: 5 }, background: gradients.hero }}><Typography variant="overline" color="secondary">{settings?.store_name}</Typography><Typography variant="h1" gutterBottom>{settings?.hero_title || 'Collection'}</Typography><Typography color="text.secondary" sx={{ maxWidth: 660 }}>{settings?.hero_description}</Typography></Paper>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <TextField label="Search products" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ flex: 1 }} />
      <TextField select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 150 }}><MenuItem value="">All categories</MenuItem>{categories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</TextField>
      {!!collections.length && <TextField select label="Collection" value={collection} onChange={(e) => setCollection(e.target.value)} sx={{ minWidth: 150 }}><MenuItem value="">All collections</MenuItem>{collections.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}</TextField>}
      <TextField select label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} sx={{ minWidth: 170 }}>{[['manual', 'Recommended'], ['newest', 'Newest'], ['oldest', 'Oldest'], ['name', 'Name'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low']].map(([v, label]) => <MenuItem key={v} value={v}>{label}</MenuItem>)}</TextField>
    </Stack>
    <Typography variant="h2">{rows.length} styles</Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,minmax(0,1fr))', lg: 'repeat(3,minmax(0,1fr))' }, gap: 2.5 }}>{rows.map((product) => <ProductCard key={product.id} product={product} />)}</Box>
    {!rows.length && <Typography color="text.secondary">No products found.</Typography>}
  </Stack>
}
