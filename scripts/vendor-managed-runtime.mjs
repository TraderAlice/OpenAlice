#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')
const vendorRoot = resolve(repoRoot, 'vendor')
const piRoot = resolve(vendorRoot, 'pi')
const manifestPath = resolve(vendorRoot, 'manifest.json')
const piCliPath = resolve(
  piRoot,
  'node_modules',
  '@earendil-works',
  'pi-coding-agent',
  'dist',
  'cli.js',
)

const knownArgs = new Set(['--force', '--help', '-h'])
let force = false

const PI_VERSION = '0.80.3'
const PI_RELEASE_BASE = `https://github.com/earendil-works/pi/releases/download/v${PI_VERSION}`
const PI_ASSETS = [
  {
    name: 'package.json',
    url: `${PI_RELEASE_BASE}/pi-coding-agent-install-package.json`,
    sha256: 'ba96c5a6183936a113a7a48de45fdae8cd4489a22f4cc481fbce74afae85b6c7',
  },
  {
    name: 'package-lock.json',
    url: `${PI_RELEASE_BASE}/pi-coding-agent-install-package-lock.json`,
    sha256: '0d32c0854a23486ee80f7c82b9fad4bb5b03a380c649d5af105ad1a3c88fc54d',
  },
]

const PORTABLE_GIT_VERSION = '2.55.0.2'
const PORTABLE_GIT_TAG = 'v2.55.0.windows.2'
const WINDOWS_GIT_RUNTIMES = {
  x64: {
    platformArch: 'win32-x64',
    assetName: `PortableGit-${PORTABLE_GIT_VERSION}-64-bit.7z.exe`,
    sha256: 'b20d42da3afa228e9fa6174480de820282667e799440d655e308f700dfa0d0df',
  },
  arm64: {
    platformArch: 'win32-arm64',
    assetName: `PortableGit-${PORTABLE_GIT_VERSION}-arm64.7z.exe`,
    sha256: '65b913a56a62d7a91fc11a2eecb08422aaa34332d3b2ea39457d2eda02c2f99c',
  },
}

function printHelp() {
  console.log(`Usage: pnpm vendor:runtime [options]

Prepare managed workspace runtimes under vendor/.

Options:
  --force    Remove and reinstall vendor/pi even if it already matches
  -h, --help Show this help
`)
}

async function main() {
  parseArgs(process.argv.slice(2))
  await mkdir(vendorRoot, { recursive: true })
  await vendorPi()
  const gitSpec = await vendorWindowsGit()
  await writeManifest(gitSpec)
}

function parseArgs(argv) {
  const args = new Set(argv)
  const help = args.has('--help') || args.has('-h')
  const unknownArgs = [...args].filter((arg) => !knownArgs.has(arg))
  force = args.has('--force')
  if (help) {
    printHelp()
    process.exit(0)
  }
  if (unknownArgs.length > 0) {
    console.error(`[vendor-runtime] unknown option(s): ${unknownArgs.join(', ')}`)
    printHelp()
    process.exit(1)
  }
}

async function vendorPi() {
  const existingManifest = readManifest()
  if (
    !force &&
    existingManifest?.pi?.version === PI_VERSION &&
    existingManifest?.pi?.mode === 'npm' &&
    existsSync(piCliPath)
  ) {
    console.log(`[vendor-runtime] Pi ${PI_VERSION} already present at ${relativeForLog(piCliPath)}`)
    return
  }

  console.log(`[vendor-runtime] preparing Pi ${PI_VERSION} npm runtime`)
  await rm(piRoot, { recursive: true, force: true })
  await mkdir(piRoot, { recursive: true })

  for (const asset of PI_ASSETS) {
    const bytes = await download(asset.url)
    verifySha256(bytes, asset.sha256, asset.url)
    await writeFile(resolve(piRoot, asset.name), bytes)
  }

  run('npm ci for managed Pi', 'npm', [
    'ci',
    '--omit=dev',
    '--ignore-scripts',
  ], { cwd: piRoot, shell: process.platform === 'win32' })

  if (!existsSync(piCliPath)) {
    throw new Error(`managed Pi CLI missing after npm ci: ${piCliPath}`)
  }
  console.log(`[vendor-runtime] Pi CLI -> ${relativeForLog(piCliPath)}`)
}

