// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('Workspace Files panel preference', () => {
  it('starts collapsed for a new user and persists an explicit opt-in', async () => {
    const { useWorkspaceSidePanels } = await import('./workspace-side-panels')

    expect(useWorkspaceSidePanels.getState().files).toBe(false)
    expect(localStorage.getItem('openalice.workspace.side-panels.v1')).toBeNull()

    useWorkspaceSidePanels.getState().setFiles(true)

    expect(useWorkspaceSidePanels.getState().files).toBe(true)
    expect(JSON.parse(
      localStorage.getItem('openalice.workspace.side-panels.v1') ?? '{}',
    )).toMatchObject({
      state: {
        files: true,
        autoHideMobile: true,
      },
      version: 3,
    })
  })
})
