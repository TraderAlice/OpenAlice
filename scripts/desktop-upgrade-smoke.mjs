#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import WebSocket from 'ws'

import { assertDesktopPackage } from './assert-desktop-package.mjs'
import {
  buildDesktopUpgradeSmokePlan,
  buildUpgradeSeedExpression,
  buildUpgradeVerifyExpression,
  candidateDesktopAssetName,
  DESKTOP_UPGRADE_RECEIPT_SCHEMA_VERSION,
  previousDesktopAssetName,
  selectPreviousDesktopTag,
  versionFromTag,
  windowsInstallerArgs,
} from './desktop-upgrade-smoke-lib.mjs'
import { packagedElectronExecutable } from './smoke-packaged-toolchain.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const candidateVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version
const repository = process.env['GITHUB_REPOSITORY'] || 'TraderAlice/OpenAlice'

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function run(command, args, options = {}) {
  console.log(`[desktop-upgrade] ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status ?? 'unknown'}${result.signal ? ` (${result.signal})` : ''}`)
  }
}

function resolvePreviousTag(explicitTag) {
  if (explicitTag) return explicitTag
  const result = spawnSync('git', ['tag', '--list', 'v[0-9]*', '--sort=-version:refname'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git tag failed: ${result.stderr}`)
  const selected = selectPreviousDesktopTag(
    result.stdout.split(/\r?\n/).map((tag) => tag.trim()).filter(Boolean),
    candidateVersion,
  )
  if (!selected) throw new Error(`no previous desktop release differs from candidate ${candidateVersion}`)
  return selected
}

async function download(url, destination) {
  console.log(`[desktop-upgrade] download ${url}`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`download failed ${response.status}: ${url}`)
  await pipeline(response.body, createWriteStream(destination))
}

function extractMacZip(archive, destination) {
  mkdirSync(destination, { recursive: true })
  run('ditto', ['-x', '-k', archive, destination])
  const executable = join(destination, 'OpenAlice.app', 'Contents', 'MacOS', 'OpenAlice')
  if (!existsSync(executable)) throw new Error(`macOS app executable missing after extraction: ${executable}`)
  return executable
}

async function waitForPath(path, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return
    await sleep(200)
  }
  throw new Error(`timed out waiting for ${path}`)
}

async function waitForInstalledVersion(installRoot, expectedVersion, timeoutMs = 20 * 60_000) {
  const packageJson = join(installRoot, 'resources', 'app', 'package.json')
  const startedAt = Date.now()
  const deadline = Date.now() + timeoutMs
  let lastObservedVersion = null
  let lastProgressAt = 0
  while (Date.now() < deadline) {
    let observedVersion = '<replacing>'
    try {
      observedVersion = JSON.parse(readFileSync(packageJson, 'utf8')).version ?? '<missing>'
      if (observedVersion === expectedVersion) return
    } catch {
      // NSIS replaces the package tree in place; partial reads are expected while it runs.
    }
    const now = Date.now()
    if (observedVersion !== lastObservedVersion || now - lastProgressAt >= 30_000) {
      const elapsedSeconds = Math.round((now - startedAt) / 1000)
      console.log(
        `[desktop-upgrade] waiting for installed ${expectedVersion}: ` +
        `observed=${observedVersion} elapsed=${elapsedSeconds}s`,
      )
      lastObservedVersion = observedVersion
      lastProgressAt = now
      if (process.platform === 'win32') logWindowsUpgradeProcesses(installRoot)
    }
    await sleep(500)
  }
  throw new Error(`timed out waiting for installed OpenAlice ${expectedVersion} under ${installRoot}`)
}

function logWindowsUpgradeProcesses(installRoot) {
  const powershell = join(
    process.env['SystemRoot'] || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const script = [
    "$root = [IO.Path]::GetFullPath($env:OPENALICE_UPGRADE_INSTALL_ROOT);",
    'Get-CimInstance -ClassName Win32_Process',
    '| Where-Object {',
    "  ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase))",
    "  -or $_.Name -like 'OpenAlice*'",
    "  -or $_.Name -eq 'old-uninstaller.exe'",
    '}',
    '| Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine',
    '| ConvertTo-Json -Compress',
  ].join(' ')
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
    env: {
      ...process.env,
      OPENALICE_UPGRADE_INSTALL_ROOT: installRoot,
    },
  })
  const output = result.stdout?.trim()
  if (result.status === 0) {
    console.log(`[desktop-upgrade] Windows process snapshot: ${output || '[]'}`)
  } else {
    const detail = result.error?.message || result.stderr?.trim() || `exit ${result.status ?? 'unknown'}`
    console.log(`[desktop-upgrade] Windows process snapshot unavailable: ${detail}`)
  }
}

async function spawnDetached(command, args) {
  console.log(`[desktop-upgrade] ${command} ${args.join(' ')}`)
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once('spawn', resolveSpawn)
    child.once('error', rejectSpawn)
  })
  return child
}

async function waitForInstallerExit(child, installRoot, timeoutMs = 10 * 60_000) {
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs
  let lastProgressAt = 0
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    const now = Date.now()
    if (now - lastProgressAt >= 30_000) {
      console.log(
        `[desktop-upgrade] waiting for detached installer pid=${child.pid ?? '<unknown>'}: ` +
        `elapsed=${Math.round((now - startedAt) / 1000)}s`,
      )
      if (process.platform === 'win32') logWindowsUpgradeProcesses(installRoot)
      lastProgressAt = now
    }
    await sleep(500)
  }
  if (child.exitCode === null && child.signalCode === null) {
    terminateTree(child)
    throw new Error(`timed out waiting for detached installer pid=${child.pid ?? '<unknown>'}`)
  }
  if (child.exitCode !== 0) {
    throw new Error(
      `detached installer exited ${child.exitCode ?? 'unknown'}` +
      `${child.signalCode ? ` (${child.signalCode})` : ''}`,
    )
  }
  console.log(`[desktop-upgrade] detached installer exited 0`)
}

async function installWindows(archive, installRoot, isUpdate = false) {
  mkdirSync(dirname(installRoot), { recursive: true })
  const args = windowsInstallerArgs(installRoot, isUpdate)
  if (isUpdate) {
    // NsisUpdater starts the installer detached, then quits Electron. The app
    // tree can expose its new package.json before NSIS finishes writing files,
    // shortcuts, and uninstall metadata, so do not launch the candidate until
    // the detached installer has actually completed.
    const installer = await spawnDetached(archive, args)
    await waitForInstallerExit(installer, installRoot)
    await waitForInstalledVersion(installRoot, candidateVersion)
  } else {
    run(archive, args)
  }
  const executable = join(installRoot, 'OpenAlice.exe')
  await waitForPath(executable)
  return executable
}

function getAvailablePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createNetServer()
    server.unref()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((error) => {
        if (error) rejectPort(error)
        else if (port) resolvePort(port)
        else rejectPort(new Error('unable to allocate loopback port'))
      })
    })
  })
}

class CdpClient {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('DevTools connection closed'))
      this.pending.clear()
    })
  }

  static connect(url) {
    return new Promise((resolveClient, rejectClient) => {
      const socket = new WebSocket(url)
      socket.addEventListener('open', () => resolveClient(new CdpClient(socket)), { once: true })
      socket.addEventListener('error', () => rejectClient(new Error('DevTools WebSocket failed')), { once: true })
    })
  }

  command(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolveCommand, rejectCommand) => {
      this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    }
    return result.result?.value
  }

  close() {
    try { this.socket.close() } catch { /* already closed */ }
  }
}

async function waitForRenderer(debugPort, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`OpenAlice exited before renderer readiness (${child.exitCode})`)
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find((target) =>
          target.type === 'page' &&
          typeof target.url === 'string' &&
          target.url.startsWith('app://openalice') &&
          target.webSocketDebuggerUrl)
        if (page) return CdpClient.connect(page.webSocketDebuggerUrl)
      }
    } catch (error) {
      lastError = error
    }
    await sleep(250)
  }
  throw new Error(`timed out waiting for OpenAlice renderer${lastError ? `: ${lastError.message}` : ''}`)
}

function terminateTree(child) {
  if (!child || child.exitCode !== null || child.pid == null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try { child.kill('SIGTERM') } catch { /* already exited */ }
  }
}

function waitForExit(child, timeoutMs = 30_000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode)
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      terminateTree(child)
      rejectExit(new Error('OpenAlice did not exit after renderer close'))
    }, timeoutMs)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      resolveExit(code)
    })
  })
}

async function runRendererJourney({ executable, env, electronUserData, expression, label }) {
  const debugPort = await getAvailablePort()
  console.log(`[desktop-upgrade] launch ${label}: ${executable}`)
  const child = spawn(executable, [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${electronUserData}`,
  ], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  })
  let client = null
  try {
    client = await waitForRenderer(debugPort, child)
    let result
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        result = await client.evaluate(expression)
        break
      } catch (error) {
        if (!String(error?.message ?? error).includes('Execution context was destroyed') || attempt === 4) {
          throw error
        }
        client.close()
        await sleep(500)
        client = await waitForRenderer(debugPort, child)
      }
    }
    await client.evaluate('window.close(); true').catch(() => undefined)
    client.close()
    client = null
    const exitCode = await waitForExit(child)
    if (exitCode !== 0) throw new Error(`${label} exited ${exitCode}`)
    return result
  } catch (error) {
    client?.close()
    terminateTree(child)
    throw error
  }
}

