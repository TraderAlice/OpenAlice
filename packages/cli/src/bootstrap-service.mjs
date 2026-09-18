import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

export const OPENALICE_SERVICE_NAME = 'OpenAliceServer'
export const OPENALICE_LAUNCH_AGENT_LABEL = 'ai.openalice.server'

const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32'])
const SUPPORTED_ARCHITECTURES = new Set(['arm64', 'x64'])

export function normalizeNativeTarget(platform, architecture, options = {}) {
  const normalizedPlatform = normalizePlatform(platform)
  const rawArchitecture = normalizedPlatform === 'win32'
    ? options.architecture6432 || architecture
    : architecture
  const normalizedArchitecture = normalizeArchitecture(rawArchitecture)
  if (!SUPPORTED_PLATFORMS.has(normalizedPlatform)) {
    throw serviceError('EPLATFORM', `Unsupported OpenAlice platform: ` + String(platform))
  }
  if (!SUPPORTED_ARCHITECTURES.has(normalizedArchitecture)) {
    throw serviceError('EARCH', `Unsupported OpenAlice architecture: ` + String(rawArchitecture))
  }
  return { platform: normalizedPlatform, arch: normalizedArchitecture }
}

export function detectLocalTarget(options = {}) {
  const env = options.env ?? process.env
  return normalizeNativeTarget(
    options.platform ?? process.platform,
    options.arch ?? process.arch,
    { architecture6432: env.PROCESSOR_ARCHITEW6432 },
  )
}

export function windowsTargetProbeCommand() {
  return 'cmd.exe /d /s /c "echo __OA_OS__=windows&echo __OA_ARCH__=%PROCESSOR_ARCHITECTURE%&echo __OA_ARCH6432__=%PROCESSOR_ARCHITEW6432%"'
}

export function posixTargetProbeCommand() {
  return "/bin/sh -c 'printf \"__OA_OS__=%s\\n__OA_ARCH__=%s\\n\" \"$(uname -s)\" \"$(uname -m)\"'"
}

export function parseTargetProbe(output) {
  const fields = Object.create(null)
  for (const line of String(output).split(/\r?\n/)) {
    const match = /^__OA_(OS|ARCH|ARCH6432)__=(.*)$/.exec(line.trim())
    if (match) fields[match[1]] = unresolvedWindowsVariable(match[2]) ? '' : match[2].trim()
  }
  if (!fields.OS || !fields.ARCH) {
    throw serviceError('EPROBE', 'OpenAlice target probe output is incomplete')
  }
  return normalizeNativeTarget(fields.OS, fields.ARCH, { architecture6432: fields.ARCH6432 })
}

export async function installPersistentService(options, dependencies = {}) {
  const target = normalizeNativeTarget(options.platform, options.arch)
  if (options.mode === 'none') {
    return { manager: 'none', name: null, state: 'disabled' }
  }
  const commandPath = options.commandPath
  const installRoot = options.installRoot
  const homeRoot = options.homeRoot ?? installRoot
  const port = options.port ?? 47332
  const waitSeconds = options.waitSeconds ?? 120
  const serviceOptions = {
    commandPath,
    statusCommandPath: options.statusCommandPath ?? commandPath,
    statusEnv: options.statusEnv,
    installRoot,
    homeRoot,
    port,
    waitSeconds,
    replaceExisting: options.replaceExisting === true,
  }
  rejectControlCharacters(commandPath, 'command path')
  rejectControlCharacters(serviceOptions.statusCommandPath, 'status command path')
  rejectControlCharacters(installRoot, 'install root')
  rejectControlCharacters(homeRoot, 'home root')

  if (target.platform === 'win32') return installWindowsTask(serviceOptions, dependencies)
  if (target.platform === 'linux') return installSystemdUserService(serviceOptions, dependencies)
  return installLaunchAgent(serviceOptions, dependencies)
}

export async function waitForNativeRuntime(options, dependencies = {}) {
  const spawn = dependencies.spawnSyncImpl ?? spawnSync
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const deadline = Date.now() + (options.waitSeconds ?? 120) * 1_000
  let detail = 'no status response'
  do {
    const result = spawn(options.commandPath, [
      'server', 'status', '--home', options.homeRoot, '--wait', '2', '--json',
    ], { encoding: 'utf8', windowsHide: true, env: options.env })
    if (result.status === 0) {
      try {
        const status = JSON.parse(String(result.stdout).trim())
        if (status?.class === 'running') return status
        detail = status?.detail ?? status?.class ?? status?.state ?? 'not running'
      } catch {
        detail = 'invalid status JSON'
      }
    } else {
      detail = String(result.stderr || result.stdout || `status exit ` + result.status).trim()
    }
    await sleep(500)
  } while (Date.now() < deadline)
  throw serviceError('ESERVICE', `OpenAlice Runtime did not become ready: ` + detail)
}

