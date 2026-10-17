import { Accordion, AccordionDetails, AccordionSummary, Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
export default function SizeDescription({ guide }) {
  if (!guide) return null
  return <Accordion disableGutters elevation={0} sx={{ mt: 2, borderTop: 0, borderBottom: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } }}>
    <AccordionSummary expandIcon={<AddRoundedIcon fontSize="small" />} sx={{ p: 0, minHeight: 48, '& .MuiAccordionSummary-content': { my: 1 } }}><Typography sx={{ fontSize: 12, fontWeight: 700 }}>SIZE GUIDE</Typography></AccordionSummary>
    <AccordionDetails sx={{ px: 0, pt: 0 }}>{guide.fields.length > 0 && <TableContainer><Table size="small" aria-label={guide.name || 'Size guide'}><TableHead><TableRow><TableCell>Size</TableCell>{guide.fields.map(field => <TableCell key={field.key}>{field.label}{field.unit ? ' (' + field.unit + ')' : ''}</TableCell>)}</TableRow></TableHead><TableBody>{guide.sizes.map(size => <TableRow key={size.id}><TableCell component="th" scope="row">{size.label}</TableCell>{guide.fields.map(field => <TableCell key={field.key}>{Array.isArray(size[field.key]) ? size[field.key].join('–') : '—'}</TableCell>)}</TableRow>)}</TableBody></Table></TableContainer>}
      {/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1):9199\/)/.test(guide.image_path || '') && <Box component="img" src={guide.image_path} alt={guide.name} sx={{ maxWidth: '100%', maxHeight: 480, mt: 2, objectFit: 'contain' }} />}
      {guide.notes && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{guide.notes}</Typography>}
    </AccordionDetails>
  </Accordion>
}
