#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { extractFile, listPackage, statFile } from '@electron/asar'
import { DEFAULT_DESKTOP_PACKAGE_ROOT, resolveDesktopPackageRootArg } from './desktop-package-artifact.mjs'
import { INSTALL_INTEGRITY_FILE, readInstallIntegrity, verifyInstallIntegrity } from './desktop-install-integrity.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')

export const RESOURCE_ROOT_RELATIVE_CANDIDATES = [
  'mac-arm64/OpenAlice.app/Contents/Resources/runtime',
  'mac/OpenAlice.app/Contents/Resources/runtime',
  'OpenAlice.app/Contents/Resources/runtime',
  'win-unpacked/resources/runtime',
  'linux-unpacked/resources/runtime',
]

export const BASE_REQUIRED_FILES = [
  'package.json',
  'ui/dist/index.html',
  'src/workspaces/cli/bin/openalice-cli.cjs',
  'src/workspaces/cli/bin/alice',
  'src/workspaces/cli/bin/alice.cmd',
  'src/workspaces/cli/bin/alice-workspace',
  'src/workspaces/cli/bin/alice-workspace.cmd',
  'src/workspaces/cli/bin/traderhub',
  'src/workspaces/cli/bin/traderhub.cmd',
  'src/workspaces/cli/bin/alice-uta',
  'src/workspaces/cli/bin/alice-uta.cmd',
  'src/workspaces/cli/bin/pi-session-provider.ts',
  'src/workspaces/templates/_common.mjs',
  'src/workspaces/templates/chat/bootstrap.mjs',
  'vendor/manifest.json',
  'vendor/pi/package.json',
  'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
]

export const ASAR_REQUIRED_FILES = [
  'package.json',
  'dist/main.js',
  'dist/electron/main.js',
  'dist/electron/preload.js',
  'services/uta/dist/uta.js',
  'services/connector/dist/connector.cjs',
  'node_modules/dugite/package.json',
  'node_modules/dugite/build/lib/index.js',
]

export const FORBIDDEN_BROKER_SDKS = [
  { packagePath: 'ccxt', pnpmPrefix: 'ccxt@' },
  { packagePath: 'longbridge', pnpmPrefix: 'longbridge@' },
  { packagePath: 'longbridge-darwin-arm64', pnpmPrefix: 'longbridge-' },
  { packagePath: 'longbridge-darwin-x64', pnpmPrefix: 'longbridge-' },
  { packagePath: 'longbridge-linux-x64-gnu', pnpmPrefix: 'longbridge-' },
  { packagePath: 'longbridge-win32-x64-msvc', pnpmPrefix: 'longbridge-' },
  { packagePath: '@alpacahq/alpaca-trade-api', pnpmPrefix: '@alpacahq+alpaca-trade-api@' },
]

