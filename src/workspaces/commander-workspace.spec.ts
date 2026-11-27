import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COMMANDER_SYSTEM_PROMPT,
  COMMANDER_WORKSPACE_ID,
  COMMANDER_WORKSPACE_TAG,
  CommanderPointerStore,
  LEGACY_MANAGER_WORKSPACE_ID,
  THREAD_REPORTING_CONVENTION_NOTE,
  commanderPointerPath,
  commanderSkillPath,
  commanderTerminalPrompt,
  createCommanderWorkspaceMeta,
} from './commander-workspace.js'

describe('commander-workspace', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'commander-ws-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('builds the launcher-owned Commander metadata and paths', () => {
    expect(COMMANDER_WORKSPACE_ID).toBe('commander')
    expect(COMMANDER_WORKSPACE_TAG).toBe('Commander')
    expect(LEGACY_MANAGER_WORKSPACE_ID).toBe('workspace-manager')

    expect(createCommanderWorkspaceMeta('/alice/home')).toEqual({
      id: 'commander',
      tag: 'Commander',
      dir: join('/alice/home', 'workspaces'),
      createdAt: new Date(0).toISOString(),
    })
    expect(commanderPointerPath('/alice/home')).toBe(join('/alice/home', 'state', 'commander.json'))
    expect(commanderSkillPath('/repo')).toBe(join('/repo', 'default', 'skills', 'commander'))
  })

  it('formats terminal prompts with or without a user request and includes reporting conventions', () => {
    expect(COMMANDER_SYSTEM_PROMPT).toContain('alice orchestration worker-start')
    expect(COMMANDER_SYSTEM_PROMPT).toContain('alice conversation check')
    expect(COMMANDER_SYSTEM_PROMPT).toContain('alice inbox push')
    expect(THREAD_REPORTING_CONVENTION_NOTE).toContain('Commander')
    expect(commanderTerminalPrompt()).toBe(COMMANDER_SYSTEM_PROMPT)
    expect(commanderTerminalPrompt('   ')).toBe(COMMANDER_SYSTEM_PROMPT)
    expect(commanderTerminalPrompt('Check daily schedules.')).toBe(
      `${COMMANDER_SYSTEM_PROMPT}\n\nUser request:\nCheck daily schedules.`,
    )
  })

  it('returns null on missing or corrupt pointer files and writes atomically', async () => {
    const store = CommanderPointerStore.forLauncherRoot(root)
    expect(await store.read()).toBeNull()

    const filePath = commanderPointerPath(root)
    const written = await store.write('resume-cmd-1', 1000)
    expect(written).toEqual({
      version: 1,
      resumeId: 'resume-cmd-1',
      createdAt: 1000,
      updatedAt: 1000,
    })
    expect(await store.read()).toEqual(written)

    // Rewriting same resumeId preserves createdAt and updates updatedAt
    const touched = await store.write('resume-cmd-1', 2500)
    expect(touched).toEqual({
      version: 1,
      resumeId: 'resume-cmd-1',
      createdAt: 1000,
      updatedAt: 2500,
    })

    // No temp files left behind
    const files = await readdir(join(root, 'state'))
    expect(files).toEqual(['commander.json'])

    // Corrupt file recovers gracefully as null
    await writeFile(filePath, '{corrupt json', 'utf8')
    expect(await store.read()).toBeNull()

    // Invalid schema recovers gracefully as null
    await writeFile(filePath, JSON.stringify({ version: 2, resumeId: '' }), 'utf8')
    expect(await store.read()).toBeNull()
  })

  it('serializes concurrent ensure() calls so only one canonical Commander resumeId is minted', async () => {
    const store = CommanderPointerStore.forLauncherRoot(root)
    let counter = 0
    const mint = vi.fn(async () => {
      counter += 1
      await new Promise((resolve) => setTimeout(resolve, 15))
      return `resume-commander-${counter}`
    })

    const [a, b, c] = await Promise.all([
      store.ensure(mint, 5000),
      store.ensure(mint, 5001),
      store.ensure(mint, 5002),
    ])

    expect(mint).toHaveBeenCalledTimes(1)
    expect(a).toEqual({
      pointer: { version: 1, resumeId: 'resume-commander-1', createdAt: 5000, updatedAt: 5000 },
      created: true,
    })
    expect(b).toEqual({ pointer: a.pointer, created: false })
    expect(c).toEqual({ pointer: a.pointer, created: false })

    const persisted = JSON.parse(await readFile(commanderPointerPath(root), 'utf8'))
    expect(persisted).toEqual(a.pointer)
  })
})
