import { Box, TextField, Typography } from '@mui/material'
import ScaleIcon from '@mui/icons-material/Scale'

export default function MeasurementInputs({ register, errors, showMeasurements, weightError }) {
  return (
    <Box sx={{ mb: 2 }}>
      {showMeasurements && (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            ရင်ခါးတင် သုံးမျိုးလုံး မသိရင် ဖြည့်ထားသလောက်နဲ့ suggestion ပေးပါမယ်
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 1.5, mb: 2 }}>
            <TextField
              label="ရင်"
              type="number"
              size="small"
              {...register('bust')}
              slotProps={{ htmlInput: { min: 0 } }}
            />
            <TextField
              label="ခါး"
              type="number"
              size="small"
              {...register('waist')}
              slotProps={{ htmlInput: { min: 0 } }}
            />
            <TextField
              label="တင်"
              type="number"
              size="small"
              {...register('hip')}
              slotProps={{ htmlInput: { min: 0 } }}
            />
          </Box>
        </>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <ScaleIcon fontSize="small" />
        <Typography variant="body2" fontWeight={600}>
          ကိုယ်အလေးချိန် (lb) *
        </Typography>
      </Box>
      <TextField
        label="lb"
        type="number"
        fullWidth
        size="small"
        required
        error={!!errors.weight || !!weightError}
        helperText={errors.weight?.message || weightError}
        {...register('weight', { required: 'ကိုယ်အလေးချိန် ထည့်ပါ' })}
        slotProps={{ htmlInput: { min: 0 } }}
      />
    </Box>
  )
}