export function assertDesktopPackage(options = {}) {
  const root = options.packageRoot ?? DEFAULT_DESKTOP_PACKAGE_ROOT
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

  const archivePath = join(dirname(appRoot), 'app.asar')
  const unpackedRoot = `${archivePath}.unpacked`
  let archiveEntries = []
  try {
    archiveEntries = listPackage(archivePath).map((entry) => entry.replaceAll('\\', '/').replace(/^\//, ''))
    for (const file of ASAR_REQUIRED_FILES) {
      // ASAR's directory lookup splits on path.sep, including on Windows.
      const stat = statFile(archivePath, normalize(file))
      if ('files' in stat) throw new Error(`${file} must be a file`)
      if (stat.unpacked && (!file.startsWith('node_modules/') || !existsSync(join(unpackedRoot, file)))) {
        throw new Error(`${file} must be packed or an available native dependency`)
      }
    }
    const archiveMetadata = JSON.parse(extractFile(archivePath, 'package.json').toString())
    const runtimeMetadata = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
    if (archiveMetadata.version !== runtimeMetadata.version) throw new Error('archive/runtime product versions differ')
    for (const entry of archiveEntries) {
      const externalResource = /^(vendor|ui|default)(\/|$)/.test(entry) || entry.startsWith('src/workspaces/')
      // Windows builder can retain empty parent directories after excluding
      // extraResources. Only actual files represent duplicated payloads.
      if (externalResource && !('files' in statFile(archivePath, normalize(entry)))) {
        throw new Error(`external runtime resource duplicated in ASAR: ${entry}`)
      }
    }
    // Every native payload advertised by the archive must exist on disk;
    // successful JS imports alone cannot prove PTY/helper executability.
    const nativeFiles = archiveEntries.filter((entry) => /\.node$|\/spawn-helper$/.test(entry))
    if (!nativeFiles.some((entry) => entry.startsWith('node_modules/node-pty/'))) {
      throw new Error('node-pty native payload is missing')
    }
    for (const file of nativeFiles) {
      if (!statFile(archivePath, normalize(file)).unpacked || !existsSync(join(unpackedRoot, file))) {
        throw new Error(`native payload must be unpacked: ${file}`)
      }
    }
    // Compiler intermediates only add extraction surface to the installer.
    const buildIntermediates = archiveEntries.filter((entry) =>
      /^node_modules\/node-pty\/build\/.*(\/obj\/|\.(exp|iobj|ipdb|lib|pdb|tlog)$)/.test(entry) &&
      !('files' in statFile(archivePath, normalize(entry))))
    if (buildIntermediates.length > 0) {
      throw new Error(`node-pty build intermediates must not ship: ${buildIntermediates[0]}`)
    }
  } catch (error) {
    errors.push(`[desktop-package] invalid app.asar: ${error instanceof Error ? error.message : String(error)}`)
  }

  const resourcesRoot = dirname(appRoot)
  try {
    const integrity = verifyInstallIntegrity(resourcesRoot, readInstallIntegrity(resourcesRoot))
    for (const file of integrity.missing) errors.push(`[desktop-package] ${INSTALL_INTEGRITY_FILE} lists a missing file: ${file}`)
    for (const file of integrity.mismatched) errors.push(`[desktop-package] ${INSTALL_INTEGRITY_FILE} size differs on disk: ${file}`)
  } catch (error) {
    errors.push(`[desktop-package] unreadable ${INSTALL_INTEGRITY_FILE}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const nodeModules = join(unpackedRoot, 'node_modules')
  const virtualStore = join(nodeModules, '.pnpm')
  const virtualEntries = existsSync(virtualStore) ? readdirSync(virtualStore) : []
  const bundledBrokerSdks = FORBIDDEN_BROKER_SDKS.filter(({ packagePath, pnpmPrefix }) =>
    archiveEntries.some((entry) => entry === `node_modules/${packagePath}` || entry.startsWith(`node_modules/${packagePath}/`)) ||
    existsSync(join(nodeModules, packagePath)) || virtualEntries.some((entry) => entry.startsWith(pnpmPrefix)),
  )
  if (bundledBrokerSdks.length > 0) {
    errors.push('[desktop-package] optional broker SDKs must ship only in downloadable Broker Packs:')
    for (const sdk of bundledBrokerSdks) errors.push(`  - ${sdk.packagePath}`)
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

  if (platform === 'win32' || platform === 'darwin') {
    const searchTools = manifest?.searchTools?.[platformArch]
    if (!searchTools) {
      errors.push(`[desktop-package] expected manifest.searchTools.${platformArch} for managed fd/rg`)
    } else {
      if (searchTools.path !== `vendor/tools/${platformArch}`) {
        errors.push(
          `[desktop-package] unexpected manifest.searchTools.${platformArch}.path: ${JSON.stringify(searchTools.path)}`,
        )
      }
      if (normalizeManifestPath(searchTools.fd?.binary) !== `bin/fd${platform === 'win32' ? '.exe' : ''}`) {
        errors.push(
          `[desktop-package] unexpected manifest.searchTools.${platformArch}.fd.binary: ${JSON.stringify(searchTools.fd?.binary)}`,
        )
      }
      if (normalizeManifestPath(searchTools.rg?.binary) !== `bin/rg${platform === 'win32' ? '.exe' : ''}`) {
        errors.push(
          `[desktop-package] unexpected manifest.searchTools.${platformArch}.rg.binary: ${JSON.stringify(searchTools.rg?.binary)}`,
        )
      }
    }
  }

  if (platform === 'win32') {
    const embeddedDugiteGit = join(unpackedRoot, 'node_modules', 'dugite', 'git')
    if (existsSync(embeddedDugiteGit) || archiveEntries.some((entry) => entry.startsWith('node_modules/dugite/git/'))) {
      errors.push(
        '[desktop-package] Windows must use managed PortableGit; dugite\'s embedded Git payload is forbidden',
      )
    }

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

  if (platform === 'darwin' && !existsSync(join(unpackedRoot, 'node_modules/dugite/git/bin/git'))) {
    errors.push('[desktop-package] macOS requires unpacked node_modules/dugite/git/bin/git')
  }

  return { ok: errors.length === 0, errors, appRoot, archivePath, unpackedRoot, manifest, platform, platformArch }
}

export function platformFromAppRoot(appRoot) {
  const normalized = appRoot.replaceAll('\\', '/')
  if (normalized.includes('/win-unpacked/')) return 'win32'
  if (normalized.includes('/linux-unpacked/')) return 'linux'
  if (normalized.includes('.app/Contents/Resources/runtime')) return 'darwin'
  return process.platform
}

function platformRequiredFiles(platform, platformArch) {
  const searchTools = platform === 'win32' || platform === 'darwin'
    ? [
        `vendor/tools/${platformArch}/bin/fd${platform === 'win32' ? '.exe' : ''}`,
        `vendor/tools/${platformArch}/bin/rg${platform === 'win32' ? '.exe' : ''}`,
        `vendor/tools/${platformArch}/licenses/fd/LICENSE-APACHE`,
        `vendor/tools/${platformArch}/licenses/fd/LICENSE-MIT`,
        `vendor/tools/${platformArch}/licenses/rg/LICENSE-MIT`,
        `vendor/tools/${platformArch}/licenses/rg/UNLICENSE`,
      ]
    : []
  const git = platform === 'win32'
    ? [
        `vendor/git/${platformArch}/cmd/git.exe`,
        `vendor/git/${platformArch}/bin/bash.exe`,
        `vendor/git/${platformArch}/bin/sh.exe`,
      ]
    : []
  return [...searchTools, ...git]
}

function normalizeManifestPath(value) {
  return typeof value === 'string' ? value.replaceAll('\\', '/') : null
}

function main() {
  const packageRoot = resolveDesktopPackageRootArg(process.argv.slice(2), repoRoot)
  const result = assertDesktopPackage({ packageRoot })
  if (!result.ok) {
    for (const error of result.errors) console.error(error)
    process.exit(1)
  }
  console.log(`[desktop-package] app resources OK: ${relative(repoRoot, result.appRoot)}`)
  console.log(`[desktop-package] managed Pi: ${result.manifest.pi.version} (${result.manifest.pi.mode})`)
  if (result.platform === 'win32' || result.platform === 'darwin') {
    const tools = result.manifest.searchTools[result.platformArch]
    console.log(
      `[desktop-package] managed fd/rg: ${tools.fd.version}/${tools.rg.version} (${result.platformArch})`,
    )
  }
  if (result.platform === 'win32') {
    const git = result.manifest.git[result.platformArch]
    console.log(`[desktop-package] managed Git Bash: ${git.version} (${result.platformArch})`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (err) {
    console.error(`[desktop-package] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