async function installWindowsTask(options, dependencies) {
  const spawn = dependencies.spawnSyncImpl ?? spawnSync
  const run = (command, args, allowFailure = false) => runCommand(spawn, command, args, allowFailure)
  const whoami = run('whoami.exe', ['/user', '/fo', 'csv', '/nh'])
  const sid = /"(S-1-[0-9-]+)"/i.exec(whoami.stdout)?.[1]
  if (!sid) throw serviceError('ESERVICE', 'Could not resolve the current Windows user SID')
  const temporaryRoot = dependencies.temporaryRoot ?? join(homedir(), '.openalice')
  await mkdir(temporaryRoot, { recursive: true })
  const token = process.pid + `-` + randomUUID()
  const taskXml = join(temporaryRoot, `.bootstrap-task-` + token + `.xml`)
  const backupXml = join(temporaryRoot, `.bootstrap-task-` + token + `.previous.xml`)
  const previous = queryWindowsTask(spawn, backupXml)
  if (previous.status === 0 && !options.replaceExisting) {
    throw serviceError('ESERVICE', 'OpenAliceServer is already owned by another installation')
  }
  const xml = windowsTaskXml({ ...options, sid })
  let installed = false
  try {
    await (dependencies.writeFileImpl ?? writeFile)(taskXml, '\uFEFF' + xml, 'utf16le')
    const createArguments = ['/Create', '/TN', OPENALICE_SERVICE_NAME, '/XML', taskXml]
    if (previous.status === 0) createArguments.push('/F')
    run('schtasks.exe', createArguments)
    installed = true
    run('schtasks.exe', ['/Run', '/TN', OPENALICE_SERVICE_NAME])
    const runtime = await waitForNativeRuntime({
      commandPath: options.statusCommandPath,
      homeRoot: options.homeRoot,
      waitSeconds: options.waitSeconds,
      env: options.statusEnv,
    }, dependencies)
    return { manager: 'task-scheduler', name: OPENALICE_SERVICE_NAME, state: 'running', runtime }
  } catch (error) {
    if (installed) {
      run('schtasks.exe', ['/End', '/TN', OPENALICE_SERVICE_NAME], true)
      const removed = run('schtasks.exe', ['/Delete', '/TN', OPENALICE_SERVICE_NAME, '/F'], true)
      const restored = previous.status === 0
        ? run('schtasks.exe', ['/Create', '/TN', OPENALICE_SERVICE_NAME, '/XML', backupXml, '/F'], true)
        : { status: 0 }
      const restarted = previous.status === 0 && restored.status === 0
        ? run('schtasks.exe', ['/Run', '/TN', OPENALICE_SERVICE_NAME], true)
        : { status: 0 }
      if (removed.status !== 0 || restored.status !== 0 || restarted.status !== 0) {
        throw serviceError('ESERVICE', errorMessage(error) + '; Task Scheduler rollback failed')
      }
    }
    throw error
  } finally {
    await Promise.all([
      (dependencies.rmImpl ?? rm)(taskXml, { force: true }),
      (dependencies.rmImpl ?? rm)(backupXml, { force: true }),
    ])
  }
}

