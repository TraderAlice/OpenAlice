/**
 * analysis_core napi-rs binding boundary spec (OPE-17).
 *
 * Locks the typed-error contract documented in
 * `docs/autonomous-refactor/adr/ADR-003-binding-strategy.md` §"Failure
 * isolation":
 *
 *   - `BindingParseError` for parser failures, with `.message` matching
 *     the legacy TypeScript parser format.
 *   - `RustPanicError` (`code = 'INTERNAL_RUST_PANIC'`) when a Rust
 *     panic is caught at the napi-rs binding edge. Node never crashes
 *     because of a Rust panic.
 *   - `BindingLoadError` (`code = 'ANALYSIS_CORE_BINDING_LOAD_FAILED'`)
 *     when the `.node` artifact is missing or unloadable. The legacy
 *     TypeScript parser path remains the documented fallback.
 *   - The opt-in CLI fallback (`OPENALICE_ANALYSIS_CORE_USE_CLI=1`)
 *     still works after the napi-rs path lands so the binding-overhead
 *     benchmark can compare both paths against the legacy path.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, renameSync } from 'node:fs'
import os from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  __resetForTest,
  __triggerPanicForTest,
  BindingLoadError,
  BindingParseError,
  RustPanicError,
  bootstrapHealthcheck,
  parseFormulaSync,
} from '../../../../packages/node-bindings/analysis-core/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..')
const NATIVE_BINDING_PATH = resolve(
  REPO_ROOT,
  'packages',
  'node-bindings',
  'analysis-core',
  'analysis-core.node',
)

function resolveCargoBin(): string {
  if (process.env.CARGO) return process.env.CARGO
  const sep = process.platform === 'win32' ? ';' : ':'
  const onPath = (process.env.PATH || '').split(sep)
  const exe = process.platform === 'win32' ? 'cargo.exe' : 'cargo'
  for (const dir of onPath) {
    if (!dir) continue
    const candidate = resolve(dir, exe)
    if (existsSync(candidate)) return candidate
  }
  const home = os.homedir()
  if (home) {
    const fallback = resolve(home, '.cargo', 'bin', exe)
    if (existsSync(fallback)) return fallback
  }
  return 'cargo'
}

function ensureNativeArtifact(): void {
  if (existsSync(NATIVE_BINDING_PATH)) return
  execFileSync(
    process.execPath,
    [resolve(REPO_ROOT, 'packages/node-bindings/analysis-core/scripts/build-native.mjs')],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
}

function ensureCliFallback(): void {
  const debugBin = resolve(REPO_ROOT, 'target', 'debug', 'analysis-core-parse')
  const releaseBin = resolve(REPO_ROOT, 'target', 'release', 'analysis-core-parse')
  if (existsSync(debugBin) || existsSync(releaseBin)) return
  execFileSync(
    resolveCargoBin(),
    ['build', '--bin', 'analysis-core-parse', '-p', 'analysis-core-node-binding'],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
}

let originalFlag: string | undefined
let originalCliFlag: string | undefined

beforeAll(() => {
  ensureNativeArtifact()
  ensureCliFallback()
  originalFlag = process.env.OPENALICE_RUST_ANALYSIS
  process.env.OPENALICE_RUST_ANALYSIS = '1'
  originalCliFlag = process.env.OPENALICE_ANALYSIS_CORE_USE_CLI
  delete process.env.OPENALICE_ANALYSIS_CORE_USE_CLI
}, 180_000)

afterAll(() => {
  if (originalFlag === undefined) {
    delete process.env.OPENALICE_RUST_ANALYSIS
  } else {
    process.env.OPENALICE_RUST_ANALYSIS = originalFlag
  }
  if (originalCliFlag === undefined) {
    delete process.env.OPENALICE_ANALYSIS_CORE_USE_CLI
  } else {
    process.env.OPENALICE_ANALYSIS_CORE_USE_CLI = originalCliFlag
  }
})

afterEach(() => {
  delete process.env.OPENALICE_ANALYSIS_CORE_USE_CLI
  __resetForTest()
})

describe('analysis_core napi binding: load + healthcheck', () => {
  it('exposes the bootstrap marker through the in-process bridge', () => {
    expect(bootstrapHealthcheck()).toBe('analysis_core:bootstrap')
  })

  it('returns a JSON-shaped AST DTO for a simple expression', () => {
    const ast = parseFormulaSync('1 + 2') as Record<string, unknown>
    expect(ast.type).toBe('binaryOp')
    expect((ast as { operator: string }).operator).toBe('+')
  })
})

describe('analysis_core napi binding: typed parse-error boundary', () => {
  it('throws BindingParseError with the legacy-format message for an unknown identifier', () => {
    let caught: unknown = null
    try {
      parseFormulaSync('AAPL')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BindingParseError)
    const err = caught as BindingParseError
    expect(err.code).toBe('ANALYSIS_CORE_PARSE_ERROR')
    expect(err.message).toBe("Unknown identifier 'AAPL' at position 4")
    expect(err.position).toBe(4)
  })

  it('preserves the trailing "Expected end of expression." sentence', () => {
    let caught: unknown = null
    try {
      parseFormulaSync('1 + 2 )')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BindingParseError)
    expect((caught as Error).message).toBe(
      "Unexpected character ')' at position 6. Expected end of expression.",
    )
  })
})

describe('analysis_core napi binding: panic boundary', () => {
  it('catches a Rust panic at the binding edge and surfaces RustPanicError', () => {
    let caught: unknown = null
    try {
      __triggerPanicForTest('synthetic panic for OPE-17 boundary spec')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(RustPanicError)
    const err = caught as RustPanicError
    expect(err.code).toBe('INTERNAL_RUST_PANIC')
    expect(err.message).toContain('synthetic panic for OPE-17 boundary spec')
  })

  it('keeps Node alive after a caught panic (subsequent parse calls still work)', () => {
    try {
      __triggerPanicForTest('post-panic recovery probe')
    } catch {
      /* expected RustPanicError */
    }
    const ast = parseFormulaSync('3 + 4') as Record<string, unknown>
    expect(ast.type).toBe('binaryOp')
  })
})

