import {
  smaRaw,
  evaluateFormula,
  safeCalculate,
  AnalysisError,
  encodeDecimal,
  decodeDecimal,
} from '../ts/dist/index.js'
import Decimal from 'decimal.js'

const closes = new Float64Array(50)
for (let i = 0; i < 50; i++) closes[i] = 100 + i

console.log('smaRaw(closes, 10):', smaRaw(closes, 10))
console.log('safeCalculate("10/3"):', safeCalculate('10/3'))

const fixture = {
  close: closes,
  open: closes,
  high: new Float64Array(50).map((_, i) => 102 + i),
  low: new Float64Array(50).map((_, i) => 99 + i),
  volume: new Float64Array(50).map((_, i) => i === 48 ? 0 : 1000 + i * 10),
}
async function fetcher(symbol, interval, field) {
  return {
    values: fixture[field],
    source: { symbol, from: '2025-01-01', to: '2025-02-19', bars: 50 },
  }
}

const r = await evaluateFormula("CLOSE('AAPL', '1d')[-1]", fetcher, 4)
console.log('CLOSE[-1]:', r.value, 'dataRange:', r.dataRange)

const r2 = await evaluateFormula("BBANDS(CLOSE('AAPL', '1d'), 20, 2)", fetcher, 2)
console.log('BBANDS:', r2.value)

// Error-class wrapping
try {
  await evaluateFormula("1 / 0", fetcher, 4)
} catch (e) {
  console.log('error class:', e.constructor.name, '/ code:', e.code, '/ msg:', e.message)
  if (!(e instanceof AnalysisError)) {
    console.error('FAIL: expected AnalysisError')
    process.exit(1)
  }
  if (e.code !== 'DIV_BY_ZERO') {
    console.error('FAIL: expected code DIV_BY_ZERO')
    process.exit(1)
  }
}

// Decimal codec
const d = decodeDecimal('123.456')
console.log('decoded Decimal:', d.toString(), '/ encoded:', encodeDecimal(d))

console.log('All TS-adapter smoke tests pass.')
