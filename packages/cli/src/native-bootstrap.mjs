import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, stat, symlink, writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

import { detectLocalTarget, installPersistentService, waitForNativeRuntime } from './bootstrap-service.mjs'
import { confirmActivation, markActivationRolledBack, recordPendingActivation } from './activation.mjs'
import { requireInstallSource } from './install-source.mjs'

export const NATIVE_BOOTSTRAP_RECEIPT_SCHEMA_VERSION = 1
const RELEASE_NAME = /^[A-Za-z0-9._+-]+$/
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SHA256 = /^[a-f0-9]{64}$/
const CONTENT_IDENTITY = /^[a-f0-9]{16}$/
const CHANNELS = new Set(['stable', 'beta', 'dev', 'pinned', 'custom'])
const SERVICES = new Set(['auto', 'none'])
const HELP = `OpenAlice Native Bootstrap

Usage:
  openalice bootstrap deploy --archive <path> --sha256 <hex> [options]
  openalice-bootstrap deploy --archive <path> --sha256 <hex> [options]

Required:
  --archive <path>                    Local native CLI tar.gz archive
  --sha256 <64-lowercase-hex>         Expected archive digest

Binding:
  --expected-version <version>        Require the release version
  --expected-content-identity <hex>   Require the 16-hex payload identity
  --channel <name>                    stable, beta, dev, pinned, or custom
  --installer-url <http(s)-url>       Provenance for the artifact resolver

Target:
  --install-dir <absolute-path>       Install root (default: ~/.openalice)
  --service <auto|none>               Persistence adapter (default: auto)
  --port <port>                       Runtime Web port (default: 47332)
  --wait <seconds>                    Readiness timeout, 1-600 (default: 120)

Control:
  --plan                              Verify and report without installing
  --yes                               Required for every installation
  --json                              Emit one machine-readable result
  -h, --help                          Show this help

The bootstrap never modifies PATH and never installs an Agent Runtime.
`

export function formatNativeBootstrapHelp() {
  return HELP
}

