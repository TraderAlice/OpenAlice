import { randomUUID } from 'node:crypto'
import {
  access,
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'

import { recordPendingActivation } from './activation.mjs'
import { resolveInstalledLayout } from './install-layout.mjs'
import { requireInstallSource } from './install-source.mjs'

export function parseRollbackArgs(argv) {
  const options = { target: null, planOnly: false, yes: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--to') {
      const target = argv[++index]
      if (!target || target.startsWith('-')) throw new Error('--to requires a release name')
      if (!/^[A-Za-z0-9._+-]+$/.test(target)) throw new Error('--to must be an installed release name')
      options.target = target
    } else if (arg === '--plan') options.planOnly = true
    else if (arg === '--yes' || arg === '-y') options.yes = true
    else throw new Error(`Unknown rollback option: ${arg}`)
  }
  return options
}

export async function runRollbackCommand(argv, dependencies = {}) {
  const options = parseRollbackArgs(argv)
  const stdout = dependencies.stdout ?? process.stdout
  const stdin = dependencies.stdin ?? process.stdin
  const env = dependencies.env ?? process.env
  if (env['OPENALICE_SERVICE_MANAGER']?.trim() === 'railway') {
    stdout.write('Railway service variables own this OpenAlice installation. Set OPENALICE_RAILWAY_CHANNEL and optional OPENALICE_RAILWAY_VERSION, then restart or redeploy the service.\n')
    stdout.write('OpenAlice did not modify the persistent release pointer.\n')
    return 0
  }
  const layout = Object.hasOwn(dependencies, 'layout')
    ? dependencies.layout
    : resolveInstalledLayout(import.meta.url, { env })
  if (!layout || layout.kind !== 'bun') {
    throw new Error('Rollback is available only for a directly installed OpenAlice Bun CLI.')
  }

  const plan = await inspectRollback(layout, options.target, dependencies)
  stdout.write(formatRollbackPlan(plan))
  if (options.planOnly) {
    stdout.write('\nPlan complete. No files were changed.\n')
    return 0
  }
  if (!options.yes) {
    const confirm = dependencies.confirm ?? confirmRollback
    if (!stdin.isTTY && !dependencies.confirm) {
      throw new Error('No interactive terminal is available. Review "openalice rollback --plan", then re-run with --yes.')
    }
    if (!await confirm({ stdin, stdout })) {
      stdout.write('\nNo changes made.\n')
      return 0
    }
  }

  await assertNoLiveInstaller(layout.lockDir, dependencies.processKill ?? process.kill)
  await (dependencies.recordPendingActivationImpl ?? recordPendingActivation)(layout, {
    activeRelease: plan.target.name,
    previousRelease: plan.current.name,
    productVersion: plan.target.source.cliVersion,
  }, dependencies)
  await activateRelease(layout, plan.target.name, dependencies)
  stdout.write(`\nOpenAlice rollback complete: ${plan.target.name}\n`)
  stdout.write('Run openalice again to use the activated release. User data was not changed.\n')
  return 0
}

export async function inspectRollback(layout, requestedTarget = null, dependencies = {}) {
  const realpathImpl = dependencies.realpathImpl ?? realpath
  const currentPath = await realpathImpl(layout.currentPath)
  const releasesPath = await realpathImpl(layout.releasesDir)
  if (dirname(currentPath) !== releasesPath) {
    throw new Error('The active OpenAlice release pointer leaves the installer-owned releases directory.')
  }
  const currentName = basename(currentPath)
  const entries = await (dependencies.readdirImpl ?? readdir)(layout.releasesDir, { withFileTypes: true })
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink?.() || entry.name === currentName) continue
    const release = await validateRelease(layout, entry.name, dependencies)
    const releaseStat = await (dependencies.statImpl ?? stat)(release.path)
    candidates.push({ ...release, mtimeMs: releaseStat.mtimeMs })
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name))

  const target = requestedTarget
    ? candidates.find((candidate) => candidate.name === requestedTarget)
    : candidates[0]
  if (!target) {
    if (requestedTarget === currentName) throw new Error(`Release ${requestedTarget} is already active.`)
    if (requestedTarget) throw new Error(`Release ${requestedTarget} is not an installed rollback candidate.`)
    throw new Error('No previous OpenAlice release is retained for rollback.')
  }
  const current = await validateRelease(layout, currentName, dependencies)
  return { current, target }
}

export async function activateRelease(layout, releaseName, dependencies = {}) {
  const nextPath = `${layout.currentPath}.next.${process.pid}.${randomUUID()}`
  await (dependencies.rmImpl ?? rm)(nextPath, { force: true })
  try {
    await (dependencies.symlinkImpl ?? symlink)(join('releases', releaseName), nextPath)
    await (dependencies.renameImpl ?? rename)(nextPath, layout.currentPath)
  } finally {
    await (dependencies.rmImpl ?? rm)(nextPath, { force: true })
  }
}

export function formatRollbackHelp() {
  return `Usage:
  openalice rollback --plan [--to <release>]
  openalice rollback [--to <release>] [--yes]

Atomically switches a direct Bun CLI install to a retained immutable release.
It does not download files or change OpenAlice user data. Without --to, the
newest retained release other than the active one is selected.

Options:
  --to <release>  Select an installed release by its full directory name
  --plan          Show the release switch without changing files
  -y, --yes       Approve rollback non-interactively
  -h, --help      Show this help
`
}

async function validateRelease(layout, name, dependencies) {
  if (!/^[A-Za-z0-9._+-]+$/.test(name)) throw new Error(`Invalid installed release name: ${name}`)
  const path = join(layout.releasesDir, name)
  const status = await (dependencies.lstatImpl ?? lstat)(path)
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error(`Installed release is not an immutable directory: ${name}`)
  await (dependencies.accessImpl ?? access)(join(path, 'bin', 'openalice'))
  const provenancePath = join(layout.provenanceDir, `${name}.json`)
  const source = requireInstallSource(JSON.parse(await (dependencies.readFileImpl ?? readFile)(provenancePath, 'utf8')))
  if (!name.startsWith(`${source.cliVersion}-`)) {
    throw new Error(`Installed release provenance does not match ${name}`)
  }
  return { name, path, source }
}

function formatRollbackPlan(plan) {
  return `OpenAlice CLI rollback plan

Current release  ${plan.current.name}
Target release   ${plan.target.name}
Change           switch the cli/current pointer atomically
Preserve         all releases, provenance, user data, Workspaces, and Agent Runtimes
`
}

async function confirmRollback({ stdin, stdout }) {
  const prompt = createInterface({ input: stdin, output: stdout })
  try {
    const answer = await prompt.question('\nContinue with rollback? [y/N] ')
    return /^y(?:es)?$/i.test(answer.trim())
  } finally {
    prompt.close()
  }
}

export async function assertNoLiveInstaller(lockDir, processKill) {
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
    throw new Error(`Another OpenAlice CLI installer is running (pid ${pid}). Wait for it to finish before rollback.`)
  } catch (error) {
    if (error?.code === 'ESRCH') return
    if (error?.code === 'EPERM') throw new Error(`OpenAlice cannot verify installer lock owner ${pid}; wait or inspect ${lockDir}.`)
    throw error
  }
}
