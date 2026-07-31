import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AdapterRegistry, type CliAdapter } from './cli-adapter.js'
import type { Logger } from './logger.js'
import type { ResumeRegistry } from './resume-registry.js'
import { SessionRegistry, sessionDisplayTitle } from './session-registry.js'
import { NativeSessionTitleResolver } from './session-title-resolver.js'
import type { WorkspaceMeta } from './workspace-registry.js'

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  event() {},
  child() {
    return noopLogger
  },
} as unknown as Logger

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'session-title-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('NativeSessionTitleResolver', () => {
  it('refreshes a cached native title without losing the launch prompt fallback', async () => {
    const sessionRegistry = await SessionRegistry.load(root, noopLogger)
    await sessionRegistry.create({
      id: 'codex-calm-amber-river',
      resumeId: 'resume-calm-amber-river-a1b2c3',
      wsId: 'chat-calm-amber-river',
      agent: 'codex',
      name: 'x1',
      createdAt: '2026-07-30T00:00:00.000Z',
      lastActiveAt: '2026-07-30T00:00:00.000Z',
      state: 'paused',
      title: 'Stale native title',
      fallbackTitle: 'Please investigate this.',
      resumeHint: { kind: 'agent-session-id', value: 'native-session' },
    })
    const readSessionTitle = vi.fn(async () => 'Runtime-generated investigation title')
    const adapter: CliAdapter = {
      id: 'codex',
      displayName: 'Codex',
      capabilities: {
        parallelPerCwd: true,
        resumeLast: true,
        resumeById: true,
        transcriptDiscovery: 'none',
      },
      composeCommand: (base) => base,
      readSessionTitle,
    }
    const adapters = new AdapterRegistry()
    adapters.register(adapter)
    const resolver = new NativeSessionTitleResolver({
      sessionRegistry,
      resumeRegistry: { get: () => undefined } as unknown as ResumeRegistry,
      adapters,
      logger: noopLogger,
      retryMs: 0,
    })
    const meta = {
      id: 'chat-calm-amber-river',
      dir: '/workspace/chat',
    } as WorkspaceMeta

    await resolver.refreshWorkspace(meta)

    const record = sessionRegistry.get(meta.id, 'codex-calm-amber-river')!
    expect(readSessionTitle).toHaveBeenCalledWith('/workspace/chat', 'native-session')
    expect(record.fallbackTitle).toBe('Please investigate this.')
    expect(record.title).toBe('Runtime-generated investigation title')
    expect(sessionDisplayTitle(record)).toBe('Runtime-generated investigation title')
  })

  it('keeps the fallback and retries later when the runtime has no title yet', async () => {
    const sessionRegistry = await SessionRegistry.load(root, noopLogger)
    await sessionRegistry.create({
      id: 'pi-clear-copper-harbor',
      resumeId: 'resume-clear-copper-harbor-a1b2c3',
      wsId: 'chat-clear-copper-harbor',
      agent: 'pi',
      name: 'p1',
      createdAt: '2026-07-30T00:00:00.000Z',
      lastActiveAt: '2026-07-30T00:00:00.000Z',
      state: 'paused',
      fallbackTitle: 'Original request',
      resumeHint: { kind: 'agent-session-id', value: 'native-pi' },
    })
    const readSessionTitle = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('Named in Pi')
    const adapters = new AdapterRegistry()
    adapters.register({
      id: 'pi',
      displayName: 'Pi',
      capabilities: {
        parallelPerCwd: true,
        resumeLast: true,
        resumeById: true,
        transcriptDiscovery: 'none',
      },
      composeCommand: (base) => base,
      readSessionTitle,
    })
    const resolver = new NativeSessionTitleResolver({
      sessionRegistry,
      resumeRegistry: { get: () => undefined } as unknown as ResumeRegistry,
      adapters,
      logger: noopLogger,
      retryMs: 0,
    })
    const meta = { id: 'chat-clear-copper-harbor', dir: '/workspace/chat' } as WorkspaceMeta

    await resolver.refreshWorkspace(meta)
    expect(sessionDisplayTitle(sessionRegistry.listFor(meta.id)[0]!)).toBe('Original request')
    await resolver.refreshWorkspace(meta)
    expect(sessionDisplayTitle(sessionRegistry.listFor(meta.id)[0]!)).toBe('Named in Pi')
  })

  it('does not deduplicate same-named records across workspaces', async () => {
    const sessionRegistry = await SessionRegistry.load(root, noopLogger)
    for (const wsId of ['chat-one', 'chat-two']) {
      await sessionRegistry.create({
        id: 'codex-shared-record-id',
        resumeId: `resume-${wsId}`,
        wsId,
        agent: 'codex',
        name: 'x1',
        createdAt: '2026-07-30T00:00:00.000Z',
        lastActiveAt: '2026-07-30T00:00:00.000Z',
        state: 'paused',
        resumeHint: { kind: 'agent-session-id', value: `native-${wsId}` },
      })
    }
    const readSessionTitle = vi.fn(async (cwd: string) => `Title for ${cwd}`)
    const adapters = new AdapterRegistry()
    adapters.register({
      id: 'codex',
      displayName: 'Codex',
      capabilities: {
        parallelPerCwd: true,
        resumeLast: true,
        resumeById: true,
        transcriptDiscovery: 'none',
      },
      composeCommand: (base) => base,
      readSessionTitle,
    })
    const resolver = new NativeSessionTitleResolver({
      sessionRegistry,
      resumeRegistry: { get: () => undefined } as unknown as ResumeRegistry,
      adapters,
      logger: noopLogger,
    })

    await Promise.all([
      resolver.refreshWorkspace({ id: 'chat-one', dir: '/workspace/one' } as WorkspaceMeta),
      resolver.refreshWorkspace({ id: 'chat-two', dir: '/workspace/two' } as WorkspaceMeta),
    ])

    expect(readSessionTitle).toHaveBeenCalledTimes(2)
    expect(sessionRegistry.get('chat-one', 'codex-shared-record-id')?.title)
      .toBe('Title for /workspace/one')
    expect(sessionRegistry.get('chat-two', 'codex-shared-record-id')?.title)
      .toBe('Title for /workspace/two')
  })
})
