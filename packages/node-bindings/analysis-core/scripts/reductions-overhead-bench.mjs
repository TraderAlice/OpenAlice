#!/usr/bin/env node
// analysis_core finite-`number[]` reductions overhead benchmark (OPE-19).
//
// Measures per-call cost across two reduction paths for `MIN`, `MAX`,
// `SUM`, and `AVERAGE` over arrays of size N:
//
//   - "ts"     : in-process TypeScript reductions (mirror of the legacy
//                statistics module after `toValues(...)`).
//   - "napi"   : Rust kernel via `reduceNumbersSync` (the OPE-19 path).
//
// The benchmark is intentionally NOT a microbench against `Math.min /
// Math.max / reduce` in isolation — the production caller in
// `statistics.ts` always has a plain `number[]` after `toValues(...)`,
// and the Rust route also pays the JS-array → `Float64Array` copy on
// each call. We replicate that copy in the napi path so the recorded
// numbers reflect the real overhead a caller will see.
//
// Output:
//   - tab-separated summary on stdout
//   - JSON object (last line) for downstream tooling
//   - optional `--out path.json` writes the same JSON object to disk
//
// Usage:
//   node packages/node-bindings/analysis-core/scripts/reductions-overhead-bench.mjs \
//     [--iterations N] [--warmup N] [--size N ...] [--kind MIN|MAX|SUM|AVERAGE ...] [--out path.json]

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
    } else if (a === '--kind') {
      out.kinds.push(String(argv[++i]))
    } else if (a === '--out') {
      out.out = String(argv[++i])
    } else if (a === '--help' || a === '-h') {
      console.error(
        'Usage: reductions-overhead-bench.mjs [--iterations N] [--warmup N] [--size N ...] [--kind MIN|MAX|SUM|AVERAGE ...] [--out path.json]',
      )
      process.exit(0)
    }
  }
  if (out.sizes.length === 0) out.sizes = [16, 256, 4_096]
  if (out.kinds.length === 0) out.kinds = ['MIN', 'MAX', 'SUM', 'AVERAGE']
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
  // Simple monotonically increasing finite-`f64` slice. The reduction
  // semantics are kind-independent of the exact values; we keep them
  // small and finite so neither path can short-circuit.
  const arr = new Array(size)
  for (let i = 0; i < size; i += 1) arr[i] = (i + 1) * 0.5
  return arr
}

function tsReduce(kind, values) {
  switch (kind) {
    case 'MIN':
      if (values.length === 0) throw new Error('MIN requires at least 1 data point')
      return Math.min(...values)
    case 'MAX':
      if (values.length === 0) throw new Error('MAX requires at least 1 data point')
      return Math.max(...values)
    case 'SUM':
      return values.reduce((acc, v) => acc + v, 0)
    case 'AVERAGE':
      if (values.length === 0) throw new Error('AVERAGE requires at least 1 data point')
      return values.reduce((acc, v) => acc + v, 0) / values.length
    default:
      throw new Error(`unknown reduction kind: ${kind}`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  ensureNativeBuilt()

  const { reduceNumbersSync } = await import('../index.js')

  const runs = []
  for (const size of args.sizes) {
    const arr = makeArray(size)
    for (const kind of args.kinds) {
      const tsResult = bench(
        'ts',
        () => {
          tsReduce(kind, arr)
        },
        args.iterations,
        args.warmup,
      )
      const napiResult = bench(
        'napi',
        () => {
          const out = reduceNumbersSync(kind, arr)
          if (out.kind !== 'value') {
            throw new Error(`reductions-overhead-bench expects a value envelope, got ${out.kind}`)
          }
        },
        args.iterations,
        args.warmup,
      )
      runs.push({ kind, size, results: [tsResult, napiResult] })
    }
  }

  const summary = {
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    iterations: args.iterations,
    warmup: args.warmup,
    runs,
    notes: [
      'ts: in-process TypeScript reduction (mirrors statistics.ts after toValues).',
      'napi: Rust kernel via reduceNumbersSync (OPE-19 path) — includes the JS array → Float64Array copy on every call.',
    ],
  }

  console.log('kind\tsize\tlabel\titer\tmean(us)\tp50\tp95\tp99\tmin\tmax')
  for (const run of summary.runs) {
    for (const r of run.results) {
      console.log(
        `${run.kind}\t${run.size}\t${r.label}\t${r.iterations}\t${r.meanUs}\t${r.p50Us}\t${r.p95Us}\t${r.p99Us}\t${r.minUs}\t${r.maxUs}`,
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