export function parseNativeBootstrapArgs(argv, dependencies = {}) {
  const values = argv[0] === 'deploy' ? argv.slice(1) : [...argv]
  if (values.includes('--help') || values.includes('-h')) return { help: true }
  const options = {
    archive: null,
    sha256: null,
    expectedVersion: null,
    expectedContentIdentity: null,
    channel: 'custom',
    installerUrl: 'https://openalice.ai/install',
    installRoot: join((dependencies.homedirImpl ?? homedir)(), '.openalice'),
    service: 'auto',
    port: 47332,
    waitSeconds: 120,
    plan: false,
    yes: false,
    json: false,
  }
  for (let index = 0; index < values.length; index += 1) {
    const argument = values[index]
    if (argument === '--archive') options.archive = requireValue(values, ++index, argument)
    else if (argument === '--sha256') options.sha256 = requireValue(values, ++index, argument).toLowerCase()
    else if (argument === '--expected-version') options.expectedVersion = requireValue(values, ++index, argument)
    else if (argument === '--expected-content-identity') options.expectedContentIdentity = requireValue(values, ++index, argument).toLowerCase()
    else if (argument === '--channel') options.channel = requireValue(values, ++index, argument)
    else if (argument === '--installer-url') options.installerUrl = requireValue(values, ++index, argument)
    else if (argument === '--install-dir') options.installRoot = resolve(requireValue(values, ++index, argument))
    else if (argument === '--service') options.service = requireValue(values, ++index, argument)
    else if (argument === '--port') options.port = integerOption(requireValue(values, ++index, argument), argument, 1, 65_535)
    else if (argument === '--wait') options.waitSeconds = integerOption(requireValue(values, ++index, argument), argument, 1, 600)
    else if (argument === '--plan') options.plan = true
    else if (argument === '--yes') options.yes = true
    else if (argument === '--json') options.json = true
    else throw bootstrapError('EUSAGE', `Unknown bootstrap option: ${String(argument)}`, 2)
  }
  if (!options.archive) throw bootstrapError('EUSAGE', '--archive is required', 2)
  options.archive = resolve(options.archive)
  if (!SHA256.test(options.sha256 ?? '')) throw bootstrapError('EUSAGE', '--sha256 must be 64 lowercase hexadecimal characters', 2)
  if (options.expectedVersion && !VERSION.test(options.expectedVersion)) throw bootstrapError('EUSAGE', '--expected-version is invalid', 2)
  if (options.expectedContentIdentity && !CONTENT_IDENTITY.test(options.expectedContentIdentity)) throw bootstrapError('EUSAGE', '--expected-content-identity must be 16 lowercase hexadecimal characters', 2)
  if (!CHANNELS.has(options.channel)) throw bootstrapError('EUSAGE', '--channel must be stable, beta, dev, pinned, or custom', 2)
  if (!SERVICES.has(options.service)) throw bootstrapError('EUSAGE', '--service must be auto or none', 2)
  if (!isAbsolute(options.installRoot) || /[\0\r\n]/u.test(options.installRoot)) throw bootstrapError('EUSAGE', '--install-dir must be an absolute path without control characters', 2)
  try {
    const url = new URL(options.installerUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
  } catch {
    throw bootstrapError('EUSAGE', '--installer-url must be an HTTP(S) URL', 2)
  }
  if (!options.plan && !options.yes) throw bootstrapError('ECONSENT', 'Installation requires --yes; use --plan to inspect it first', 2)
  return options
}

export async function runNativeBootstrap(argv, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout
  const options = parseNativeBootstrapArgs(argv, dependencies)
  if (options.help) {
    stdout.write(formatNativeBootstrapHelp())
    return 0
  }
  const result = await deployNativeArchive(options, dependencies)
  stdout.write(options.json ? `${JSON.stringify(result)}\n` : formatResult(result))
  return 0
}

export async function deployNativeArchive(options, dependencies = {}) {
  const target = dependencies.target ?? detectLocalTarget({
    platform: dependencies.platform,
    arch: dependencies.arch,
    env: dependencies.env,
  })
  const archivePath = resolve(options.archive)
  const archiveSha256 = await hashFile(archivePath, dependencies)
  if (archiveSha256 !== options.sha256) {
    throw bootstrapError('ECHECKSUM', `Archive checksum mismatch: expected ${options.sha256}, received ${archiveSha256}`)
  }
  const topLevel = listArchiveRoot(archivePath, target.platform, dependencies)
  let layout = null
  let lockHeld = false
  let activation = null
  let previousRelease = null
  let previousExecutable = null
  let stageRoot = options.plan
    ? await (dependencies.mkdtempImpl ?? mkdtemp)(join(dependencies.tmpdirImpl?.() ?? tmpdir(), 'openalice-bootstrap-plan-'))
    : null
  try {
    if (!options.plan) {
      layout = installLayout(options.installRoot, target.platform)
      await mkdir(layout.installRoot, { recursive: true })
      await acquireLock(layout.lockDir, dependencies)
      lockHeld = true
      await Promise.all([
        mkdir(layout.releasesDir, { recursive: true }),
        mkdir(layout.provenanceDir, { recursive: true }),
        mkdir(layout.binDir, { recursive: true }),
        mkdir(layout.stagingDir, { recursive: true }),
        mkdir(layout.deploymentDir, { recursive: true }),
      ])
      stageRoot = await (dependencies.mkdtempImpl ?? mkdtemp)(join(layout.stagingDir, 'bootstrap-'))
      previousRelease = await readCurrentReleaseName(layout, dependencies)
      if (previousRelease) previousExecutable = releaseExecutable(join(layout.releasesDir, previousRelease), target.platform)
    }

    extractArchive(archivePath, stageRoot, target.platform, dependencies)
    const extractedRoot = join(stageRoot, topLevel)
    const release = await verifyReleaseDirectory(extractedRoot, {
      target,
      topLevel,
      expectedVersion: options.expectedVersion,
      expectedContentIdentity: options.expectedContentIdentity,
    }, dependencies)
    if (options.plan) {
      return {
        schemaVersion: NATIVE_BOOTSTRAP_RECEIPT_SCHEMA_VERSION,
        action: 'plan',
        target,
        artifact: artifactReceipt(release.metadata, archiveSha256),
        installRoot: options.installRoot,
        service: options.service,
        mutations: false,
      }
    }

    const releaseName = `openalice-cli-${release.metadata.version}-${target.platform}-${target.arch}-${release.metadata.contentIdentity}`
    const destination = join(layout.releasesDir, releaseName)
    const unchanged = previousRelease === releaseName
    if (await exists(destination, dependencies)) {
      await verifyReleaseDirectory(destination, {
        target,
        topLevel: `openalice-cli-${release.metadata.version}-${target.platform}-${target.arch}`,
        expectedVersion: release.metadata.version,
        expectedContentIdentity: release.metadata.contentIdentity,
      }, dependencies)
    } else {
      await (dependencies.renameImpl ?? rename)(extractedRoot, destination)
    }

    await ensureProvenance(join(layout.provenanceDir, `${releaseName}.json`), {
      options, target, metadata: release.metadata, sha256: archiveSha256,
    }, dependencies)
    const activeExecutable = releaseExecutable(destination, target.platform)
    const activeLauncher = join(layout.binDir, target.platform === 'win32' ? 'openalice.cmd' : 'openalice')
    const runtimeEnv = releaseEnvironment(layout, releaseName, release.metadata.contentIdentity, dependencies.env)

    if (!unchanged) {
      activation = await recordPendingActivation(layout, {
        activeRelease: releaseName,
        previousRelease,
        productVersion: release.metadata.version,
      }, activationDependencies(dependencies))
      if (previousExecutable && options.service === 'auto') {
        stopPreviousRuntime(previousExecutable, options, dependencies)
      }
      await switchCurrentRelease(layout, releaseName, dependencies)
    }
    await writeLaunchers(layout, target.platform, dependencies)
    verifyActiveLauncher(activeLauncher, release.metadata.version, target.platform, dependencies)

    const service = unchanged && options.service === 'auto'
      ? await inspectOrRepairService({ options, target, layout, activeExecutable, activeLauncher, runtimeEnv }, dependencies)
      : await installPersistentService({
        mode: options.service,
        platform: target.platform,
        arch: target.arch,
        commandPath: activeLauncher,
        statusCommandPath: activeExecutable,
        statusEnv: runtimeEnv,
        replaceExisting: Boolean(previousRelease),
        installRoot: layout.installRoot,
        homeRoot: layout.installRoot,
        port: options.port,
        waitSeconds: options.waitSeconds,
      }, dependencies)
    if (activation) activation = await confirmActivation(layout, activation, activationDependencies(dependencies))

    const receipt = {
      schemaVersion: NATIVE_BOOTSTRAP_RECEIPT_SCHEMA_VERSION,
      status: unchanged ? 'unchanged' : previousRelease ? 'updated' : 'installed',
      target,
      artifact: artifactReceipt(release.metadata, archiveSha256),
      install: {
        root: layout.installRoot,
        release: releaseName,
        command: activeLauncher,
        executable: activeExecutable,
      },
      service: summarizeService(service),
      verifiedAt: nowIso(dependencies),
    }
    await atomicWriteJson(layout.deploymentReceiptPath, receipt, dependencies)
    return receipt
  } catch (error) {
    if (layout && activation?.state === 'pending') {
      await restoreAfterFailure({ layout, activation, previousRelease, previousExecutable, options, target }, error, dependencies)
    }
    throw error
  } finally {
    if (stageRoot) await (dependencies.rmImpl ?? rm)(stageRoot, { recursive: true, force: true })
    if (lockHeld) await (dependencies.rmImpl ?? rm)(layout.lockDir, { recursive: true, force: true })
  }
}

export async function verifyReleaseDirectory(releaseRoot, expectations, dependencies = {}) {
  let metadata
  try {
    metadata = JSON.parse(await (dependencies.readFileImpl ?? readFile)(join(releaseRoot, 'release.json'), 'utf8'))
  } catch (error) {
    throw bootstrapError('EMETADATA', `Release metadata is unreadable: ${errorMessage(error)}`)
  }
  if (
    metadata?.schemaVersion !== 1
    || metadata.product !== 'OpenAlice CLI'
    || metadata.platform !== expectations.target.platform
    || metadata.arch !== expectations.target.arch
    || !VERSION.test(metadata.version ?? '')
    || !CONTENT_IDENTITY.test(metadata.contentIdentity ?? '')
    || !Array.isArray(metadata.files)
  ) throw bootstrapError('EMETADATA', 'Release metadata does not match this host')
  const expectedTopLevel = `openalice-cli-${metadata.version}-${metadata.platform}-${metadata.arch}`
  if (expectations.topLevel !== expectedTopLevel) throw bootstrapError('EMETADATA', 'Release top-level directory does not match release.json')
  if (expectations.expectedVersion && metadata.version !== expectations.expectedVersion) throw bootstrapError('EVERSION', 'Release version does not match --expected-version')
  if (expectations.expectedContentIdentity && metadata.contentIdentity !== expectations.expectedContentIdentity) throw bootstrapError('EIDENTITY', 'Release identity does not match --expected-content-identity')

  const expectedFiles = new Map()
  for (const entry of metadata.files) {
    if (!validManifestEntry(entry) || expectedFiles.has(entry.path)) throw bootstrapError('EMETADATA', 'Release file manifest is invalid')
    expectedFiles.set(entry.path, entry)
  }
  const actualFiles = await collectReleaseFiles(releaseRoot, dependencies)
  if (actualFiles.size !== expectedFiles.size) throw bootstrapError('EFILES', 'Release file inventory does not match release.json')
  for (const [path, expected] of expectedFiles) {
    const actual = actualFiles.get(path)
    if (!actual || actual.type !== expected.type) throw bootstrapError('EFILES', `Release file is missing or has the wrong type: ${path}`)
    if (actual.type === 'file') {
      if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) throw bootstrapError('EFILES', `Release file digest does not match: ${path}`)
    } else if (actual.target !== expected.target) {
      throw bootstrapError('EFILES', `Release symlink target does not match: ${path}`)
    }
  }
  const executable = releaseExecutable(releaseRoot, expectations.target.platform)
  const result = (dependencies.spawnSyncImpl ?? spawnSync)(executable, ['--version'], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0 || String(result.stdout).trim() !== metadata.version) {
    throw bootstrapError('EEXECUTABLE', 'Release executable version verification failed')
  }
  return { metadata, executable }
}

