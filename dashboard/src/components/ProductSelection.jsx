import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {useQuery} from '@tanstack/react-query'
import { Alert, Box, Button, Checkbox, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { Link } from 'react-router'
import MeasurementInputs from './MeasurementInputs.jsx'
import SizeSuggestion from './SizeSuggestion.jsx'
import { useCart } from '../services/cart-context.js'
import { available, money, suggestFromGuide } from '../../shared/catalog.js'
import {recipeSelection} from '../../shared/recipe.js'
import {api} from '../services/client.js'

export default function ProductSelection({ product }) {
  const { add } = useCart()
  const colors = [...new Set(product.variants.map((v) => v.color))]
  const [color, setColor] = useState(colors[0] || '')
  const [size, setSize] = useState(''); const [quantity, setQuantity] = useState(1); const [message, setMessage] = useState(null)
  const [options,setOptions]=useState({})
  const { register, control, handleSubmit, formState: { errors } } = useForm()
  const measurements = useWatch({ control })
  const suggestion = suggestFromGuide(product.guide, measurements)
  const sizes = [...new Set(product.variants.filter((v) => v.color === color).map((v) => v.size))]
  const selectedSize = sizes.includes(size) ? size : sizes.includes(suggestion.suggested) ? suggestion.suggested : sizes.length === 1 ? sizes[0] : ''
  const variant = product.variants.find((v) => v.color === color && v.size === selectedSize)
  const selectedIds=options[variant?.id]||[],selection=recipeSelection(variant,selectedIds)
  const stock=useQuery({queryKey:['public-recipe-stock',variant?.id,[...selectedIds].sort()],enabled:!!variant?.recipe&&selection.valid,queryFn:()=>api(`stock/availability?variant_id=${encodeURIComponent(variant.id)}&modifier_option_ids=${encodeURIComponent([...selectedIds].sort().join(','))}`),refetchInterval:10_000})
  const ready=!variant?.recipe||selection.valid&&stock.isSuccess,currentAvailable=variant?.recipe?(ready?stock.data.available:0):variant?available(variant):0
  const previewSizes = product.guide?.sizes.map((s) => s.id) || []
  function submit(values) {
    try {
      if (!variant) throw new Error('Choose a color and size.')
      if(!ready)throw new Error('Choose the required options and refresh availability before adding this item.')
      const cleaned = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '' && value != null).map(([key, value]) => [key, Number(value)]))
      add({ variant_id: variant.id, quantity: Number(quantity), measurements: cleaned, ...(selectedIds.length?{modifier_option_ids:[...selectedIds].sort()}:{}),stock_available:currentAvailable })
      setMessage({ severity: 'success', text: 'Added to cart.' })
    } catch (error) { setMessage({ severity: 'error', text: error.message }) }
  }
  return <Stack component="form" onSubmit={handleSubmit(submit)} spacing={2}>
    {colors.length > 0 && <TextField label="Color" select value={color} onChange={(e) => { setColor(e.target.value); setSize(''); setMessage(null) }}>{colors.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}</TextField>}
    <MeasurementInputs guide={product.guide} register={register} errors={errors} />
    <SizeSuggestion suggestion={suggestion} selectedSize={selectedSize || size} onSelectSize={setSize} guide={product.guide} sizes={sizes.length ? sizes : previewSizes} />
    {variant?.recipe?.modifier_groups.map(group=><TextField key={group.id} select label={group.name} value={selectedIds.filter(id=>group.options.some(option=>option.id===id))} onChange={event=>{const ids=selectedIds.filter(id=>!group.options.some(option=>option.id===id));setOptions({...options,[variant.id]:[...ids,...event.target.value]});setMessage(null)}} slotProps={{select:{multiple:true,renderValue:ids=>group.options.filter(option=>ids.includes(option.id)).map(option=>option.name).join(', ')}}} helperText={`Choose ${Math.max(group.required?1:0,group.min_select)} to ${group.max_select}`}>{group.options.map(option=><MenuItem key={option.id} value={option.id}><Checkbox checked={selectedIds.includes(option.id)}/>{option.name} ({option.price_delta>=0?'+':''}{money(option.price_delta)})</MenuItem>)}</TextField>)}
    {variant && <><Typography sx={{ fontWeight: 700 }}>{money(variant.recipe?(stock.isSuccess?Math.max(0,stock.data.price):selection.price):variant.price)}</Typography><Typography variant="body2" color={currentAvailable ? 'text.secondary' : 'error'}>{ready?`${currentAvailable} available`:selection.valid?'Checking availability…':'Choose the required options to check availability.'}</Typography><TextField label="Quantity" type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} slotProps={{ htmlInput: { min: 1, max: Math.min(100, currentAvailable), step: 1 } }} /></>}
    {variant?.recipe&&stock.isError&&<Alert severity="error">{stock.error.message}<Button onClick={()=>stock.refetch()}>Retry availability</Button></Alert>}
    {message && <Alert severity={message.severity}>{message.text}</Alert>}
    <Box sx={{ display: 'flex', gap: 2 }}><Button type="submit" variant="contained" disabled={!variant || !ready || currentAvailable === 0}>Add to cart</Button><Button component={Link} to="/cart" variant="outlined">View cart</Button></Box>
  </Stack>
}
