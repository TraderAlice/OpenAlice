import { lstat, open, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { spawn } from 'node:child_process'

import { resolveInstalledLayout } from './install-layout.mjs'
import { readInstallSource } from './install-source.mjs'
import { packageManagerUninstallMessage } from './package-manager.mjs'

const BEGIN_MARKER = '# >>> OpenAlice CLI >>>'
const END_MARKER = '# <<< OpenAlice CLI <<<'
const NATIVE_LAUNCHERS = ['openalice', 'alice', 'alice-workspace', 'alice-uta', 'traderhub']
const LEGACY_LAUNCHERS = ['openalice', 'openalice.cmd', 'pi', 'pi.cmd']

export function parseUninstallArgs(argv) {
  const options = { planOnly: false, yes: false }
  for (const arg of argv) {
    if (arg === '--plan') options.planOnly = true
    else if (arg === '--yes' || arg === '-y') options.yes = true
    else throw new Error(`Unknown uninstall option: ${arg}`)
  }
  return options
}

export async function runUninstallCommand(argv, dependencies = {}) {
  const options = parseUninstallArgs(argv)
  const stdout = dependencies.stdout ?? process.stdout
  const stdin = dependencies.stdin ?? process.stdin
  const env = dependencies.env ?? process.env
  const layout = Object.hasOwn(dependencies, 'layout')
    ? dependencies.layout
    : resolveInstalledLayout(import.meta.url, { env })
  if (!layout) {
    const installSource = await (
      dependencies.readInstallSourceImpl ?? readInstallSource
    )({ env })
    const managerMessage = packageManagerUninstallMessage(installSource)
    if (managerMessage) {
      stdout.write(`${managerMessage}\n`)
      stdout.write('OpenAlice did not modify the package manager\'s files or user data.\n')
      return 0
    }
    throw new Error('This OpenAlice CLI is running from source, not an installed release.')
  }

  const profiles = dependencies.profiles ?? shellProfileCandidates(
    dependencies.homeDir ?? homedir(),
  )
  printUninstallPlan(stdout, layout, profiles)
  if (options.planOnly) {
    stdout.write('\nPlan complete. No files were changed.\n')
    return 0
  }
  if (!options.yes) {
    const confirm = dependencies.confirm ?? confirmUninstall
    if (!stdin.isTTY && !dependencies.confirm) {
      throw new Error('No interactive terminal is available. Review "openalice uninstall --plan", then re-run with --yes.')
    }
    if (!await confirm({ stdin, stdout })) {
      stdout.write('\nNo changes made.\n')
      return 0
    }
  }

  const uninstall = dependencies.uninstall ?? performUninstall
  const result = await uninstall(layout, {
    profiles,
    processKill: dependencies.processKill,
  })
  if (result.deferred) {
    stdout.write('\nWindows cleanup is scheduled after this command exits. See .cli-uninstall-result.json for its result or .cli-uninstall.log for startup errors in the install root. User data is preserved.\n')
    return 0
  }
  stdout.write('\nOpenAlice CLI releases and installer-owned launchers were removed.\n')
  stdout.write(`Preserved application data and user work under ${layout.installRoot}.\n`)
  if (result.profilesChanged.length > 0) {
    stdout.write(`Removed managed PATH configuration from: ${result.profilesChanged.join(', ')}\n`)
  }
  return 0
}

export async function performUninstall(layout, options = {}) {
  const processKill = options.processKill ?? process.kill
  await assertNoLiveInstaller(layout.lockDir, processKill)
  if (layout.platform === 'win32') return scheduleWindowsUninstall(layout)

  const profilesChanged = []
  for (const profile of options.profiles ?? []) {
    if (await removeManagedPathBlock(profile, layout.binDir)) profilesChanged.push(profile)
  }

  const launchers = layout.kind === 'bun' ? NATIVE_LAUNCHERS : LEGACY_LAUNCHERS
  for (const launcher of launchers) {
    await rm(join(layout.binDir, launcher), { force: true })
  }
  await rm(layout.updateCachePath, { force: true })
  await rm(layout.lockDir, { recursive: true, force: true })
  await rm(layout.cliDir ?? layout.versionsDir, { recursive: true, force: true })
  try {
    await rmdir(layout.binDir)
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) throw error
  }
  return { profilesChanged }
}

