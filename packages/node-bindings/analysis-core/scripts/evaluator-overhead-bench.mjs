#!/usr/bin/env node
// analysis_core evaluator-overhead benchmark (OPE-18).
//
// Measures per-call cost across three full parse+evaluate paths for an
// arithmetic-only formula:
//
//   - "ts"          : legacy in-process TypeScript parser + evaluator
//                     (mirror of `IndicatorCalculator.parse` and the
//                     arithmetic subset of `IndicatorCalculator.evaluate`).
//   - "napi-parse"  : OPE-17 path - Rust parser via napi-rs +
//                     TypeScript evaluator (the AST round-trips JSON,
//                     evaluator stays in JS).
//   - "napi-eval"   : OPE-18 path - Rust parser + Rust arithmetic
//                     evaluator via `evaluateFormulaSync`. Returns a
//                     `number` directly; no JSON envelope for the AST.
//
// The benchmark shows whether keeping the entire arithmetic-only
// computation inside Rust amortizes the OPE-17 binding overhead - the
// expected win for OPE-18 is on `napi-eval` versus `napi-parse`, not
// against the in-process TypeScript baseline (V8 still wins for tiny
// trees because the FFI cost dominates the work).
//
// Output:
//   - tab-separated summary on stdout
//   - JSON object (last line) for downstream tooling
//   - optional `--out path.json` writes the same JSON object to disk
//
// Usage:
//   node packages/node-bindings/analysis-core/scripts/evaluator-overhead-bench.mjs \
//     [--iterations N] [--warmup N] [--formula "..."] [--out path.json]
//
// The default formula is intentionally small so the napi-vs-ts overhead
// dominates. Pass `--formula` to compare larger arithmetic trees.

import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..', '..')

function parseArgs(argv) {
  const out = {
    iterations: 5_000,
    warmup: 500,
    formulas: [],
    out: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--iterations') {
      out.iterations = Number(argv[++i])
    } else if (a === '--warmup') {
      out.warmup = Number(argv[++i])
    } else if (a === '--formula') {
      out.formulas.push(String(argv[++i]))
    } else if (a === '--out') {
      out.out = String(argv[++i])
    } else if (a === '--help' || a === '-h') {
      console.error(
        'Usage: evaluator-overhead-bench.mjs [--iterations N] [--warmup N] [--formula "..."] [--out path.json]',
      )
      process.exit(0)
    }
  }
  if (out.formulas.length === 0) {
    out.formulas = [
      '1 + 2',
      '(2 + 3) * 4',
      '((1 - -2) * 3) + (-4 / -2)',
      '10 / 3',
    ]
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  ensureNativeBuilt()

  const { parseFormulaSync, evaluateFormulaSync } = await import('../index.js')
  const tsRun = makeTsParseEval()

  const runs = []
  for (const formula of args.formulas) {
    const tsResult = bench(
      'ts',
      () => {
        tsRun(formula)
      },
      args.iterations,
      args.warmup,
    )

    const napiParseResult = bench(
      'napi-parse',
      () => {
        const ast = parseFormulaSync(formula)
        evaluateAstInJs(ast)
      },
      args.iterations,
      args.warmup,
    )

    const napiEvalResult = bench(
      'napi-eval',
      () => {
        const out = evaluateFormulaSync(formula)
        // The benchmark only times arithmetic-only formulas; if a
        // benchmark formula falls back to "unsupported" we record it
        // as such instead of paying the JS evaluator cost twice.
        if (out.kind !== 'value') {
          throw new Error(`evaluator-overhead-bench expects arithmetic-only formula, got ${out.kind}`)
        }
      },
      args.iterations,
      args.warmup,
    )

    runs.push({ formula, results: [tsResult, napiParseResult, napiEvalResult] })
  }

  const summary = {
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
    iterations: args.iterations,
    warmup: args.warmup,
    runs,
    notes: [
      'ts: in-process TypeScript parse + arithmetic evaluate (mirror of IndicatorCalculator).',
      'napi-parse: Rust parser via napi-rs (AST JSON envelope) + TypeScript arithmetic evaluator (OPE-17 path).',
      'napi-eval: Rust parser + Rust arithmetic evaluator via evaluateFormulaSync (OPE-18 path).',
    ],
  }

  console.log('formula\tlabel\titer\tmean(us)\tp50\tp95\tp99\tmin\tmax')
  for (const run of summary.runs) {
    for (const r of run.results) {
      console.log(
        `${run.formula}\t${r.label}\t${r.iterations}\t${r.meanUs}\t${r.p50Us}\t${r.p95Us}\t${r.p99Us}\t${r.minUs}\t${r.maxUs}`,
      )
    }
  }
  console.log('JSON:', JSON.stringify(summary))
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(summary, null, 2))
    console.error(`[bench] wrote ${args.out}`)
  }
}

// Recursive walker that mirrors the arithmetic subset of the legacy
// IndicatorCalculator.evaluate. We keep it inline so the benchmark is
// self-contained and so the timed cost reflects the same instructions
// the production legacy path would execute under flag=0.
function evaluateAstInJs(node) {
  switch (node.type) {
    case 'number':
      return node.value
    case 'binaryOp': {
      const left = evaluateAstInJs(node.left)
      const right = evaluateAstInJs(node.right)
      switch (node.operator) {
        case '+':
          return left + right
        case '-':
          return left - right
        case '*':
          return left * right
        case '/':
          if (right === 0) throw new Error('Division by zero')
          return left / right
        default:
          throw new Error(`Unknown operator: ${node.operator}`)
      }
    }
    default:
      throw new Error(`evaluator-overhead-bench expects arithmetic-only AST, got ${node.type}`)
  }
}

// Legacy TypeScript parse + evaluate, kept inline so the bench
// remains self-contained against either the source tree or a shipped
// dist/. Mirrors `IndicatorCalculator.parse` (and the arithmetic
// subset of `IndicatorCalculator.evaluate`).
function makeTsParseEval() {
  return function tsParseEval(formula) {
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
      if (isDigit(peek())) return parseNumber()
      if (peek() === '-') {
        const next = formula[pos + 1]
        if (next && (isDigit(next) || next === '.')) return parseNumber()
        throw new Error(`Unexpected character '${peek()}' at position ${pos}`)
      }
      if (isAlpha(peek())) {
        throw new Error('evaluator-overhead-bench expects arithmetic-only formula')
      }
      throw new Error(`Unexpected character '${peek()}' at position ${pos}`)
    }
    const parseNumber = () => {
      let numStr = ''
      if (peek() === '-') numStr += consume()
      while (pos < formula.length && (isDigit(peek()) || peek() === '.')) numStr += consume()
      return { type: 'number', value: parseFloat(numStr) }
    }

    pos = 0
    skipWhitespace()
    const ast = parseExpression()
    skipWhitespace()
    if (pos < formula.length) {
      throw new Error(
        `Unexpected character '${peek()}' at position ${pos}. Expected end of expression.`,
      )
    }
    return evaluateAstInJs(ast)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
