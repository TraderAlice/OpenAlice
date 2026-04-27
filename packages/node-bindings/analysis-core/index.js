// OpenAlice analysis_core Node binding - Phase 2 first parity slice.
//
// Until the napi-rs in-process bridge described in
// docs/autonomous-refactor/adr/ADR-003-binding-strategy.md lands, this
// module shells out to the `analysis-core-parse` Rust binary built by
// `cargo build` from `packages/node-bindings/analysis-core/`.
//
// The flag-controlled call site is in
// src/domain/analysis/indicator/calculator.ts. With
// OPENALICE_RUST_ANALYSIS unset, "0", or any non-"1" value the shim does
// not call this module and the legacy in-process TypeScript parser is
// used. Only OPENALICE_RUST_ANALYSIS="1" routes parser work through here.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN_BASENAME = process.platform === 'win32'
  ? 'analysis-core-parse.exe'
  : 'analysis-core-parse'

export function bootstrapHealthcheck() {
  return 'analysis_core:bootstrap'
}

function walkUpForCargoWorkspace(start) {
  let cur = path.resolve(start)
  while (true) {
    if (existsSync(path.join(cur, 'Cargo.toml'))) {
      // Could be a crate-level Cargo.toml; require either a workspace
      // entry or a target/ sibling to be confident it is the root.
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

  // Override for non-default layouts (CI, container builds).
  const override = process.env.OPENALICE_ANALYSIS_CORE_REPO_ROOT
  if (override) candidates.push(path.resolve(override))

  // Source-tree layout: index.js sits inside packages/node-bindings/
  // analysis-core/, three levels below the repo root.
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    candidates.push(path.resolve(here, '..', '..', '..'))
  } catch {
    // import.meta.url unavailable (e.g. exotic bundler); fall through.
  }

  // Process-cwd-driven walk-up for bundled runtimes that lose the
  // original module URL.
  const fromCwd = walkUpForCargoWorkspace(process.cwd())
  if (fromCwd) candidates.push(fromCwd)

  return candidates
}

function findBinaryPath() {
  for (const root of repoRootCandidates()) {
    const release = path.join(root, 'target', 'release', BIN_BASENAME)
    if (existsSync(release)) return release
    const debug = path.join(root, 'target', 'debug', BIN_BASENAME)
    if (existsSync(debug)) return debug
  }
  return null
}

function buildBinary() {
  const root = repoRootCandidates().find((r) => existsSync(path.join(r, 'Cargo.toml')))
  if (!root) {
    throw new Error(
      'analysis_core: cannot locate Cargo workspace root for build. '
        + 'Set OPENALICE_ANALYSIS_CORE_REPO_ROOT to the OpenAlice checkout.',
    )
  }
  const result = spawnSync(
    'cargo',
    ['build', '--bin', 'analysis-core-parse', '-p', 'analysis-core-node-binding'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.toString() : ''
    throw new Error(
      'analysis_core: failed to build the parse binary via cargo. '
        + 'Run `cargo build --bin analysis-core-parse -p analysis-core-node-binding` from the repo root. '
        + `cargo stderr: ${stderr.trim()}`,
    )
  }
  return findBinaryPath()
}

function ensureBinaryPath() {
  let binPath = findBinaryPath()
  if (binPath) return binPath
  binPath = buildBinary()
  if (!binPath) {
    throw new Error(
      'analysis_core: parse binary not found after cargo build. '
        + `Expected ${path.join('target', 'debug', BIN_BASENAME)} under the Cargo workspace root.`,
    )
  }
  return binPath
}

/**
 * Parse a formula via the Rust `analysis_core` parser.
 *
 * Returns the JSON-compatible AST DTO. Throws an Error whose message
 * matches the legacy TypeScript parser for parser-relevant cases.
 *
 * @param {string} formula
 * @returns {object}
 */
export function parseFormulaSync(formula) {
  if (typeof formula !== 'string') {
    throw new TypeError('parseFormulaSync expects a string formula')
  }
  const binPath = ensureBinaryPath()
  const result = spawnSync(binPath, [], {
    input: formula,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error) {
    throw new Error(
      `analysis_core: failed to spawn parse binary: ${result.error.message}`,
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `analysis_core: parse binary exited with status ${result.status}; `
        + `stderr: ${(result.stderr || '').trim()}`,
    )
  }
  const stdout = (result.stdout || '').trim()
  if (!stdout) {
    throw new Error('analysis_core: parse binary produced empty stdout')
  }
  let envelope
  try {
    envelope = JSON.parse(stdout)
  } catch (err) {
    throw new Error(
      `analysis_core: parse binary produced invalid JSON: ${err.message}; raw: ${stdout}`,
    )
  }
  if (envelope && envelope.ok === true) {
    return envelope.ast
  }
  if (envelope && envelope.ok === false && typeof envelope.message === 'string') {
    throw new Error(envelope.message)
  }
  throw new Error(`analysis_core: unrecognized parse envelope: ${stdout}`)
}
