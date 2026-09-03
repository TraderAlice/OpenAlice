import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root: string
let wsDir: string
let service: import('./service.js').WorkspaceService | undefined
let createIssue: typeof import('./issues/mutate.js').createIssue
let savedEnv: Record<string, string | undefined>

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'issue-assignee-active-'))
  wsDir = join(root, 'fixture-workspace')
  await mkdir(wsDir, { recursive: true })
  savedEnv = {
    OPENALICE_HOME: process.env['OPENALICE_HOME'],
    AQ_LAUNCHER_ROOT: process.env['AQ_LAUNCHER_ROOT'],
    OPENALICE_GLOBAL_DIR: process.env['OPENALICE_GLOBAL_DIR'],
  }
  process.env['OPENALICE_HOME'] = root
  process.env['AQ_LAUNCHER_ROOT'] = join(root, 'launcher')
  process.env['OPENALICE_GLOBAL_DIR'] = join(root, 'global')

  // paths.ts captures OPENALICE_HOME during module evaluation. A reset plus
  // dynamic imports keeps this real-service test isolated from user state.
  vi.resetModules()
  const serviceModule = await import('./service.js')
  const mutateModule = await import('./issues/mutate.js')
  createIssue = mutateModule.createIssue
  service = await serviceModule.createWorkspaceService({
    webPort: 0,
    mcpPort: 0,
    toolBaseUrl: 'http://127.0.0.1:0/cli',
    scheduleScannerIntervalMs: 600_000,
  })
  await service.registry.add({
    id: 'ws-1',
    tag: 'ws-1',
    dir: wsDir,
    createdAt: new Date(0).toISOString(),
  })
})

afterEach(async () => {
  await service?.dispose('issue assignee activity test')
  service = undefined
  restoreEnv('OPENALICE_HOME', savedEnv.OPENALICE_HOME)
  restoreEnv('AQ_LAUNCHER_ROOT', savedEnv.AQ_LAUNCHER_ROOT)
  restoreEnv('OPENALICE_GLOBAL_DIR', savedEnv.OPENALICE_GLOBAL_DIR)
  vi.resetModules()
  await rm(root, { recursive: true, force: true })
})

describe('WorkspaceService Issue assignee activity', () => {
  it('reports running terminal and WebPi owners as active', async () => {
    for (const fixture of [
      { resumeId: 'resume-kind-owl-abc123', issueId: 'terminal-owner', surface: 'terminal' as const },
      { resumeId: 'resume-calm-fox-def456', issueId: 'webpi-owner', surface: 'webpi' as const },
    ]) {
      await service!.sessionCoordinator.ensure({
        resumeId: fixture.resumeId,
        wsId: 'ws-1',
        agent: 'codex',
        namePrefix: 'x',
        agentSessionId: `native-${fixture.surface}`,
        state: 'running',
        surface: fixture.surface,
        now: 1_000,
      })
      const created = await createIssue(wsDir, {
        id: fixture.issueId,
        title: `${fixture.surface} owner`,
        assignee: `@${fixture.resumeId}`,
      })
      expect(created.ok).toBe(true)

      const detail = await service!.issueDetail('ws-1', fixture.issueId)
      expect(detail?.assigneeSession).toMatchObject({
        resumeId: fixture.resumeId,
        state: 'ready',
        active: true,
      })
    }
  })
})
