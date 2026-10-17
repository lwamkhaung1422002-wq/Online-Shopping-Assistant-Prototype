import { useState } from 'react'
import { Link } from 'react-router'
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material'
import { useCart } from '../services/cart-context.js'
import { useStore } from '../services/store-context.js'
import { available, money } from '../../shared/catalog.js'
import {cartKey} from '../../shared/recipe.js'

export default function CartPage() {
  const { lines, update, remove } = useCart(); const { loading, error } = useStore(); const [message, setMessage] = useState('')
  if (loading) return <CircularProgress aria-label="Loading cart" />
  if (error) return <Alert severity="error">Unable to refresh stock. Please try again.</Alert>
  const invalid = lines.some((line) => !line.variant || !line.selection.valid || line.stock_loading || line.quantity > available(line.variant))
  const subtotal = lines.reduce((sum, line) => sum + (line.variant ? line.selected_price * line.quantity : 0), 0)
  return <Stack spacing={3}><Typography variant="h1">Your cart</Typography>{message && <Alert severity="error">{message}</Alert>}
    {lines.map((line) => <Paper key={cartKey(line)} variant="outlined" sx={{ p: 3 }}><Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: "space-between", gap: 2 }}>
      <Box><Typography variant="h6">{line.product?.name || 'Unavailable product'}</Typography>{line.variant && <Typography color="text.secondary">{line.variant.color} / {line.variant.size} · {money(line.selected_price)} · {line.stock_loading?'Checking stock':`${available(line.variant)} available`}</Typography>}{line.selection.options.map(option=><Typography key={option.id} variant="body2">{option.group_name}: {option.name}</Typography>)}{(!line.variant || !line.selection.valid || line.quantity > available(line.variant)) && <Typography color="error">This selection is no longer available. Update or remove the item.</Typography>}{line.stock_error&&<Typography color="error">{line.stock_error}</Typography>}</Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><TextField label="Quantity" type="number" value={line.quantity} sx={{ width: 100 }} slotProps={{ htmlInput: { min: 1, max: line.variant ? Math.min(100, available(line.variant)) : 1 } }} onChange={(e) => { try { update(cartKey(line), Number(e.target.value)); setMessage('') } catch (error) { setMessage(error.message) } }} /><Button color="error" onClick={() => remove(cartKey(line))}>Remove</Button></Stack>
    </Stack></Paper>)}
    {!lines.length && <Typography>Your cart is empty.</Typography>}
    {!!lines.length && <><Typography variant="h6">Subtotal: {money(subtotal)}</Typography><Typography variant="body2" color="text.secondary">Delivery fee is shown at checkout.</Typography><Box><Button component={Link} to="/checkout" variant="contained" disabled={invalid}>Checkout</Button></Box></>}
    <Box><Button component={Link} to="/">Continue shopping</Button></Box>
  </Stack>
}
