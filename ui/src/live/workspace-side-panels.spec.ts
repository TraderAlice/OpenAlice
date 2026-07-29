// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('Workspace Files panel preference', () => {
  it('starts collapsed for a new user and persists an explicit desktop opt-in', async () => {
    const { useWorkspaceSidePanels } = await import('./workspace-side-panels')

    expect(useWorkspaceSidePanels.getState().files).toBe(false)
    expect(useWorkspaceSidePanels.getState().mobileFilesOpen).toBe(false)
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

  it('keeps the explicit mobile overlay state out of persisted preferences', async () => {
    const { useWorkspaceSidePanels } = await import('./workspace-side-panels')

    useWorkspaceSidePanels.getState().toggleMobileFiles()

    expect(useWorkspaceSidePanels.getState().mobileFilesOpen).toBe(true)
    expect(JSON.parse(
      localStorage.getItem('openalice.workspace.side-panels.v1') ?? '{}',
    )).toMatchObject({
      state: {
        files: false,
        autoHideMobile: true,
      },
      version: 3,
    })
    expect(JSON.parse(
      localStorage.getItem('openalice.workspace.side-panels.v1') ?? '{}',
    ).state).not.toHaveProperty('mobileFilesOpen')
  })
})
