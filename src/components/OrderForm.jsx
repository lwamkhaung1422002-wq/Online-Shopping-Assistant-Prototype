import {
  Box,
  Button,
  TextField,
  Typography,
  Divider,
} from '@mui/material'
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag'
import { useForm, useWatch } from 'react-hook-form'
import { useEffect, useState } from 'react'
import MeasurementInputs from './MeasurementInputs.jsx'
import SizeSuggestion from './SizeSuggestion.jsx'
import ChannelSelect from './ChannelSelect.jsx'
import OrderMessagePreview from './OrderMessagePreview.jsx'
import { getSizeConfig } from '../config/sizeRules.js'
import { suggestSize, validateWeight } from '../utils/sizeSuggestion.js'
import { formatOrderMessage } from '../utils/formatOrder.js'
import { sendViaChannel } from '../utils/messaging.js'
import shop from '../config/shop.json'

const PHONE_REGEX = /^09\d{7,9}$/

export default function OrderForm({ product, onSuccess }) {
  const config = getSizeConfig(product.id)
  const [selectedSize, setSelectedSize] = useState(
    config?.type === 'free-weight-only' || config?.type === 'free-with-measurements'
      ? 'free'
      : '',
  )
  const [suggestion, setSuggestion] = useState(null)
  const [weightError, setWeightError] = useState(null)
  const [channel, setChannel] = useState('')
  const [message, setMessage] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [sendResult, setSendResult] = useState(null)

  const [pendingOrder, setPendingOrder] = useState(null)
  const [sizeTouched, setSizeTouched] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    getValues,
    formState: { errors },
  } = useForm({
    defaultValues: { bust: '', waist: '', hip: '', weight: '' },
  })

  const watched = useWatch({ control })

  useEffect(() => {
    const result = suggestSize(product.id, watched)
    setSuggestion(result)
    if (result.suggested && !sizeTouched && !selectedSize) {
      setSelectedSize(result.suggested)
    }
    if (watched.weight) {
      setWeightError(validateWeight(product.id, watched.weight))
    } else {
      setWeightError(null)
    }
  }, [watched, product.id, selectedSize, sizeTouched])

  const showMeasurements =
    config?.type === 'numbered' || config?.type === 'free-with-measurements'

  const needsSizePicker = config?.type === 'numbered'

  const onSubmit = (data) => {
    if (needsSizePicker && !selectedSize) return
    if (weightError) return

    const order = {
      ...data,
      size: selectedSize || 'free',
      suggestedSize: suggestion?.suggested,
    }

    setPendingOrder(order)
    const msg = formatOrderMessage({ shop, product, order, channel: channel || 'telegram' })
    setMessage(msg)
    setShowPreview(true)
  }

  const handleChannelSelect = async (ch) => {
    setChannel(ch)
    const order =
      pendingOrder ?? {
        ...getValues(),
        size: selectedSize || 'free',
        suggestedSize: suggestion?.suggested,
      }
    const msg = formatOrderMessage({ shop, product, order, channel: ch })
    setMessage(msg)

    const result = await sendViaChannel(ch, msg)
    setSendResult(result)

    if (onSuccess) {
      onSuccess({ product, order, channel: ch, message: msg })
    }
  }

  const handleResend = async () => {
    if (!channel || !message) return
    const result = await sendViaChannel(channel, message)
    setSendResult(result)
  }

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <ShoppingBagIcon fontSize="small" />
        <Typography variant="h3">Order Form</Typography>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {product.name}
      </Typography>

      <MeasurementInputs
        register={register}
        errors={errors}
        showMeasurements={showMeasurements}
        weightError={weightError}
      />

      {needsSizePicker && (
        <SizeSuggestion
          suggestion={suggestion}
          selectedSize={selectedSize}
          onSelectSize={(sizeId) => {
            setSizeTouched(true)
            setSelectedSize(sizeId)
          }}
          productId={product.id}
          sizes={config.sizes}
        />
      )}

      {config?.type === 'free-with-measurements' && (
        <SizeSuggestion
          suggestion={suggestion}
          selectedSize="free"
          onSelectSize={() => setSizeTouched(true)}
          productId={product.id}
          sizes={['free']}
        />
      )}

      <Divider sx={{ my: 2.5 }} />

      <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5 }}>
        ဝယ်ယူသူ အချက်အလက် *
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
        <TextField
          label="အမည်"
          fullWidth
          required
          error={!!errors.name}
          helperText={errors.name?.message}
          {...register('name', {
            required: 'အမည် ထည့်ပါ',
            minLength: { value: 2, message: 'အမည် အနည်းဆုံး ၂ လုံး' },
          })}
        />
        <TextField
          label="မြို့"
          fullWidth
          required
          error={!!errors.city}
          helperText={errors.city?.message}
          {...register('city', { required: 'မြို့ ထည့်ပါ' })}
        />
        <TextField
          label="လိပ်စာ"
          fullWidth
          required
          multiline
          rows={2}
          error={!!errors.address}
          helperText={errors.address?.message}
          {...register('address', { required: 'လိပ်စာ ထည့်ပါ' })}
        />
        <TextField
          label="ဖုန်းနံပါတ်"
          fullWidth
          required
          placeholder="09xxxxxxxxx"
          error={!!errors.phone}
          helperText={errors.phone?.message}
          {...register('phone', {
            required: 'ဖုန်းနံပါတ် ထည့်ပါ',
            pattern: {
              value: PHONE_REGEX,
              message: '09xxxxxxxxx format ထည့်ပါ',
            },
          })}
        />
      </Box>

      {!showPreview ? (
        <Button
          type="submit"
          variant="contained"
          fullWidth
          size="large"
          disabled={!!weightError || (needsSizePicker && !selectedSize)}
        >
          Order တင်မည်
        </Button>
      ) : (
        <>
          <ChannelSelect
            selected={channel}
            onSelect={handleChannelSelect}
          />
          <OrderMessagePreview
            message={message}
            channel={channel}
            sendResult={sendResult}
            onResend={handleResend}
          />
        </>
      )}
    </Box>
  )
}