async function vendorWindowsGit() {
  const spec = resolveWindowsGitRuntimeSpec()
  if (!spec) {
    console.log('[vendor-runtime] managed Git Bash skipped on non-Windows host')
    return null
  }

  const existingManifest = readManifest()
  if (
    !force &&
    existingManifest?.git?.[spec.platformArch]?.version === spec.version &&
    requiredWindowsGitFiles(spec).every((file) => existsSync(resolve(repoRoot, spec.root, file)))
  ) {
    console.log(`[vendor-runtime] Git for Windows ${spec.version} already present at ${spec.root}`)
    return spec
  }

  const gitRoot = resolve(repoRoot, spec.root)
  console.log(`[vendor-runtime] preparing Git for Windows ${spec.version} at ${relativeForLog(gitRoot)}`)
  await rm(gitRoot, { recursive: true, force: true })
  await mkdir(gitRoot, { recursive: true })

  const bytes = await download(spec.url)
  verifySha256(bytes, spec.sha256, spec.url)

  const tmpRoot = await mkdtemp(resolve(tmpdir(), 'openalice-portablegit-'))
  const archivePath = resolve(tmpRoot, basename(spec.url))
  try {
    await writeFile(archivePath, bytes)
    run('extract Git for Windows PortableGit', archivePath, ['-y', `-o${gitRoot}`])
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }

  const missing = requiredWindowsGitFiles(spec)
    .filter((file) => !existsSync(resolve(repoRoot, spec.root, file)))
  if (missing.length > 0) {
    throw new Error(`Git for Windows extraction missing required files: ${missing.join(', ')}`)
  }
  console.log(`[vendor-runtime] Git for Windows -> ${relativeForLog(gitRoot)}`)
  return spec
}

async function download(url) {
  console.log(`[vendor-runtime] download ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

function verifySha256(bytes, expected, label) {
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expected) {
    throw new Error(`${label} sha256 mismatch: expected ${expected}, got ${actual}`)
  }
}

function run(label, command, commandArgs, opts = {}) {
  console.log(`\n[vendor-runtime] ${label}`)
  const result = spawnSync(command, commandArgs, {
    cwd: opts.cwd ?? repoRoot,
    stdio: 'inherit',
    env: process.env,
    shell: opts.shell ?? false,
  })
  if (result.error) {
    console.error(`[vendor-runtime] failed to start ${command}: ${result.error.message}`)
  }
  if (result.status !== 0 || result.error) process.exit(result.status ?? 1)
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

export function buildVendorRuntimeManifest(gitSpec = null) {
  const manifest = {
    pi: {
      version: PI_VERSION,
      mode: 'npm',
      root: 'vendor/pi',
      cli: relativeForManifest(piCliPath),
      node: 'electron',
    },
  }
  if (gitSpec) {
    manifest.git = {
      [gitSpec.platformArch]: {
        version: gitSpec.version,
        distribution: 'PortableGit',
        url: gitSpec.url,
        sha256: gitSpec.sha256,
        path: gitSpec.root,
        gitBin: gitSpec.gitBin,
        shellPath: gitSpec.shellPath,
        shPath: gitSpec.shPath,
        toolchainPaths: gitSpec.toolchainPaths,
      },
    }
  }
  return manifest
}

async function writeManifest(gitSpec) {
  const manifest = buildVendorRuntimeManifest(gitSpec)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`[vendor-runtime] manifest -> ${relativeForLog(manifestPath)}`)
}

export function resolveWindowsGitRuntimeSpec(opts = {}) {
  const platform = opts.platform ?? process.platform
  const arch = opts.arch ?? process.arch
  if (platform !== 'win32') return null
  const runtime = WINDOWS_GIT_RUNTIMES[arch]
  if (!runtime) {
    throw new Error(`unsupported Windows architecture for managed Git runtime: ${arch}`)
  }
  const root = `vendor/git/${runtime.platformArch}`
  return {
    version: PORTABLE_GIT_VERSION,
    platformArch: runtime.platformArch,
    url: `https://github.com/git-for-windows/git/releases/download/${PORTABLE_GIT_TAG}/${runtime.assetName}`,
    sha256: runtime.sha256,
    root,
    gitBin: 'cmd/git.exe',
    shellPath: 'bin/bash.exe',
    shPath: 'bin/sh.exe',
    toolchainPaths: [
      'cmd',
      'bin',
      'usr/bin',
      arch === 'arm64' ? 'clangarm64/bin' : 'mingw64/bin',
    ],
  }
}

export function requiredWindowsGitFiles(spec) {
  return [spec.gitBin, spec.shellPath, spec.shPath]
}

function relativeForManifest(path) {
  return relative(repoRoot, path).replaceAll('\\', '/')
}

function relativeForLog(path) {
  return relative(repoRoot, path)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[vendor-runtime] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
