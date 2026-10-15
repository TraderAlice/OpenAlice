/** Client control plane delegates project mutations to the owning Machine's CLI.
 * Commands run once: a dropped SSH connection is not retry authority. */
import { spawn } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { buildRemoteCommand } from './machine-target-command.mjs'
import { buildRemoteSshArgs } from './remote.mjs'
import { readMachineRegistrySummary, requireMachineEnabled, type RegisteredMachine } from './machine-registry.ts'
import { createSupervisorAliceProject, readSupervisorAliceProjectRegistry } from './supervisor-config.ts'
import { resolveSupervisorRootPath } from './launch-context.ts'
import { PROJECT_WORKSPACES } from './project-workspaces.ts'
import { parseLifecycleArgs, runLifecycleCommand } from './lifecycle-command.mjs'

export type ProjectControlInput = { machine: string; project: string; action: 'start' | 'create'; home?: string }

export function validateProjectControl(input: unknown): ProjectControlInput {
  if (!input || typeof input !== 'object') throw new Error('Choose a Machine and AliceProject.')
  const value = input as Record<string, unknown>
  if (typeof value.machine !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(value.machine)
    || typeof value.project !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(value.project)
    || !['start', 'create'].includes(String(value.action))) throw new Error('Invalid project operation.')
  if (value.action === 'create' && (value.project === 'default' || typeof value.home !== 'string'
    || !value.home.startsWith('/') && !(value.machine === 'local' && isAbsolute(value.home)) || /[\r\n\0]/.test(value.home))) {
    throw new Error('Choose a new project key and an absolute data folder on the selected Machine.')
  }
  return { machine: value.machine, project: value.project, action: value.action as 'start' | 'create', ...(value.action === 'create' ? { home: value.home as string } : {}) }
}

export async function runRemoteProjectCommand(machine: RegisteredMachine, args: string[]): Promise<void> {
  const child = spawn('ssh', buildRemoteSshArgs({ destination: machine.sshTarget, sshPort: machine.sshPort ?? null, identityFile: machine.identityFile ?? null, batchMode: true }, buildRemoteCommand(args)), {
    stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  })
  let tail = ''
  child.stderr?.on('data', chunk => { tail = (tail + String(chunk)).slice(-4096) })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Project command timed out. Refresh its status before retrying; the remote operation may still be running.')) }, 60_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Project command failed (${signal ?? code ?? 'unknown'}). ${tail.trim()}`)) })
  })
}

export async function controlProject(input: ProjectControlInput): Promise<void> {
  const value = validateProjectControl(input)
  if (value.machine !== 'local') {
    const machine = (await readMachineRegistrySummary()).machines.find(entry => entry.key === value.machine)
    if (!machine) throw new Error('This Machine is no longer registered.')
    requireMachineEnabled(machine)
    if (value.action === 'create') await runRemoteProjectCommand(machine, ['create', 'alice-project', '--name', value.project, '--home', value.home!, '--yes', '--require-empty'])
    else await runRemoteProjectCommand(machine, ['up', '--project', value.project, '--wait', '30'])
    return
  }
  if (value.action === 'create') {
    // Creation from the GUI uses a new/empty home. Reusing a complete home is
    // a separate registration/transfer workflow, never an overwrite shortcut.
    const entries = await readdir(value.home!).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    if (entries.some(entry => !['.DS_Store', 'Thumbs.db', 'desktop.ini'].includes(entry))) throw new Error('Choose a new or empty data folder.')
    await createSupervisorAliceProject({ supervisorRoot: resolveSupervisorRootPath() }, value.project, value.home!, { select: false, workspaces: [...PROJECT_WORKSPACES] })
  } else {
    const home = await resolveLocalStartupHome(value.project)
    const sink = { write: (_text: string) => undefined }
    const code = await runLifecycleCommand('up', parseLifecycleArgs('up', ['--project', value.project, '--home', home, '--wait', '30']), { stdout: sink, stderr: sink, env: projectLifecycleEnvironment(home) })
    if (code !== 0) throw new Error('Could not start this AliceProject. Refresh its status before retrying.')
  }
}

/** Resolving a registered local identity is read-only; never invent a fallback. */
export async function resolveLocalStartupHome(project: string): Promise<string> {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(project)) throw new Error('Invalid AliceProject key.')
  const root = resolveSupervisorRootPath()
  const registered = (await readSupervisorAliceProjectRegistry({ supervisorRoot: root })).projects.find(entry => entry.key === project)
  if (!registered) throw new Error('This local AliceProject is no longer registered.')
  return registered.home
}

/** The relay's inherited project environment must not redirect another project
 * into its current home, ports or Workspace registry. Installation settings and
 * the Supervisor registry remain client-owned and are retained. */
export function projectLifecycleEnvironment(home: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base }
  for (const key of ['OPENALICE_HOME', 'OPENALICE_PROJECT_ID', 'OPENALICE_PROJECT_KEY', 'OPENALICE_PROJECT_NAME', 'OPENALICE_PROJECT_APP_ROOT', 'OPENALICE_PORT', 'OPENALICE_SERVER_PORT']) delete env[key]
  return { ...env, OPENALICE_HOME: home, AQ_LAUNCHER_ROOT: join(home, 'workspaces') }
}
