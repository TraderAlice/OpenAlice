// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('Workspace Files panel state', () => {
  it('starts collapsed and does not persist an explicit desktop opt-in', async () => {
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
        autoHideMobile: true,
      },
      version: 4,
    })
    expect(JSON.parse(
      localStorage.getItem('openalice.workspace.side-panels.v1') ?? '{}',
    ).state).not.toHaveProperty('files')
  })

  it('discards a legacy persisted Files-open value during hydration', async () => {
    localStorage.setItem('openalice.workspace.side-panels.v1', JSON.stringify({
      state: {
        files: true,
        autoHideMobile: false,
      },
      version: 3,
    }))

    const { useWorkspaceSidePanels } = await import('./workspace-side-panels')

    expect(useWorkspaceSidePanels.getState()).toMatchObject({
      files: false,
      autoHideMobile: false,
      mobileFilesOpen: false,
    })
    expect(JSON.parse(
      localStorage.getItem('openalice.workspace.side-panels.v1') ?? '{}',
    )).toMatchObject({
      state: {
        autoHideMobile: false,
      },
      version: 4,
    })
    expect(JSON.parse(
      localStorage.getItem('openalice.workspace.side-panels.v1') ?? '{}',
    ).state).not.toHaveProperty('files')
  })

  it('keeps the explicit mobile overlay state out of persisted preferences', async () => {
    const { useWorkspaceSidePanels } = await import('./workspace-side-panels')

    useWorkspaceSidePanels.getState().toggleMobileFiles()

    expect(useWorkspaceSidePanels.getState().mobileFilesOpen).toBe(true)
    expect(JSON.parse(
      localStorage.getItem('openalice.workspace.side-panels.v1') ?? '{}',
    )).toMatchObject({
      state: {
        autoHideMobile: true,
      },
      version: 4,
    })
    expect(JSON.parse(
      localStorage.getItem('openalice.workspace.side-panels.v1') ?? '{}',
    ).state).not.toHaveProperty('mobileFilesOpen')
  })
})
