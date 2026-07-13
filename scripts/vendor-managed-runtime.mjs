#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
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

const PI_VERSION = '0.80.6'
const PI_RELEASE_BASE = `https://github.com/earendil-works/pi/releases/download/v${PI_VERSION}`
const PI_ASSETS = [
  {
    name: 'package.json',
    url: `${PI_RELEASE_BASE}/pi-coding-agent-install-package.json`,
    sha256: 'ee080db64c3732daea5547bd6d9809465ffa236ef6099051e64a16753e48b795',
  },
  {
    name: 'package-lock.json',
    url: `${PI_RELEASE_BASE}/pi-coding-agent-install-package-lock.json`,
    sha256: '0f409bf498507f93bfbde3dc6f2b4c83bc58bdea2e2f5eabf3053cc2a81568d4',
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

const MANAGED_SEARCH_TOOL_RUNTIMES = {
  'darwin-arm64': searchToolRuntime('darwin', 'arm64', {
    fd: releaseAsset({
      id: 'fd',
      version: '10.4.2',
      binaryName: 'fd',
      url: 'https://github.com/sharkdp/fd/releases/download/v10.4.2/fd-v10.4.2-aarch64-apple-darwin.tar.gz',
      sha256: '623dc0afc81b92e4d4606b380d7bc91916ba7b97814263e554d50923a39e480a',
      licenses: ['LICENSE-APACHE', 'LICENSE-MIT'],
    }),
    rg: releaseAsset({
      id: 'rg',
      version: '15.1.0',
      binaryName: 'rg',
      url: 'https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-aarch64-apple-darwin.tar.gz',
      sha256: '378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715',
      licenses: ['LICENSE-MIT', 'UNLICENSE'],
    }),
  }),
  'darwin-x64': searchToolRuntime('darwin', 'x64', {
    // fd 10.4.x no longer publishes an Intel macOS asset.
    fd: releaseAsset({
      id: 'fd',
      version: '10.3.0',
      binaryName: 'fd',
      url: 'https://github.com/sharkdp/fd/releases/download/v10.3.0/fd-v10.3.0-x86_64-apple-darwin.tar.gz',
      sha256: '50d30f13fe3d5914b14c4fff5abcbd4d0cdab4b855970a6956f4f006c17117a3',
      licenses: ['LICENSE-APACHE', 'LICENSE-MIT'],
    }),
    rg: releaseAsset({
      id: 'rg',
      version: '15.1.0',
      binaryName: 'rg',
      url: 'https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-x86_64-apple-darwin.tar.gz',
      sha256: '64811cb24e77cac3057d6c40b63ac9becf9082eedd54ca411b475b755d334882',
      licenses: ['LICENSE-MIT', 'UNLICENSE'],
    }),
  }),
  'win32-x64': searchToolRuntime('win32', 'x64', {
    fd: releaseAsset({
      id: 'fd',
      version: '10.4.2',
      binaryName: 'fd.exe',
      url: 'https://github.com/sharkdp/fd/releases/download/v10.4.2/fd-v10.4.2-x86_64-pc-windows-msvc.zip',
      sha256: 'b2816e506390a89941c63c9187d58a3cc10e9a55f2ef0685f9ea0eccaf7c98c8',
      licenses: ['LICENSE-APACHE', 'LICENSE-MIT'],
    }),
    rg: releaseAsset({
      id: 'rg',
      version: '15.1.0',
      binaryName: 'rg.exe',
      url: 'https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-x86_64-pc-windows-msvc.zip',
      sha256: '124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a',
      licenses: ['LICENSE-MIT', 'UNLICENSE'],
    }),
  }),
  'win32-arm64': searchToolRuntime('win32', 'arm64', {
    fd: releaseAsset({
      id: 'fd',
      version: '10.4.2',
      binaryName: 'fd.exe',
      url: 'https://github.com/sharkdp/fd/releases/download/v10.4.2/fd-v10.4.2-aarch64-pc-windows-msvc.zip',
      sha256: '4f9110c2d5b33a7f760bfa5510f4c113d828109f7277d421b1053a9943c0fc92',
      licenses: ['LICENSE-APACHE', 'LICENSE-MIT'],
    }),
    rg: releaseAsset({
      id: 'rg',
      version: '15.1.0',
      binaryName: 'rg.exe',
      url: 'https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-aarch64-pc-windows-msvc.zip',
      sha256: '00d931fb5237c9696ca49308818edb76d8eb6fc132761cb2a1bd616b2df02f8e',
      licenses: ['LICENSE-MIT', 'UNLICENSE'],
    }),
  }),
}

function releaseAsset(spec) {
  return spec
}

function searchToolRuntime(platform, arch, tools) {
  const platformArch = `${platform}-${arch}`
  return {
    platform,
    arch,
    platformArch,
    root: `vendor/tools/${platformArch}`,
    binPath: 'bin',
    licensesPath: 'licenses',
    tools,
  }
}

function printHelp() {
  console.log(`Usage: pnpm vendor:runtime [options]

Prepare managed workspace runtimes under vendor/.

Options:
  --force    Reinstall managed runtimes even if they already match
  -h, --help Show this help
`)
}

async function main() {
  parseArgs(process.argv.slice(2))
  await mkdir(vendorRoot, { recursive: true })
  await vendorPi()
  const searchToolsSpec = await vendorManagedSearchTools()
  const gitSpec = await vendorWindowsGit()
  await writeManifest(gitSpec, searchToolsSpec)
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

async function vendorManagedSearchTools() {
  const spec = resolveManagedSearchToolsSpec()
  if (!spec) {
    console.log(`[vendor-runtime] managed fd/rg skipped on unsupported ${process.platform}-${process.arch} host`)
    return null
  }

  const existingManifest = readManifest()
  const existing = existingManifest?.searchTools?.[spec.platformArch]
  const isCurrent = Object.values(spec.tools).every((tool) => (
    existing?.[tool.id]?.version === tool.version &&
    existing?.[tool.id]?.sha256 === tool.sha256
  ))
  if (
    !force &&
    isCurrent &&
    requiredManagedSearchToolFiles(spec).every((file) => existsSync(resolve(repoRoot, spec.root, file)))
  ) {
    console.log(`[vendor-runtime] managed fd/rg already present at ${spec.root}`)
    return spec
  }

  const toolsParent = resolve(vendorRoot, 'tools')
  const finalRoot = resolve(repoRoot, spec.root)
  await mkdir(toolsParent, { recursive: true })
  let stagingRoot = await mkdtemp(resolve(toolsParent, `.${spec.platformArch}-`))
  try {
    const binDir = resolve(stagingRoot, spec.binPath)
    await mkdir(binDir, { recursive: true })

    for (const tool of Object.values(spec.tools)) {
      const bytes = await download(tool.url)
      verifySha256(bytes, tool.sha256, tool.url)

      const extractRoot = await mkdtemp(resolve(tmpdir(), `openalice-${tool.id}-`))
      const archivePath = resolve(extractRoot, basename(tool.url))
      try {
        await writeFile(archivePath, bytes)
        extractArchive(tool.id, archivePath, extractRoot)

        const binary = findFileRecursively(extractRoot, tool.binaryName)
        if (!binary) throw new Error(`${tool.binaryName} missing after extracting ${tool.url}`)
        const destination = resolve(binDir, tool.binaryName)
        await copyFile(binary, destination)
        if (spec.platform !== 'win32') await chmod(destination, 0o755)

        const licenseDir = resolve(stagingRoot, spec.licensesPath, tool.id)
        await mkdir(licenseDir, { recursive: true })
        for (const licenseName of tool.licenses) {
          const license = findFileRecursively(extractRoot, licenseName)
          if (!license) throw new Error(`${licenseName} missing after extracting ${tool.url}`)
          await copyFile(license, resolve(licenseDir, licenseName))
        }
      } finally {
        await rm(extractRoot, { recursive: true, force: true })
      }
    }

    const missing = requiredManagedSearchToolFiles(spec)
      .filter((file) => !existsSync(resolve(stagingRoot, file)))
    if (missing.length > 0) {
      throw new Error(`managed fd/rg staging missing required files: ${missing.join(', ')}`)
    }

    await rm(finalRoot, { recursive: true, force: true })
    await rename(stagingRoot, finalRoot)
    stagingRoot = null
    console.log(`[vendor-runtime] managed fd/rg -> ${relativeForLog(resolve(finalRoot, spec.binPath))}`)
    return spec
  } finally {
    if (stagingRoot) await rm(stagingRoot, { recursive: true, force: true })
  }
}

function extractArchive(toolId, archivePath, destination) {
  if (archivePath.endsWith('.tar.gz')) {
    run(`extract ${toolId}`, windowsTarCommand(), ['-xzf', archivePath, '-C', destination])
    return
  }
  if (archivePath.endsWith('.zip')) {
    run(`extract ${toolId}`, windowsTarCommand(), ['-xf', archivePath, '-C', destination])
    return
  }
  throw new Error(`unsupported managed tool archive: ${archivePath}`)
}

function windowsTarCommand() {
  if (process.platform !== 'win32') return 'tar'
  const systemRoot = process.env['SystemRoot'] ?? process.env['WINDIR']
  const systemTar = systemRoot ? resolve(systemRoot, 'System32', 'tar.exe') : null
  return systemTar && existsSync(systemTar) ? systemTar : 'tar.exe'
}

function findFileRecursively(root, fileName) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name)
    if (entry.isFile() && entry.name === fileName) return path
    if (entry.isDirectory()) {
      const nested = findFileRecursively(path, fileName)
      if (nested) return nested
    }
  }
  return null
}

