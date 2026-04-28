// OpenAlice analysis_core Node binding — Phase 2 napi-rs bridge
// (OPE-17 parser, OPE-18 arithmetic evaluator, OPE-19 finite number[]
// reductions, OPE-20 rolling-window moving averages).
//
// This module is the only authorized boundary between the TypeScript
// adapters in `src/domain/analysis/` and the Rust `analysis_core`
// kernel. It is intentionally small:
//
//   - `parseFormulaSync(formula)` is the legacy parser entry point.
//     It loads the in-process napi-rs `.node` artifact built from
//     `packages/node-bindings/analysis-core/src/lib.rs`, calls the Rust
//     parser, JSON-decodes the envelope, and returns the AST DTO.
//   - `evaluateFormulaSync(formula)` is the OPE-18 entry point. It
//     parses *and* evaluates the formula in Rust when the AST is
//     arithmetic-only (numeric literals and `+ - * /`); for any other
//     shape it returns the parsed AST so the caller can hand it to
//     the legacy TypeScript evaluator without re-parsing. Returns
//     `{ kind: 'value', value: number }` or `{ kind: 'unsupported',
//     ast: AstNode }`. Throws `BindingParseError` on parse failure
//     and `BindingEvaluateError` on arithmetic-only runtime errors
//     (e.g. division by zero).
//   - `bootstrapHealthcheck()` returns the bootstrap marker. Used by
//     workspace smoke tests and the `pnpm test` script in this package.
//   - `BindingLoadError`, `BindingParseError`, `BindingEvaluateError`,
//     `RustPanicError` are typed JS errors; the TypeScript shim in
//     `src/domain/analysis/indicator/calculator.ts` consumes them via
//     duck-typing on `name`/`code`.
//
// Failure isolation contract (per ADR-003 §"Failure isolation"):
//
//   - Missing/unloadable native artifact → `BindingLoadError`. The
//     legacy TypeScript parser path (OPENALICE_RUST_ANALYSIS=0, the
//     default) keeps working because this module is only imported on
//     OPENALICE_RUST_ANALYSIS=1 and the legacy shim still owns the call
//     site decision (see calculator.ts).
//   - Parser failures → `BindingParseError` whose `.message` is the
//     legacy-format string (`Expected ')' at position N`, etc.). Tests,
//     tool-shim normalization, and downstream `.rejects.toThrow(...)`
//     assertions therefore stay green.
//   - Rust panics → caught at the napi-rs binding edge, surfaced here as
//     `RustPanicError` with `code = 'INTERNAL_RUST_PANIC'`. Node never
//     crashes from a Rust panic.
//
// CLI fallback (debug-only):
//   `OPENALICE_ANALYSIS_CORE_USE_CLI=1` forces the parser to shell out
//   to the OPE-16 `analysis-core-parse` binary instead of loading the
//   napi binding. This exists for local debugging and for the binding-
//   overhead benchmark, not for production use; the napi path is the
//   normal `OPENALICE_RUST_ANALYSIS=1` route.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NODE_REQUIRE = createRequire(import.meta.url)
const NATIVE_BASENAME = 'analysis-core.node'
const NATIVE_PATH = path.join(HERE, NATIVE_BASENAME)
const PANIC_SENTINEL = 'INTERNAL_RUST_PANIC'

export class BindingLoadError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'BindingLoadError'
    this.code = 'ANALYSIS_CORE_BINDING_LOAD_FAILED'
    if (cause !== undefined) this.cause = cause
  }
}

export class BindingParseError extends Error {
  constructor(message, position) {
    super(message)
    this.name = 'BindingParseError'
    this.code = 'ANALYSIS_CORE_PARSE_ERROR'
    this.position = position
  }
}

export class BindingEvaluateError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BindingEvaluateError'
    this.code = 'ANALYSIS_CORE_EVALUATE_ERROR'
  }
}

export class BindingReduceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BindingReduceError'
    this.code = 'ANALYSIS_CORE_REDUCE_ERROR'
  }
}

