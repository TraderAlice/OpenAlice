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

const options = parseArgs(process.argv.slice(2))
const root = mkdtempSync(join(tmpdir(), `openalice-${options.manager}-package-smoke-`))
const packagesRoot = join(root, 'packages')
const sourcePackages = resolve(options.packagesDir)
cpSync(sourcePackages, packagesRoot, { recursive: true })

const packageName = `openalice-${process.platform}-${process.arch}`
const platformRoot = join(packagesRoot, packageName)
const metaRoot = join(packagesRoot, 'openalice')
if (!existsSync(join(platformRoot, 'package.json'))) {
  fail(`generated package set does not contain ${packageName}`)
}
const tarballRoot = join(root, 'tarballs')
mkdirSync(tarballRoot, { recursive: true })
const platformTarball = pack(platformRoot, tarballRoot)
const metaPackagePath = join(metaRoot, 'package.json')
const metaPackage = JSON.parse(readFileSync(metaPackagePath, 'utf8'))
metaPackage.optionalDependencies = {
  [packageName]: `file:${platformTarball}`,
}
writeFileSync(metaPackagePath, `${JSON.stringify(metaPackage, null, 2)}\n`)
const metaTarball = pack(metaRoot, tarballRoot)

const managerRoot = join(root, 'manager')
const home = join(root, 'home')
const runtimeHome = join(root, 'runtime-home')
const baseEnv = {
  ...process.env,
  HOME: home,
  XDG_CACHE_HOME: join(root, 'cache'),
  npm_config_cache: join(root, 'npm-cache'),
  BUN_INSTALL: managerRoot,
}

try {
  if (options.manager === 'npm') {
    run(options.npm, ['install', '--global', '--prefix', managerRoot, metaTarball], baseEnv)
  } else {
    const bunExecutable = realpathSync(resolveExecutable(options.bun))
    const bunOnlyPath = join(root, 'bun-only-path')
    mkdirSync(bunOnlyPath, { recursive: true })
    symlinkSync(bunExecutable, join(bunOnlyPath, 'bun'))
    run(bunExecutable, ['add', '--global', '--trust', metaTarball], {
      ...baseEnv,
      PATH: `${bunOnlyPath}:/usr/bin:/bin`,
    })
  }

  const executable = join(managerRoot, 'bin', 'openalice')
  if (!existsSync(executable)) fail(`${options.manager} did not install the openalice command`)
  const runtimeEnv = {
    HOME: home,
    PATH: '/usr/bin:/bin',
  }
  const version = JSON.parse(capture(executable, ['version', '--json'], runtimeEnv))
  if (version.version !== options.expectedVersion) fail(`installed version is ${version.version}`)
  if (version.contentIdentity !== options.expectedContentIdentity) {
    fail(`installed content identity is ${version.contentIdentity}`)
  }
  if (version.installSource?.method !== options.manager) {
    fail(`installed provenance method is ${version.installSource?.method}`)
  }
  if (version.installSource?.artifact?.platform !== process.platform) fail('installed platform provenance is wrong')
  if (version.installSource?.artifact?.arch !== process.arch) fail('installed architecture provenance is wrong')

  run(executable, ['up', '--home', runtimeHome, '--no-update-check', '--wait', '120', '--json'], runtimeEnv)
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
  run(executable, ['down', '--home', runtimeHome, '--json'], runtimeEnv)
  const uninstall = capture(executable, ['uninstall', '--yes'], runtimeEnv)
  const expectedRemoval = options.manager === 'npm'
    ? 'npm uninstall -g openalice'
    : 'bun remove -g openalice'
  if (!uninstall.includes(expectedRemoval)) fail('uninstall guidance did not return to the package manager')
  if (!existsSync(executable)) fail('OpenAlice removed package-manager-owned files')

  if (options.manager === 'npm') {
    run(options.npm, ['uninstall', '--global', '--prefix', managerRoot, 'openalice'], baseEnv)
  } else {
    run(options.bun, ['remove', '--global', 'openalice'], baseEnv)
  }
  if (existsSync(executable)) fail(`${options.manager} removal left the openalice command behind`)
  process.stdout.write(`[cli-package-smoke] ${options.manager} passed ${process.platform}-${process.arch}\n`)
} finally {
  if (options.keep) {
    process.stdout.write(`[cli-package-smoke] kept ${root}\n`)
  } else {
    rmSync(root, { recursive: true, force: true })
  }
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