async function download(url, attempts = 3) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`[vendor-runtime] download ${url}${attempt > 1 ? ` (attempt ${attempt}/${attempts})` : ''}`)
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      lastError = err
      if (attempt < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1_000))
    }
  }
  const detail = lastError instanceof Error
    ? `${lastError.message}${lastError.cause instanceof Error ? `: ${lastError.cause.message}` : ''}`
    : String(lastError)
  throw new Error(`failed to download ${url} after ${attempts} attempts: ${detail}`)
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
    throw new Error(`${label} failed to start ${command}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`${label} exited ${result.status ?? 'unknown'}${result.signal ? ` (${result.signal})` : ''}`)
  }
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

export function buildVendorRuntimeManifest(gitSpec = null, searchToolsSpec = null) {
  const manifest = {
    pi: {
      version: PI_VERSION,
      mode: 'npm',
      root: 'vendor/pi',
      cli: relativeForManifest(piCliPath),
      node: 'electron',
    },
  }
  if (searchToolsSpec) {
    manifest.searchTools = {
      [searchToolsSpec.platformArch]: {
        path: searchToolsSpec.root,
        binPath: searchToolsSpec.binPath,
        ...Object.fromEntries(Object.values(searchToolsSpec.tools).map((tool) => [
          tool.id,
          {
            version: tool.version,
            binary: `${searchToolsSpec.binPath}/${tool.binaryName}`,
            distribution: tool.id === 'fd' ? 'sharkdp/fd' : 'BurntSushi/ripgrep',
            url: tool.url,
            sha256: tool.sha256,
            licenses: tool.licenses.map((name) => `${searchToolsSpec.licensesPath}/${tool.id}/${name}`),
          },
        ])),
      },
    }
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

async function writeManifest(gitSpec, searchToolsSpec) {
  const manifest = buildVendorRuntimeManifest(gitSpec, searchToolsSpec)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`[vendor-runtime] manifest -> ${relativeForLog(manifestPath)}`)
}

export function resolveManagedSearchToolsSpec(opts = {}) {
  const platform = opts.platform ?? process.platform
  const arch = opts.arch ?? process.arch
  return MANAGED_SEARCH_TOOL_RUNTIMES[`${platform}-${arch}`] ?? null
}

export function requiredManagedSearchToolFiles(spec) {
  return Object.values(spec.tools).flatMap((tool) => [
    `${spec.binPath}/${tool.binaryName}`,
    ...tool.licenses.map((name) => `${spec.licensesPath}/${tool.id}/${name}`),
  ])
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
