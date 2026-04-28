#!/usr/bin/env node
// analysis_core binding-overhead benchmark (OPE-17).
//
// Measures per-call parser cost across three implementations:
//   - "ts"    : legacy in-process TypeScript parser
//                 (`IndicatorCalculator.parse` reflected via the public
//                 `calculate()` entry; the parse happens before any
//                 evaluator work and is the dominant cost of an
//                 immediately-failing reference like `__bench_unknown`).
//   - "napi"  : in-process napi-rs binding (the OPE-17 normal path).
//   - "cli"   : OPE-16 CLI fallback (`analysis-core-parse`), retained as
//                 the explicit debug-only fallback per OPE-17 scope.
//
// Output:
//   - tab-separated summary on stdout
//   - JSON object (last line) for downstream tooling
//
// Usage:
//   node packages/node-bindings/analysis-core/scripts/binding-overhead-bench.mjs \
//     [--iterations N] [--warmup N] [--formula "..."]
//
// The benchmark targets the parser surface only - there is no data
// fetch, no statistics math, no evaluator path - so the numbers reflect
// pure binding/parser overhead rather than indicator workloads.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..', '..')

function parseArgs(argv) {
  const out = {
    iterations: 5_000,
    warmup: 500,
    formula:
      "(CLOSE('AAPL', '1d')[-1] - SMA(CLOSE('AAPL', '1d'), 50)) / SMA(CLOSE('AAPL', '1d'), 50) * 100",
    out: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--iterations') {
      out.iterations = Number(argv[++i])
    } else if (a === '--warmup') {
      out.warmup = Number(argv[++i])
    } else if (a === '--formula') {
      out.formula = String(argv[++i])
    } else if (a === '--out') {
      out.out = String(argv[++i])
    } else if (a === '--help' || a === '-h') {
      console.error(
        'Usage: binding-overhead-bench.mjs [--iterations N] [--warmup N] [--formula "..."] [--out path.json]',
      )
      process.exit(0)
    }
  }
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

function ensureCliBuilt() {
  const debug = path.join(REPO_ROOT, 'target', 'debug', 'analysis-core-parse')
  const release = path.join(REPO_ROOT, 'target', 'release', 'analysis-core-parse')
  if (!existsSync(debug) && !existsSync(release)) {
    throw new Error(
      'analysis_core CLI fallback binary not built. '
        + 'Run `cargo build -p analysis-core-node-binding --bin analysis-core-parse`.',
    )
  }
}

function nowNs() {
  return process.hrtime.bigint()
}

function nsToUs(ns) {
  return Number(ns) / 1_000
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

async function bench(label, runOnce, iterations, warmup) {
  for (let i = 0; i < warmup; i += 1) await runOnce()
  const samples = new Array(iterations)
  for (let i = 0; i < iterations; i += 1) {
    const t0 = nowNs()
    await runOnce()
    samples[i] = nowNs() - t0
  }
  const s = summarize(samples)
  s.label = label
  return s
}

async function loadTsParser() {
  // Reach into the legacy TypeScript parser by spinning up an
  // IndicatorCalculator and calling calculate() on a known-bad reference
  // ("__bench_unknown"). The parser succeeds and the evaluator throws on
  // the unknown function name, so we measure parse cost without paying
  // for data access. We strip the evaluator failure from the timing by
  // catching it inside the runOnce closure.
  const mod = await import(
    new URL('../../../../src/domain/analysis/indicator/calculator.ts', import.meta.url).href
  ).catch(async () => {
    // For shipped builds, fall back to dist.
    return import(new URL('../../../../dist/main.js', import.meta.url).href)
  })
  return mod.IndicatorCalculator
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  ensureNativeBuilt()
  ensureCliBuilt()

  const formula = args.formula

  // ---- napi ----
  process.env.OPENALICE_RUST_ANALYSIS = '1'
  delete process.env.OPENALICE_ANALYSIS_CORE_USE_CLI
  const { parseFormulaSync } = await import('../index.js')
  const napiResult = await bench(
    'napi',
    async () => {
      parseFormulaSync(formula)
    },
    args.iterations,
    args.warmup,
  )

  // ---- cli fallback ----
  process.env.OPENALICE_ANALYSIS_CORE_USE_CLI = '1'
  // Re-import is unnecessary; the CLI fallback is gated at call time.
  const cliResult = await bench(
    'cli',
    async () => {
      parseFormulaSync(formula)
    },
    Math.min(args.iterations, 200), // CLI is ~10000x slower; cap iterations
    Math.min(args.warmup, 20),
  )
  delete process.env.OPENALICE_ANALYSIS_CORE_USE_CLI

  // ---- ts parser ----
  // Use the same legacy parse function but invoke it via a dedicated
  // benchmark harness to avoid re-instantiating the calculator state
  // each iteration. We import the calculator class and call a private
  // helper exported only for this benchmark would be invasive; the
  // recursive-descent parser is small enough that we can reproduce it
  // here directly to measure pure parse cost without the evaluator.
  const tsParse = makeTsParser()
  const tsResult = await bench(
    'ts',
    () => {
      tsParse(formula)
    },
    args.iterations,
    args.warmup,
  )

  const summary = {
    formula,
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    runs: [tsResult, napiResult, cliResult],
    notes: [
      'ts: in-process TypeScript recursive-descent parser (mirror of '
        + 'IndicatorCalculator.parse for benchmark isolation).',
      'napi: in-process napi-rs binding (default OPE-17 path).',
      'cli: OPE-16 spawnSync fallback (debug-only).',
    ],
  }

  // Pretty table
  console.log('label\titer\tmean(us)\tp50\tp95\tp99\tmin\tmax')
  for (const r of summary.runs) {
    console.log(
      `${r.label}\t${r.iterations}\t${r.meanUs}\t${r.p50Us}\t${r.p95Us}\t${r.p99Us}\t${r.minUs}\t${r.maxUs}`,
    )
  }
  console.log('JSON:', JSON.stringify(summary))
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(summary, null, 2))
    console.error(`[bench] wrote ${args.out}`)
  }
}