export class BindingRollingError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BindingRollingError'
    this.code = 'ANALYSIS_CORE_ROLLING_ERROR'
  }
}

export class BindingArgumentError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BindingArgumentError'
    this.code = 'ANALYSIS_CORE_ARGUMENT_ERROR'
  }
}

export class RustPanicError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'RustPanicError'
    this.code = PANIC_SENTINEL
    if (cause !== undefined) this.cause = cause
  }
}

let nativeBinding = null
let nativeLoadError = null

function loadNative() {
  if (nativeBinding) return nativeBinding
  if (nativeLoadError) throw nativeLoadError
  if (!existsSync(NATIVE_PATH)) {
    nativeLoadError = new BindingLoadError(
      `analysis_core: native binding not found at ${NATIVE_PATH}. `
        + 'Build it with `pnpm --filter @openalice/node-bindings-analysis-core build:napi` '
        + '(or `node packages/node-bindings/analysis-core/scripts/build-native.mjs`) '
        + 'before enabling OPENALICE_RUST_ANALYSIS=1.',
    )
    throw nativeLoadError
  }
  try {
    nativeBinding = NODE_REQUIRE(`./${NATIVE_BASENAME}`)
  } catch (err) {
    nativeLoadError = new BindingLoadError(
      `analysis_core: failed to load native binding at ${NATIVE_PATH}: ${err.message}`,
      err,
    )
    throw nativeLoadError
  }
  for (const fn of [
    'bootstrapHealthcheck',
    'parseFormulaToJson',
    'evaluateFormulaToJson',
    'reduceNumbersToJson',
    'movingAverageToJson',
  ]) {
    if (typeof nativeBinding[fn] !== 'function') {
      nativeLoadError = new BindingLoadError(
        `analysis_core: native binding at ${NATIVE_PATH} is missing required export "${fn}".`,
      )
      throw nativeLoadError
    }
  }
  return nativeBinding
}

// Test-only escape hatch used by the binding-load-failure spec to
// simulate "native binding never built". Mirrors the cache-reset pattern
// used in the legacy parity harness.
export function __resetForTest() {
  nativeBinding = null
  nativeLoadError = null
}

export function bootstrapHealthcheck() {
  return loadNative().bootstrapHealthcheck()
}

function isPanicError(err) {
  if (!err || typeof err.message !== 'string') return false
  return err.message.startsWith(`${PANIC_SENTINEL}:`)
}

function panicMessageFromNative(message) {
  return message.slice(PANIC_SENTINEL.length + 1).trim()
}

function decodeEnvelope(rawJson) {
  let envelope
  try {
    envelope = JSON.parse(rawJson)
  } catch (err) {
    throw new BindingLoadError(
      `analysis_core: native binding produced invalid JSON envelope: ${err.message}; raw: ${rawJson}`,
      err,
    )
  }
  if (envelope && envelope.ok === true) return envelope.ast
  if (envelope && envelope.ok === false && envelope.error) {
    const { kind, message, position } = envelope.error
    if (kind === 'parse' && typeof message === 'string') {
      throw new BindingParseError(message, typeof position === 'number' ? position : -1)
    }
  }
  throw new BindingLoadError(
    `analysis_core: native binding returned unrecognized envelope: ${rawJson}`,
  )
}

function callNative(formula) {
  const native = loadNative()
  let raw
  try {
    raw = native.parseFormulaToJson(formula)
  } catch (err) {
    if (isPanicError(err)) {
      throw new RustPanicError(panicMessageFromNative(err.message), err)
    }
    throw err
  }
  return decodeEnvelope(raw)
}