async function installSystemdUserService(options, dependencies) {
  const spawn = dependencies.spawnSyncImpl ?? spawnSync
  const unitPath = dependencies.unitPath ?? join(homedir(), '.config/systemd/user/openalice.service')
  const previous = await readOptional(unitPath, dependencies)
  if (previous !== null && !options.replaceExisting) {
    throw serviceError('ESERVICE', 'openalice.service is already owned by another installation')
  }
  const unit = `[Unit]\nDescription=OpenAlice Runtime\nAfter=network-online.target\n\n[Service]\nType=simple\nExecStart=`
    + systemdArguments([options.commandPath, 'server', 'run', '--home', options.homeRoot, '--port', String(options.port), '--wait', String(options.waitSeconds)])
    + `\nExecStop=`
    + systemdArguments([options.commandPath, 'server', 'stop', '--home', options.homeRoot, '--wait', '30'])
    + '\n\n[Install]\nWantedBy=default.target\n'
  await mkdir(dirname(unitPath), { recursive: true })
  let installed = false
  try {
    await atomicWrite(unitPath, unit, dependencies)
    installed = true
    runCommand(spawn, 'systemctl', ['--user', 'daemon-reload'])
    runCommand(spawn, 'systemctl', ['--user', 'enable', 'openalice.service'])
    runCommand(spawn, 'systemctl', ['--user', 'restart', 'openalice.service'])
    const runtime = await waitForNativeRuntime({
      commandPath: options.statusCommandPath,
      homeRoot: options.homeRoot,
      waitSeconds: options.waitSeconds,
      env: options.statusEnv,
    }, dependencies)
    return { manager: 'systemd-user', name: 'openalice.service', state: 'running', runtime }
  } catch (error) {
    if (!installed) throw error
    try {
      const stopped = runCommand(spawn, 'systemctl', ['--user', 'disable', '--now', 'openalice.service'], true)
      if (previous === null) await (dependencies.rmImpl ?? rm)(unitPath, { force: true })
      else await atomicWrite(unitPath, previous, dependencies)
      const reloaded = runCommand(spawn, 'systemctl', ['--user', 'daemon-reload'], true)
      const enabled = previous === null
        ? { status: 0 }
        : runCommand(spawn, 'systemctl', ['--user', 'enable', 'openalice.service'], true)
      const restarted = previous === null || enabled.status !== 0
        ? { status: 0 }
        : runCommand(spawn, 'systemctl', ['--user', 'restart', 'openalice.service'], true)
      if (stopped.status !== 0 || reloaded.status !== 0 || enabled.status !== 0 || restarted.status !== 0) {
        throw new Error('one or more recovery commands failed')
      }
    } catch (rollbackError) {
      throw serviceError('ESERVICE', errorMessage(error) + '; systemd rollback failed: ' + errorMessage(rollbackError))
    }
    throw error
  }
}

