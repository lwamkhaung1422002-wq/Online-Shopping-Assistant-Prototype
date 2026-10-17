import { Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import StraightenIcon from '@mui/icons-material/Straighten'
export default function SizeDescription({ guide }) {
  if (!guide) return null
  return <Box sx={{ my: 3 }}><Typography variant="h6" sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}><StraightenIcon fontSize="small" />{guide.name || 'Size guide'}</Typography>
    {guide.fields.length > 0 && <TableContainer component={Paper} variant="outlined"><Table size="small"><TableHead><TableRow><TableCell>Measurement</TableCell>{guide.sizes.map((size) => <TableCell key={size.id}>{size.label}</TableCell>)}</TableRow></TableHead><TableBody>{guide.fields.map((field) => <TableRow key={field.key}><TableCell>{field.label} {field.unit && '(' + field.unit + ')'}</TableCell>{guide.sizes.map((size) => <TableCell key={size.id}>{Array.isArray(size[field.key]) ? size[field.key].join('–') : '—'}</TableCell>)}</TableRow>)}</TableBody></Table></TableContainer>}
    {/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1):9199\/)/.test(guide.image_path || '') && <Box component="img" src={guide.image_path} alt={guide.name} sx={{ maxWidth: '100%', maxHeight: 480, mt: 2, objectFit: 'contain' }} />}
    {guide.notes && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{guide.notes}</Typography>}
  </Box>
}
