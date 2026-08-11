import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { migrateWorkspaceSessionRuntimeBindings } from './0039_workspace_session_runtime_bindings/index.js'

const binding = {
  version: 1,
  credential: {
    source: 'vault',
    credentialSlug: 'openai-1',
    wireShape: 'openai-responses',
  },
  model: 'gpt-5.6-terra',
  reasoningEffort: 'high',
}

async function fixture(): Promise<{ root: string; workspace: string }> {
  const root = await mkdtemp(join(tmpdir(), 'workspace-session-binding-migration-'))
  const workspace = join(root, 'workspaces', 'ws-1')
  await mkdir(workspace, { recursive: true })
  await writeFile(join(root, 'workspaces.json'), JSON.stringify({
    version: 1,
    workspaces: [{ id: 'ws-1', tag: 'test', dir: workspace, createdAt: '2026-08-01T00:00:00.000Z' }],
  }))
  await mkdir(join(root, 'state'), { recursive: true })
  return { root, workspace }
}

function legacyRecord(overrides: Record<string, unknown> = {}) {
  return {
    resumeId: 'resume-test',
    wsId: 'ws-1',
    agent: 'codex',
    createdAt: 1,
    updatedAt: 2,
    lifecycle: 'active',
    runtimeBinding: binding,
    ...overrides,
  }
}

describe('0039 Workspace Session runtime bindings migration', () => {
  it('moves 0.89.2 inline bindings into Workspace Session files', async () => {
    const { root, workspace } = await fixture()
    const registryPath = join(root, 'state', 'resume-identities.json')
    await writeFile(registryPath, JSON.stringify({ version: 2, records: [legacyRecord()] }))

    expect(await migrateWorkspaceSessionRuntimeBindings(root)).toEqual({ migrated: true, sessions: 1 })
    expect(JSON.parse(await readFile(registryPath, 'utf8'))).toEqual({
      version: 1,
      records: [{
        resumeId: 'resume-test', wsId: 'ws-1', agent: 'codex', createdAt: 1, updatedAt: 2, lifecycle: 'active',
      }],
    })
    expect(JSON.parse(await readFile(join(workspace, '.alice', 'sessions', 'resume-test.json'), 'utf8'))).toEqual({
      version: 1,
      resumeId: 'resume-test',
      agent: 'codex',
      ai: binding,
    })
    expect(await migrateWorkspaceSessionRuntimeBindings(root)).toEqual({ migrated: false, sessions: 0 })
  })

  it('supports launcher-owned and departed Session locations', async () => {
    const { root } = await fixture()
    const departed = join(root, 'departed-workspaces', 'ws-old')
    await mkdir(departed, { recursive: true })
    await writeFile(join(root, 'state', 'workspace-catalog.json'), JSON.stringify({
      version: 1,
      workspaces: [{ id: 'ws-old', activeDir: join(root, 'missing'), departedDir: departed }],
    }))
    await writeFile(join(root, 'state', 'resume-identities.json'), JSON.stringify({
      version: 2,
      records: [
        legacyRecord({ resumeId: 'resume-manager', wsId: 'workspace-manager' }),
        legacyRecord({ resumeId: 'resume-old', wsId: 'ws-old' }),
      ],
    }))

    expect(await migrateWorkspaceSessionRuntimeBindings(root)).toEqual({ migrated: true, sessions: 2 })
    await expect(readFile(join(root, 'state', 'workspace-manager-sessions', 'resume-manager.json'), 'utf8'))
      .resolves.toContain('gpt-5.6-terra')
    await expect(readFile(join(departed, '.alice', 'sessions', 'resume-old.json'), 'utf8'))
      .resolves.toContain('gpt-5.6-terra')
  })

  it('keeps current and missing registries as no-ops', async () => {
    const { root } = await fixture()
    expect(await migrateWorkspaceSessionRuntimeBindings(root)).toEqual({ migrated: false, sessions: 0 })
    await writeFile(join(root, 'state', 'resume-identities.json'), JSON.stringify({ version: 1, records: [] }))
    expect(await migrateWorkspaceSessionRuntimeBindings(root)).toEqual({ migrated: false, sessions: 0 })
  })

  it('refuses to overwrite a conflicting Session config', async () => {
    const { root, workspace } = await fixture()
    await writeFile(join(root, 'state', 'resume-identities.json'), JSON.stringify({
      version: 2, records: [legacyRecord()],
    }))
    const sessionDir = join(workspace, '.alice', 'sessions')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'resume-test.json'), JSON.stringify({
      version: 1, resumeId: 'resume-test', agent: 'codex', ai: { ...binding, model: 'other' },
    }))

    await expect(migrateWorkspaceSessionRuntimeBindings(root)).rejects.toThrow(/different Workspace AI config/)
    expect(JSON.parse(await readFile(join(root, 'state', 'resume-identities.json'), 'utf8'))['version']).toBe(2)
  })
})
