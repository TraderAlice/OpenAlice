#!/usr/bin/env node
// analysis_core napi-rs bridge build helper.
//
// Wraps `cargo build` for the binding crate and copies the resulting
// platform cdylib into `packages/node-bindings/analysis-core/analysis-core.node`
// so the JS loader can `require('./analysis-core.node')` directly.
//
// We call `cargo build` instead of pulling in `@napi-rs/cli` to keep the
// npm dependency surface minimal under the OPE-17 allowed-files policy.
// `napi-build` (a build-dependency of the Rust crate) still configures
// the platform-specific link flags Node-API needs, so the artifact
// produced here is loadable by `process.dlopen` / `require`.

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function resolveCargoBin() {
  if (process.env.CARGO) return process.env.CARGO
  const sep = process.platform === 'win32' ? ';' : ':'
  const onPath = (process.env.PATH || '').split(sep)
  const exe = process.platform === 'win32' ? 'cargo.exe' : 'cargo'
  for (const dir of onPath) {
    if (!dir) continue
    const candidate = path.join(dir, exe)
    if (existsSync(candidate)) return candidate
  }
  // Standard rustup install location used by the OpenAlice bootstrap.
  const home = os.homedir()
  if (home) {
    const fallback = path.join(home, '.cargo', 'bin', exe)
    if (existsSync(fallback)) return fallback
  }
  throw new Error(
    'analysis_core: cargo not found on PATH. '
      + 'Install Rust via rustup (see docs/autonomous-refactor/reports/adapter-bootstrap/) '
      + 'or set the CARGO env var.',
  )
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..', '..')
const PROFILE = process.env.OPENALICE_NAPI_PROFILE === 'release' ? 'release' : 'debug'
const TARGET_DIR = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(REPO_ROOT, 'target')

const args = ['build', '-p', 'analysis-core-node-binding', '--lib']
if (PROFILE === 'release') args.push('--release')

const cargoBin = resolveCargoBin()
console.error(`[analysis-core] ${cargoBin} ${args.join(' ')} (cwd=${REPO_ROOT})`)
execFileSync(cargoBin, args, { cwd: REPO_ROOT, stdio: 'inherit' })

const candidates = [
  path.join(TARGET_DIR, PROFILE, 'libanalysis_core_node_binding.dylib'),
  path.join(TARGET_DIR, PROFILE, 'libanalysis_core_node_binding.so'),
  path.join(TARGET_DIR, PROFILE, 'analysis_core_node_binding.dll'),
]
const built = candidates.find((p) => existsSync(p) && statSync(p).isFile())
if (!built) {
  console.error(
    `[analysis-core] could not find built cdylib in: ${candidates.join(', ')}`,
  )
  process.exit(1)
}

mkdirSync(PKG_ROOT, { recursive: true })
const dest = path.join(PKG_ROOT, 'analysis-core.node')
copyFileSync(built, dest)
console.error(`[analysis-core] napi binding ready: ${dest}`)