async function candidateExecutableFromPackage(packageRoot) {
  const result = assertDesktopPackage({ packageRoot })
  const executable = result.appRoot ? packagedElectronExecutable(result.appRoot, result.platform) : null
  if (!result.ok || !executable || !existsSync(executable)) {
    throw new Error([...result.errors, `candidate executable missing under ${packageRoot}`].join('\n'))
  }
  if (result.platform !== process.platform || result.platformArch !== `${process.platform}-${process.arch}`) {
    throw new Error(
      `candidate package ${result.platformArch} does not match host ${process.platform}-${process.arch}`,
    )
  }
  return executable
}

async function main() {
  const plan = buildDesktopUpgradeSmokePlan(process.argv.slice(2), { cwd: repoRoot })
  if (plan.errors.length > 0) {
    for (const error of plan.errors) console.error(error)
    return 1
  }
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    console.error(`[desktop-upgrade] unsupported host ${process.platform}-${process.arch}`)
    return 1
  }

  const fromTag = resolvePreviousTag(plan.fromTag)
  const previousVersion = versionFromTag(fromTag)
  if (!previousVersion || previousVersion === candidateVersion) {
    throw new Error(`previous ${fromTag} must differ from candidate ${candidateVersion}`)
  }

  const createdSmokeRoot = mkdtempSync(join(tmpdir(), 'openalice-desktop-upgrade-'))
  // GitHub's Windows runners expose TEMP through an 8.3 path such as
  // C:\Users\RUNNER~1\.... NSIS records /D verbatim, while its process check
  // compares that install root with the long paths returned by CIM. Expanding
  // the existing directory first keeps the upgrade fixture representative and
  // lets the candidate installer close every process under the old app root.
  const smokeRoot = process.platform === 'win32'
    ? realpathSync.native(createdSmokeRoot)
    : createdSmokeRoot
  const smokeHome = join(smokeRoot, 'home')
  const smokeWorkspaces = join(smokeRoot, 'workspaces')
  const smokeGlobal = join(smokeRoot, 'global')
  const smokeOsHome = join(smokeRoot, 'os-home')
  const electronUserData = join(smokeRoot, 'electron-user-data')
  const previousAsset = previousDesktopAssetName(previousVersion, process.platform, process.arch)
  const previousArchive = join(smokeRoot, previousAsset)
  const receiptPath = plan.receiptPath ?? join(smokeRoot, 'desktop-upgrade-receipt.json')
  let previousChildExecutable = null
  let journeyCompleted = false

  try {
    mkdirSync(smokeOsHome, { recursive: true })
    const previousUrl = `https://github.com/${repository}/releases/download/${encodeURIComponent(fromTag)}/${encodeURIComponent(previousAsset)}`
    await download(previousUrl, previousArchive)

    if (process.platform === 'darwin') {
      previousChildExecutable = extractMacZip(previousArchive, join(smokeRoot, 'previous'))
    } else {
      previousChildExecutable = await installWindows(previousArchive, join(smokeRoot, 'installed', 'OpenAlice'))
    }

    const commonEnv = {
      ...process.env,
      ...(process.platform === 'darwin'
        ? { HOME: smokeOsHome, XDG_CACHE_HOME: join(smokeOsHome, '.cache') }
        : {
            APPDATA: join(smokeOsHome, 'AppData', 'Roaming'),
            LOCALAPPDATA: join(smokeOsHome, 'AppData', 'Local'),
          }),
      OPENALICE_HOME: smokeHome,
      AQ_LAUNCHER_ROOT: smokeWorkspaces,
      OPENALICE_GLOBAL_DIR: smokeGlobal,
      OPENALICE_LITE_MODE: '1',
      OPENALICE_MCP_ENABLED: '0',
      OPENALICE_UTA_DISABLED: '1',
    }
    delete commonEnv.OPENALICE_TAKEOVER
    const tag = `desktop-upgrade-${previousVersion.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
    const postUpgradeTag = `${tag}-post`
    const sentinelKey = 'openalice-desktop-upgrade-smoke'
    const sentinelValue = `${fromTag}->${candidateVersion}`

    const seeded = await runRendererJourney({
      executable: previousChildExecutable,
      env: commonEnv,
      electronUserData,
      expression: buildUpgradeSeedExpression({ tag, sentinelKey, sentinelValue }),
      label: `previous ${previousVersion}`,
    })
    if (
      seeded.version !== previousVersion ||
      seeded.workspacePresent !== true ||
      seeded.sentinel !== sentinelValue ||
      !seeded.workspaceId
    ) {
      throw new Error(`previous release did not seed expected state: ${JSON.stringify(seeded)}`)
    }

    let candidateExecutable
    let candidateSource
    if (plan.candidateArtifactDir) {
      const asset = join(
        plan.candidateArtifactDir,
        candidateDesktopAssetName(candidateVersion, process.platform, process.arch),
      )
      if (!existsSync(asset)) throw new Error(`candidate release asset missing: ${asset}`)
      candidateSource = 'final-artifact'
      candidateExecutable = process.platform === 'darwin'
        ? extractMacZip(asset, join(smokeRoot, 'candidate'))
        : await installWindows(asset, join(smokeRoot, 'installed', 'OpenAlice'), true)
    } else {
      candidateSource = 'unpacked-package'
      candidateExecutable = await candidateExecutableFromPackage(plan.candidatePackageRoot)
    }

    const verifyExpression = buildUpgradeVerifyExpression({
      expectedWorkspaceId: seeded.workspaceId,
      postUpgradeTag,
      sentinelKey,
    })
    const upgraded = await runRendererJourney({
      executable: candidateExecutable,
      env: commonEnv,
      electronUserData,
      expression: verifyExpression,
      label: `candidate ${candidateVersion}`,
    })
    const restarted = await runRendererJourney({
      executable: candidateExecutable,
      env: commonEnv,
      electronUserData,
      expression: verifyExpression,
      label: `candidate restart ${candidateVersion}`,
    })

    const checks = {
      previousVersionMatched: seeded.version === previousVersion,
      previousWorkspaceSeeded: seeded.workspacePresent === true,
      candidateVersionMatched: upgraded.version === candidateVersion,
      previousWorkspacePreserved: upgraded.previousWorkspacePresent === true,
      previousMetadataPreserved: upgraded.previousDisplayName === 'N-1 upgrade sentinel',
      browserStatePreserved: upgraded.sentinel === sentinelValue,
      postUpgradeWriteSucceeded: upgraded.postUpgradeWorkspacePresent === true,
      candidateRestarted: restarted.version === candidateVersion,
      restartPreservedPreviousWorkspace: restarted.previousWorkspacePresent === true,
      restartPreservedPostUpgradeWrite:
        restarted.postUpgradeWorkspaceId === upgraded.postUpgradeWorkspaceId &&
        restarted.postUpgradeWorkspacePresent === true,
      restartPreservedBrowserState: restarted.sentinel === sentinelValue,
    }
    const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name)
    const receipt = {
      schemaVersion: DESKTOP_UPGRADE_RECEIPT_SCHEMA_VERSION,
      mode: 'desktop-n-1-upgrade',
      platform: process.platform,
      arch: process.arch,
      fromTag,
      previousVersion,
      candidateVersion,
      candidateSource,
      previousWorkspaceId: seeded.workspaceId,
      postUpgradeWorkspaceId: upgraded.postUpgradeWorkspaceId,
      checks,
    }
    mkdirSync(dirname(receiptPath), { recursive: true })
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
    console.log(`[desktop-upgrade] receipt: ${JSON.stringify(receipt)}`)
    if (failed.length > 0) throw new Error(`desktop upgrade checks failed: ${failed.join(', ')}`)
    journeyCompleted = true
    return 0
  } finally {
    if (plan.keep) {
      console.log(`[desktop-upgrade] kept isolated upgrade root: ${smokeRoot}`)
    } else {
      try {
        // Chromium can finish a final userData write just after the Electron
        // process exit event. Give it a short grace and use bounded retries.
        await sleep(500)
        rmSync(smokeRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
      } catch (cleanupError) {
        if (journeyCompleted) throw cleanupError
        console.error(
          `[desktop-upgrade] cleanup also failed for ${smokeRoot}: ` +
          `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        )
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main()
  } catch (error) {
    console.error(`[desktop-upgrade] ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    process.exitCode = 1
  }
}