function decodeEvaluateEnvelope(rawJson) {
  let envelope
  try {
    envelope = JSON.parse(rawJson)
  } catch (err) {
    throw new BindingLoadError(
      `analysis_core: native binding produced invalid evaluate JSON envelope: ${err.message}; raw: ${rawJson}`,
      err,
    )
  }
  if (envelope && envelope.ok === true) {
    if (envelope.kind === 'value' && typeof envelope.value === 'number') {
      return { kind: 'value', value: envelope.value }
    }
    if (envelope.kind === 'unsupported' && envelope.ast && typeof envelope.ast === 'object') {
      return { kind: 'unsupported', ast: envelope.ast }
    }
  }
  if (envelope && envelope.ok === false && envelope.error) {
    const { kind, message, position } = envelope.error
    if (kind === 'parse' && typeof message === 'string') {
      throw new BindingParseError(message, typeof position === 'number' ? position : -1)
    }
    if (kind === 'evaluate' && typeof message === 'string') {
      throw new BindingEvaluateError(message)
    }
  }
  throw new BindingLoadError(
    `analysis_core: native binding returned unrecognized evaluate envelope: ${rawJson}`,
  )
}

function callNativeEvaluate(formula) {
  const native = loadNative()
  let raw
  try {
    raw = native.evaluateFormulaToJson(formula)
  } catch (err) {
    if (isPanicError(err)) {
      throw new RustPanicError(panicMessageFromNative(err.message), err)
    }
    throw err
  }
  return decodeEvaluateEnvelope(raw)
}

const REDUCE_KIND_SET = new Set(['MIN', 'MAX', 'SUM', 'AVERAGE'])

function decodeReduceEnvelope(rawJson) {
  let envelope
  try {
    envelope = JSON.parse(rawJson)
  } catch (err) {
    throw new BindingLoadError(
      `analysis_core: native binding produced invalid reduce JSON envelope: ${err.message}; raw: ${rawJson}`,
      err,
    )
  }
  if (envelope && envelope.ok === true) {
    if (envelope.kind === 'value' && typeof envelope.value === 'number') {
      return { kind: 'value', value: envelope.value }
    }
    if (envelope.kind === 'unsupported') {
      return { kind: 'unsupported' }
    }
  }
  if (envelope && envelope.ok === false && envelope.error) {
    const { kind, message } = envelope.error
    if (kind === 'reduce' && typeof message === 'string') {
      throw new BindingReduceError(message)
    }
    if (kind === 'argument' && typeof message === 'string') {
      throw new BindingArgumentError(message)
    }
  }
  throw new BindingLoadError(
    `analysis_core: native binding returned unrecognized reduce envelope: ${rawJson}`,
  )
}

function callNativeReduce(kind, values) {
  const native = loadNative()
  let raw
  try {
    raw = native.reduceNumbersToJson(kind, values)
  } catch (err) {
    if (isPanicError(err)) {
      throw new RustPanicError(panicMessageFromNative(err.message), err)
    }
    throw err
  }
  return decodeReduceEnvelope(raw)
}

const ROLLING_KIND_SET = new Set(['SMA', 'EMA'])

function decodeRollingEnvelope(rawJson) {
  let envelope
  try {
    envelope = JSON.parse(rawJson)
  } catch (err) {
    throw new BindingLoadError(
      `analysis_core: native binding produced invalid rolling JSON envelope: ${err.message}; raw: ${rawJson}`,
      err,
    )
  }
  if (envelope && envelope.ok === true) {
    if (envelope.kind === 'value' && typeof envelope.value === 'number') {
      return { kind: 'value', value: envelope.value }
    }
    if (envelope.kind === 'unsupported') {
      return { kind: 'unsupported' }
    }
  }
  if (envelope && envelope.ok === false && envelope.error) {
    const { kind, message } = envelope.error
    if (kind === 'rolling' && typeof message === 'string') {
      throw new BindingRollingError(message)
    }
    if (kind === 'argument' && typeof message === 'string') {
      throw new BindingArgumentError(message)
    }
  }
  throw new BindingLoadError(
    `analysis_core: native binding returned unrecognized rolling envelope: ${rawJson}`,
  )
}

function callNativeMovingAverage(kind, values, period) {
  const native = loadNative()
  let raw
  try {
    raw = native.movingAverageToJson(kind, values, period)
  } catch (err) {
    if (isPanicError(err)) {
      throw new RustPanicError(panicMessageFromNative(err.message), err)
    }
    throw err
  }
  return decodeRollingEnvelope(raw)
}

