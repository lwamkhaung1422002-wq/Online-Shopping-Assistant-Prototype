import { Box, Typography, Paper, Divider } from '@mui/material'
import { getSizeLabel } from '../config/sizeRules.js'

export default function OrderSummary({ order, product, channel }) {
  if (!order) return null

  const channelLabels = {
    telegram: 'Telegram',
    tiktok: 'TikTok',
    messenger: 'Messenger',
  }

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Typography variant="h3" gutterBottom>
        Order Summary
      </Typography>
      <Divider sx={{ my: 1.5 }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Row label="Product" value={product?.name} />
        {order.size && (
          <Row label="Size" value={getSizeLabel(order.size, product?.id)} />
        )}
        {order.weight && <Row label="Weight" value={`${order.weight} lb`} />}
        <Row label="အမည်" value={order.name} />
        <Row label="မြို့" value={order.city} />
        <Row label="လိပ်စာ" value={order.address} />
        <Row label="ဖုန်း" value={order.phone} />
        {channel && <Row label="Source" value={channelLabels[channel]} />}
      </Box>
    </Paper>
  )
}

function Row({ label, value }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={500} textAlign="right">
        {value}
      </Typography>
    </Box>
  )
}
