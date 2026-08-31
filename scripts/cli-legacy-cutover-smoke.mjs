#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
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
export const DEFAULT_LEGACY_INSTALLER_SHA256 =
  'a2f34a715cc4a089854fde18741e316953868c1685db592b67b2b4ea10ede0bb'
const PUBLIC_INSTALLER_URL = 'https://openalice.ai/install'
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

const FIXTURE_SERVER_SOURCE = `
const { createServer } = require('node:http')
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs')

const config = JSON.parse(process.env.OPENALICE_CLI_UPDATE_FIXTURE_CONFIG)
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  appendFileSync(config.requestLog, request.method + ' ' + pathname + '\\n')
  const baseUrl = 'http://' + request.headers.host

  if (pathname === '/manifest.json') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      channel: 'stable',
      version: config.version,
      releaseNotesUrl: baseUrl + '/release-notes',
      installer: {
        url: baseUrl + '/install',
        versionedUrl: baseUrl + config.installerPath,
        sha256: config.installerSha256,
      },
    }))
    return
  }
  if (pathname === config.installerPath || pathname === '/install') {
    response.setHeader('content-type', 'text/plain')
    response.end(readFileSync(config.installer))
    return
  }
  if (pathname === config.archivePath) {
    response.setHeader('content-type', 'application/gzip')
    response.end(readFileSync(config.archive))
    return
  }
  if (pathname === config.archivePath + '.sha256') {
    response.setHeader('content-type', 'text/plain')
    response.end(config.archiveSha256 + '  ' + config.archiveName + '\\n')
    return
  }
  if (pathname === '/release-notes') {
    response.setHeader('content-type', 'text/plain')
    response.end('OpenAlice ' + config.version + '\\n')
    return
  }
  response.statusCode = 404
  response.end('not found\\n')
})

server.listen(0, '127.0.0.1', () => {
  writeFileSync(config.portFile, String(server.address().port))
})
const stop = () => server.close(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
`

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
    verifyLegacyInstallerSha256(readFileSync(legacyInstaller), options.legacyInstallerSha256)
    chmodSync(legacyInstaller, 0o755)
    prepareLegacyPiAssets(options.curl, legacyPiAssets, legacyEnv)
    run(legacyInstaller, [
      '--install-dir', installRoot,
      '--no-modify-path',
      '--yes',
    ], legacySeedEnvironment(options, legacyEnv, legacyPiAssets), 15 * 60_000)

    if (!existsSync(join(installRoot, 'cli-versions'))) {
      fail('published legacy installer did not create the expected cli-versions layout')
    }
    if (!existsSync(executable)) fail('published legacy installer did not create openalice')
    if (!existsSync(join(installRoot, 'bin', 'pi'))) {
      fail('published legacy installer did not create its managed Pi launcher')
    }
    const legacyVersion = JSON.parse(capture(executable, ['version', '--json'], legacyEnv))
    if (legacyVersion.version !== options.legacyVersion) {
      fail(`published legacy installer installed ${legacyVersion.version}, expected ${options.legacyVersion}`)
    }
    if (legacyVersion.installSource?.updateChannel !== 'stable') {
      fail(`published legacy installer recorded ${legacyVersion.installSource?.updateChannel}, expected stable`)
    }

    mkdirSync(dirname(dataMarker), { recursive: true })
    writeFileSync(dataMarker, 'preserve-product-data\n')
    const externalPiBefore = readFileSync(externalPi, 'utf8')

    if (options.channel === 'stable') {
      const fixture = startStableUpdateFixture(options, root)
      try {
        run(executable, ['update', '--yes'], {
          ...legacyEnv,
          PATH: `${dirname(externalPi)}:${inheritedPath}`,
          OPENALICE_INSTALL_URL: 'https://openalice.ai/install',
          OPENALICE_UPDATE_MANIFEST_URL: `${fixture.baseUrl}/manifest.json`,
          OPENALICE_STABLE_MANIFEST_URL: `${fixture.baseUrl}/manifest.json`,
          OPENALICE_RELEASE_ASSET_BASE_URL: fixture.baseUrl,
        }, 10 * 60_000)
      } finally {
        fixture.stop()
      }
      fixture.assertRequests()
    } else {
      run(options.installer, [
        '--archive', options.archive,
        '--sha256', options.sha256,
        '--install-dir', installRoot,
        '--no-modify-path',
        '--yes',
      ], { ...legacyEnv, PATH: `${dirname(externalPi)}:${inheritedPath}` }, 5 * 60_000)
    }

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
    if (options.channel === 'stable') {
      if (version.installSource?.updateChannel !== 'stable') {
        fail(`stable updater cutover recorded ${version.installSource?.updateChannel}, expected stable`)
      }
      if (
        version.installSource?.selector?.kind !== 'version'
        || version.installSource?.selector?.value !== `v${options.expectedVersion}`
      ) {
        fail(`stable updater cutover recorded unexpected selector ${JSON.stringify(version.installSource?.selector)}`)
      }
      if (version.installSource?.installerUrl !== 'https://openalice.ai/install') {
        fail(`stable updater cutover recorded unexpected installer ${version.installSource?.installerUrl}`)
      }
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

export function legacySeedEnvironment(options, baseEnv, piAssets) {
  return {
    ...baseEnv,
    OPENALICE_PI_SOURCE_DIR: piAssets,
    OPENALICE_INSTALL_URL: PUBLIC_INSTALLER_URL,
    OPENALICE_INSTALL_UPDATE_CHANNEL: 'stable',
    OPENALICE_INSTALLER_RELEASE_VERSION: options.legacyVersion,
    OPENALICE_INSTALLER_UPDATE_CHANNEL: 'stable',
    OPENALICE_EXPECTED_CLI_VERSION: options.legacyVersion,
  }
}

export function verifyLegacyInstallerSha256(bytes, expectedSha256) {
  const actualSha256 = createHash('sha256').update(bytes).digest('hex')
  if (actualSha256 !== expectedSha256) {
    fail(`published legacy installer failed SHA-256 verification: expected ${expectedSha256}, received ${actualSha256}`)
  }
  return actualSha256
}

function startStableUpdateFixture(options, root) {
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : null
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
  if (!platform || !arch) fail(`unsupported stable update fixture target: ${process.platform}-${process.arch}`)

  const archiveName = `openalice-cli-${options.expectedVersion}-${platform}-${arch}.tar.gz`
  const installerPath = `/OpenAlice-${options.expectedVersion}-install`
  const archivePath = `/v${options.expectedVersion}/${archiveName}`
  const portFile = join(root, 'stable-update-fixture.port')
  const requestLog = join(root, 'stable-update-fixture.requests')
  writeFileSync(requestLog, '')
  const config = {
    version: options.expectedVersion,
    installer: options.installer,
    installerPath,
    installerSha256: createHash('sha256').update(readFileSync(options.installer)).digest('hex'),
    archive: options.archive,
    archiveName,
    archivePath,
    archiveSha256: options.sha256,
    portFile,
    requestLog,
  }
  const child = spawn(process.execPath, ['--eval', FIXTURE_SERVER_SOURCE], {
    env: {
      ...process.env,
      OPENALICE_CLI_UPDATE_FIXTURE_CONFIG: JSON.stringify(config),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const deadline = Date.now() + 10_000
  const waitCell = new Int32Array(new SharedArrayBuffer(4))
  while (!existsSync(portFile) && Date.now() < deadline) {
    Atomics.wait(waitCell, 0, 0, 25)
  }
  if (!existsSync(portFile)) {
    child.kill('SIGTERM')
    fail('stable update fixture did not become ready')
  }
  const port = readFileSync(portFile, 'utf8').trim()
  if (!/^[1-9][0-9]*$/.test(port)) {
    child.kill('SIGTERM')
    fail(`stable update fixture returned an invalid port: ${port}`)
  }
  const requiredRequests = [
    '/manifest.json',
    installerPath,
    archivePath,
    `${archivePath}.sha256`,
  ]
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => child.kill('SIGTERM'),
    assertRequests: () => {
      const requests = new Set(readFileSync(requestLog, 'utf8').trim().split('\n').filter(Boolean))
      for (const pathname of requiredRequests) {
        if (!requests.has(`GET ${pathname}`)) {
          fail(`stable update fixture did not receive GET ${pathname}; received ${[...requests].join(', ')}`)
        }
      }
    },
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
    channel: 'stable',
    curl: 'curl',
    installer: resolve(import.meta.dirname, '..', 'install'),
    legacyversion: DEFAULT_LEGACY_VERSION,
    legacyinstallerurl: DEFAULT_LEGACY_INSTALLER_URL,
    legacyinstallersha256: DEFAULT_LEGACY_INSTALLER_SHA256,
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
      '--legacy-version', '--legacy-installer-url', '--legacy-installer-sha256',
      '--installer', '--curl', '--channel',
    ].includes(name)) fail(`unknown option: ${name}\n${usage()}`)
    const value = argv[++index]
    if (!value || value.startsWith('--')) fail(`${name} requires a value\n${usage()}`)
    result[name.slice(2).replaceAll('-', '')] = value
  }
  if (!result.archive || !result.sha256 || !result.expectedversion || !result.expectedcontentidentity) {
    fail(usage())
  }
  if (!/^[a-f0-9]{64}$/.test(result.sha256)) fail('--sha256 must be 64 lowercase hex characters')
  if (!/^[a-f0-9]{64}$/.test(result.legacyinstallersha256)) {
    fail('--legacy-installer-sha256 must be 64 lowercase hex characters')
  }
  if (!/^[a-f0-9]{16}$/.test(result.expectedcontentidentity)) {
    fail('--expected-content-identity must be 16 lowercase hex characters')
  }
  if (!['stable', 'beta', 'dev'].includes(result.channel)) fail('--channel must be stable, beta, or dev')
  for (const version of [result.legacyversion, result.expectedversion]) {
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
      fail(`invalid OpenAlice version: ${version}`)
    }
  }
  if (result.channel === 'stable' && !/^\d+\.\d+\.\d+$/.test(result.expectedversion)) {
    fail(`stable cutover requires a stable expected version: ${result.expectedversion}`)
  }
  if (result.channel === 'beta' && !/^\d+\.\d+\.\d+-beta(?:\.[1-9][0-9]*)?$/.test(result.expectedversion)) {
    fail(`beta cutover requires a beta expected version: ${result.expectedversion}`)
  }
  return {
    channel: result.channel,
    archive: resolve(result.archive),
    sha256: result.sha256,
    expectedVersion: result.expectedversion,
    expectedContentIdentity: result.expectedcontentidentity,
    legacyVersion: result.legacyversion,
    legacyInstallerUrl: result.legacyinstallerurl,
    legacyInstallerSha256: result.legacyinstallersha256,
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
  return 'Usage: cli-legacy-cutover-smoke.mjs --archive <tar.gz> --sha256 <hex> --expected-version <version> --expected-content-identity <id> [--channel <stable|beta|dev>] [--legacy-version <version>] [--legacy-installer-url <url>] [--legacy-installer-sha256 <hex>] [--installer <path>] [--curl <command>] [--keep]'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runLegacyCutoverSmoke(parseArgs(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`Legacy CLI cutover smoke: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
