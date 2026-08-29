#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const options = parseArgs(process.argv.slice(2))
const root = mkdtempSync(join(tmpdir(), `openalice-${options.manager}-lifecycle-`))
const home = join(root, 'home')
const runtimeHome = join(root, 'runtime-home')
const emptyPath = join(root, 'runtime-path')
mkdirSync(home, { recursive: true })
mkdirSync(emptyPath, { recursive: true })

const manager = options.manager === 'brew'
  ? prepareBrewManager()
  : prepareAurManager()
const runtimeEnv = { HOME: home, PATH: emptyPath }

try {
  manager.installPrevious()
  assertInstalled(options.previousVersion, options.previousContentIdentity)
  manager.upgradeCurrent()
  assertInstalled(options.currentVersion, options.currentContentIdentity)
  manager.remove()
  assertRemoved()

  manager.installPrevious()
  assertInstalled(options.previousVersion, options.previousContentIdentity)
  run(manager.executable, [
    'up', '--home', runtimeHome, '--no-update-check', '--wait', '120', '--json',
  ], runtimeEnv)
  const previousStatus = runtimeStatus()
  if (previousStatus.provider?.contentIdentity !== options.previousContentIdentity) {
    fail('synthetic prior Runtime did not report its content identity')
  }

  manager.upgradeCurrent()
  assertInstalled(options.currentVersion, options.currentContentIdentity)
  const pendingStatus = runtimeStatus()
  if (
    pendingStatus.class !== 'running'
    || pendingStatus.provider?.contentIdentity !== options.previousContentIdentity
    || pendingStatus.pendingActivation?.productVersion !== options.currentVersion
    || pendingStatus.pendingActivation?.restartRequired !== true
  ) {
    fail(`active ${options.manager} upgrade did not report pending activation: ${JSON.stringify(pendingStatus)}`)
  }
  const idempotentUp = JSON.parse(capture(manager.executable, [
    'up', '--home', runtimeHome, '--no-update-check', '--wait', '3', '--json',
  ], runtimeEnv))
  if (idempotentUp.result?.runtime?.status?.pendingActivation?.restartRequired !== true) {
    fail('idempotent up did not preserve active manager upgrade reporting')
  }
  const doctor = JSON.parse(capture(manager.executable, [
    'doctor', '--home', runtimeHome, '--json',
  ], runtimeEnv))
  const updateOwner = doctor.result?.doctor?.checks?.find((check) => check.id === 'update.metadata')
  if (updateOwner?.status !== 'pass' || !updateOwner.summary.includes(manager.ownerLabel)) {
    fail(`Doctor did not report ${options.manager} update ownership`)
  }
  const update = capture(manager.executable, ['update'], runtimeEnv)
  if (!update.includes('openalice down') || !update.includes(manager.updateGuidance)) {
    fail(`update guidance did not return to ${options.manager}`)
  }
  const uninstall = capture(manager.executable, ['uninstall', '--yes'], runtimeEnv)
  if (!uninstall.includes(manager.uninstallGuidance)) {
    fail(`uninstall guidance did not return to ${options.manager}`)
  }
  if (!existsSync(manager.executable)) fail('OpenAlice removed package-manager-owned files')

  run(manager.executable, ['down', '--home', runtimeHome, '--json'], runtimeEnv)
  run(manager.executable, [
    'up', '--home', runtimeHome, '--no-update-check', '--wait', '120', '--json',
  ], runtimeEnv)
  const activatedStatus = runtimeStatus()
  if (
    activatedStatus.provider?.contentIdentity !== options.currentContentIdentity
    || activatedStatus.pendingActivation !== null
  ) {
    fail(`stopped restart did not activate the ${options.manager} upgrade: ${JSON.stringify(activatedStatus)}`)
  }
  run(manager.executable, ['down', '--home', runtimeHome, '--json'], runtimeEnv)

  manager.remove()
  assertRemoved()
  process.stdout.write(`[cli-system-package-smoke] ${options.manager} passed ${process.platform}-${process.arch}\n`)
} finally {
  if (existsSync(manager.executable)) {
    spawnSync(manager.executable, ['down', '--home', runtimeHome, '--json'], {
      env: runtimeEnv,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 20_000,
    })
  }
  manager.cleanup()
  if (options.keep) process.stdout.write(`[cli-system-package-smoke] kept ${root}\n`)
  else rmSync(root, { recursive: true, force: true })
}

