import { Box, Chip, Typography, Alert } from '@mui/material'
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined'
import { getSizeLabel } from '../config/sizeRules.js'
import { brand } from '../theme/palette.js'

export default function SizeSuggestion({ suggestion, selectedSize, onSelectSize, productId, sizes }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        System က size အကြံပြုပေးပါတယ် — မိမိနှစ်သက်ရာ size ကိုလည်း ရွေးချယ်နိုင်ပါတယ်
      </Typography>

      {suggestion?.suggested && suggestion.confidence !== 'invalid' && (
        <Alert severity="info" icon={<CheckCircleOutlinedIcon fontSize="small" />} sx={{ mb: 1.5 }}>
          {suggestion.message ?? `အကြံပြု: ${getSizeLabel(suggestion.suggested, productId)}`}
        </Alert>
      )}

      {suggestion?.confidence === 'invalid' && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          ကိုယ်အလေးချိန် range ထဲမှာ မရှိပါ — size guide ကို စစ်ဆေးပါ
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {sizes.map((sizeId) => {
          const isSuggested = suggestion?.suggested === sizeId
          const isSelected = selectedSize === sizeId
          return (
            <Chip
              key={sizeId}
              label={
                isSuggested && !isSelected
                  ? `${getSizeLabel(sizeId, productId)} ★`
                  : getSizeLabel(sizeId, productId)
              }
              onClick={() => onSelectSize(sizeId)}
              variant={isSelected ? 'filled' : 'outlined'}
              sx={{
                fontWeight: isSelected ? 700 : 500,
                bgcolor: isSelected ? brand.charcoal : 'transparent',
                color: isSelected ? brand.cream : brand.text,
                borderColor: isSelected ? brand.charcoal : brand.sand,
                '&:hover': {
                  bgcolor: isSelected ? brand.plum : brand.sandLight,
                },
              }}
            />
          )
        })}
      </Box>
    </Box>
  )
}
