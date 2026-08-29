#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_LEGACY_VERSION = '0.90.1'
export const DEFAULT_LEGACY_INSTALLER_URL =
  `https://github.com/TraderAlice/OpenAlice/releases/download/v${DEFAULT_LEGACY_VERSION}/OpenAlice-${DEFAULT_LEGACY_VERSION}-install`
export const LEGACY_PI_ASSETS = Object.freeze({
  'package.json': {
    url: `https://raw.githubusercontent.com/TraderAlice/OpenAlice/v${DEFAULT_LEGACY_VERSION}/scripts/install-smoke/pi-assets/package.json`,
    sha256: '41f07a3eb41227905ac436ad41d949e4589dcc34c15454d718f85f399b533cb6',
  },
  'package-lock.json': {
    url: `https://raw.githubusercontent.com/TraderAlice/OpenAlice/v${DEFAULT_LEGACY_VERSION}/scripts/install-smoke/pi-assets/package-lock.json`,
    sha256: 'f5cb41dcfc60561ba54490b49c17beecec202900f73eb5f104b34f8b2a79a0af',
  },
})

export function runLegacyCutoverSmoke(options) {
  const root = mkdtempSync(join(tmpdir(), 'openalice-legacy-cutover-'))
  const home = join(root, 'home')
  const installRoot = join(root, 'install')
  const runtimeHome = join(root, 'runtime-home')
  const legacyInstaller = join(root, 'legacy-install')
  const legacyPiAssets = join(root, 'legacy-pi-assets')
  const dataMarker = join(installRoot, 'data', 'cutover-marker.txt')
  const externalPi = join(root, 'external-bin', 'pi')
  const executable = join(installRoot, 'bin', 'openalice')
  const inheritedPath = process.env.PATH ?? '/usr/bin:/bin'
  const legacyEnv = { ...process.env, HOME: home, PATH: inheritedPath }
  const nativeEnv = { HOME: home, PATH: '/usr/bin:/bin' }

  mkdirSync(home, { recursive: true })
  mkdirSync(dirname(externalPi), { recursive: true })
  writeFileSync(externalPi, '#!/bin/sh\nprintf external-pi-preserved\\n\n')
  chmodSync(externalPi, 0o755)

  try {
    run(options.curl, [
      '-fsSL', '--retry', '3', '--retry-delay', '2',
      '-o', legacyInstaller, options.legacyInstallerUrl,
    ], legacyEnv, 5 * 60_000)
    chmodSync(legacyInstaller, 0o755)
    prepareLegacyPiAssets(options.curl, legacyPiAssets, legacyEnv)
    run(legacyInstaller, [
      '--version', `v${options.legacyVersion}`,
      '--install-dir', installRoot,
      '--no-modify-path',
      '--yes',
    ], { ...legacyEnv, OPENALICE_PI_SOURCE_DIR: legacyPiAssets }, 15 * 60_000)

    if (!existsSync(join(installRoot, 'cli-versions'))) {
      fail('published legacy installer did not create the expected cli-versions layout')
    }
    if (!existsSync(executable)) fail('published legacy installer did not create openalice')
    if (!existsSync(join(installRoot, 'bin', 'pi'))) {
      fail('published legacy installer did not create its managed Pi launcher')
    }

    mkdirSync(dirname(dataMarker), { recursive: true })
    writeFileSync(dataMarker, 'preserve-product-data\n')
    const externalPiBefore = readFileSync(externalPi, 'utf8')

    run(options.installer, [
      '--archive', options.archive,
      '--sha256', options.sha256,
      '--install-dir', installRoot,
      '--no-modify-path',
      '--yes',
    ], { ...legacyEnv, PATH: `${dirname(externalPi)}:${inheritedPath}` }, 5 * 60_000)

    if (existsSync(join(installRoot, 'cli-versions'))) {
      fail('native cutover left the installer-owned legacy cli-versions layout behind')
    }
    for (const launcher of ['pi', 'pi.cmd']) {
      if (existsSync(join(installRoot, 'bin', launcher))) {
        fail(`native cutover left the installer-owned ${launcher} launcher behind`)
      }
    }
    assertPreserved(dataMarker, 'preserve-product-data\n', 'product data marker')
    assertPreserved(externalPi, externalPiBefore, 'external Pi executable')

    const version = JSON.parse(capture(executable, ['version', '--json'], nativeEnv))
    if (version.version !== options.expectedVersion) {
      fail(`native cutover installed ${version.version}, expected ${options.expectedVersion}`)
    }
    if (version.contentIdentity !== options.expectedContentIdentity) {
      fail(`native cutover content identity is ${version.contentIdentity}, expected ${options.expectedContentIdentity}`)
    }
    if (version.installSource?.method !== 'direct') {
      fail(`native cutover provenance method is ${version.installSource?.method}, expected direct`)
    }

    run(executable, [
      'up', '--home', runtimeHome, '--no-update-check', '--wait', '120', '--json',
    ], nativeEnv, 150_000)
    const status = JSON.parse(capture(executable, [
      'status', '--home', runtimeHome, '--wait', '3', '--json',
    ], nativeEnv)).result?.status
    if (status?.class !== 'running' || status.provider?.contentIdentity !== options.expectedContentIdentity) {
      fail(`native Runtime did not become ready after cutover: ${JSON.stringify(status)}`)
    }
    run(executable, ['down', '--home', runtimeHome, '--json'], nativeEnv, 30_000)

    run(executable, ['uninstall', '--yes'], nativeEnv, 30_000)
    if (existsSync(executable)) fail('direct uninstall left the openalice launcher behind')
    assertPreserved(dataMarker, 'preserve-product-data\n', 'product data marker after uninstall')
    assertPreserved(externalPi, externalPiBefore, 'external Pi executable after uninstall')

    process.stdout.write(
      `[cli-legacy-cutover] ${options.legacyVersion} -> ${options.expectedVersion} passed ${process.platform}-${process.arch}\n`,
    )
  } finally {
    if (existsSync(executable)) {
      spawnSync(executable, ['down', '--home', runtimeHome, '--json'], {
        env: nativeEnv,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 30_000,
      })
    }
    if (options.keep) process.stdout.write(`[cli-legacy-cutover] kept ${root}\n`)
    else rmSync(root, { recursive: true, force: true })
  }
}