function installLayout(installRoot, platform) {
  const cliDir = join(installRoot, 'cli')
  return {
    installRoot,
    cliDir,
    releasesDir: join(cliDir, 'releases'),
    provenanceDir: join(cliDir, 'provenance'),
    stagingDir: join(cliDir, 'staging'),
    currentPath: join(cliDir, platform === 'win32' ? 'current.txt' : 'current'),
    pointerKind: platform === 'win32' ? 'file' : 'symlink',
    activationPath: join(cliDir, 'activation.json'),
    binDir: join(installRoot, 'bin'),
    lockDir: join(installRoot, '.cli-install.lock'),
    deploymentDir: join(installRoot, 'deployment'),
    deploymentReceiptPath: join(installRoot, 'deployment/latest.json'),
  }
}

async function acquireLock(lockDir, dependencies) {
  try {
    await (dependencies.mkdirImpl ?? mkdir)(lockDir)
    await (dependencies.writeFileImpl ?? writeFile)(
      join(lockDir, 'owner.json'),
      `${JSON.stringify({ pid: process.pid, startedAt: nowIso(dependencies) })}\n`,
      { mode: 0o600 },
    )
  } catch (error) {
    if (error?.code === 'EEXIST') throw bootstrapError('ELOCKED', 'Another OpenAlice installation owns the install lock')
    throw error
  }
}