// --- legacy TS parser, copied verbatim from
// src/domain/analysis/indicator/calculator.ts so the benchmark can time
// pure parse cost without the evaluator. Kept inline here so the bench
// remains self-contained and can run against either the source tree or
// a shipped dist/.
function makeTsParser() {
  return function parse(formula) {
    let pos = 0
    const peek = () => formula[pos] || ''
    const consume = () => formula[pos++] || ''
    const isDigit = (ch) => /[0-9]/.test(ch)
    const isAlpha = (ch) => /[a-zA-Z_]/.test(ch)
    const skipWhitespace = () => {
      while (pos < formula.length && /\s/.test(peek())) consume()
    }
    const parseExpression = () => {
      let left = parseTerm()
      skipWhitespace()
      while (pos < formula.length && (peek() === '+' || peek() === '-')) {
        const operator = consume()
        skipWhitespace()
        const right = parseTerm()
        skipWhitespace()
        left = { type: 'binaryOp', operator, left, right }
      }
      return left
    }
    const parseTerm = () => {
      let left = parseFactor()
      skipWhitespace()
      while (pos < formula.length && (peek() === '*' || peek() === '/')) {
        const operator = consume()
        skipWhitespace()
        const right = parseFactor()
        skipWhitespace()
        left = { type: 'binaryOp', operator, left, right }
      }
      return left
    }
    const parseFactor = () => {
      skipWhitespace()
      if (peek() === '(') {
        consume()
        const expr = parseExpression()
        skipWhitespace()
        if (peek() !== ')') throw new Error(`Expected ')' at position ${pos}`)
        consume()
        return expr
      }
      if (peek() === "'" || peek() === '"') return parseString()
      if (isDigit(peek())) return parseNumber()
      if (peek() === '-') {
        const next = formula[pos + 1]
        if (next && (isDigit(next) || next === '.')) return parseNumber()
        throw new Error(`Unexpected character '${peek()}' at position ${pos}`)
      }
      if (isAlpha(peek())) return parseFunctionOrIdentifier()
      throw new Error(`Unexpected character '${peek()}' at position ${pos}`)
    }
    const parseFunctionOrIdentifier = () => {
      const name = parseIdentifier()
      skipWhitespace()
      if (peek() === '(') {
        consume()
        skipWhitespace()
        const args = []
        if (peek() !== ')') {
          args.push(parseArgument())
          skipWhitespace()
          while (peek() === ',') {
            consume()
            skipWhitespace()
            args.push(parseArgument())
            skipWhitespace()
          }
        }
        if (peek() !== ')') throw new Error(`Expected ')' at position ${pos}`)
        consume()
        const node = { type: 'function', name, args }
        skipWhitespace()
        if (peek() === '[') return parseArrayAccess(node)
        return node
      }
      throw new Error(`Unknown identifier '${name}' at position ${pos}`)
    }
    const parseArgument = () => {
      skipWhitespace()
      if (peek() === "'" || peek() === '"') return parseString()
      return parseExpression()
    }
    const parseString = () => {
      const quote = consume()
      let value = ''
      while (pos < formula.length && peek() !== quote) value += consume()
      if (peek() !== quote) throw new Error(`Unterminated string at position ${pos}`)
      consume()
      return { type: 'string', value }
    }
    const parseNumber = () => {
      let numStr = ''
      if (peek() === '-') numStr += consume()
      while (pos < formula.length && (isDigit(peek()) || peek() === '.')) numStr += consume()
      return { type: 'number', value: parseFloat(numStr) }
    }
    const parseIdentifier = () => {
      let name = ''
      while (pos < formula.length && (isAlpha(peek()) || isDigit(peek()))) name += consume()
      return name
    }
    const parseArrayAccess = (array) => {
      consume()
      skipWhitespace()
      const index = parseExpression()
      skipWhitespace()
      if (peek() !== ']') throw new Error(`Expected ']' at position ${pos}`)
      consume()
      return { type: 'arrayAccess', array, index }
    }
    pos = 0
    skipWhitespace()
    const result = parseExpression()
    skipWhitespace()
    if (pos < formula.length) {
      throw new Error(
        `Unexpected character '${peek()}' at position ${pos}. Expected end of expression.`,
      )
    }
    return result
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
