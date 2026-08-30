import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryInboxStore } from '../../core/inbox-store.js'
import { processConnectorArtifactClaims, processConnectorArtifactRequests } from './action-bridge.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('Connector action bridge', () => {
  it('acks a completed claim and releases it when terminal delivery cannot be reported', async () => {
    const store = createMemoryInboxStore()
    const ackActions = vi.fn(async () => undefined)
    const releaseActions = vi.fn(async () => undefined)
    const base = {
      isEnabled: async () => true,
      drainActions: async () => [],
      claimActions: async () => ({
        claimId: 'claim-art',
        items: [{
          requestId: 'art-missing',
          connectorId: 'telegram',
          entryId: 'gone',
          docIndex: 0,
          createdAt: new Date().toISOString(),
        }],
      }),
      ackActions,
      releaseActions,
      deliverArtifact: async () => undefined,
      warn: vi.fn(),
    }

    await processConnectorArtifactClaims(store, {
      ...base,
      failArtifact: async () => undefined,
    })
    expect(ackActions).toHaveBeenCalledWith('claim-art', ['art-missing'])
    expect(releaseActions).not.toHaveBeenCalled()

    ackActions.mockClear()
    await processConnectorArtifactClaims(store, {
      ...base,
      failArtifact: async () => { throw new Error('connector offline') },
    })
    expect(releaseActions).toHaveBeenCalledWith('claim-art', ['art-missing'])
    expect(ackActions).not.toHaveBeenCalled()
  })

  it('materializes the selected current file and delivers it only as an artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-action-bridge-'))
    tempDirs.push(root)
    await mkdir(join(root, 'research'))
    await writeFile(join(root, 'research', 'close.md'), '# Close scan\n')
    const store = createMemoryInboxStore()
    const entry = await store.append({
      workspaceId: 'ws-1',
      comments: 'See the report.',
      docs: [{ path: 'research/close.md' }],
    })
    const markRead = vi.spyOn(store, 'markRead')
    const deliverArtifact = vi.fn(async () => undefined)
    const failArtifact = vi.fn(async () => undefined)
    const pushInbox = vi.fn()

    await processConnectorArtifactRequests(store, {
      isEnabled: async () => true,
      drainActions: async () => [{
        requestId: 'art-1',
        connectorId: 'telegram',
        entryId: entry.id,
        docIndex: 0,
        createdAt: new Date().toISOString(),
      }],
      deliverArtifact,
      failArtifact,
      warn: vi.fn(),
      resolveWorkspace: () => ({ dir: root }),
    })

    expect(deliverArtifact).toHaveBeenCalledOnce()
    expect(deliverArtifact).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'art-1',
      connectorId: 'telegram',
      entryId: entry.id,
      docIndex: 0,
      attachment: expect.objectContaining({ filename: 'close.md' }),
    }))
    expect(failArtifact).not.toHaveBeenCalled()
    expect(pushInbox).not.toHaveBeenCalled()
    expect(markRead).not.toHaveBeenCalled()
    expect((await store.get(entry.id))?.readAt).toBeUndefined()
  })

  it('reports a retryable failure when the Inbox entry is gone', async () => {
    const store = createMemoryInboxStore()
    const failArtifact = vi.fn(async () => undefined)
    await processConnectorArtifactRequests(store, {
      isEnabled: async () => true,
      drainActions: async () => [{
        requestId: 'art-missing',
        connectorId: 'telegram',
        entryId: 'gone',
        docIndex: 0,
        createdAt: new Date().toISOString(),
      }],
      deliverArtifact: async () => undefined,
      failArtifact,
      warn: vi.fn(),
      resolveWorkspace: () => ({ dir: '/tmp' }),
    })
    expect(failArtifact).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'art-missing',
      connectorId: 'telegram',
      reason: 'entry_not_found',
      message: expect.stringContaining('no longer available'),
    }))
  })

  it('does not read a file after the request has expired', async () => {
    const store = createMemoryInboxStore()
    const entry = await store.append({ workspaceId: 'ws-1', comments: 'later', docs: [{ path: 'a.md' }] })
    const resolveWorkspace = vi.fn(() => ({ dir: '/tmp' }))
    const failArtifact = vi.fn(async () => undefined)
    await processConnectorArtifactRequests(store, {
      isEnabled: async () => true,
      drainActions: async () => [{
        requestId: 'art-expired',
        connectorId: 'telegram',
        entryId: entry.id,
        docIndex: 0,
        createdAt: '2026-08-14T15:00:00.000Z',
      }],
      deliverArtifact: async () => undefined,
      failArtifact,
      warn: vi.fn(),
      resolveWorkspace,
      now: () => Date.parse('2026-08-14T15:02:00.000Z'),
    })
    expect(resolveWorkspace).not.toHaveBeenCalled()
    expect(failArtifact).toHaveBeenCalledWith(expect.objectContaining({ reason: 'expired' }))
  })

  it('turns a late delivery outage into a retryable user error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-action-bridge-fail-'))
    tempDirs.push(root)
    await writeFile(join(root, 'note.md'), 'ok\n')
    const store = createMemoryInboxStore()
    const entry = await store.append({
      workspaceId: 'ws-1',
      comments: 'file',
      docs: [{ path: 'note.md' }],
    })
    const failArtifact = vi.fn(async () => undefined)
    await processConnectorArtifactRequests(store, {
      isEnabled: async () => true,
      drainActions: async () => [{
        requestId: 'art-send',
        connectorId: 'telegram',
        entryId: entry.id,
        docIndex: 0,
        createdAt: new Date().toISOString(),
      }],
      deliverArtifact: async () => { throw new Error('telegram offline') },
      failArtifact,
      warn: vi.fn(),
      resolveWorkspace: () => ({ dir: root }),
    })
    expect(failArtifact).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'delivery_failed',
      message: 'OpenAlice could not send the file. Try again.',
    }))
  })
})
