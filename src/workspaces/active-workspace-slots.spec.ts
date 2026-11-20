import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  readActiveWorkspaceSlots,
  readPreferences,
  rememberAutoPredictionDefaultWorkspace,
  rememberAutoQuantDefaultWorkspace,
  rememberRecentChatWorkspace,
  rememberTemplateActiveWorkspace,
} from '@/core/preferences.js'

import {
  ActiveWorkspaceSlotManager,
  createPreferenceWorkspaceSlotStore,
  resolveActiveWorkspaceSlots,
  workspaceTemplateSlot,
} from './active-workspace-slots.js'
import type { WorkspaceMeta } from './workspace-registry.js'

const tempDirs: string[] = []

async function makeTempPrefs(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openalice-active-slots-'))
  tempDirs.push(dir)
  return join(dir, 'preferences.json')
}

function makeWs(
  id: string,
  createdAt: string,
  template?: string,
  tag = id,
): WorkspaceMeta {
  return {
    id,
    tag,
    dir: `/tmp/${id}`,
    createdAt,
    ...(template !== undefined ? { template } : {}),
  }
}

function makeFakeRegistry(initial: WorkspaceMeta[]) {
  const map = new Map<string, WorkspaceMeta>(initial.map((ws) => [ws.id, ws]))
  return {
    get: (id: string) => map.get(id),
    list: () => Array.from(map.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    add: (ws: WorkspaceMeta) => { map.set(ws.id, ws) },
    remove: (id: string) => { map.delete(id) },
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('active-workspace-slots', () => {
  it('normalizes template categories and maps legacy untemplated workspaces to chat', () => {
    expect(workspaceTemplateSlot('chat')).toBe('chat')
    expect(workspaceTemplateSlot('auto-quant-v2')).toBe('auto-quant-v2')
    expect(workspaceTemplateSlot('auto-prediction')).toBe('auto-prediction')
    expect(workspaceTemplateSlot('custom-desk')).toBe('custom-desk')
    expect(workspaceTemplateSlot(undefined)).toBe('chat')
    expect(workspaceTemplateSlot('   ')).toBe('chat')
  })

  it('resolves at most one active workspace per template and keeps others standby', () => {
    const chatOld = makeWs('chat-old', '2026-01-01T00:00:00.000Z', 'chat')
    const chatNew = makeWs('chat-new', '2026-02-01T00:00:00.000Z', 'chat')
    const aqOld = makeWs('aq-old', '2026-01-01T00:00:00.000Z', 'auto-quant-v2')
    const aqNew = makeWs('aq-new', '2026-02-01T00:00:00.000Z', 'auto-quant-v2')
    const pred = makeWs('pred-1', '2026-01-15T00:00:00.000Z', 'auto-prediction')

    const resolved = resolveActiveWorkspaceSlots(
      [chatOld, chatNew, aqOld, aqNew, pred],
      {
        chat: 'chat-old',
        'auto-quant-v2': 'aq-old',
        'auto-prediction': 'pred-1',
      },
    )

    expect(resolved.activeByTemplate.get('chat')?.id).toBe('chat-old')
    expect(resolved.activeByTemplate.get('auto-quant-v2')?.id).toBe('aq-old')
    expect(resolved.activeByTemplate.get('auto-prediction')?.id).toBe('pred-1')
    expect([...resolved.activeIds].sort()).toEqual(['aq-old', 'chat-old', 'pred-1'])
    expect(resolved.repairs.size).toBe(0)
  })

  it('falls back to most recently created workspace when pointer is null, missing, or wrong template', () => {
    const chatOld = makeWs('chat-old', '2026-01-01T00:00:00.000Z', 'chat')
    const chatNew = makeWs('chat-new', '2026-03-01T00:00:00.000Z', 'chat')
    const aqOnly = makeWs('aq-1', '2026-02-01T00:00:00.000Z', 'auto-quant-v2')

    const resolved = resolveActiveWorkspaceSlots(
      [chatOld, chatNew, aqOnly],
      {
        chat: 'missing-id',
        'auto-quant-v2': 'chat-old', // wrong template
        'auto-prediction': 'departed-pred', // no workspaces left
      },
    )

    expect(resolved.activeByTemplate.get('chat')?.id).toBe('chat-new')
    expect(resolved.activeByTemplate.get('auto-quant-v2')?.id).toBe('aq-1')
    expect(resolved.repairs.get('chat')).toBe('chat-new')
    expect(resolved.repairs.get('auto-quant-v2')).toBe('aq-1')
    expect(resolved.repairs.get('auto-prediction')).toBeNull()
  })

  it('backs built-in templates with existing preferences.json fields without breaking schema', async () => {
    const prefsPath = await makeTempPrefs()
    await rememberTemplateActiveWorkspace('chat', 'chat-1', prefsPath)
    await rememberTemplateActiveWorkspace('auto-quant-v2', 'aq-1', prefsPath)
    await rememberTemplateActiveWorkspace('auto-prediction', 'pred-1', prefsPath)
    await rememberTemplateActiveWorkspace('custom-tpl', 'custom-1', prefsPath)

    const raw = JSON.parse(await readFile(prefsPath, 'utf8')) as Record<string, any>
    expect(raw.quickChat.recentChatWorkspaceId).toBe('chat-1')
    expect(raw.autoQuant.defaultWorkspaceId).toBe('aq-1')
    expect(raw.autoPrediction.defaultWorkspaceId).toBe('pred-1')
    expect(raw.activeWorkspaceByTemplate).toEqual({ 'custom-tpl': 'custom-1' })

    const slots = await readActiveWorkspaceSlots(prefsPath)
    expect(slots).toEqual({
      chat: 'chat-1',
      'auto-quant-v2': 'aq-1',
      'auto-prediction': 'pred-1',
      'custom-tpl': 'custom-1',
    })

    // Clearing custom template removes the optional map cleanly
    await rememberTemplateActiveWorkspace('custom-tpl', null, prefsPath)
    const prefsAfter = await readPreferences(prefsPath)
    expect(prefsAfter.activeWorkspaceByTemplate).toBeUndefined()
  })

  it('converges missing/offboarded pointers on startup and after offboarding', async () => {
    const prefsPath = await makeTempPrefs()
    const chatOlder = makeWs('chat-older', '2026-01-01T00:00:00.000Z', 'chat')
    const chatNewer = makeWs('chat-newer', '2026-02-01T00:00:00.000Z', 'chat')
    const aqOne = makeWs('aq-1', '2026-01-10T00:00:00.000Z', 'auto-quant-v2')

    const registry = makeFakeRegistry([chatOlder, chatNewer, aqOne])
    await rememberRecentChatWorkspace('chat-departed', prefsPath)
    await rememberAutoQuantDefaultWorkspace(null, prefsPath)
    await rememberAutoPredictionDefaultWorkspace('pred-departed', prefsPath)

    const manager = new ActiveWorkspaceSlotManager(
      registry,
      createPreferenceWorkspaceSlotStore(prefsPath),
    )

    // Startup convergence selects most recently created and clears departed-only template
    await manager.converge()
    expect(await readActiveWorkspaceSlots(prefsPath)).toEqual({
      chat: 'chat-newer',
      'auto-quant-v2': 'aq-1',
      'auto-prediction': null,
    })
    expect(await manager.activationState('chat-newer')).toBe('active')
    expect(await manager.activationState('chat-older')).toBe('standby')

    // Offboard active chat workspace -> falls back to remaining older workspace
    registry.remove('chat-newer')
    await manager.converge()
    expect(await readActiveWorkspaceSlots(prefsPath)).toEqual({
      chat: 'chat-older',
      'auto-quant-v2': 'aq-1',
      'auto-prediction': null,
    })
    expect(await manager.activationState('chat-older')).toBe('active')

    // Offboard last chat workspace -> clears pointer to null
    registry.remove('chat-older')
    await manager.converge()
    expect((await readActiveWorkspaceSlots(prefsPath)).chat).toBeNull()
  })

  it('auto-activates first workspace of a template but does not preempt an existing active workspace', async () => {
    const prefsPath = await makeTempPrefs()
    const registry = makeFakeRegistry([])
    const manager = new ActiveWorkspaceSlotManager(
      registry,
      createPreferenceWorkspaceSlotStore(prefsPath),
    )

    // First workspace of template -> automatically activated
    const first = makeWs('aq-first', '2026-01-01T00:00:00.000Z', 'auto-quant-v2')
    registry.add(first)
    expect(await manager.handleWorkspaceCreated(first)).toBe('active')
    expect((await readActiveWorkspaceSlots(prefsPath))['auto-quant-v2']).toBe('aq-first')

    // Second workspace of same template -> stays standby, does NOT steal active
    const second = makeWs('aq-second', '2026-02-01T00:00:00.000Z', 'auto-quant-v2')
    registry.add(second)
    expect(await manager.handleWorkspaceCreated(second)).toBe('standby')
    expect((await readActiveWorkspaceSlots(prefsPath))['auto-quant-v2']).toBe('aq-first')
    expect(await manager.activationState('aq-first')).toBe('active')
    expect(await manager.activationState('aq-second')).toBe('standby')
  })

  it('serializes concurrent handleWorkspaceCreated calls for the same template so the second does not steal active', async () => {
    const slots: Record<string, string | null> = {}
    let readCount = 0
    const store = {
      readSlots: async () => {
        readCount += 1
        // Yield on async I/O so unserialized callers would interleave readSlots() before writeSlot().
        await new Promise((resolve) => setTimeout(resolve, 15))
        return { ...slots }
      },
      writeSlot: async (template: string, workspaceId: string | null) => {
        await new Promise((resolve) => setTimeout(resolve, 15))
        slots[template] = workspaceId
      },
    }

    const first = makeWs('chat-first', '2026-01-01T00:00:00.000Z', 'chat')
    const second = makeWs('chat-second', '2026-01-01T00:00:01.000Z', 'chat')
    const registry = makeFakeRegistry([first, second])
    const manager = new ActiveWorkspaceSlotManager(registry, store)

    const [firstState, secondState] = await Promise.all([
      manager.handleWorkspaceCreated(first),
      manager.handleWorkspaceCreated(second),
    ])

    expect(readCount).toBe(2)
    expect(firstState).toBe('active')
    expect(secondState).toBe('standby')
    expect(slots.chat).toBe('chat-first')
    expect(await manager.activationState('chat-first')).toBe('active')
    expect(await manager.activationState('chat-second')).toBe('standby')
  })
})
