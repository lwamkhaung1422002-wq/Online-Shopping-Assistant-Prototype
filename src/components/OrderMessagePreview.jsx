import { Box, Typography, Button, Paper, Alert } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import SendIcon from '@mui/icons-material/Send'
import { copyToClipboard } from '../utils/messaging.js'
import { brand } from '../theme/palette.js'
import { useState } from 'react'

export default function OrderMessagePreview({ message, channel, sendResult, onResend }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const ok = await copyToClipboard(message)
    setCopied(ok)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!message) return null

  return (
    <Box sx={{ mt: 2 }}>
      {sendResult?.needsPaste && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Message က clipboard မှာ copy လုပ်ပြီးပါပြီ — TikTok profile မှာ paste လုပ်ပြီး Send နှိပ်ပါ
        </Alert>
      )}

      {sendResult?.method === 'prefill' && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Message က DM မှာ auto-fill ဖြစ်ပါပြီ — Send နှိပ်ရုံ
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: brand.sandLight, borderColor: brand.sand }}>
        <Typography
          variant="body2"
          component="pre"
          sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', m: 0, fontSize: '0.8rem' }}
        >
          {message}
        </Typography>
      </Paper>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {channel && (
          <Button
            variant="contained"
            fullWidth
            startIcon={<SendIcon />}
            onClick={onResend}
          >
            ပို့မည်
          </Button>
        )}
        <Button
          variant="outlined"
          fullWidth
          startIcon={<ContentCopyIcon />}
          onClick={handleCopy}
        >
          {copied ? 'Copy ပြီးပါပြီ!' : 'Message Copy'}
        </Button>
      </Box>
    </Box>
  )
}
