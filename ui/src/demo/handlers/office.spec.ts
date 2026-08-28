// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import {
  DEMO_AUTO_QUANT_WORKSPACE_ID,
  DEMO_CHAT_RESUME_ID,
  DEMO_CHAT_SESSION_ID,
  DEMO_CHAT_WORKSPACE_ID,
} from '../fixtures/workspaces'
import { demoWorkspaceFiles } from '../fixtures/inbox'
import { officeHandlers } from './office'

const server = setupServer(...officeHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('demo Office handlers', () => {
  it('projects Workspaces and Sessions that exist in the shared demo roster', async () => {
    const response = await fetch(`${baseUrl}/api/office/floor`)
    const body = await response.json() as {
      offices: Array<{
        workspace: { id: string }
        employees: Array<{
          resumeId: string
          sessionRecordId?: string
          drawers: Array<{ path?: string }>
        }>
      }>
    }

    expect(response.status).toBe(200)
    expect(body.offices.map((office) => office.workspace.id)).toEqual([
      DEMO_CHAT_WORKSPACE_ID,
      DEMO_AUTO_QUANT_WORKSPACE_ID,
    ])
    expect(body.offices[0]?.employees[0]?.sessionRecordId).toBe(DEMO_CHAT_SESSION_ID)
    expect(body.offices[0]?.employees[0]?.resumeId).toBe(DEMO_CHAT_RESUME_ID)
    const drawerPath = body.offices[0]?.employees[0]?.drawers[0]?.path
    expect(drawerPath).toBe('rotation/ai-chain-2026-06-02.md')
    expect(demoWorkspaceFiles[drawerPath ?? '']).toBeTruthy()
  })
})
