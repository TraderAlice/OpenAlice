// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import {
  AUTO_QUANT_DISPLAY_MODE_STORAGE_KEY,
  CHAT_DISPLAY_MODE_STORAGE_KEY,
} from '../components/workspace/chat-display-mode'
import { ChatPageShell } from './ChatPageShell'

const workspaceState = vi.hoisted(() => ({
  autoQuantPreferenceLoaded: true,
  hasLoaded: true,
  autoQuantDefaultWorkspaceId: 'auto-quant-1' as string | null,
  workspaces: [{ id: 'auto-quant-1', template: 'auto-quant-v2' }],
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => workspaceState,
}))

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
  workspaceState.autoQuantPreferenceLoaded = true
  workspaceState.hasLoaded = true
  workspaceState.autoQuantDefaultWorkspaceId = 'auto-quant-1'
  workspaceState.workspaces = [{ id: 'auto-quant-1', template: 'auto-quant-v2' }]
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

  it('reuses the Ask Alice shell chrome for a ready AutoQuant desk without sharing view state', () => {
    window.localStorage.setItem(CHAT_DISPLAY_MODE_STORAGE_KEY, 'multi')
    render(<ChatPageShell mode="auto-quant"><div>Quant content</div></ChatPageShell>)
    expect(screen.getByRole('button', { name: 'Collapse Quant' })).toBeTruthy()
    expect(screen.getByTestId('display-mode').textContent).toBe('focused')

    fireEvent.click(screen.getByRole('button', { name: 'Request recent' }))
    expect(window.localStorage.getItem(AUTO_QUANT_DISPLAY_MODE_STORAGE_KEY)).toBe('recent')
    expect(window.localStorage.getItem(CHAT_DISPLAY_MODE_STORAGE_KEY)).toBe('multi')
  })

  it('keeps AutoQuant navigation hidden until a default desk is ready', () => {
    workspaceState.autoQuantDefaultWorkspaceId = null
    render(<ChatPageShell mode="auto-quant"><div>Initialize Quant</div></ChatPageShell>)

    expect(screen.getByText('Initialize Quant')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Collapse Quant' })).toBeNull()
  })
})
