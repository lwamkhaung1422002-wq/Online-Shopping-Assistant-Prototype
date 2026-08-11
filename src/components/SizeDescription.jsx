import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  Box,
} from '@mui/material'
import StraightenIcon from '@mui/icons-material/Straighten'
import { getSizeConfig, NUMBERED_SIZE_RULES, SAKURA_RULES } from '../config/sizeRules.js'
import { brand } from '../theme/palette.js'

function NumberedSizeTable() {
  const rows = [
    { label: 'ရင်', key: 'bust' },
    { label: 'ခါး', key: 'waist' },
    { label: 'တင်', key: 'hip' },
    { label: 'ကိုယ်အလေးချိန် (lb)', key: 'weight' },
    { label: 'အရပ်အမြင့်', key: 'height' },
  ]

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: brand.sandLight }}>
            <TableCell sx={{ fontWeight: 600 }}></TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="center">
              Size 1
            </TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="center">
              Size 2
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell sx={{ fontWeight: 500 }}>{row.label}</TableCell>
              <TableCell align="center">
                {row.key === 'height'
                  ? NUMBERED_SIZE_RULES['size-1'].height
                  : row.key === 'weight'
                    ? `${NUMBERED_SIZE_RULES['size-1'].weight[0]}–${NUMBERED_SIZE_RULES['size-1'].weight[1]}`
                    : `${NUMBERED_SIZE_RULES['size-1'][row.key][0]}–${NUMBERED_SIZE_RULES['size-1'][row.key][1]}`}
              </TableCell>
              <TableCell align="center">
                {row.key === 'height'
                  ? NUMBERED_SIZE_RULES['size-2'].height
                  : row.key === 'weight'
                    ? `${NUMBERED_SIZE_RULES['size-2'].weight[0]}–${NUMBERED_SIZE_RULES['size-2'].weight[1]}`
                    : `${NUMBERED_SIZE_RULES['size-2'][row.key][0]}–${NUMBERED_SIZE_RULES['size-2'][row.key][1]}`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function SakuraSizeTable() {
  const r = SAKURA_RULES
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableBody>
          {[
            ['ရင်', `${r.bust[0]}–${r.bust[1]}`],
            ['ခါး', `${r.waist[0]}–${r.waist[1]}`],
            ['တင်', `${r.hip[0]}–${r.hip[1]}`],
            ['ကိုယ်အလေးချိန် (lb)', `${r.weight[0]}–${r.weight[1]}`],
          ].map(([label, value]) => (
            <TableRow key={label}>
              <TableCell sx={{ fontWeight: 500 }}>{label}</TableCell>
              <TableCell align="right">{value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function WeightOnlyInfo({ productId }) {
  const config = getSizeConfig(productId)
  const [min, max] = config.weightRange
  return (
    <Box sx={{ p: 2, border: `1px solid ${brand.sand}`, borderRadius: 2, bgcolor: brand.sandLight }}>
      <Typography variant="body2">
        Free Size — ကိုယ်အလေးချိန် <strong>{min}–{max} lb</strong>
      </Typography>
    </Box>
  )
}

export default function SizeDescription({ productId }) {
  const config = getSizeConfig(productId)
  if (!config) return null

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <StraightenIcon fontSize="small" />
        <Typography variant="h3">Size Guide</Typography>
      </Box>
      {config.type === 'numbered' && <NumberedSizeTable />}
      {config.type === 'free-with-measurements' && <SakuraSizeTable />}
      {config.type === 'free-weight-only' && <WeightOnlyInfo productId={productId} />}
    </Box>
  )
}