describe('analysis_core napi binding: missing-artifact boundary', () => {
  it('throws BindingLoadError when the .node artifact is missing', () => {
    const stash = `${NATIVE_BINDING_PATH}.stashed-for-test`
    expect(existsSync(NATIVE_BINDING_PATH)).toBe(true)
    renameSync(NATIVE_BINDING_PATH, stash)
    try {
      __resetForTest()
      let caught: unknown = null
      try {
        parseFormulaSync('1 + 2')
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(BindingLoadError)
      expect((caught as BindingLoadError).code).toBe('ANALYSIS_CORE_BINDING_LOAD_FAILED')
      expect((caught as Error).message).toContain('native binding not found')
    } finally {
      renameSync(stash, NATIVE_BINDING_PATH)
      __resetForTest()
    }
  })
})

describe('analysis_core: opt-in CLI fallback (debug-only)', () => {
  it('parses through the CLI binary when OPENALICE_ANALYSIS_CORE_USE_CLI=1', () => {
    process.env.OPENALICE_ANALYSIS_CORE_USE_CLI = '1'
    const ast = parseFormulaSync('5 * 6') as Record<string, unknown>
    expect(ast.type).toBe('binaryOp')
    expect((ast as { operator: string }).operator).toBe('*')
  })

  it('CLI fallback also surfaces BindingParseError on bad input', () => {
    process.env.OPENALICE_ANALYSIS_CORE_USE_CLI = '1'
    let caught: unknown = null
    try {
      parseFormulaSync('@')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(BindingParseError)
    expect((caught as Error).message).toBe("Unexpected character '@' at position 0")
  })
})
