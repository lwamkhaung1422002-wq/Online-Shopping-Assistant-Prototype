import { Box, TextField, Typography } from '@mui/material'
export default function MeasurementInputs({ guide, register, errors = {} }) {
  if (!guide?.fields?.length) return null
  return <Box sx={{ my: 2 }}><Typography variant="body2" sx={{ mb: 1.5 }}>Measurements for size suggestion (optional)</Typography>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3,1fr)' }, gap: 1.5 }}>
      {guide.fields.map((field) => <TextField key={field.key} label={field.label + (field.unit ? ' (' + field.unit + ')' : '')} type="number" size="small"
        slotProps={{ htmlInput: { min: 0, max: 10000, step: 'any' } }} {...register(field.key, { min: 0, max: 10000 })}
        error={!!errors[field.key]} helperText={errors[field.key] && 'Enter a valid measurement'} />)}
    </Box>
  </Box>
}
