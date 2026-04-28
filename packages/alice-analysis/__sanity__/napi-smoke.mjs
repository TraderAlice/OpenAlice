// Smoke test for the napi surface. Run with the Homebrew Node:
//   /opt/homebrew/bin/node packages/alice-analysis/__sanity__/napi-smoke.mjs

// Wire-decimal codec moved to @traderalice/alice-decimal (task #11). Its smoke
// test lives at `packages/alice-decimal/__sanity__/smoke.mjs`. This script
// covers analysis-only napi exports.
import {
  smaRaw,
  evaluateFormula,
  safeCalculate,
} from '../index.js'

const eq = (label, got, want) => {
  if (Number.isFinite(want) && Math.abs(got - want) > 1e-9) {
    console.error(`FAIL ${label}: got ${got}, want ${want}`)
    process.exit(1)
  }
  if (typeof want === 'string' && got !== want) {
    console.error(`FAIL ${label}: got ${got}, want ${want}`)
    process.exit(1)
  }
  console.log(`OK   ${label}: ${got}`)
}

// 1) raw kernel
const closes = new Float64Array(50)
for (let i = 0; i < 50; i++) closes[i] = 100 + i
eq('smaRaw(closes, 10)', smaRaw(closes, 10), 144.5)

// 2) safeCalculate
eq('safeCalculate("1/3+1/3+1/3")', safeCalculate('1/3+1/3+1/3'), 1.0)

// 3) full formula via evaluateFormula
const fixture = (() => {
  const close = new Float64Array(50)
  const open = new Float64Array(50)
  const high = new Float64Array(50)
  const low = new Float64Array(50)
  const volume = new Float64Array(50)
  for (let i = 0; i < 50; i++) {
    close[i] = 100 + i
    open[i] = 100 + i
    high[i] = 102 + i
    low[i] = 99 + i
    volume[i] = i === 48 ? 0 : 1000 + i * 10
  }
  return { close, open, high, low, volume }
})()

async function fetcher(symbol, interval, field) {
  const values = fixture[field]
  if (!values) throw new Error(`no field ${field}`)
  return {
    values,
    source: { symbol, from: '2025-01-01', to: '2025-02-19', bars: 50 },
  }
}

const r1 = await evaluateFormula("CLOSE('AAPL', '1d')[-1]", fetcher, 4)
eq('formula CLOSE[-1]', r1.n, 149)
console.log('   dataRange:', JSON.stringify(r1.dataRange))

const r2 = await evaluateFormula("SMA(CLOSE('AAPL', '1d'), 10)", fetcher, 4)
eq('formula SMA(close,10)', r2.n, 144.5)

const r3 = await evaluateFormula("BBANDS(CLOSE('AAPL', '1d'), 20, 2)", fetcher, 4)
console.log('   BBANDS:', JSON.stringify(r3.o))
if (!(r3.o.upper > r3.o.middle && r3.o.middle > r3.o.lower)) {
  console.error('FAIL BBANDS not monotonic')
  process.exit(1)
}

// 5) error path
try {
  await evaluateFormula('1 / 0', fetcher, 4)
  console.error('FAIL expected div-by-zero error')
  process.exit(1)
} catch (e) {
  console.log(`OK   div-by-zero throws: ${e.message}`)
}

console.log('\nAll napi smoke tests pass.')
