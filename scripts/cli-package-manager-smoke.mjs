#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  rewriteExpandedCliRelease,
  syntheticPreviousVersion,
} from './cli-release-fixture.mjs'

const options = parseArgs(process.argv.slice(2))
const root = mkdtempSync(join(tmpdir(), `openalice-${options.manager}-package-smoke-`))
const sourcePackages = resolve(options.packagesDir)
const currentPackagesRoot = join(root, 'packages-current')
const previousPackagesRoot = join(root, 'packages-previous')
cpSync(sourcePackages, currentPackagesRoot, { recursive: true })
cpSync(sourcePackages, previousPackagesRoot, { recursive: true })

const packageName = `openalice-${process.platform}-${process.arch}`
if (!existsSync(join(currentPackagesRoot, packageName, 'package.json'))) {
  fail(`generated package set does not contain ${packageName}`)
}
const previousVersion = syntheticPreviousVersion(options.expectedVersion)
const previousContentIdentity = rewritePackageSetVersion({
  packagesRoot: previousPackagesRoot,
  packageName,
  fromVersion: options.expectedVersion,
  toVersion: previousVersion,
})
const previousMetaTarball = packPackageSet(
  previousPackagesRoot,
  join(root, 'tarballs-previous'),
  packageName,
)
const currentMetaTarball = packPackageSet(
  currentPackagesRoot,
  join(root, 'tarballs-current'),
  packageName,
)

const home = join(root, 'home')
const runtimeHome = join(root, 'runtime-home')
const bunExecutable = options.manager === 'bun'
  ? realpathSync(resolveExecutable(options.bun))
  : null
const bunOnlyPath = options.manager === 'bun'
  ? prepareBunOnlyPath(bunExecutable)
  : null
const activeManager = managerContext(join(root, 'manager'), 'active')
const stoppedManager = managerContext(join(root, 'manager-stopped'), 'stopped')

try {
  installPackage(previousMetaTarball, stoppedManager)
  assertInstalled(
    stoppedManager.executable,
    { HOME: home, PATH: '/usr/bin:/bin' },
    previousVersion,
    previousContentIdentity,
  )
  installPackage(currentMetaTarball, stoppedManager, { force: true })
  assertInstalled(
    stoppedManager.executable,
    { HOME: home, PATH: '/usr/bin:/bin' },
    options.expectedVersion,
    options.expectedContentIdentity,
  )
  removePackage(stoppedManager)
  if (existsSync(stoppedManager.executable)) {
    fail(`${options.manager} stopped removal left the openalice command behind`)
  }

  installPackage(previousMetaTarball, activeManager)

  const executable = activeManager.executable
  if (!existsSync(executable)) fail(`${options.manager} did not install the openalice command`)
  const runtimeEnv = {
    HOME: home,
    PATH: '/usr/bin:/bin',
  }
  assertInstalled(executable, runtimeEnv, previousVersion, previousContentIdentity)

  run(executable, ['up', '--home', runtimeHome, '--no-update-check', '--wait', '120', '--json'], runtimeEnv)
  const previousStatus = runtimeStatus(executable, runtimeHome, runtimeEnv)
  if (previousStatus.provider?.contentIdentity !== previousContentIdentity) {
    fail('synthetic prior Runtime did not report its content identity')
  }

  installPackage(currentMetaTarball, activeManager, { force: true })
  assertInstalled(executable, runtimeEnv, options.expectedVersion, options.expectedContentIdentity)
  const pendingStatus = runtimeStatus(executable, runtimeHome, runtimeEnv)
  if (
    pendingStatus.class !== 'running'
    || pendingStatus.provider?.contentIdentity !== previousContentIdentity
    || pendingStatus.pendingActivation?.productVersion !== options.expectedVersion
    || pendingStatus.pendingActivation?.restartRequired !== true
  ) {
    fail(`active manager upgrade did not report pending activation: ${JSON.stringify(pendingStatus)}`)
  }
  const idempotentUp = JSON.parse(capture(executable, [
    'up', '--home', runtimeHome, '--no-update-check', '--wait', '3', '--json',
  ], runtimeEnv))
  if (idempotentUp.result?.runtime?.status?.pendingActivation?.restartRequired !== true) {
    fail('idempotent up did not preserve active manager upgrade reporting')
  }
  const doctor = JSON.parse(capture(executable, ['doctor', '--home', runtimeHome, '--json'], runtimeEnv))
  const updateOwner = doctor.result?.doctor?.checks?.find((check) => check.id === 'update.metadata')
  if (updateOwner?.status !== 'pass' || !updateOwner.summary.includes('owns OpenAlice updates')) {
    fail('Doctor did not report package-manager update ownership')
  }
  const update = capture(executable, ['update'], runtimeEnv)
  const expectedUpdate = options.manager === 'npm'
    ? 'npm install -g openalice@latest'
    : 'bun add -g --trust openalice@latest'
  if (!update.includes('openalice down') || !update.includes(expectedUpdate)) {
    fail('update guidance did not return to the package manager while Runtime was active')
  }
  const uninstall = capture(executable, ['uninstall', '--yes'], runtimeEnv)
  const expectedRemoval = options.manager === 'npm'
    ? 'npm uninstall -g openalice'
    : 'bun remove -g openalice'
  if (!uninstall.includes(expectedRemoval)) fail('uninstall guidance did not return to the package manager')
  if (!existsSync(executable)) fail('OpenAlice removed package-manager-owned files')

  run(executable, ['down', '--home', runtimeHome, '--json'], runtimeEnv)
  run(executable, ['up', '--home', runtimeHome, '--no-update-check', '--wait', '120', '--json'], runtimeEnv)
  const activatedStatus = runtimeStatus(executable, runtimeHome, runtimeEnv)
  if (
    activatedStatus.provider?.contentIdentity !== options.expectedContentIdentity
    || activatedStatus.pendingActivation !== null
  ) {
    fail(`stopped restart did not activate the manager upgrade: ${JSON.stringify(activatedStatus)}`)
  }
  run(executable, ['down', '--home', runtimeHome, '--json'], runtimeEnv)

  removePackage(activeManager)
  if (existsSync(executable)) fail(`${options.manager} removal left the openalice command behind`)
  process.stdout.write(`[cli-package-smoke] ${options.manager} passed ${process.platform}-${process.arch}\n`)
} finally {
  if (existsSync(activeManager.executable)) {
    spawnSync(activeManager.executable, [
      'down', '--home', runtimeHome, '--json',
    ], {
      env: { HOME: home, PATH: '/usr/bin:/bin' },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 20_000,
    })
  }
  if (options.keep) {
    process.stdout.write(`[cli-package-smoke] kept ${root}\n`)
  } else {
    rmSync(root, { recursive: true, force: true })
  }
}

