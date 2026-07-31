import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  migrateWorkspaceAgentPins,
  stripWorkspaceAgentPins,
} from './0030_retire_workspace_agent_pins/index.js'

describe('0030 retire Workspace adapter pins', () => {
  it('removes only legacy agents keys and is idempotent', () => {
    const raw = {
      version: 1,
      workspaces: [
        { id: 'old', tag: 'old', agents: ['claude', 'codex'], lifecycle: 'active' },
        { id: 'new', tag: 'new' },
      ],
    }
    expect(stripWorkspaceAgentPins(raw)).toEqual({
      updated: 1,
      value: {
        version: 1,
        workspaces: [
          { id: 'old', tag: 'old', lifecycle: 'active' },
          { id: 'new', tag: 'new' },
        ],
      },
    })
    const once = stripWorkspaceAgentPins(raw).value
    expect(stripWorkspaceAgentPins(once)).toEqual({ value: once, updated: 0 })
  })

  it('migrates and backs up both registry files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-agent-pins-'))
    const state = join(root, 'state')
    const backup = join(root, 'backup')
    await mkdir(state, { recursive: true })
    await writeFile(join(root, 'workspaces.json'), JSON.stringify({
      version: 1,
      workspaces: [{ id: 'active', agents: ['claude'] }],
    }))
    await writeFile(join(state, 'workspace-catalog.json'), JSON.stringify({
      version: 1,
      workspaces: [{ id: 'departed', agents: ['pi'], lifecycle: 'departed' }],
    }))

    await expect(migrateWorkspaceAgentPins(root, { backupRoot: backup })).resolves.toEqual({
      registryUpdated: 1,
      catalogUpdated: 1,
    })
    expect(JSON.parse(await readFile(join(root, 'workspaces.json'), 'utf8'))).toEqual({
      version: 1,
      workspaces: [{ id: 'active' }],
    })
    expect(JSON.parse(await readFile(join(state, 'workspace-catalog.json'), 'utf8'))).toEqual({
      version: 1,
      workspaces: [{ id: 'departed', lifecycle: 'departed' }],
    })
    expect(JSON.parse(await readFile(join(backup, 'workspaces.json'), 'utf8')))
      .toEqual({ version: 1, workspaces: [{ id: 'active', agents: ['claude'] }] })
    expect(JSON.parse(await readFile(join(backup, 'state', 'workspace-catalog.json'), 'utf8')))
      .toEqual({
        version: 1,
        workspaces: [{ id: 'departed', agents: ['pi'], lifecycle: 'departed' }],
      })
    await expect(migrateWorkspaceAgentPins(root, { backupRoot: backup })).resolves.toEqual({
      registryUpdated: 0,
      catalogUpdated: 0,
    })
  })
})
