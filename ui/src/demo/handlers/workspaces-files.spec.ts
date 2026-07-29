// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import {
  DEMO_CHAT_WORKSPACE_ID,
  DEMO_WORKSPACE_ID,
} from '../fixtures/workspaces'
import {
  demoWorkspaceFilePaths,
  demoWorkspaceFiles,
} from '../fixtures/inbox'
import { workspacesHandlers } from './workspaces'

const server = setupServer(...workspacesHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

async function listFiles(workspaceId: string, path = '') {
  const query = path ? `?path=${encodeURIComponent(path)}` : ''
  const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/files${query}`)
  return {
    response,
    body: await response.json() as {
      path: string
      entries: Array<{
        name: string
        kind: 'file' | 'dir'
        sizeBytes: number | null
        mtime: string
      }>
    },
  }
}

describe('demo Workspace file listings', () => {
  it('assigns every readable demo artifact to a Workspace directory', () => {
    const indexedPaths = Object.values(demoWorkspaceFilePaths).flat().sort()
    expect(indexedPaths).toEqual(Object.keys(demoWorkspaceFiles).sort())
  })

  it('shows the report written by the featured AAPL Session', async () => {
    const { response, body } = await listFiles(DEMO_WORKSPACE_ID)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      path: '',
      entries: [{
        name: 'research-AAPL-q1.md',
        kind: 'file',
        mtime: expect.any(String),
      }],
    })
    expect(body.entries[0]?.sizeBytes).toBeGreaterThan(0)
  })

  it('builds navigable directories for the Chat Workspace notes', async () => {
    const root = await listFiles(DEMO_CHAT_WORKSPACE_ID)
    expect(root.body.entries).toEqual([
      expect.objectContaining({ name: 'rotation', kind: 'dir', sizeBytes: null }),
      expect.objectContaining({ name: 'power_buy_points_2026-06-02.md', kind: 'file' }),
    ])

    const rotation = await listFiles(DEMO_CHAT_WORKSPACE_ID, 'rotation')
    expect(rotation.body.path).toBe('rotation')
    expect(rotation.body.entries.map((entry) => entry.name)).toEqual([
      '2026-06-02.md',
      'ai-chain-2026-06-02.md',
      'missed-rightside-2026-06-02.md',
    ])
    expect(rotation.body.entries.every((entry) => entry.kind === 'file')).toBe(true)
  })

  it('rejects paths that try to leave the Workspace', async () => {
    const { response } = await listFiles(DEMO_WORKSPACE_ID, '../secrets')
    expect(response.status).toBe(400)
  })
})
