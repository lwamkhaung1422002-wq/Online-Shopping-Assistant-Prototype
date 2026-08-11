import { useLocation, useNavigate } from 'react-router'
import { Box, Typography, Button } from '@mui/material'
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined'
import HomeIcon from '@mui/icons-material/Home'
import OrderSummary from '../components/OrderSummary.jsx'
import OrderMessagePreview from '../components/OrderMessagePreview.jsx'
import { useState } from 'react'
import { sendViaChannel } from '../utils/messaging.js'

export default function SuccessPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { product, order, channel, message } = location.state ?? {}
  const [sendResult, setSendResult] = useState(null)

  if (!product || !order) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography>Order မတွေ့ပါ</Typography>
        <Button onClick={() => navigate('/')} sx={{ mt: 2 }} startIcon={<HomeIcon />}>
          ပင်မစာမျက်နှာ
        </Button>
      </Box>
    )
  }

  const handleResend = async () => {
    if (!channel || !message) return
    const result = await sendViaChannel(channel, message)
    setSendResult(result)
  }

  return (
    <Box>
      <Box sx={{ textAlign: 'center', mb: 3 }}>
        <CheckCircleOutlinedIcon sx={{ fontSize: 48, mb: 1 }} />
        <Typography variant="h1" gutterBottom>
          Order တင်ပြီးပါပြီ
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Message က OS ထံ ပို့ပြီးပါပြီ — Send နှိပ်ရုံ (သို့) paste လုပ်ရုံ
        </Typography>
      </Box>

      <OrderSummary order={order} product={product} channel={channel} />

      {message && (
        <Box sx={{ mt: 3 }}>
          <OrderMessagePreview
            message={message}
            channel={channel}
            sendResult={sendResult}
            onResend={handleResend}
          />
        </Box>
      )}

      <Button
        variant="contained"
        fullWidth
        startIcon={<HomeIcon />}
        onClick={() => navigate('/')}
        sx={{ mt: 3 }}
      >
        ပင်မစာမျက်နှာ
      </Button>
    </Box>
  )
}
