// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import { useWorkspaceSidePanels } from '../../live/workspace-side-panels'
import { WorkspaceFilesToggle } from './WorkspaceFilesToggle'

const toggleMocks = vi.hoisted(() => ({ isDesktop: true }))

vi.mock('../../live/use-is-desktop', () => ({
  useIsDesktop: () => toggleMocks.isDesktop,
}))

beforeEach(async () => {
  localStorage.clear()
  toggleMocks.isDesktop = true
  useWorkspaceSidePanels.setState({
    files: false,
    autoHideMobile: true,
    mobileFilesOpen: false,
  })
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('WorkspaceFilesToggle', () => {
  it('opens and closes Files on mobile without changing the desktop preference', () => {
    toggleMocks.isDesktop = false
    render(<WorkspaceFilesToggle />)

    const button = screen.getByRole('button', { name: 'Files' })
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)

    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(useWorkspaceSidePanels.getState()).toMatchObject({
      files: false,
      mobileFilesOpen: true,
    })

    fireEvent.click(button)

    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(useWorkspaceSidePanels.getState()).toMatchObject({
      files: false,
      mobileFilesOpen: false,
    })
  })

  it('toggles the runtime disclosure state on desktop', () => {
    render(<WorkspaceFilesToggle />)

    const button = screen.getByRole('button', { name: 'Files' })
    fireEvent.click(button)

    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(useWorkspaceSidePanels.getState()).toMatchObject({
      files: true,
      mobileFilesOpen: false,
    })
  })
})
