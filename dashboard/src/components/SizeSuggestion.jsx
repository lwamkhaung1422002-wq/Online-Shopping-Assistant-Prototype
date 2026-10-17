import { Box, Button } from '@mui/material'
export default function SizeSuggestion({ suggestion, selectedSize, onSelectSize, guide, sizes }) {
  const label = id => guide?.sizes.find(size => size.id === id)?.label || id
  return <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{sizes.map(id => <Button key={id} variant="outlined" aria-pressed={selectedSize === id} title={suggestion?.suggested === id ? 'Suggested fit' : undefined} onClick={() => onSelectSize(id)} sx={{ minWidth: 51, minHeight: 39, px: '13px', py: '10px', fontSize: 12, fontWeight: 400, borderColor: selectedSize === id ? '#24201f' : '#ded9d5', bgcolor: selectedSize === id ? '#24201f' : '#fff', color: selectedSize === id ? '#fff' : 'text.primary', '&:hover': { bgcolor: selectedSize === id ? '#24201f' : '#f6f3f0' } }}>{label(id)}</Button>)}</Box>
}
