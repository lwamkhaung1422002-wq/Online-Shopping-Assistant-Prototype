import { Box, Typography, Paper } from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import ChatIcon from '@mui/icons-material/Chat'
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary'
import FacebookIcon from '@mui/icons-material/Facebook'
import { getChannelInfo } from '../utils/messaging.js'
import { brand } from '../theme/palette.js'

const CHANNELS = [
  { id: 'telegram', icon: SendIcon, tint: '#5B8DEF' },
  { id: 'tiktok', icon: VideoLibraryIcon, tint: brand.charcoal },
  { id: 'messenger', icon: FacebookIcon, tint: '#6B8DD6' },
]

export default function ChannelSelect({ selected, onSelect }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <ChatIcon fontSize="small" sx={{ color: brand.roseDeep }} />
        <Typography variant="h3">ဝယ်ယူမည့် Source</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        ရွေးလိုက်ရင် message က OS ရဲ့ DM မှာ auto-fill ဖြစ်ပါမယ် — Send နှိပ်ရုံ
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {CHANNELS.map(({ id, icon: Icon, tint }) => {
          const info = getChannelInfo(id)
          const isSelected = selected === id
          return (
            <Paper
              key={id}
              component="button"
              type="button"
              aria-pressed={isSelected}
              variant="outlined"
              sx={{
                p: 2,
                width: '100%',
                textAlign: 'left',
                font: 'inherit',
                cursor: 'pointer',
                opacity: info.inactive ? 0.72 : 1,
                borderColor: isSelected ? brand.roseDeep : brand.sand,
                borderWidth: isSelected ? 2 : 1,
                bgcolor: isSelected ? brand.sandLight : brand.cream,
                transition: 'all 0.2s ease',
                boxShadow: isSelected ? '0 4px 16px rgba(166, 107, 110, 0.12)' : 'none',
                '&:hover': { borderColor: brand.rose, bgcolor: brand.sandLight },
              }}
              onClick={() => onSelect(id)}
            >
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 2,
                    bgcolor: brand.sandLight,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px solid ${brand.sand}`,
                  }}
                >
                  <Icon sx={{ color: tint }} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body1" fontWeight={600}>
                    {info.label}
                    {info.inactive && (
                      <Typography
                        component="span"
                        variant="body2"
                        sx={{
                          ml: 1,
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          color: brand.textMuted,
                          border: `1px solid ${brand.sand}`,
                          bgcolor: brand.ivory,
                          px: 0.75,
                          py: 0.25,
                          borderRadius: 1,
                        }}
                      >
                        Active နည်းပါး
                      </Typography>
                    )}
                    {info.recommended && !info.inactive && (
                      <Typography component="span" variant="body2" sx={{ ml: 1, color: brand.gold }}>
                        (အကြံပြု)
                      </Typography>
                    )}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {info.description}
                  </Typography>
                </Box>
              </Box>
            </Paper>
          )
        })}
      </Box>
    </Box>
  )
}