// ============================================================================
// Debug-only CLI fallback
// ============================================================================

const BIN_BASENAME = process.platform === 'win32'
  ? 'analysis-core-parse.exe'
  : 'analysis-core-parse'

function walkUpForCargoWorkspace(start) {
  let cur = path.resolve(start)
  while (true) {
    if (existsSync(path.join(cur, 'Cargo.toml'))) {
      if (
        existsSync(path.join(cur, 'Cargo.lock'))
        || existsSync(path.join(cur, 'target'))
      ) {
        return cur
      }
    }
    const parent = path.dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

function repoRootCandidates() {
  const candidates = []
  const override = process.env.OPENALICE_ANALYSIS_CORE_REPO_ROOT
  if (override) candidates.push(path.resolve(override))
  candidates.push(path.resolve(HERE, '..', '..', '..'))
  const fromCwd = walkUpForCargoWorkspace(process.cwd())
  if (fromCwd) candidates.push(fromCwd)
  return candidates
}

function findCliBinaryPath() {
  for (const root of repoRootCandidates()) {
    const release = path.join(root, 'target', 'release', BIN_BASENAME)
    if (existsSync(release)) return release
    const debug = path.join(root, 'target', 'debug', BIN_BASENAME)
    if (existsSync(debug)) return debug
  }
  return null
}

function callCliFallback(formula) {
  const binPath = findCliBinaryPath()
  if (!binPath) {
    throw new BindingLoadError(
      'analysis_core: CLI fallback requested via OPENALICE_ANALYSIS_CORE_USE_CLI=1 '
        + 'but `analysis-core-parse` binary was not found. '
        + 'Build it via `cargo build --bin analysis-core-parse -p analysis-core-node-binding`.',
    )
  }
  const result = spawnSync(binPath, [], {
    input: formula,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) {
    throw new BindingLoadError(
      `analysis_core: CLI fallback spawn failed: ${result.error.message}`,
      result.error,
    )
  }
  if (result.status !== 0) {
    throw new BindingLoadError(
      `analysis_core: CLI fallback exited with status ${result.status}; `
        + `stderr: ${(result.stderr || '').trim()}`,
    )
  }
  const stdout = (result.stdout || '').trim()
  if (!stdout) {
    throw new BindingLoadError('analysis_core: CLI fallback produced empty stdout')
  }
  let envelope
  try {
    envelope = JSON.parse(stdout)
  } catch (err) {
    throw new BindingLoadError(
      `analysis_core: CLI fallback produced invalid JSON: ${err.message}; raw: ${stdout}`,
      err,
    )
  }
  if (envelope && envelope.ok === true) return envelope.ast
  if (envelope && envelope.ok === false && typeof envelope.message === 'string') {
    throw new BindingParseError(
      envelope.message,
      typeof envelope.position === 'number' ? envelope.position : -1,
    )
  }
  throw new BindingLoadError(`analysis_core: CLI fallback returned unrecognized envelope: ${stdout}`)
}

function shouldUseCliFallback() {
  const raw = process.env.OPENALICE_ANALYSIS_CORE_USE_CLI
  return typeof raw === 'string' && raw.trim() === '1'
}

/**
 * Synchronously parse a formula via the Rust `analysis_core` parser.
 *
 * Default route: in-process napi-rs binding.
 * Debug fallback: shell-out to `analysis-core-parse` when
 * `OPENALICE_ANALYSIS_CORE_USE_CLI=1`.
 *
 * @param {string} formula
 * @returns {object} JSON-compatible AST DTO matching the legacy
 *   `ASTNode` discriminated-union shape.
 */
export function parseFormulaSync(formula) {
  if (typeof formula !== 'string') {
    throw new TypeError('parseFormulaSync expects a string formula')
  }
  if (shouldUseCliFallback()) return callCliFallback(formula)
  return callNative(formula)
}

/**
 * Synchronously parse + arithmetic-only evaluate a formula via the
 * Rust `analysis_core` kernel.
 *
 * Returns one of:
 *   - `{ kind: 'value', value: number }` when the AST is arithmetic-only
 *     (numeric literals + `+ - * /`) and evaluation succeeds.
 *   - `{ kind: 'unsupported', ast: AstNode }` when the AST contains any
 *     non-arithmetic node. The caller is expected to hand `ast` to the
 *     legacy TypeScript evaluator without re-parsing.
 *
 * The CLI fallback is intentionally not wired here. The CLI binary
 * exposes only the parser (OPE-16 surface); the OPE-18 evaluator slice
 * exists exclusively on the in-process napi-rs route.
 *
 * @param {string} formula
 * @returns {{ kind: 'value', value: number } | { kind: 'unsupported', ast: object }}
 */
export function evaluateFormulaSync(formula) {
  if (typeof formula !== 'string') {
    throw new TypeError('evaluateFormulaSync expects a string formula')
  }
  return callNativeEvaluate(formula)
}

/**
 * Synchronously apply a finite-`number[]` reduction (`MIN`, `MAX`,
 * `SUM`, or `AVERAGE`) via the Rust `analysis_core` kernel.
 *
 * Returns one of:
 *   - `{ kind: 'value', value: number }` on a successful reduction or
 *     on `SUM([])` (which returns `0` to mirror the legacy
 *     `[].reduce((a, v) => a + v, 0)` semantics).
 *   - `{ kind: 'unsupported' }` when the slice contains a non-finite
 *     element (`NaN` / `+/-Infinity`). The JS wrapper pre-screens for
 *     these — JSON cannot encode them losslessly — so the caller is
 *     expected to route those slices back to the legacy TypeScript
 *     reduction and keep `dataRange`/`TrackedValues` semantics
 *     authoritative on the TypeScript side.
 *
 * Throws:
 *   - `BindingReduceError`     - `MIN`/`MAX`/`AVERAGE` on an empty slice;
 *                                `.message` is parity-locked with the
 *                                legacy TypeScript implementation
 *                                (e.g. `"MIN requires at least 1 data point"`).
 *   - `BindingArgumentError`   - `kind` is not one of `MIN`/`MAX`/`SUM`/`AVERAGE`.
 *   - `BindingLoadError`       - native artifact missing or unloadable.
 *   - `RustPanicError`         - Rust panic caught at the binding edge.
 *
 * @param {'MIN'|'MAX'|'SUM'|'AVERAGE'} kind
 * @param {number[]|Float64Array} values  Plain finite `number[]`. The
 *   wrapper converts a JS `number[]` to a `Float64Array` once before
 *   crossing the binding boundary so the Rust kernel sees a contiguous
 *   `&[f64]` slice without re-allocating per element.
 * @returns {{ kind: 'value', value: number } | { kind: 'unsupported' }}
 */
export function reduceNumbersSync(kind, values) {
  if (typeof kind !== 'string' || !REDUCE_KIND_SET.has(kind)) {
    throw new BindingArgumentError(`unknown reduction kind: ${String(kind)}`)
  }
  let buffer
  if (values instanceof Float64Array) {
    buffer = values
  } else if (Array.isArray(values)) {
    // Defensive pre-screen for non-finite elements. The Rust kernel
    // also screens, but JSON cannot losslessly carry NaN/+/-Infinity,
    // so we keep these on the legacy TypeScript path. Returning the
    // `unsupported` envelope here avoids a wasted FFI hop and matches
    // the documented semantics exactly.
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i]
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { kind: 'unsupported' }
      }
    }
    buffer = Float64Array.from(values)
  } else {
    throw new BindingArgumentError(
      `reduceNumbersSync expects a number[] or Float64Array, got ${typeof values}`,
    )
  }
  return callNativeReduce(kind, buffer)
}