async function scheduleWindowsUninstall(layout) {
  // A mapped PE cannot remove itself. Bun's Windows detached children may
  // still be killed with their parent (oven-sh/bun#31603); cmd/start launches
  // the post-exit helper outside that lifetime. Await only the bootstrap.
  const script = join(layout.installRoot, '.cli-uninstall.ps1')
  await writeFile(script, await readFile(join(layout.releaseDir, 'share', 'openalice', 'install.ps1')))
  await rm(join(layout.installRoot, '.cli-uninstall-result.json'), { force: true })
  const env = { ...process.env }
  delete env.PSModulePath
  const systemRoot = env.SystemRoot ?? 'C:\\Windows'
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const command = windowsUninstallBootstrap(powershell, script, layout.installRoot, process.pid)
  const log = await open(join(layout.installRoot, '.cli-uninstall.log'), 'w', 0o600)
  try {
    const child = spawn(join(systemRoot, 'System32', 'cmd.exe'), ['/d', '/c', command], {
      cwd: layout.installRoot, windowsVerbatimArguments: true, windowsHide: true,
      stdio: ['ignore', log.fd, log.fd], env,
    })
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Windows cleanup bootstrap exited ${code}; see .cli-uninstall.log`)))
    })
  } finally { await log.close() }
  return { profilesChanged: [], deferred: true }
}

export function windowsUninstallBootstrap(powershell, script, installRoot, parentPid) {
  if (!Number.isSafeInteger(parentPid) || parentPid < 1) throw new Error('Invalid uninstall parent PID')
  const quote = value => {
    if (!value || /["\r\n%!]/.test(value)) throw new Error('Unsupported Windows cleanup path')
    return `"${value}"`
  }
  return `start "" /b ${quote(powershell)} -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File ${quote(script)} -InstallDir ${quote(installRoot)} -Uninstall -WaitForPid ${parentPid} -Yes`
}

export async function removeManagedPathBlock(profile, binDir, dependencies = {}) {
  const readFileImpl = dependencies.readFileImpl ?? readFile
  const writeFileImpl = dependencies.writeFileImpl ?? writeFile
  let content
  try {
    content = await readFileImpl(profile, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  const cleaned = removeMatchingBlocks(content, binDir)
  if (cleaned === content) return false

  const lstatImpl = dependencies.lstatImpl ?? lstat
  const status = await lstatImpl(profile)
  if (status.isSymbolicLink()) {
    await writeFileImpl(profile, cleaned)
  } else {
    const temporary = `${profile}.openalice-uninstall.${process.pid}`
    await writeFileImpl(temporary, cleaned, { mode: status.mode })
    await (dependencies.renameImpl ?? rename)(temporary, profile)
  }
  return true
}

export function removeMatchingBlocks(content, binDir) {
  const lines = content.split(/(?<=\n)/)
  const output = []
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].replace(/\r?\n$/, '') !== BEGIN_MARKER) {
      output.push(lines[index])
      continue
    }
    const block = [lines[index]]
    let cursor = index + 1
    while (cursor < lines.length) {
      block.push(lines[cursor])
      if (lines[cursor].replace(/\r?\n$/, '') === END_MARKER) break
      cursor += 1
    }
    if (block.at(-1)?.replace(/\r?\n$/, '') !== END_MARKER) {
      output.push(...block)
      index = cursor
      continue
    }
    if (!block.join('').includes(binDir)) output.push(...block)
    index = cursor
  }
  return output.join('')
}

export function formatUninstallHelp() {
  return `Usage:
  openalice uninstall --plan
  openalice uninstall [--yes]

Removes the native OpenAlice CLI releases, installer-owned launchers,
provenance, update cache, and matching managed PATH blocks. It preserves
OpenAlice data, Workspaces, source checkouts, credentials, keys, Agent Runtimes,
and the shared install root. Package-manager installations instead report the
owning manager's exact uninstall command and do not remove its files directly.

Options:
  --plan     Show exact ownership boundaries without changing files
  -y, --yes  Approve uninstall non-interactively
  -h, --help Show this help
`
}

function printUninstallPlan(stdout, layout, profiles) {
  const releaseRoot = layout.cliDir ?? layout.versionsDir
  const launchers = layout.kind === 'bun'
    ? NATIVE_LAUNCHERS.map((name) => layout.platform === 'win32' ? `${name}.cmd` : name)
    : LEGACY_LAUNCHERS
  stdout.write(`OpenAlice CLI uninstall plan

Remove:
  ${launchers.map((launcher) => join(layout.binDir, launcher)).join('\n  ')}
  ${releaseRoot}
  ${layout.updateCachePath}
  matching managed PATH blocks in ${profiles.join(', ')}

Preserve:
  ${join(layout.installRoot, 'data')}
  ${join(layout.installRoot, 'workspaces')}
  ${join(layout.installRoot, 'sources')}
  ${join(layout.installRoot, 'provider-keys.json')}
  ${join(layout.installRoot, 'sealing.key')}
  Agent Runtime executables and their native configuration
  ${layout.installRoot}
`)
}

async function confirmUninstall({ stdin, stdout }) {
  const prompt = createInterface({ input: stdin, output: stdout })
  try {
    const answer = await prompt.question('\nContinue with CLI uninstall? [y/N] ')
    return /^y(?:es)?$/i.test(answer.trim())
  } finally {
    prompt.close()
  }
}

async function assertNoLiveInstaller(lockDir, processKill) {
  let pid
  try {
    pid = Number((await readFile(join(lockDir, 'pid'), 'utf8')).trim())
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if (!Number.isInteger(pid) || pid < 1) return
  try {
    processKill(pid, 0)
    throw new Error(`Another OpenAlice CLI installer is running (pid ${pid}). Wait for it to finish before uninstalling.`)
  } catch (error) {
    if (error?.code === 'ESRCH') return
    if (error?.code === 'EPERM') {
      throw new Error(`OpenAlice cannot verify installer lock owner ${pid}; wait or inspect ${lockDir}.`)
    }
    throw error
  }
}

function shellProfileCandidates(homeDir) {
  return [
    join(homeDir, '.zprofile'),
    join(homeDir, '.zshrc'),
    join(homeDir, '.bash_profile'),
    join(homeDir, '.bashrc'),
    join(homeDir, '.config', 'fish', 'config.fish'),
  ]
}