function installPackage(metaTarball, manager, { force = false } = {}) {
  if (options.manager === 'npm') {
    run(options.npm, [
      'install', '--global', '--prefix', manager.root,
      ...(force ? ['--force'] : []),
      metaTarball,
    ], manager.baseEnv)
    return
  }
  run(bunExecutable, [
    'add', '--global', '--trust',
    ...(force ? ['--force'] : []),
    metaTarball,
  ], manager.managerEnv)
}

function removePackage(manager) {
  if (options.manager === 'npm') {
    run(options.npm, ['uninstall', '--global', '--prefix', manager.root, 'openalice'], manager.baseEnv)
  } else {
    run(bunExecutable, ['remove', '--global', 'openalice'], manager.managerEnv)
  }
}

function prepareBunOnlyPath(executable) {
  const bunOnlyPath = join(root, 'bun-only-path')
  mkdirSync(bunOnlyPath, { recursive: true })
  symlinkSync(executable, join(bunOnlyPath, 'bun'))
  return bunOnlyPath
}

function managerContext(managerRoot, cacheName) {
  const baseEnv = {
    ...process.env,
    HOME: home,
    XDG_CACHE_HOME: join(root, `cache-${cacheName}`),
    npm_config_cache: join(root, `npm-cache-${cacheName}`),
    BUN_INSTALL: managerRoot,
  }
  return {
    root: managerRoot,
    executable: join(managerRoot, 'bin', 'openalice'),
    baseEnv,
    managerEnv: options.manager === 'bun'
      ? { ...baseEnv, PATH: `${bunOnlyPath}:/usr/bin:/bin` }
      : baseEnv,
  }
}

function assertInstalled(executable, env, expectedVersion, expectedIdentity) {
  const version = JSON.parse(capture(executable, ['version', '--json'], env))
  if (version.version !== expectedVersion) fail(`installed version is ${version.version}, expected ${expectedVersion}`)
  if (version.contentIdentity !== expectedIdentity) {
    fail(`installed content identity is ${version.contentIdentity}, expected ${expectedIdentity}`)
  }
  if (version.installSource?.method !== options.manager) {
    fail(`installed provenance method is ${version.installSource?.method}`)
  }
  if (version.installSource?.artifact?.platform !== process.platform) fail('installed platform provenance is wrong')
  if (version.installSource?.artifact?.arch !== process.arch) fail('installed architecture provenance is wrong')
}

