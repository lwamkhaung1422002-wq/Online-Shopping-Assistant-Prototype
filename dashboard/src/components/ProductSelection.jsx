import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {useQuery} from '@tanstack/react-query'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Checkbox, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import SizeDescription from './SizeDescription.jsx'
import MeasurementInputs from './MeasurementInputs.jsx'
import SizeSuggestion from './SizeSuggestion.jsx'
import { useCart } from '../services/cart-context.js'
import { available, money, productPrice, suggestFromGuide } from '../../shared/catalog.js'
import {recipeSelection} from '../../shared/recipe.js'
import {api} from '../services/client.js'
import { productOffer, variantOffer } from '../../shared/product-offer.js'

export default function ProductSelection({ product, initialColor, onColorChange, onAdded }) {
  const { add } = useCart()
  const colors = [...new Set(product.variants.map((v) => v.color))]
  const [color, setColor] = useState(colors.includes(initialColor) ? initialColor : colors[0] || '')
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
  const displayPrice = variant ? variant.recipe ? (stock.isSuccess ? Math.max(0,stock.data.price) : selection.price) : variant.price : productPrice(product)
  const offer = variant ? variantOffer(variant) : productOffer(product, color)
  function submit(values) {
    try {
      if (!variant) throw new Error('Choose a color and size.')
      if(!ready)throw new Error('Choose the required options and refresh availability before adding this item.')
      const cleaned = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '' && value != null).map(([key, value]) => [key, Number(value)]))
      add({ variant_id: variant.id, quantity: Number(quantity), measurements: cleaned, ...(selectedIds.length?{modifier_option_ids:[...selectedIds].sort()}:{}),stock_available:currentAvailable })
      setMessage({ severity: 'success', text: 'Added to cart.' }); onAdded?.()
    } catch (error) { setMessage({ severity: 'error', text: error.message }) }
  }
  return <Stack component="form" onSubmit={handleSubmit(submit)} spacing={2}>
    <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 1, mb: .5 }}><Typography sx={{ fontSize: 16, fontWeight: 650, color: offer.saving && !variant?.recipe ? 'primary.main' : 'text.primary' }}>{money(variant ? displayPrice : offer.price)}</Typography>{offer.saving > 0 && !variant?.recipe && <Typography component="del" aria-label="Original price" sx={{ fontSize: 13, color: 'text.secondary' }}>{money(offer.originalPrice)}</Typography>}</Box>
    {product.description && <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.9, whiteSpace: 'pre-wrap', mb: 1 }}>{product.description}</Typography>}
    {colors.length > 0 && <Box><Typography sx={{ fontSize: 12, fontWeight: 700, mb: 1.25 }}>COLOR · {color}</Typography><Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{colors.map(value => <Button key={value} variant="outlined" aria-pressed={color === value} onClick={() => { setColor(value); onColorChange?.(value); setSize(''); setMessage(null) }} sx={{ minHeight: 36, px: 1.5, py: .75, fontSize: 12, fontWeight: 400, borderColor: color === value ? '#24201f' : '#ded9d5', bgcolor: color === value ? '#24201f' : '#fff', color: color === value ? '#fff' : 'text.primary' }}>{value}</Button>)}</Box></Box>}
    <Box><Typography sx={{ fontSize: 12, fontWeight: 700, mb: 1.25 }}>SELECT SIZE</Typography><SizeSuggestion suggestion={suggestion} selectedSize={selectedSize || size} onSelectSize={setSize} guide={product.guide} sizes={sizes.length ? sizes : previewSizes} /></Box>
    <SizeDescription guide={product.guide} />
    {product.guide?.fields?.length > 0 && <Accordion disableGutters elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } }}><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} sx={{ px: 0, minHeight: 44 }}><Typography sx={{ fontSize: 12, fontWeight: 600 }}>Measurements</Typography></AccordionSummary><AccordionDetails sx={{ px: 0 }}><MeasurementInputs guide={product.guide} register={register} errors={errors} /></AccordionDetails></Accordion>}
    {variant?.recipe?.modifier_groups.map(group => <TextField key={group.id} select label={group.name} value={selectedIds.filter(id=>group.options.some(option=>option.id===id))} onChange={event=>{const ids=selectedIds.filter(id=>!group.options.some(option=>option.id===id));setOptions({...options,[variant.id]:[...ids,...event.target.value]});setMessage(null)}} slotProps={{select:{multiple:true,renderValue:ids=>group.options.filter(option=>ids.includes(option.id)).map(option=>option.name).join(', ')}}}>{group.options.map(option=><MenuItem key={option.id} value={option.id}><Checkbox checked={selectedIds.includes(option.id)}/>{option.name} ({option.price_delta>=0?'+':''}{money(option.price_delta)})</MenuItem>)}</TextField>)}
    {variant?.recipe && stock.isError && <Alert severity="error">{stock.error.message}<Button onClick={()=>stock.refetch()}>Retry availability</Button></Alert>}
    {message && <Alert severity={message.severity}>{message.text}</Alert>}
    <Box sx={{ display: 'flex', gap: '11px', pt: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', border: '1px solid', borderColor: 'divider', flexShrink: 0 }}><IconButton aria-label="Decrease quantity" disabled={Number(quantity) <= 1} onClick={() => setQuantity(Math.max(1, Number(quantity) - 1))} sx={{ minWidth: 34, width: 34, minHeight: 45, borderRadius: 0 }}><RemoveRoundedIcon sx={{ fontSize: 16 }} /></IconButton><TextField type="number" value={quantity} onChange={event => setQuantity(event.target.value)} variant="standard" slotProps={{ htmlInput: { 'aria-label': 'Quantity', min: 1, max: Math.min(100,currentAvailable), step: 1, style: { textAlign: 'center', padding: 0, appearance: 'textfield' } }, input: { disableUnderline: true } }} sx={{ width: 32, '& input::-webkit-inner-spin-button': { WebkitAppearance: 'none' } }} /><IconButton aria-label="Increase quantity" disabled={!variant || !ready || Number(quantity) >= Math.min(100,currentAvailable)} onClick={() => setQuantity(Number(quantity) + 1)} sx={{ minWidth: 34, width: 34, minHeight: 45, borderRadius: 0 }}><AddRoundedIcon sx={{ fontSize: 16 }} /></IconButton></Box>
      <Button type="submit" aria-label="Add to cart" variant="contained" disabled={!variant || !ready || currentAvailable === 0} sx={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, letterSpacing: '.04em' }}>{variant && ready && currentAvailable === 0 ? 'SOLD OUT' : 'ADD TO BAG'}</Button>
    </Box>
    {variant && <Typography sx={{ fontSize: 11, color: currentAvailable ? 'text.secondary' : 'error.main' }}>{ready ? currentAvailable + ' available' : selection.valid ? 'Checking availability…' : 'Choose the required options to check availability.'}</Typography>}
  </Stack>
}
