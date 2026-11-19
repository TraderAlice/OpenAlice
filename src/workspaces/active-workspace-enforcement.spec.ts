import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEntityRoutes } from '@/webui/routes/entities.js'
import { createOfficeRoutes } from '@/webui/routes/office.js'
import { createStickerRoutes } from '@/webui/routes/stickers.js'
import { createWorkspaceRoutes } from '@/webui/routes/workspaces.js'

import { createPreferenceWorkspaceSlotStore, ActiveWorkspaceSlotManager } from './active-workspace-slots.js'
import type { CliAdapter } from './cli-adapter.js'
import type { Logger } from './logger.js'
import { ScheduleMarkerStore } from './schedule/marker-store.js'
import { ScheduleScanner } from './schedule/scanner.js'
import type { WorkspaceMeta, WorkspaceRegistry } from './workspace-registry.js'

const tempRoots: string[] = []
const originalEnv = { ...process.env }

function silentLogger(): Logger {
  const log: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    event: () => {},
    child: () => log,
  }
  return log
}

async function writeIssue(
  wsDir: string,
  id: string,
  opts: {
    title?: string
    status?: string
    every?: string
    connectorDesk?: string
    body?: string
  } = {},
): Promise<string> {
  const dir = join(wsDir, '.alice', 'issues')
  await mkdir(dir, { recursive: true })
  const lines = [
    '---',
    `title: ${opts.title ?? id}`,
    `status: ${opts.status ?? 'todo'}`,
    ...(opts.every ? ['assignee: "@new-each-run"', `when: { kind: every, every: "${opts.every}" }`] : []),
    ...(opts.connectorDesk ? [`connectorDesk: ${opts.connectorDesk}`] : []),
    '---',
    '',
    opts.body ?? `Run ${id}`,
    '',
  ]
  const path = join(dir, `${id}.md`)
  await writeFile(path, lines.join('\n'), 'utf8')
  return path
}

async function writeWorkspaceMetaFile(wsDir: string, displayName: string): Promise<void> {
  const dir = join(wsDir, '.alice')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'workspace.json'),
    JSON.stringify({ displayName }, null, 2),
    'utf8',
  )
}

function fakeAdapter(): CliAdapter {
  return {
    id: 'claude',
    displayName: 'Claude',
    binary: 'claude',
    capabilities: { headless: true },
    composeCommand: () => ['claude'],
    composeHeadlessCommand: () => ['claude', '-p', 'test'],
  } as unknown as CliAdapter
}