function listArchiveRoot(archivePath, platform, dependencies) {
  const tar = dependencies.tarCommand ?? (platform === 'win32' ? 'tar.exe' : 'tar')
  const result = (dependencies.spawnSyncImpl ?? spawnSync)(tar, ['-tzf', archivePath], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw bootstrapError('EARCHIVE', `Could not list release archive: ${commandDetail(result)}`)
  const roots = new Set()
  let entries = 0
  for (const rawPath of String(result.stdout).split(/\r?\n/)) {
    const path = rawPath.replace(/\/$/, '')
    if (!path) continue
    validateArchivePath(path)
    roots.add(path.split('/')[0])
    entries += 1
  }
  if (entries === 0 || roots.size !== 1) throw bootstrapError('EARCHIVE', 'Release archive must contain exactly one top-level directory')
  return [...roots][0]
}

function extractArchive(archivePath, destination, platform, dependencies) {
  const tar = dependencies.tarCommand ?? (platform === 'win32' ? 'tar.exe' : 'tar')
  const result = (dependencies.spawnSyncImpl ?? spawnSync)(tar, ['-xzf', archivePath, '-C', destination], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw bootstrapError('EARCHIVE', `Could not extract release archive: ${commandDetail(result)}`)
}

function validateArchivePath(path) {
  if (path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) throw bootstrapError('EARCHIVE', 'Release archive contains an unsafe path')
  const segments = path.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw bootstrapError('EARCHIVE', 'Release archive contains an unsafe path')
}

async function collectReleaseFiles(root, dependencies) {
  const output = new Map()
  const walk = async (directory, prefix = '') => {
    const entries = await (dependencies.readdirImpl ?? readdir)(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (path === 'release.json') continue
      const absolutePath = join(directory, entry.name)
      const fileStat = await (dependencies.lstatImpl ?? lstat)(absolutePath)
      if (fileStat.isDirectory()) await walk(absolutePath, path)
      else if (fileStat.isFile()) output.set(path, { type: 'file', bytes: fileStat.size, sha256: await hashFile(absolutePath, dependencies) })
      else if (fileStat.isSymbolicLink()) {
        const target = await (dependencies.readlinkImpl ?? readlink)(absolutePath)
        if (!insideRoot(root, resolve(dirname(absolutePath), target))) throw bootstrapError('EFILES', `Release symlink escapes its root: ${path}`)
        output.set(path, { type: 'symlink', target })
      } else throw bootstrapError('EFILES', `Release contains an unsupported file type: ${path}`)
    }
  }
  await walk(root)
  return output
}

async function ensureProvenance(path, context, dependencies) {
  if (await exists(path, dependencies)) {
    const existing = requireInstallSource(JSON.parse(await (dependencies.readFileImpl ?? readFile)(path, 'utf8')))
    if (
      existing.cliVersion !== context.metadata.version
      || existing.artifact.platform !== context.target.platform
      || existing.artifact.arch !== context.target.arch
      || existing.artifact.sha256 !== context.sha256
    ) throw bootstrapError('EPROVENANCE', 'Existing release provenance conflicts with the verified artifact')
    return existing
  }
  const updateChannel = context.options.channel === 'dev' ? 'development' : context.options.channel
  const selector = context.options.channel === 'dev'
    ? { kind: 'branch', value: 'dev' }
    : { kind: 'version', value: context.options.channel === 'custom' ? `local-${context.metadata.version}` : `v${context.metadata.version}` }
  const provenance = requireInstallSource({
    schemaVersion: 3,
    repository: 'TraderAlice/OpenAlice',
    cliVersion: context.metadata.version,
    selector,
    installerUrl: context.options.installerUrl,
    updateChannel,
    method: 'direct',
    artifact: { platform: context.target.platform, arch: context.target.arch, sha256: context.sha256 },
    installedAt: nowIso(dependencies),
  })
  await atomicWriteJson(path, provenance, dependencies)
  return provenance
}

async function switchCurrentRelease(layout, releaseName, dependencies) {
  if (layout.pointerKind === 'file') {
    await atomicWrite(layout.currentPath, `${releaseName}\n`, { mode: 0o600 }, dependencies)
    return
  }
  const next = `${layout.currentPath}.next.${process.pid}.${randomUUID()}`
  try {
    await (dependencies.symlinkImpl ?? symlink)(`releases/${releaseName}`, next)
    await (dependencies.renameImpl ?? rename)(next, layout.currentPath)
  } finally {
    await (dependencies.rmImpl ?? rm)(next, { force: true })
  }
}

async function readCurrentReleaseName(layout, dependencies) {
  try {
    if (layout.pointerKind === 'file') {
      return validReleaseName(String(await (dependencies.readFileImpl ?? readFile)(layout.currentPath, 'utf8')).trim())
    }
    const current = await (dependencies.realpathImpl ?? realpath)(layout.currentPath)
    const releases = await (dependencies.realpathImpl ?? realpath)(layout.releasesDir)
    if (dirname(current) !== releases) throw new Error('outside releases directory')
    return validReleaseName(basename(current))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw bootstrapError('EACTIVATION', `OpenAlice activation pointer is invalid: ${errorMessage(error)}`)
  }
}

async function writeLaunchers(layout, platform, dependencies) {
  for (const helper of ['openalice', 'alice', 'alice-workspace', 'alice-uta', 'traderhub']) {
    const role = helper === 'openalice' ? '' : `--workspace-cli ${helper} `
    if (platform === 'win32') {
      const launcher = `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "OPENALICE_INSTALL_ROOT=%~dp0.."\r\nset /p OPENALICE_RELEASE_NAME=<"%~dp0..\\cli\\current.txt"\r\nif not defined OPENALICE_RELEASE_NAME exit /b 1\r\nset "OPENALICE_RELEASE_DIR=%~dp0..\\cli\\releases\\%OPENALICE_RELEASE_NAME%"\r\nset "OPENALICE_INSTALL_SOURCE=%~dp0..\\cli\\provenance\\%OPENALICE_RELEASE_NAME%.json"\r\nset "OPENALICE_CONTENT_IDENTITY=%OPENALICE_RELEASE_NAME:~-16%"\r\nset "OPENALICE_INSTALL_METHOD=direct"\r\n"%OPENALICE_RELEASE_DIR%\\bin\\openalice.exe" ${role}%*\r\nexit /b %errorlevel%\r\n`
      await atomicWrite(join(layout.binDir, `${helper}.cmd`), launcher, {}, dependencies)
    } else {
      const launcher = `#!/bin/sh\nset -eu\nbin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)\ninstall_root=$(dirname "$bin_dir")\nrelease_dir=$(CDPATH= cd -- "$install_root/cli/current" && pwd -P)\nrelease_name=$(basename "$release_dir")\ncontent_identity=\${release_name##*-}\nexport OPENALICE_INSTALL_ROOT="$install_root"\nexport OPENALICE_RELEASE_DIR="$release_dir"\nexport OPENALICE_INSTALL_SOURCE="$install_root/cli/provenance/$release_name.json"\nexport OPENALICE_CONTENT_IDENTITY="$content_identity"\nexport OPENALICE_INSTALL_METHOD="direct"\nexec "$release_dir/bin/openalice" ${role}"$@"\n`
      await atomicWrite(join(layout.binDir, helper), launcher, { mode: 0o755 }, dependencies)
    }
  }
}

export function verifyActiveLauncher(path, version, platform, dependencies = {}) {
  const spawn = dependencies.spawnSyncImpl ?? spawnSync
  const result = platform === 'win32'
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/v:off', '/s', '/c', 'call "%OPENALICE_BOOTSTRAP_LAUNCHER%" --version'], {
        encoding: 'utf8',
        windowsHide: true,
        windowsVerbatimArguments: true,
        env: { ...process.env, OPENALICE_BOOTSTRAP_LAUNCHER: path },
      })
    : spawn(path, ['--version'], { encoding: 'utf8' })
  if (result.status !== 0 || String(result.stdout).trim() !== version) {
    throw bootstrapError('EACTIVATION', 'Active launcher verification failed')
  }
}

