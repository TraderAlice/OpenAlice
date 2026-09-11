// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
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
  ChatChannelListContainer: () => <div data-testid="harness-sidebar" />,
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

describe('ChatPageShell', () => {
  it('keeps Workspace view controls out of the title bar', () => {
    render(<ChatPageShell><div>Chat content</div></ChatPageShell>)

    expect(screen.queryByTestId('harness-sidebar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Collapse Ask Alice' })).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
    expect(screen.getByText('Chat content')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Workspace display mode' })).toBeNull()
  })

  it('gives a ready AutoQuant desk the content surface without a second navigator', () => {
    render(<ChatPageShell mode="auto-quant"><div>Quant content</div></ChatPageShell>)
    expect(screen.queryByRole('button', { name: 'Collapse Quant' })).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
    expect(screen.queryByTestId('harness-sidebar')).toBeNull()
    expect(screen.getByText('Quant content')).toBeTruthy()
  })

  it('keeps AutoQuant navigation hidden until a default desk is ready', () => {
    workspaceState.autoQuantDefaultWorkspaceId = null
    render(<ChatPageShell mode="auto-quant"><div>Initialize Quant</div></ChatPageShell>)

    expect(screen.getByText('Initialize Quant')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Collapse Quant' })).toBeNull()
  })
})
