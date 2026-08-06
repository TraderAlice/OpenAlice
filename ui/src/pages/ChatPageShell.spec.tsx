// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { CHAT_DISPLAY_MODE_STORAGE_KEY } from '../components/workspace/chat-display-mode'
import { ChatPageShell } from './ChatPageShell'

vi.mock('../components/ChatChannelListContainer', () => ({
  ChatChannelListContainer: ({
    displayMode,
    onRequestDisplayMode,
  }: {
    displayMode: 'focused' | 'recent' | 'multi'
    onRequestDisplayMode: (mode: 'focused' | 'recent' | 'multi') => void
  }) => (
    <div>
      <span data-testid="display-mode">{displayMode}</span>
      <button type="button" onClick={() => onRequestDisplayMode('focused')}>Request current</button>
      <button type="button" onClick={() => onRequestDisplayMode('recent')}>Request recent</button>
      <button type="button" onClick={() => onRequestDisplayMode('multi')}>Request tree</button>
    </div>
  ),
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
  it('keeps mode controls out of the title bar and persists all three views', () => {
    render(<ChatPageShell><div>Chat content</div></ChatPageShell>)

    expect(screen.getByTestId('display-mode').textContent).toBe('focused')
    expect(screen.getByRole('button', { name: 'Collapse Ask Alice' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Workspace display mode' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Request recent' }))
    expect(screen.getByTestId('display-mode').textContent).toBe('recent')
    expect(window.localStorage.getItem(CHAT_DISPLAY_MODE_STORAGE_KEY)).toBe('recent')

    fireEvent.click(screen.getByRole('button', { name: 'Request tree' }))
    expect(screen.getByTestId('display-mode').textContent).toBe('multi')
    expect(window.localStorage.getItem(CHAT_DISPLAY_MODE_STORAGE_KEY)).toBe('multi')

    fireEvent.click(screen.getByRole('button', { name: 'Request current' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('display-mode').textContent).toBe('focused')
    expect(window.localStorage.getItem(CHAT_DISPLAY_MODE_STORAGE_KEY)).toBe('focused')
  })
})