function prepareLegacyPiAssets(curl, destination, env) {
  mkdirSync(destination, { recursive: true })
  for (const [name, asset] of Object.entries(LEGACY_PI_ASSETS)) {
    const path = join(destination, name)
    run(curl, [
      '-fsSL', '--retry', '3', '--retry-delay', '2',
      '-o', path, asset.url,
    ], env, 60_000)
    const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (actual !== asset.sha256) fail(`published legacy Pi fixture failed verification: ${name}`)
  }
}

export function parseArgs(argv) {
  const result = {
    curl: 'curl',
    installer: resolve(import.meta.dirname, '..', 'install'),
    legacyversion: DEFAULT_LEGACY_VERSION,
    legacyinstallerurl: DEFAULT_LEGACY_INSTALLER_URL,
    keep: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--keep') {
      result.keep = true
      continue
    }
    if (![
      '--archive', '--sha256', '--expected-version', '--expected-content-identity',
      '--legacy-version', '--legacy-installer-url', '--installer', '--curl',
    ].includes(name)) fail(`unknown option: ${name}\n${usage()}`)
    const value = argv[++index]
    if (!value || value.startsWith('--')) fail(`${name} requires a value\n${usage()}`)
    result[name.slice(2).replaceAll('-', '')] = value
  }
  if (!result.archive || !result.sha256 || !result.expectedversion || !result.expectedcontentidentity) {
    fail(usage())
  }
  if (!/^[a-f0-9]{64}$/.test(result.sha256)) fail('--sha256 must be 64 lowercase hex characters')
  if (!/^[a-f0-9]{16}$/.test(result.expectedcontentidentity)) {
    fail('--expected-content-identity must be 16 lowercase hex characters')
  }
  for (const version of [result.legacyversion, result.expectedversion]) {
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
      fail(`invalid OpenAlice version: ${version}`)
    }
  }
  return {
    archive: resolve(result.archive),
    sha256: result.sha256,
    expectedVersion: result.expectedversion,
    expectedContentIdentity: result.expectedcontentidentity,
    legacyVersion: result.legacyversion,
    legacyInstallerUrl: result.legacyinstallerurl,
    installer: resolve(result.installer),
    curl: result.curl,
    keep: result.keep,
  }
}

function assertPreserved(path, expected, label) {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== expected) fail(`${label} was not preserved`)
}

function run(command, args, env, timeout) {
  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    stdio: 'inherit',
    timeout,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (${result.status})`)
  return result
}

function capture(command, args, env) {
  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0]} failed (${result.status}):\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout
}

function fail(message) {
  throw new Error(message)
}

function usage() {
  return 'Usage: cli-legacy-cutover-smoke.mjs --archive <tar.gz> --sha256 <hex> --expected-version <version> --expected-content-identity <id> [--legacy-version <version>] [--legacy-installer-url <url>] [--installer <path>] [--curl <command>] [--keep]'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runLegacyCutoverSmoke(parseArgs(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`Legacy CLI cutover smoke: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
