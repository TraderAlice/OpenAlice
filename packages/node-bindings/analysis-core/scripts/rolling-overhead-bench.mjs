#!/usr/bin/env node
// analysis_core finite-`number[]` rolling-window moving-average overhead
// benchmark (OPE-20).
//
// Measures per-call cost across two paths for `SMA` and `EMA` over arrays
// of size N at multiple periods:
//
//   - "ts"     : in-process TypeScript moving averages (mirror of the
//                legacy statistics module after `toValues(...)`).
//   - "napi"   : Rust kernel via `movingAverageSync` (the OPE-20 path).
//
// The benchmark is intentionally not a microbench against the inner
// loop in isolation — the production caller in `statistics.ts` always
// has a plain `number[]` after `toValues(...)`, and the Rust route also
// pays the JS-array → `Float64Array` copy on each call. We replicate
// that copy in the napi path so the recorded numbers reflect the real
// overhead a caller will see.
//
// Output:
//   - tab-separated summary on stdout
//   - JSON object (last line) for downstream tooling
//   - optional `--out path.json` writes the same JSON object to disk
//
// Usage:
//   node packages/node-bindings/analysis-core/scripts/rolling-overhead-bench.mjs \
//     [--iterations N] [--warmup N] [--size N ...] [--period N ...] [--kind SMA|EMA ...] [--out path.json]

import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')

function parseArgs(argv) {
  const out = {
    iterations: 5_000,
    warmup: 500,
    sizes: [],
    periods: [],
    kinds: [],
    out: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--iterations') {
      out.iterations = Number(argv[++i])
    } else if (a === '--warmup') {
      out.warmup = Number(argv[++i])
    } else if (a === '--size') {
      out.sizes.push(Number(argv[++i]))
    } else if (a === '--period') {
      out.periods.push(Number(argv[++i]))
    } else if (a === '--kind') {
      out.kinds.push(String(argv[++i]))
    } else if (a === '--out') {
      out.out = String(argv[++i])
    } else if (a === '--help' || a === '-h') {
      console.error(
        'Usage: rolling-overhead-bench.mjs [--iterations N] [--warmup N] [--size N ...] [--period N ...] [--kind SMA|EMA ...] [--out path.json]',
      )
      process.exit(0)
    }
  }
  if (out.sizes.length === 0) out.sizes = [16, 256, 4_096]
  if (out.periods.length === 0) out.periods = [5, 20]
  if (out.kinds.length === 0) out.kinds = ['SMA', 'EMA']
  return out
}

function ensureNativeBuilt() {
  const nativePath = path.join(PKG_ROOT, 'analysis-core.node')
  if (!existsSync(nativePath)) {
    throw new Error(
      `analysis_core napi binding not built at ${nativePath}. Run scripts/build-native.mjs first.`,
    )
  }
}

function nowNs() {
  return process.hrtime.bigint()
}

function summarize(samplesNs) {
  const sorted = [...samplesNs].sort((a, b) => Number(a - b))
  const n = sorted.length
  const sum = sorted.reduce((acc, v) => acc + v, 0n)
  const mean = Number(sum / BigInt(n))
  const p50 = Number(sorted[Math.floor(n * 0.5)])
  const p95 = Number(sorted[Math.floor(n * 0.95)])
  const p99 = Number(sorted[Math.floor(n * 0.99)])
  const min = Number(sorted[0])
  const max = Number(sorted[n - 1])
  return {
    iterations: n,
    meanUs: +(mean / 1_000).toFixed(3),
    p50Us: +(p50 / 1_000).toFixed(3),
    p95Us: +(p95 / 1_000).toFixed(3),
    p99Us: +(p99 / 1_000).toFixed(3),
    minUs: +(min / 1_000).toFixed(3),
    maxUs: +(max / 1_000).toFixed(3),
  }
}

function bench(label, runOnce, iterations, warmup) {
  for (let i = 0; i < warmup; i += 1) runOnce()
  const samples = new Array(iterations)
  for (let i = 0; i < iterations; i += 1) {
    const t0 = nowNs()
    runOnce()
    samples[i] = nowNs() - t0
  }
  const s = summarize(samples)
  s.label = label
  return s
}

function makeArray(size) {
  // Linear ramp + small sine perturbation so neither the SMA mean nor
  // the EMA recurrence collapses to a constant or a closed form.
  const arr = new Array(size)
  for (let i = 0; i < size; i += 1) {
    arr[i] = 100 + i * 0.5 + Math.sin(i / 3) * 2.5
  }
  return arr
}

// In-process TypeScript SMA / EMA — mirrors statistics.ts under
// flag=0 so the bench reflects the actual fallback path's cost. We
// duplicate the implementation rather than importing from src/ to keep
// this script free of TS-runtime dependencies and runnable as a plain
// `node` script.
function tsRolling(kind, values, period) {
  if (kind === 'SMA') {
    if (values.length < period) {
      throw new Error(`SMA requires at least ${period} data points, got ${values.length}`)
    }
    const slice = values.slice(-period)
    const sum = slice.reduce((acc, v) => acc + v, 0)
    return sum / period
  }
  if (kind === 'EMA') {
    if (values.length < period) {
      throw new Error(`EMA requires at least ${period} data points, got ${values.length}`)
    }
    const multiplier = 2 / (period + 1)
    let ema = values.slice(0, period).reduce((acc, v) => acc + v, 0) / period
    for (let i = period; i < values.length; i += 1) {
      ema = (values[i] - ema) * multiplier + ema
    }
    return ema
  }
  throw new Error(`unknown moving-average kind: ${kind}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  ensureNativeBuilt()

  const { movingAverageSync } = await import('../index.js')

  const runs = []
  for (const size of args.sizes) {
    const arr = makeArray(size)
    for (const period of args.periods) {
      if (size < period) continue
      for (const kind of args.kinds) {
        const tsResult = bench(
          'ts',
          () => {
            tsRolling(kind, arr, period)
          },
          args.iterations,
          args.warmup,
        )
        const napiResult = bench(
          'napi',
          () => {
            const out = movingAverageSync(kind, arr, period)
            if (out.kind !== 'value') {
              throw new Error(
                `rolling-overhead-bench expects a value envelope, got ${out.kind}`,
              )
            }
          },
          args.iterations,
          args.warmup,
        )
        runs.push({ kind, size, period, results: [tsResult, napiResult] })
      }
    }
  }

  const summary = {
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    iterations: args.iterations,
    warmup: args.warmup,
    runs,
    notes: [
      'ts: in-process TypeScript rolling-window kernel (mirrors statistics.ts under flag=0).',
      'napi: Rust kernel via movingAverageSync (OPE-20 path) — includes the JS array → Float64Array copy on every call.',
    ],
  }

  console.log('kind\tsize\tperiod\tlabel\titer\tmean(us)\tp50\tp95\tp99\tmin\tmax')
  for (const run of summary.runs) {
    for (const r of run.results) {
      console.log(
        `${run.kind}\t${run.size}\t${run.period}\t${r.label}\t${r.iterations}\t${r.meanUs}\t${r.p50Us}\t${r.p95Us}\t${r.p99Us}\t${r.minUs}\t${r.maxUs}`,
      )
    }
  }
  console.log('JSON:', JSON.stringify(summary))
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(summary, null, 2))
    console.error(`[bench] wrote ${args.out}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