/**
 * Synchronously apply a finite-`number[]` rolling-window moving average
 * (`SMA` or `EMA`) via the Rust `analysis_core` kernel.
 *
 * Returns one of:
 *   - `{ kind: 'value', value: number }` on a successful moving-average
 *     calculation. Semantics are parity-locked with the legacy
 *     TypeScript implementations:
 *     * `SMA(values, period)` averages the trailing `period` values.
 *     * `EMA(values, period)` seeds from the SMA of the first `period`
 *       values and applies the
 *       `ema = (v[i] - ema) * multiplier + ema` recurrence with
 *       `multiplier = 2 / (period + 1)` left-to-right over the rest.
 *   - `{ kind: 'unsupported' }` when:
 *     * `period` is not a positive safe integer; OR
 *     * `values` contains a non-finite element (`NaN` / `+/-Infinity`).
 *     The caller is expected to fall back to the legacy TypeScript
 *     implementation in `statistics.ts` so existing `dataRange` and
 *     `TrackedValues` semantics stay authoritative.
 *
 * Throws:
 *   - `BindingRollingError`    - `values.length < period`. `.message` is
 *                                parity-locked with the legacy TS error
 *                                (`"<KIND> requires at least <period>
 *                                data points, got <len>"`).
 *   - `BindingArgumentError`   - `kind` is not one of `SMA`/`EMA`, or
 *                                `values` is not an array / `Float64Array`.
 *   - `BindingLoadError`       - native artifact missing or unloadable.
 *   - `RustPanicError`         - Rust panic caught at the binding edge.
 *
 * @param {'SMA'|'EMA'} kind
 * @param {number[]|Float64Array} values  Plain finite `number[]`. The
 *   wrapper converts a JS `number[]` to a `Float64Array` once before
 *   crossing the binding boundary so the Rust kernel sees a contiguous
 *   `&[f64]` slice without re-allocating per element.
 * @param {number} period  Positive safe integer.
 * @returns {{ kind: 'value', value: number } | { kind: 'unsupported' }}
 */