async function inspectOrRepairService(context, dependencies) {
  try {
    const runtime = await waitForNativeRuntime({
      commandPath: context.activeExecutable,
      homeRoot: context.layout.installRoot,
      waitSeconds: 1,
      env: context.runtimeEnv,
    }, dependencies)
    return { manager: serviceManager(context.target.platform), name: serviceName(context.target.platform), state: 'running', runtime }
  } catch {
    return installPersistentService({
      mode: context.options.service,
      platform: context.target.platform,
      arch: context.target.arch,
      commandPath: context.activeLauncher,
      statusCommandPath: context.activeExecutable,
      statusEnv: context.runtimeEnv,
      replaceExisting: true,
      installRoot: context.layout.installRoot,
      homeRoot: context.layout.installRoot,
      port: context.options.port,
      waitSeconds: context.options.waitSeconds,
    }, dependencies)
  }
}

function stopPreviousRuntime(executable, options, dependencies) {
  const result = (dependencies.spawnSyncImpl ?? spawnSync)(executable, [
    'server', 'stop', '--home', options.installRoot, '--wait', '30', '--json',
  ], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw bootstrapError('ESERVICE', `Could not stop the previous OpenAlice Runtime: ${commandDetail(result)}`)
}

async function restoreAfterFailure(context, error, dependencies) {
  if (context.previousRelease) await switchCurrentRelease(context.layout, context.previousRelease, dependencies)
  else await (dependencies.rmImpl ?? rm)(context.layout.currentPath, { force: true })
  await markActivationRolledBack(context.layout, context.activation, error, activationDependencies(dependencies))
  if (context.previousRelease && context.previousExecutable && context.options.service === 'auto') {
    const previousLauncher = join(context.layout.binDir, context.target.platform === 'win32' ? 'openalice.cmd' : 'openalice')
    await writeLaunchers(context.layout, context.target.platform, dependencies)
    try {
      await installPersistentService({
        mode: 'auto',
        platform: context.target.platform,
        arch: context.target.arch,
        commandPath: previousLauncher,
        statusCommandPath: context.previousExecutable,
        statusEnv: releaseEnvironment(context.layout, context.previousRelease, context.previousRelease.slice(-16), dependencies.env),
        replaceExisting: true,
        installRoot: context.layout.installRoot,
        homeRoot: context.layout.installRoot,
        port: context.options.port,
        waitSeconds: context.options.waitSeconds,
      }, dependencies)
    } catch (rollbackError) {
      error.message += `; rollback service recovery also failed: ${errorMessage(rollbackError)}`
    }
  }
}

function releaseEnvironment(layout, releaseName, contentIdentity, env = process.env) {
  return {
    ...env,
    OPENALICE_INSTALL_ROOT: layout.installRoot,
    OPENALICE_RELEASE_DIR: join(layout.releasesDir, releaseName),
    OPENALICE_INSTALL_SOURCE: join(layout.provenanceDir, `${releaseName}.json`),
    OPENALICE_CONTENT_IDENTITY: contentIdentity,
    OPENALICE_INSTALL_METHOD: 'direct',
  }
}

function releaseExecutable(root, platform) {
  return join(root, 'bin', platform === 'win32' ? 'openalice.exe' : 'openalice')
}

function artifactReceipt(metadata, sha256) {
  return { version: metadata.version, contentIdentity: metadata.contentIdentity, sha256, platform: metadata.platform, arch: metadata.arch }
}

function summarizeService(service) {
  return {
    manager: service.manager,
    name: service.name,
    state: service.state,
    ...(service.runtime?.endpoints?.web ? { endpoint: service.runtime.endpoints.web } : {}),
  }
}

function formatResult(result) {
  if (result.action === 'plan') return `Verified OpenAlice ${result.artifact.version} (${result.artifact.platform}-${result.artifact.arch}, ${result.artifact.contentIdentity}).\nNo files were changed.\n`
  const endpoint = result.service.endpoint ? `\nOpenAlice: ${result.service.endpoint}` : ''
  return `OpenAlice ${result.artifact.version} ${result.status}.\nCommand: ${result.install.command}\nPersistence: ${result.service.manager} (${result.service.state})${endpoint}\n`
}

async function hashFile(path, dependencies) {
  if (dependencies.hashFileImpl) return dependencies.hashFileImpl(path)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function atomicWriteJson(path, value, dependencies) {
  return atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }, dependencies)
}

