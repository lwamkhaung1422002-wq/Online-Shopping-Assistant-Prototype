import { Alert, Box, Chip } from '@mui/material'
export default function SizeSuggestion({ suggestion, selectedSize, onSelectSize, guide, sizes }) {
  const label = (id) => guide?.sizes.find((size) => size.id === id)?.label || id
  return <Box sx={{ my: 2 }}>
    {suggestion?.suggested && <Alert severity="info" sx={{ mb: 1.5 }}>Suggested fit: {label(suggestion.suggested)}{suggestion.confidence === 'partial' ? ' · Check the size guide' : ''}</Alert>}
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{sizes.map((id) => <Chip key={id} label={label(id)} onClick={() => onSelectSize(id)} color={selectedSize === id ? 'primary' : 'default'} variant={selectedSize === id ? 'filled' : 'outlined'} />)}</Box>
  </Box>
}
