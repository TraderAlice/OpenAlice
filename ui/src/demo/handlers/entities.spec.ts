// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import type { EntityDetail } from '../../api/entities'
import {
  DEMO_CHAT_WORKSPACE_ID,
  demoChatWorkspace,
  demoWorkspaces,
} from '../fixtures/workspaces'
import { entitiesHandlers } from './entities'

const server = setupServer(...entitiesHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('demo Tracked handlers', () => {
  it('keeps note backlinks attached to a registered Workspace', async () => {
    const response = await fetch(`${baseUrl}/api/entities/stock-vst`)
    const detail = await response.json() as EntityDetail
    const noteBacklinks = detail.backlinks.filter(
      (backlink) => !backlink.path.startsWith('.alice/issues/'),
    )

    expect(response.status).toBe(200)
    expect(demoWorkspaces).toContain(demoChatWorkspace)
    expect(noteBacklinks).not.toHaveLength(0)
    for (const backlink of noteBacklinks) {
      expect(backlink).toMatchObject({
        workspaceId: DEMO_CHAT_WORKSPACE_ID,
        workspaceTag: demoChatWorkspace.tag,
      })
    }
  })
})