export function movingAverageSync(kind, values, period) {
  if (typeof kind !== 'string' || !ROLLING_KIND_SET.has(kind)) {
    throw new BindingArgumentError(`unknown moving-average kind: ${String(kind)}`)
  }
  // Period guard: only positive safe integers route through Rust. Any
  // other shape (zero, negative, non-integer, non-finite, NaN, > 2^32-1)
  // returns `unsupported` so the caller stays on the legacy TS path
  // rather than introducing new validation behavior in this slice.
  if (
    typeof period !== 'number'
    || !Number.isSafeInteger(period)
    || period < 1
    || period > 0xffffffff
  ) {
    return { kind: 'unsupported' }
  }
  let buffer
  if (values instanceof Float64Array) {
    // Float64Array can carry NaN/Infinity, so we still need the
    // pre-screen below; do it on a typed-array iteration.
    for (let i = 0; i < values.length; i += 1) {
      if (!Number.isFinite(values[i])) return { kind: 'unsupported' }
    }
    buffer = values
  } else if (Array.isArray(values)) {
    for (let i = 0; i < values.length; i += 1) {
      const v = values[i]
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { kind: 'unsupported' }
      }
    }
    buffer = Float64Array.from(values)
  } else {
    throw new BindingArgumentError(
      `movingAverageSync expects a number[] or Float64Array, got ${typeof values}`,
    )
  }
  return callNativeMovingAverage(kind, buffer, period)
}

/**
 * Test-only hook: triggers a Rust panic inside the binding so the panic
 * boundary can be exercised. Throws `RustPanicError`. Not part of the
 * production binding surface; only `parseFormulaSync` is.
 *
 * @param {string} message
 */
export function __triggerPanicForTest(message) {
  const native = loadNative()
  if (typeof native.__triggerPanicForTest !== 'function') {
    throw new BindingLoadError(
      'analysis_core: native binding does not expose __triggerPanicForTest. '
        + 'Rebuild the binding from this branch.',
    )
  }
  try {
    native.__triggerPanicForTest(message)
  } catch (err) {
    if (isPanicError(err)) {
      throw new RustPanicError(panicMessageFromNative(err.message), err)
    }
    throw err
  }
}
