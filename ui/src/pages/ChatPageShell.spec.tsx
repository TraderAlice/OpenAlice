// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { CHAT_DISPLAY_MODE_STORAGE_KEY } from '../components/workspace/chat-display-mode'
import { ChatPageShell } from './ChatPageShell'

vi.mock('../components/ChatChannelListContainer', () => ({
  ChatChannelListContainer: () => <div>Chat navigation</div>,
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(async () => {
  window.localStorage.clear()
  await i18n.changeLanguage('en')
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query === '(min-width: 768px)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ChatPageShell display mode', () => {
  it('defaults to Focused, confirms the dense view, and persists both choices', () => {
    render(<ChatPageShell><div>Chat content</div></ChatPageShell>)

    const focused = screen.getByRole('button', { name: 'Focused' })
    const multi = screen.getByRole('button', { name: 'Multi Workspace' })
    expect(focused.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(multi)
    expect(screen.getByRole('dialog', { name: 'Switch to the multi-Workspace view?' })).toBeTruthy()
    expect(window.localStorage.getItem(CHAT_DISPLAY_MODE_STORAGE_KEY)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show all Workspaces' }))
    expect(multi.getAttribute('aria-pressed')).toBe('true')
    expect(window.localStorage.getItem(CHAT_DISPLAY_MODE_STORAGE_KEY)).toBe('multi')

    fireEvent.click(focused)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focused.getAttribute('aria-pressed')).toBe('true')
    expect(window.localStorage.getItem(CHAT_DISPLAY_MODE_STORAGE_KEY)).toBe('focused')
  })
})
