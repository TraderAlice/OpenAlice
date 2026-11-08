import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveAliceProjectIdentity } from '@traderalice/guardian-runtime'
import { main } from './main.ts'
import { runProjectCli } from './project-cli.ts'

interface SpawnRecord {
  args: string[]
  env: NodeJS.ProcessEnv
}

const spawnCalls: SpawnRecord[] = []
// vi.mock is hoisted above the static imports, so the mocked spawn replaces
// node:child_process for every module under test.
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal(),
  spawn: (_binary: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    spawnCalls.push({ args, env: options.env })
    return {
      once(event: string, cb: (code?: number) => void) {
        if (event === 'exit') queueMicrotask(() => cb(0))
        return this
      },
    }
  },
}))

interface WorkspaceEntry {
  id: string
  tag: string
}

const ISOLATED_ENV_KEYS = ['OPENALICE_SUPERVISOR_HOME', 'OPENALICE_HOME', 'OPENALICE_PROJECT', 'OPENALICE_INSTANCE', 'AQ_WS_ID', 'AQ_RUN_ID', 'AQ_SESSION_ID'] as const
const savedEnv = new Map<string, string | undefined>()

async function createProjectHome(workspaces?: WorkspaceEntry[]): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'oa-project-cli-'))
  await mkdir(join(home, 'state'), { recursive: true })
  if (workspaces) {
    await mkdir(join(home, 'workspaces'), { recursive: true })
    await writeFile(join(home, 'workspaces', 'workspaces.json'), JSON.stringify({ version: 1, workspaces }))
  }
  const identity = resolveAliceProjectIdentity({ home, env: {} })
  await writeFile(join(home, 'state', 'cli-endpoint.json'), JSON.stringify({
    schemaVersion: 1, projectId: identity.id, home, appRoot: process.cwd(), url: 'http://127.0.0.1:9/cli',
  }))
  await mkdir(join(home, 'supervisor'), { recursive: true })
  await writeFile(join(home, 'supervisor', 'config.json'), JSON.stringify({ schemaVersion: 2, defaultProject: 'research', projects: { research: { home } } }))
  return home
}

describe('openalice exec workspace selector', () => {
  let home: string | undefined
  let stdout: MockInstance

  beforeEach(() => {
    spawnCalls.length = 0
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    for (const key of ISOLATED_ENV_KEYS) {
      savedEnv.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(async () => {
    stdout.mockRestore()
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    savedEnv.clear()
    if (home) { await rm(home, { recursive: true, force: true }); home = undefined }
  })

  it('documents --ws and --manager in exec help', async () => {
    expect(await runProjectCli(['--help'])).toBe(0)
    expect(stdout.mock.calls.flat().join('\n')).toContain('--ws <id-or-tag>')
    expect(stdout.mock.calls.flat().join('\n')).toContain('--manager')
  })

  it('strips a leading -- separator before dispatch', async () => {
    const runCommand = vi.fn(async () => 7)
    expect(await main(['--', '--help'], { runCommand })).toBe(7)
    expect(runCommand).toHaveBeenCalledWith(['--help'])
    expect(await main(['--', 'exec', '--help'])).toBe(0)
    expect(stdout.mock.calls.flat().join('\n')).toContain('openalice exec')
  })

  it('resolves --ws tag, --ws id and --manager to AQ_WS_ID for the spawned payload', async () => {
    home = await createProjectHome([{ id: 'ws-chat', tag: 'Chat' }, { id: 'ws-quant', tag: 'Quant' }])
    process.env.AQ_RUN_ID = 'stale-run'
    process.env.AQ_SESSION_ID = 'stale-session'

    expect(await runProjectCli(['--home', home, '--ws', 'Chat', 'alice', 'session', 'list'])).toBe(0)
    expect(await runProjectCli(['--home', home, '--ws', 'ws-quant', 'alice', 'session', 'list'])).toBe(0)
    expect(await runProjectCli(['--home', home, '--manager', 'alice', 'session', 'list'])).toBe(0)

    expect(spawnCalls.map(call => call.env.AQ_WS_ID)).toEqual(['ws-chat', 'ws-quant', 'workspace-manager'])
    for (const call of spawnCalls) {
      expect(call.env.AQ_RUN_ID).toBeUndefined()
      expect(call.env.AQ_SESSION_ID).toBeUndefined()
    }
  })

  it('passes a raw --ws id through when workspaces.json is absent', async () => {
    home = await createProjectHome()
    expect(await runProjectCli(['--home', home, '--ws', 'local-ws', 'alice', 'session', 'list'])).toBe(0)
    expect(spawnCalls[0].env.AQ_WS_ID).toBe('local-ws')
  })

  it('throws when --ws matches nothing in workspaces.json', async () => {
    home = await createProjectHome([{ id: 'ws-chat', tag: 'Chat' }])
    await expect(runProjectCli(['--home', home, '--ws', 'unknown', 'alice', 'session', 'list'])).rejects.toThrow(`Workspace not found in ${home}: unknown`)
    expect(spawnCalls).toHaveLength(0)
  })
})
