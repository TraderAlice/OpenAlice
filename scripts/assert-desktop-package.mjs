#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')
const packageRoot = resolve(repoRoot, 'dist', 'electron-app')

export const RESOURCE_ROOT_RELATIVE_CANDIDATES = [
  'mac-arm64/OpenAlice.app/Contents/Resources/app',
  'mac/OpenAlice.app/Contents/Resources/app',
  'OpenAlice.app/Contents/Resources/app',
  'win-unpacked/resources/app',
  'linux-unpacked/resources/app',
]

export const BASE_REQUIRED_FILES = [
  'package.json',
  'dist/main.js',
  'dist/electron/main.js',
  'ui/dist/index.html',
  'services/uta/dist/uta.js',
  'src/workspaces/cli/bin/alice',
  'src/workspaces/cli/bin/alice.cmd',
  'src/workspaces/templates/_common.mjs',
  'src/workspaces/templates/chat/bootstrap.mjs',
  'vendor/manifest.json',
  'vendor/pi/package.json',
  'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
]

export function assertDesktopPackage(options = {}) {
  const root = options.packageRoot ?? packageRoot
  const repo = options.repoRoot ?? repoRoot
  const candidates = RESOURCE_ROOT_RELATIVE_CANDIDATES.map((p) => resolve(root, p))
  const appRoot = options.appRoot ?? candidates.find((p) => existsSync(join(p, 'package.json')))
  const errors = []
  if (!appRoot) {
    errors.push('[desktop-package] app resources root not found. Checked:')
    for (const candidate of candidates) {
      errors.push(`  - ${relative(repo, candidate)}`)
    }
    return { ok: false, errors, appRoot: null, manifest: null, platform: null, platformArch: null }
  }

  const platform = options.platform ?? platformFromAppRoot(appRoot)
  const arch = options.arch ?? process.arch
  const platformArch = `${platform}-${arch}`
  const requiredFiles = [...BASE_REQUIRED_FILES, ...platformRequiredFiles(platform, platformArch)]
  const missing = requiredFiles.filter((file) => !existsSync(join(appRoot, file)))
  if (missing.length > 0) {
    errors.push(`[desktop-package] ${relative(repo, appRoot)} is missing required packaged files:`)
    for (const file of missing) errors.push(`  - ${file}`)
  }

  const manifestPath = join(appRoot, 'vendor', 'manifest.json')
  let manifest = null
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    errors.push(`[desktop-package] failed to read vendor manifest: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (manifest?.pi?.mode !== 'npm') {
    errors.push(`[desktop-package] expected manifest.pi.mode="npm", got ${JSON.stringify(manifest?.pi?.mode)}`)
  }
  const piCli = typeof manifest?.pi?.cli === 'string' ? manifest.pi.cli.replaceAll('\\', '/') : null
  if (piCli !== 'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js') {
    errors.push(`[desktop-package] unexpected manifest.pi.cli: ${JSON.stringify(manifest?.pi?.cli)}`)
  }

  const fd = manifest?.fd?.[platformArch]
  const expectedFdPath = managedFdPath(platform, platformArch)
  if (!fd) {
    errors.push(`[desktop-package] expected manifest.fd.${platformArch} for managed fd`)
  } else if (normalizeManifestPath(fd.path) !== expectedFdPath) {
    errors.push(`[desktop-package] unexpected manifest.fd.${platformArch}.path: ${JSON.stringify(fd.path)}`)
  }

  if (platform === 'win32') {
    const git = manifest?.git?.[platformArch]
    if (!git) {
      errors.push(`[desktop-package] expected manifest.git.${platformArch} for Windows managed Git Bash`)
    } else {
      if (git.path !== `vendor/git/${platformArch}`) {
        errors.push(`[desktop-package] unexpected manifest.git.${platformArch}.path: ${JSON.stringify(git.path)}`)
      }
      if (normalizeManifestPath(git.gitBin) !== 'cmd/git.exe') {
        errors.push(`[desktop-package] unexpected manifest.git.${platformArch}.gitBin: ${JSON.stringify(git.gitBin)}`)
      }
      if (normalizeManifestPath(git.shellPath) !== 'bin/bash.exe') {
        errors.push(`[desktop-package] unexpected manifest.git.${platformArch}.shellPath: ${JSON.stringify(git.shellPath)}`)
      }
      if (normalizeManifestPath(git.shPath) !== 'bin/sh.exe') {
        errors.push(`[desktop-package] unexpected manifest.git.${platformArch}.shPath: ${JSON.stringify(git.shPath)}`)
      }
    }
  }

  return { ok: errors.length === 0, errors, appRoot, manifest, platform, platformArch }
}

export function platformFromAppRoot(appRoot) {
  const normalized = appRoot.replaceAll('\\', '/')
  if (normalized.includes('/win-unpacked/')) return 'win32'
  if (normalized.includes('/linux-unpacked/')) return 'linux'
  if (normalized.includes('.app/Contents/Resources/app')) return 'darwin'
  return process.platform
}

function platformRequiredFiles(platform, platformArch) {
  const files = []
  files.push(managedFdPath(platform, platformArch))
  if (platform !== 'win32') return files
  files.push(
    `vendor/git/${platformArch}/cmd/git.exe`,
    `vendor/git/${platformArch}/bin/bash.exe`,
    `vendor/git/${platformArch}/bin/sh.exe`,
  )
  return files
}

function managedFdPath(platform, platformArch) {
  return `vendor/tools/${platformArch}/${platform === 'win32' ? 'fd.exe' : 'fd'}`
}

function normalizeManifestPath(value) {
  return typeof value === 'string' ? value.replaceAll('\\', '/') : null
}

function main() {
  const result = assertDesktopPackage()
  if (!result.ok) {
    for (const error of result.errors) console.error(error)
    process.exit(1)
  }
  console.log(`[desktop-package] app resources OK: ${relative(repoRoot, result.appRoot)}`)
  console.log(`[desktop-package] managed Pi: ${result.manifest.pi.version} (${result.manifest.pi.mode})`)
  console.log(`[desktop-package] managed fd: ${result.manifest.fd[result.platformArch].version} (${result.platformArch})`)
  if (result.platform === 'win32') {
    const git = result.manifest.git[result.platformArch]
    console.log(`[desktop-package] managed Git Bash: ${git.version} (${result.platformArch})`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