function prepareBrewManager() {
  if (!['darwin', 'linux'].includes(process.platform)) {
    fail('Homebrew lifecycle smoke requires macOS or Linux')
  }
  const tap = 'openalice-smoke/lifecycle'
  const source = join(root, 'tap-source')
  const formula = join(source, 'Formula/openalice.rb')
  mkdirSync(join(source, 'Formula'), { recursive: true })
  copyFileSync(resolve(options.previousPackage), formula)
  run('git', ['init', '--initial-branch=main', source], process.env)
  run('git', ['-C', source, 'config', 'user.name', 'OpenAlice Smoke'], process.env)
  run('git', ['-C', source, 'config', 'user.email', 'smoke@openalice.invalid'], process.env)
  commitFormula(source, 'previous')
  const brewEnv = {
    ...process.env,
    HOMEBREW_NO_AUTO_UPDATE: '1',
    HOMEBREW_NO_ENV_HINTS: '1',
    HOMEBREW_NO_INSTALL_CLEANUP: '1',
  }
  run(options.brew, ['untap', '--force', tap], brewEnv, { allowFailure: true })
  run(options.brew, ['tap', tap, `file://${source}`], brewEnv)
  const tapped = capture(options.brew, ['--repository', tap], brewEnv).trim()
  const tappedFormula = join(tapped, 'Formula/openalice.rb')

  const setFormula = (sourceFormula, message) => {
    copyFileSync(resolve(sourceFormula), formula)
    commitFormula(source, message)
    run('git', ['-C', tapped, 'pull', '--ff-only'], brewEnv)
    if (!existsSync(tappedFormula)) fail('local Homebrew tap lost its formula')
  }

  return {
    executable: join(capture(options.brew, ['--prefix'], brewEnv).trim(), 'bin/openalice'),
    ownerLabel: 'Homebrew owns OpenAlice updates',
    updateGuidance: 'brew upgrade traderalice/tap/openalice',
    uninstallGuidance: 'brew uninstall traderalice/tap/openalice',
    installPrevious() {
      setFormula(options.previousPackage, `previous-${Date.now()}`)
      run(options.brew, ['install', `${tap}/openalice`], brewEnv)
    },
    upgradeCurrent() {
      setFormula(options.currentPackage, `current-${Date.now()}`)
      run(options.brew, ['upgrade', `${tap}/openalice`], brewEnv)
    },
    remove() {
      run(options.brew, ['uninstall', '--force', 'openalice'], brewEnv)
    },
    cleanup() {
      run(options.brew, ['uninstall', '--force', 'openalice'], brewEnv, { allowFailure: true })
      run(options.brew, ['untap', '--force', tap], brewEnv, { allowFailure: true })
    },
  }
}

function prepareAurManager() {
  if (process.platform !== 'linux') fail('AUR lifecycle smoke requires Linux')
  return {
    executable: '/usr/bin/openalice',
    ownerLabel: 'pacman/AUR owns OpenAlice updates',
    updateGuidance: 'paru -S openalice-bin',
    uninstallGuidance: 'paru -Rns openalice-bin',
    installPrevious() {
      run(options.pacman, ['-U', '--noconfirm', resolve(options.previousPackage)], process.env)
    },
    upgradeCurrent() {
      run(options.pacman, ['-U', '--noconfirm', resolve(options.currentPackage)], process.env)
    },
    remove() {
      run(options.pacman, ['-Rns', '--noconfirm', 'openalice-bin'], process.env)
    },
    cleanup() {
      run(options.pacman, ['-Rns', '--noconfirm', 'openalice-bin'], process.env, { allowFailure: true })
    },
  }
}

function commitFormula(source, message) {
  run('git', ['-C', source, 'add', 'Formula/openalice.rb'], process.env)
  run('git', ['-C', source, 'commit', '--allow-empty', '-m', message], process.env)
}

function assertInstalled(expectedVersion, expectedIdentity) {
  if (!existsSync(manager.executable)) fail(`${options.manager} did not install the openalice command`)
  const version = JSON.parse(capture(manager.executable, ['version', '--json'], runtimeEnv))
  if (version.version !== expectedVersion || version.contentIdentity !== expectedIdentity) {
    fail(`installed identity mismatch: ${JSON.stringify(version)}`)
  }
  if (version.installSource?.method !== options.manager) {
    fail(`installed provenance method is ${version.installSource?.method}`)
  }
  if (
    version.installSource?.artifact?.platform !== process.platform
    || version.installSource?.artifact?.arch !== process.arch
  ) {
    fail('installed target provenance does not match the host')
  }
}

function assertRemoved() {
  if (existsSync(manager.executable)) fail(`${options.manager} removal left the openalice command behind`)
}

function runtimeStatus() {
  return JSON.parse(capture(manager.executable, [
    'status', '--home', runtimeHome, '--wait', '3', '--json',
  ], runtimeEnv)).result?.status
}

function run(command, args, env, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 180_000,
  })
  if (result.error && !allowFailure) throw result.error
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args[0]} failed (${result.status}):\n${result.stdout}\n${result.stderr}`)
  }
  return result
}

function capture(command, args, env) {
  return run(command, args, env).stdout
}

function parseArgs(argv) {
  const result = { brew: 'brew', pacman: 'pacman', keep: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--keep') result.keep = true
    else if ([
      '--manager', '--previous-version', '--current-version',
      '--previous-content-identity', '--current-content-identity',
      '--previous-package', '--current-package', '--brew', '--pacman',
    ].includes(arg)) {
      const value = argv[++index]
      if (!value || value.startsWith('--')) fail(`${arg} requires a value`)
      result[arg.slice(2).replaceAll('-', '')] = value
    } else fail(`unknown option: ${arg}`)
  }
  if (!['brew', 'aur'].includes(result.manager)) fail('--manager must be brew or aur')
  for (const field of [
    'previousversion', 'currentversion', 'previouscontentidentity',
    'currentcontentidentity', 'previouspackage', 'currentpackage',
  ]) {
    if (!result[field]) fail(`missing required lifecycle option: ${field}`)
  }
  if (
    !/^[a-f0-9]{16}$/.test(result.previouscontentidentity)
    || !/^[a-f0-9]{16}$/.test(result.currentcontentidentity)
  ) fail('content identities must be 16 lowercase hexadecimal characters')
  return {
    manager: result.manager,
    previousVersion: result.previousversion,
    currentVersion: result.currentversion,
    previousContentIdentity: result.previouscontentidentity,
    currentContentIdentity: result.currentcontentidentity,
    previousPackage: result.previouspackage,
    currentPackage: result.currentpackage,
    brew: result.brew,
    pacman: result.pacman,
    keep: result.keep,
  }
}

function fail(message) {
  throw new Error(message)
}