function runtimeStatus(executable, runtimeHome, env) {
  return JSON.parse(capture(executable, [
    'status', '--home', runtimeHome, '--wait', '3', '--json',
  ], env)).result?.status
}

function run(command, args, env) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', stdio: 'pipe' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0]} failed (${result.status}):\n${result.stdout}\n${result.stderr}`)
  }
  return result
}

function capture(command, args, env) {
  return run(command, args, env).stdout
}

function packPackageSet(packagesRoot, destination, nativePackageName) {
  mkdirSync(destination, { recursive: true })
  const platformTarball = pack(join(packagesRoot, nativePackageName), destination)
  const metaRoot = join(packagesRoot, 'openalice')
  const metaPackagePath = join(metaRoot, 'package.json')
  const metaPackage = JSON.parse(readFileSync(metaPackagePath, 'utf8'))
  metaPackage.optionalDependencies = {
    [nativePackageName]: `file:${platformTarball}`,
  }
  writeFileSync(metaPackagePath, `${JSON.stringify(metaPackage, null, 2)}\n`)
  return pack(metaRoot, destination)
}

function rewritePackageSetVersion({ packagesRoot, packageName, fromVersion, toVersion }) {
  const platformRoot = join(packagesRoot, packageName)
  const { contentIdentity, executableSha256 } = rewriteExpandedCliRelease({
    releaseRoot: join(platformRoot, 'release'),
    fromVersion,
    toVersion,
  })

  const platformPackagePath = join(platformRoot, 'package.json')
  const platformPackage = JSON.parse(readFileSync(platformPackagePath, 'utf8'))
  platformPackage.version = toVersion
  platformPackage.openalice.contentIdentity = contentIdentity
  platformPackage.openalice.artifactSha256 = executableSha256
  writeFileSync(platformPackagePath, `${JSON.stringify(platformPackage, null, 2)}\n`)

  const metaPackagePath = join(packagesRoot, 'openalice', 'package.json')
  const metaPackage = JSON.parse(readFileSync(metaPackagePath, 'utf8'))
  metaPackage.version = toVersion
  metaPackage.optionalDependencies = { [packageName]: toVersion }
  writeFileSync(metaPackagePath, `${JSON.stringify(metaPackage, null, 2)}\n`)
  return contentIdentity
}

function pack(packageRoot, destination) {
  const result = run(options.npm, [
    'pack', packageRoot, '--json', '--pack-destination', destination,
  ], { ...process.env, npm_config_cache: join(root, 'npm-cache') })
  const report = JSON.parse(result.stdout)
  if (!Array.isArray(report) || report.length !== 1 || !report[0]?.filename) {
    fail(`npm pack returned an invalid report for ${packageRoot}`)
  }
  return join(destination, report[0].filename)
}

function resolveExecutable(command) {
  if (command.includes('/')) return resolve(command)
  return capture('/usr/bin/which', [command], process.env).trim()
}

function fail(message) {
  throw new Error(message)
}

function parseArgs(argv) {
  const result = { npm: 'npm', bun: 'bun', keep: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--keep') result.keep = true
    else if (['--manager', '--packages-dir', '--expected-version', '--expected-content-identity', '--npm', '--bun'].includes(arg)) {
      const value = argv[++index]
      if (!value || value.startsWith('--')) fail(`${arg} requires a value`)
      result[arg.slice(2).replaceAll('-', '')] = value
    } else fail(`unknown option: ${arg}`)
  }
  if (!['npm', 'bun'].includes(result.manager)) fail('--manager must be npm or bun')
  if (!result.packagesdir || !result.expectedversion || !/^[a-f0-9]{16}$/.test(result.expectedcontentidentity ?? '')) {
    fail('Usage: cli-package-manager-smoke.mjs --manager <npm|bun> --packages-dir <dir> --expected-version <version> --expected-content-identity <id> [--npm <path>] [--bun <path>] [--keep]')
  }
  return {
    manager: result.manager,
    packagesDir: result.packagesdir,
    expectedVersion: result.expectedversion,
    expectedContentIdentity: result.expectedcontentidentity,
    npm: result.npm,
    bun: result.bun,
    keep: result.keep,
  }
}