async function installLaunchAgent(options, dependencies) {
  const spawn = dependencies.spawnSyncImpl ?? spawnSync
  const uidResult = runCommand(spawn, 'id', ['-u'])
  const uid = String(uidResult.stdout).trim()
  if (!/^[0-9]+$/.test(uid)) throw serviceError('ESERVICE', 'Could not resolve the current macOS user id')
  const plistPath = dependencies.plistPath ?? join(homedir(), 'Library/LaunchAgents/ai.openalice.server.plist')
  const previous = await readOptional(plistPath, dependencies)
  if (previous !== null && !options.replaceExisting) {
    throw serviceError('ESERVICE', 'ai.openalice.server is already owned by another installation')
  }
  const argumentsXml = [
    options.commandPath, 'server', 'run', '--home', options.homeRoot,
    '--port', String(options.port), '--wait', String(options.waitSeconds),
  ].map((value) => `      <string>` + escapeXml(value) + '</string>').join('\n')
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key><string>` + OPENALICE_LAUNCH_AGENT_LABEL + `</string>\n  <key>ProgramArguments</key>\n  <array>\n` + argumentsXml + `\n  </array>\n  <key>RunAtLoad</key><true/>\n  <key>AbandonProcessGroup</key><true/>\n</dict>\n</plist>\n`
  await mkdir(dirname(plistPath), { recursive: true })
  const domain = `gui/` + uid
  let installed = false
  try {
    await atomicWrite(plistPath, plist, dependencies)
    installed = true
    runCommand(spawn, 'launchctl', ['bootout', domain + `/` + OPENALICE_LAUNCH_AGENT_LABEL], true)
    runCommand(spawn, 'launchctl', ['bootstrap', domain, plistPath])
    runCommand(spawn, 'launchctl', ['kickstart', '-k', domain + `/` + OPENALICE_LAUNCH_AGENT_LABEL])
    const runtime = await waitForNativeRuntime({
      commandPath: options.statusCommandPath,
      homeRoot: options.homeRoot,
      waitSeconds: options.waitSeconds,
      env: options.statusEnv,
    }, dependencies)
    return { manager: 'launchd', name: OPENALICE_LAUNCH_AGENT_LABEL, state: 'running', runtime }
  } catch (error) {
    if (!installed) throw error
    try {
      runCommand(spawn, 'launchctl', ['bootout', domain + `/` + OPENALICE_LAUNCH_AGENT_LABEL], true)
      if (previous === null) {
        await (dependencies.rmImpl ?? rm)(plistPath, { force: true })
      } else {
        await atomicWrite(plistPath, previous, dependencies)
        runCommand(spawn, 'launchctl', ['bootstrap', domain, plistPath])
        runCommand(spawn, 'launchctl', ['kickstart', '-k', domain + `/` + OPENALICE_LAUNCH_AGENT_LABEL])
      }
    } catch (rollbackError) {
      throw serviceError('ESERVICE', errorMessage(error) + '; launchd rollback failed: ' + errorMessage(rollbackError))
    }
    throw error
  }
}

function windowsTaskXml(options) {
  const openAliceArguments = ['server', 'run', '--home', quoteWindowsArgument(options.homeRoot), '--port', String(options.port), '--wait', String(options.waitSeconds)].join(' ')
  const command = options.statusCommandPath
  const argumentsValue = openAliceArguments
  return '<?xml version="1.0" encoding="UTF-16"?>\r\n'
    + '<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\r\n'
    + '  <RegistrationInfo><Description>OpenAlice Runtime</Description></RegistrationInfo>\r\n'
    + '  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>' + escapeXml(options.sid) + '</UserId></LogonTrigger></Triggers>\r\n'
    + '  <Principals><Principal id="Author"><UserId>' + escapeXml(options.sid) + '</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\r\n'
    + '  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Enabled>true</Enabled></Settings>\r\n'
    + '  <Actions Context="Author"><Exec><Command>' + escapeXml(command) + '</Command><Arguments>' + escapeXml(argumentsValue) + '</Arguments><WorkingDirectory>' + escapeXml(options.installRoot) + '</WorkingDirectory></Exec></Actions>\r\n'
    + '</Task>\r\n'
}

async function atomicWrite(path, contents, dependencies) {
  const temporary = path + `.next.` + process.pid + `.` + randomUUID()
  try {
    await (dependencies.writeFileImpl ?? writeFile)(temporary, contents, { encoding: 'utf8', mode: 0o600 })
    await (dependencies.renameImpl ?? (await import('node:fs/promises')).rename)(temporary, path)
  } finally {
    await (dependencies.rmImpl ?? rm)(temporary, { force: true })
  }
}
function queryWindowsTask(spawn, outputPath) {
  return spawn(process.env.ComSpec || `cmd.exe`, [
    '/d', '/v:off', '/s', '/c',
    'schtasks.exe /Query /TN OpenAliceServer /XML > "%OPENALICE_TASK_BACKUP%" 2>nul',
  ], {
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: true,
    env: { ...process.env, OPENALICE_TASK_BACKUP: outputPath },
  })
}

async function readOptional(path, dependencies) {
  try {
    return await (dependencies.readFileImpl ?? readFile)(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function runCommand(spawn, command, args, allowFailure = false) {
  const result = spawn(command, args, { encoding: 'utf8', windowsHide: true })
  if (!allowFailure && result.status !== 0) {
    const detail = String(result.stderr || result.stdout || `exit ` + result.status).trim()
    throw serviceError('ESERVICE', command + ` failed: ` + detail)
  }
  return result
}

function systemdArguments(values) {
  return values.map((value) => '"' + String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$') + '"').join(' ')
}

function quoteWindowsArgument(value) {
  const string = String(value)
  if (!/[\s"]/u.test(string)) return string
  return '"' + string.replaceAll(/(\\*)"/g, '$1$1\\"').replaceAll(/\\+$/g, '$&$&') + '"'
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function rejectControlCharacters(value, label) {
  if (typeof value !== 'string' || value.length === 0 || /[\0\r\n]/u.test(value)) {
    throw serviceError('EUSAGE', `OpenAlice ` + label + ' is invalid')
  }
}

function unresolvedWindowsVariable(value) {
  return /^%[A-Z0-9_]+%$/i.test(String(value).trim())
}

function normalizePlatform(value) {
  const normalized = String(value).toLowerCase()
  if (normalized === 'windows' || normalized.startsWith('mingw') || normalized.startsWith('msys')) return 'win32'
  if (normalized.startsWith('darwin')) return 'darwin'
  if (normalized.startsWith('linux')) return 'linux'
  return normalized
}

function normalizeArchitecture(value) {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'amd64' || normalized === 'x86_64' || normalized === 'x64') return 'x64'
  if (normalized === 'arm64' || normalized === 'aarch64') return 'arm64'
  return normalized
}

function serviceError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