afterEach(async () => {
  process.env = { ...originalEnv }
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('ScheduleScanner active-only enforcement', () => {
  it('only scans and fires active workspaces, preserves standby markers, and refreshes on switch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-scanner-active-'))
    tempRoots.push(root)

    const activeDir = join(root, 'chat-active')
    const standbyDir = join(root, 'chat-standby')
    await mkdir(activeDir, { recursive: true })
    await mkdir(standbyDir, { recursive: true })

    await writeIssue(activeDir, 'active-task', { every: '1m' })
    await writeIssue(standbyDir, 'standby-task', { every: '1m' })

    const wsActive: WorkspaceMeta = {
      id: 'chat-active',
      tag: 'chat-active',
      dir: activeDir,
      createdAt: '2026-01-01T00:00:00.000Z',
      template: 'chat',
    }
    const wsStandby: WorkspaceMeta = {
      id: 'chat-standby',
      tag: 'chat-standby',
      dir: standbyDir,
      createdAt: '2026-02-01T00:00:00.000Z',
      template: 'chat',
    }

    const workspaces = new Map<string, WorkspaceMeta>([
      [wsActive.id, wsActive],
      [wsStandby.id, wsStandby],
    ])
    const registry = {
      get: (id: string) => workspaces.get(id),
      list: () => Array.from(workspaces.values()),
    } as unknown as WorkspaceRegistry

    const prefsPath = join(root, 'preferences.json')
    const slots = new ActiveWorkspaceSlotManager(
      registry,
      createPreferenceWorkspaceSlotStore(prefsPath),
    )
    await slots.setActive('chat', wsActive.id)

    const markers = await ScheduleMarkerStore.load(join(root, 'markers.json'), silentLogger())
    // Seed a pre-existing marker on the standby workspace and on an already-offboarded workspace.
    await markers.set(wsStandby.id, 'standby-task', 1_000)
    await markers.set('departed-ws', 'old-task', 1_000)

    const dispatched: Array<{ wsId: string; prompt: string }> = []
    let nowMs = 1_000_000
    const scanner = new ScheduleScanner({
      registry,
      listActiveWorkspaces: () => slots.listActiveWorkspaces(),
      resolveAdapter: () => fakeAdapter(),
      dispatch: async (meta, _adapter, prompt) => {
        dispatched.push({ wsId: meta.id, prompt })
        return { taskId: `task-${dispatched.length}`, resumeId: `resume-${dispatched.length}` }
      },
      markers,
      logger: silentLogger(),
      now: () => nowMs,
    })

    // First scan: only chat-active fires and appears in snapshot
    await scanner.scan(true)
    expect(dispatched.map((d) => d.wsId)).toEqual(['chat-active'])
    expect(scanner.snapshot()?.workspaces.map((w) => w.wsId)).toEqual(['chat-active'])
    // Standby marker preserved, departed marker pruned
    expect(markers.get(wsStandby.id, 'standby-task')).toBe(1_000)
    expect(markers.get('departed-ws', 'old-task')).toBeUndefined()

    // Switch active slot to chat-standby and refresh scanner
    await slots.setActive('chat', wsStandby.id)
    nowMs += 120_000
    await scanner.refresh()
    await scanner.waitForDispatches()

    expect(scanner.snapshot()?.workspaces.map((w) => w.wsId)).toEqual(['chat-standby'])
    expect(dispatched.map((d) => d.wsId)).toEqual(['chat-active', 'chat-standby'])
  })
})

