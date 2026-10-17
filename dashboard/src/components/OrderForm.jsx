import { useForm } from 'react-hook-form'
import { Button, Stack, TextField } from '@mui/material'
import { normalizeTrackingPhone } from '../services/tracking-history.js'
// The original customer form now submits a persisted multi-item checkout.
export default function OrderForm({ onSubmit, busy, locked, defaults, children }) {
  const { register, handleSubmit, formState: { errors } } = useForm({ defaultValues: defaults || {} })
  return <Stack component="form" spacing={2} onSubmit={handleSubmit(onSubmit)}>
    <TextField label="အမည် / Name" autoComplete="name" disabled={locked} {...register('name', { required: 'Enter your name', minLength: 2, maxLength: 120 })} error={!!errors.name} helperText={errors.name?.message} />
    <TextField label="ဖုန်း / Phone" type="tel" autoComplete="tel" disabled={locked} {...register('phone', { setValueAs: normalizeTrackingPhone, required: 'Enter your phone', pattern: { value: /^09\d{7,9}$/, message: 'Use a Myanmar 09 phone number' } })} error={!!errors.phone} helperText={errors.phone?.message} />
    <TextField label="မြို့ / City" autoComplete="address-level2" disabled={locked} {...register('city', { required: 'Enter your city', maxLength: 120 })} error={!!errors.city} helperText={errors.city?.message} />
    <TextField label="လိပ်စာ / Delivery address" autoComplete="street-address" multiline rows={3} disabled={locked} {...register('address', { required: 'Enter your address', minLength: { value: 5, message: 'Enter a complete address' }, maxLength: 1000 })} error={!!errors.address} helperText={errors.address?.message} />
    <TextField label="Order note" multiline rows={2} disabled={locked} {...register('note', { maxLength: 1000 })} error={!!errors.note} />
    {children}
    <Button type="submit" variant="contained" size="large" disabled={busy}>{busy ? 'Placing order…' : locked ? 'Retry this order' : 'Place order'}</Button>
  </Stack>
}
