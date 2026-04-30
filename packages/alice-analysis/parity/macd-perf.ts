// MACD perf benchmark — measures the O(N²) signal computation cost on the
// longest fixture (2000 bars). Reports min/median/max over 20 runs after a
// 2-iter warmup. Used by `_rust-port/03-parity.md` to justify the perf claim.
//
// Run with:
//   /opt/homebrew/bin/node node_modules/.bin/tsx packages/alice-analysis/parity/macd-perf.ts

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { IndicatorCalculator } from '@/domain/analysis/indicator/calculator.js'
import type { IndicatorContext } from '@/domain/analysis/indicator/types.js'

const here = dirname(fileURLToPath(import.meta.url))
const fx = JSON.parse(readFileSync(resolve(here, 'fixtures', 'long_2000bar.json'), 'utf8'))
const ctx: IndicatorContext = {
  getHistoricalData: async (symbol) => ({
    data: fx.data,
    meta: { symbol, from: fx.from, to: fx.to, bars: fx.bars },
  }),
}

async function bench(impl: 'ts' | 'rust', n: number) {
  process.env.ALICE_RUST_INDICATORS = impl === 'rust' ? '*' : ''
  for (let i = 0; i < 2; i++) await new IndicatorCalculator(ctx).calculate("MACD(CLOSE('LONG','1d'),12,26,9)", 4)
  const ts: number[] = []
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime.bigint()
    await new IndicatorCalculator(ctx).calculate("MACD(CLOSE('LONG','1d'),12,26,9)", 4)
    const t1 = process.hrtime.bigint()
    ts.push(Number(t1 - t0) / 1e6)
  }
  ts.sort((a, b) => a - b)
  return { min: ts[0], median: ts[Math.floor(ts.length / 2)], max: ts[ts.length - 1] }
}

async function main() {
  const tsRes = await bench('ts', 20)
  const rustRes = await bench('rust', 20)
  console.log('TS  MACD 2000-bar:', JSON.stringify(tsRes))
  console.log('Rust MACD 2000-bar:', JSON.stringify(rustRes))
  console.log('Rust speedup (median):', (tsRes.median / rustRes.median).toFixed(2) + 'x')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