describe('WorkspaceService & routes active-workspace slot lifecycle', () => {
  it('enforces active-only aggregation, previews counts, switches gracefully without killing in-flight runs, and falls back on offboard', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-service-active-'))
    tempRoots.push(root)

    process.env['OPENALICE_HOME'] = root
    process.env['AQ_LAUNCHER_ROOT'] = join(root, 'launcher')
    process.env['OPENALICE_GLOBAL_DIR'] = join(root, 'global')
    vi.resetModules()

    const { createWorkspaceService } = await import('./service.js')
    const { readActiveWorkspaceSlots } = await import('@/core/preferences.js')

    const prefsPath = join(root, 'data', 'preferences.json')
    const slotStore = createPreferenceWorkspaceSlotStore(prefsPath)

    // Hold a headless run open so we can verify inFlightRunCount & non-kill on switch.
    let releaseInFlight!: () => void
    const inFlightReleased = new Promise<void>((resolve) => {
      releaseInFlight = resolve
    })
    let headlessFinished = false

    const service = await createWorkspaceService({
      webPort: 0,
      mcpPort: 0,
      toolBaseUrl: 'http://127.0.0.1:0/cli',
      scheduleScannerIntervalMs: 600_000,
      activeWorkspaceSlotStore: slotStore,
      runHeadlessTask: async (args) => {
        await inFlightReleased
        headlessFinished = true
        return {
          command: [...args.command],
          cwd: args.cwd,
          exitCode: 0,
          signal: null,
          killed: false,
          timedOut: false,
          durationMs: 25,
          stdoutTail: 'done',
          stderrTail: '',
          stdoutBytes: 4,
          stderrBytes: 0,
          agentSessionId: null,
          assistantText: 'done',
          structured: {
            schemaVersion: 1,
            assistantText: 'done',
            blocks: [],
            metrics: { textBlocks: 0, toolCalls: 0, toolFailures: 0 },
            truncated: false,
          },
        }
      },
    })

    try {
      const wsRoot = join(root, 'launcher', 'workspaces')
      const chatActiveDir = join(wsRoot, 'chat-a')
      const chatStandbyDir = join(wsRoot, 'chat-b')
      const aqActiveDir = join(wsRoot, 'aq-a')
      const aqStandbyDir = join(wsRoot, 'aq-b')
      const predActiveDir = join(wsRoot, 'pred-a')
      const predStandbyDir = join(wsRoot, 'pred-b')
      for (const dir of [chatActiveDir, chatStandbyDir, aqActiveDir, aqStandbyDir, predActiveDir, predStandbyDir]) {
        await mkdir(dir, { recursive: true })
      }

      const chatA: WorkspaceMeta = {
        id: 'chat-a', tag: 'chat-a', dir: chatActiveDir,
        createdAt: '2026-01-01T00:00:00.000Z', template: 'chat',
      }
      const chatB: WorkspaceMeta = {
        id: 'chat-b', tag: 'chat-b', dir: chatStandbyDir,
        createdAt: '2026-02-01T00:00:00.000Z', template: 'chat',
      }
      const aqA: WorkspaceMeta = {
        id: 'aq-a', tag: 'aq-a', dir: aqActiveDir,
        createdAt: '2026-01-01T00:00:00.000Z', template: 'auto-quant-v2',
      }
      const aqB: WorkspaceMeta = {
        id: 'aq-b', tag: 'aq-b', dir: aqStandbyDir,
        createdAt: '2026-02-01T00:00:00.000Z', template: 'auto-quant-v2',
      }
      const predA: WorkspaceMeta = {
        id: 'pred-a', tag: 'pred-a', dir: predActiveDir,
        createdAt: '2026-01-01T00:00:00.000Z', template: 'auto-prediction',
      }
      const predB: WorkspaceMeta = {
        id: 'pred-b', tag: 'pred-b', dir: predStandbyDir,
        createdAt: '2026-02-01T00:00:00.000Z', template: 'auto-prediction',
      }

      for (const ws of [chatA, chatB, aqA, aqB, predA, predB]) {
        await service.registry.add(ws)
        await service.catalog.recordCreated(ws)
      }

      await slotStore.writeSlot('chat', chatA.id)
      await slotStore.writeSlot('auto-quant-v2', aqA.id)
      await slotStore.writeSlot('auto-prediction', predA.id)

      // Populate metadata, issues, connector desks, and markdown notes with wikilinks
      await writeWorkspaceMetaFile(aqA.dir, 'Alpha Quant')
      const aqOpenPath = await writeIssue(aqA.dir, 'aq-open', { title: 'AQ Open' })
      await writeIssue(aqA.dir, 'aq-sched', { title: 'AQ Sched', every: '10m' })
      await writeIssue(aqA.dir, 'aq-done', { title: 'AQ Done', status: 'done' })
      await writeIssue(aqB.dir, 'aq-standby-issue', { title: 'AQ Standby', every: '10m' })

      await writeIssue(chatA.dir, 'chat-active-issue', { title: 'SharedName', every: '10m' })
      await writeIssue(chatB.dir, 'chat-standby-issue', { title: 'SharedName', every: '10m' })
      await writeIssue(chatA.dir, 'telegram-desk-a', { connectorDesk: 'telegram', every: '5m' })
      await writeIssue(chatB.dir, 'telegram-desk-b', { connectorDesk: 'telegram', every: '5m' })

      await writeFile(join(chatA.dir, 'note-a.md'), 'Tracking [[NVDA]] in active chat.', 'utf8')
      await writeFile(join(chatB.dir, 'note-b.md'), 'Tracking [[NVDA]] in standby chat.', 'utf8')

      // 1. publicMeta reports activationState
      const metaChatA = await service.publicMeta(chatA) as { activationState: string }
      const metaChatB = await service.publicMeta(chatB) as { activationState: string }
      expect(metaChatA.activationState).toBe('active')
      expect(metaChatB.activationState).toBe('standby')

      // 2. Global aggregations ONLY include active workspaces
      const issuesSnap = await service.issuesSnapshot()
      expect(issuesSnap.workspaces.map((w) => w.wsId).sort()).toEqual(['aq-a', 'chat-a', 'pred-a'])

      const schedSnap = await service.scheduleSnapshot()
      expect(schedSnap.workspaces.map((w) => w.wsId).sort()).toEqual(['aq-a', 'chat-a', 'pred-a'])

      const wikilinks = await service.resolveIssuesByName('SharedName')
      expect(wikilinks.map((i) => i.wsId)).toEqual(['chat-a'])

      const tgDesk = await service.connectorDesk('telegram')
      expect(tgDesk?.wsId).toBe('chat-a')

      const stickerApp = createStickerRoutes(service)
      const stickerRes = await stickerApp.request('/')
      expect(stickerRes.status).toBe(200)
      const stickerBody = await stickerRes.json() as { workspaces: Array<{ id: string }> }
      expect(stickerBody.workspaces.map((w) => w.id)).toEqual(['chat-a'])

      const entityApp = createEntityRoutes({
        entityStore: {
          list: async () => [{ name: 'NVDA', kind: 'ticker', summary: 'Nvidia', createdAt: '', updatedAt: '' }],
          get: async () => ({ name: 'NVDA', kind: 'ticker', summary: 'Nvidia', createdAt: '', updatedAt: '' }),
        } as any,
        registry: service.registry,
        listActiveWorkspaces: () => service.listActiveWorkspaces(),
      })
      const entityRes = await entityApp.request('/NVDA')
      expect(entityRes.status).toBe(200)
      const entityBody = await entityRes.json() as { backlinks: Array<{ workspaceId: string }> }
      expect(entityBody.backlinks.map((b) => b.workspaceId)).toEqual(['chat-a'])

      const officeApp = createOfficeRoutes(service)
      const officeRes = await officeApp.request('/floor')
      expect(officeRes.status).toBe(200)
      const officeBody = await officeRes.json() as { offices: Array<{ workspace: { id: string } }> }
      expect(officeBody.offices.map((o) => o.workspace.id).sort()).toEqual(['aq-a', 'chat-a', 'pred-a'])

      // 3. Start an in-flight headless run on aq-a to verify preview + non-kill on switch
      const adapter = service.adapters.get('claude')!
      if (adapter.lifecycle?.prepareWorkspace) {
        vi.spyOn(adapter.lifecycle, 'prepareWorkspace').mockResolvedValue()
      }
      vi.spyOn(adapter, 'composeHeadlessCommand').mockReturnValue(['claude', '-p', 'work'])

      const dispatched = await service.executions.dispatch(
        aqA,
        adapter,
        'in-flight work',
        { kind: 'user', entry: 'headless-api', workspaceId: aqA.id },
      )
      expect(dispatched.taskId).toBeTruthy()

      const wsApp = createWorkspaceRoutes(service)

      // 4. Activation preview for aq-b reports accurate counts for aq-a
      const previewRes = await wsApp.request(`/${aqB.id}/activation-preview`)
      expect(previewRes.status).toBe(200)
      const preview = await previewRes.json() as any
      expect(preview).toEqual({
        workspaceId: 'aq-b',
        template: 'auto-quant-v2',
        alreadyActive: false,
        currentActive: {
          id: 'aq-a',
          tag: 'aq-a',
          displayName: 'Alpha Quant',
          openIssueCount: 2,
          scheduledIssueCount: 1,
          inFlightRunCount: 1,
        },
      })

      // Preview on already-active workspace reports alreadyActive: true
      const alreadyPreviewRes = await wsApp.request(`/${aqA.id}/activation-preview`)
      expect(alreadyPreviewRes.status).toBe(200)
      expect((await alreadyPreviewRes.json() as any).alreadyActive).toBe(true)

      // 5. Activate aq-b via POST /api/workspaces/:id/activate
      const stopStudioSpy = vi.spyOn(service.harnessSurfaces, 'stopWorkspace').mockResolvedValue()
      const stopExecSpy = vi.spyOn(service.executions, 'stop')

      const activateRes = await wsApp.request(`/${aqB.id}/activate`, { method: 'POST' })
      expect(activateRes.status).toBe(200)
      const activated = await activateRes.json() as { workspace: { id: string; activationState: string }; previousActiveId: string | null }
      expect(activated.previousActiveId).toBe('aq-a')
      expect(activated.workspace.id).toBe('aq-b')
      expect(activated.workspace.activationState).toBe('active')

      // Studio stopped for previous active; in-flight run NOT killed; old files untouched
      expect(stopStudioSpy).toHaveBeenCalledWith('aq-a')
      expect(stopExecSpy).not.toHaveBeenCalled()
      expect(headlessFinished).toBe(false)
      expect(existsSync(aqOpenPath)).toBe(true)
      expect(await readFile(aqOpenPath, 'utf8')).toContain('AQ Open')

      // Preference slot persisted and schedule/issues snapshots immediately updated
      expect((await readActiveWorkspaceSlots(prefsPath))['auto-quant-v2']).toBe('aq-b')
      expect((await service.scheduleSnapshot()).workspaces.map((w) => w.wsId).sort()).toEqual(['aq-b', 'chat-a', 'pred-a'])
      expect((await service.issuesSnapshot()).workspaces.map((w) => w.wsId).sort()).toEqual(['aq-b', 'chat-a', 'pred-a'])

      // Release in-flight run and confirm it finishes naturally
      releaseInFlight()
      await vi.waitFor(() => {
        expect(headlessFinished).toBe(true)
      })

      // 6. Legacy PUT /auto-quant/default-workspace & /auto-prediction/default-workspace route through activateWorkspace
      stopStudioSpy.mockClear()
      const putAqRes = await wsApp.request('/auto-quant/default-workspace', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: aqA.id }),
      })
      expect(putAqRes.status).toBe(200)
      expect(await putAqRes.json()).toEqual({ defaultWorkspaceId: aqA.id, ready: true })
      expect(stopStudioSpy).toHaveBeenCalledWith('aq-b')

      stopStudioSpy.mockClear()
      const putPredRes = await wsApp.request('/auto-prediction/default-workspace', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: predB.id }),
      })
      expect(putPredRes.status).toBe(200)
      expect(await putPredRes.json()).toEqual({ defaultWorkspaceId: predB.id, ready: true })
      expect(stopStudioSpy).toHaveBeenCalledWith('pred-a')

      // 7. Offboarding active workspace converges slot to remaining workspace of same template
      const offboardRes = await service.lifecycle.offboard({ id: predB.id })
      expect(offboardRes.ok).toBe(true)
      expect((await readActiveWorkspaceSlots(prefsPath))['auto-prediction']).toBe('pred-a')
      expect((await service.publicMeta(predA) as { activationState: string }).activationState).toBe('active')

      // 8. Sending quick-chat targeting a standby Chat workspace does NOT steal the active Chat slot
      const rememberSpy = vi.fn(async (id: string | null) => {
        await slotStore.writeSlot('chat', id)
        return { lastCredentialByAgent: {}, recentChatWorkspaceId: id }
      })
      const quickChatApp = createWorkspaceRoutes(service, {
        readQuickChatPreferences: async () => ({
          lastCredentialByAgent: {},
          recentChatWorkspaceId: (await readActiveWorkspaceSlots(prefsPath)).chat ?? null,
        }),
        rememberRecentChatWorkspace: rememberSpy,
      })
      vi.spyOn(service.executions, 'terminal').mockResolvedValue({
        id: 'sess-standby-1',
        pid: 12345,
        startedAt: Date.now(),
        agent: 'claude',
        resumeId: 'resume-standby-1',
      } as any)
      const quickChatRes = await quickChatApp.request('/quick-chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'inspect standby chat',
          agent: 'claude',
          targetWsId: chatB.id,
        }),
      })
      expect(quickChatRes.status).toBe(201)
      expect(rememberSpy).not.toHaveBeenCalled()
      expect((await readActiveWorkspaceSlots(prefsPath)).chat).toBe(chatA.id)
      expect((await service.publicMeta(chatA) as { activationState: string }).activationState).toBe('active')
      expect((await service.publicMeta(chatB) as { activationState: string }).activationState).toBe('standby')
    } finally {
      releaseInFlight()
      await service.dispose('test-cleanup')
    }
  })
})