async function atomicWrite(path, contents, options, dependencies) {
  const temporary = `${path}.next.${process.pid}.${randomUUID()}`
  try {
    await (dependencies.writeFileImpl ?? writeFile)(temporary, contents, options)
    await (dependencies.renameImpl ?? rename)(temporary, path)
  } finally {
    await (dependencies.rmImpl ?? rm)(temporary, { force: true })
  }
}

async function exists(path, dependencies) {
  try {
    await (dependencies.statImpl ?? stat)(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function validManifestEntry(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string') return false
  try { validateArchivePath(entry.path) } catch { return false }
  if (entry.type === 'file') return Number.isInteger(entry.bytes) && entry.bytes >= 0 && SHA256.test(entry.sha256 ?? '')
  if (entry.type === 'symlink') return typeof entry.target === 'string' && entry.target.length > 0 && !/[\0\r\n]/u.test(entry.target)
  return false
}

function insideRoot(root, candidate) {
  const value = relative(resolve(root), resolve(candidate))
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))
}

function validReleaseName(value) {
  if (!RELEASE_NAME.test(value) || value === '.' || value === '..') throw new Error('invalid release name')
  return value
}

function activationDependencies(dependencies) {
  return {
    readFileImpl: dependencies.readFileImpl,
    writeFileImpl: dependencies.writeFileImpl,
    renameImpl: dependencies.renameImpl,
    rmImpl: dependencies.rmImpl,
    now: dependencies.now,
  }
}

function serviceManager(platform) {
  return platform === 'win32' ? 'task-scheduler' : platform === 'linux' ? 'systemd-user' : 'launchd'
}

function serviceName(platform) {
  return platform === 'win32' ? 'OpenAliceServer' : platform === 'linux' ? 'openalice.service' : 'ai.openalice.server'
}

function nowIso(dependencies) {
  return (dependencies.now?.() ?? new Date()).toISOString()
}

function commandDetail(result) {
  return String(result.stderr || result.stdout || `exit ${result.status}`).trim()
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw bootstrapError('EUSAGE', `${flag} requires a value`, 2)
  return value
}

function integerOption(value, flag, minimum, maximum) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw bootstrapError('EUSAGE', `${flag} must be an integer between ${minimum} and ${maximum}`, 2)
  return number
}

function bootstrapError(code, message, exitCode = 1) {
  return Object.assign(new Error(message), { code, exitCode })
}
