// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { useWorkspace } from '../tabs/store'
import type { Tab } from '../tabs/types'
import { TabHost } from './TabHost'

const mocks = vi.hoisted(() => ({
  shellMounted: vi.fn(),
  shellUnmounted: vi.fn(),
}))

vi.mock('../tabs/registry', () => {
  function MockView({ spec }: { spec: { kind: string } }) {
    return <div data-testid="view-content">{spec.kind}</div>
  }

  return {
    getView: (kind: string) => ({
      kind,
      lifecycle: 'active-only',
      Component: MockView,
    }),
    getViewShell: (spec: { kind: string; params: { source?: string } }) => (
      spec.kind === 'chat-landing' ||
      spec.kind === 'workspace-manager' ||
      ((spec.kind === 'workspace' || spec.kind === 'file-viewer') && spec.params.source === 'chat')
        ? 'chat'
        : null
    ),
  }
})

vi.mock('../pages/ChatPageShell', async () => {
  const React = await import('react')
  return {
    ChatPageShell: ({ children }: { children: ReactNode }) => {
      React.useEffect(() => {
        mocks.shellMounted()
        return () => mocks.shellUnmounted()
      }, [])
      return <div data-testid="chat-shell">{children}</div>
    },
  }
})

vi.mock('./EmptyEditor', () => ({ EmptyEditor: () => <div>empty</div> }))

const workspaceTab: Tab = {
  id: 'workspace-tab',
  spec: {
    kind: 'workspace',
    params: { wsId: 'chat-1', sessionId: 'pi-1', source: 'chat' },
  },
}

const fileTab: Tab = {
  id: 'file-tab',
  spec: {
    kind: 'file-viewer',
    params: {
      wsId: 'chat-1',
      path: 'README.md',
      source: 'chat',
      returnSessionId: 'pi-1',
    },
  },
}

function focus(activeTabId: string): void {
  useWorkspace.setState({
    tabs: {
      [workspaceTab.id]: workspaceTab,
      [fileTab.id]: fileTab,
    },
    tree: {
      kind: 'leaf',
      group: {
        id: 'g1',
        tabIds: [workspaceTab.id, fileTab.id],
        activeTabId,
      },
    },
    focusedGroupId: 'g1',
    selectedSidebar: 'chat',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  focus(workspaceTab.id)
})

afterEach(() => {
  cleanup()
  useWorkspace.setState({
    tabs: {},
    tree: { kind: 'leaf', group: { id: 'g1', tabIds: [], activeTabId: null } },
    focusedGroupId: 'g1',
    selectedSidebar: null,
  })
})

describe('TabHost shared product shells', () => {
  it('keeps the Ask Alice shell mounted across Session → file → Session navigation', async () => {
    const view = render(<TabHost />)

    await waitFor(() => expect(mocks.shellMounted).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('view-content').textContent).toBe('workspace')

    act(() => focus(fileTab.id))
    expect(screen.getByTestId('view-content').textContent).toBe('file-viewer')
    expect(mocks.shellMounted).toHaveBeenCalledTimes(1)
    expect(mocks.shellUnmounted).not.toHaveBeenCalled()

    act(() => focus(workspaceTab.id))
    expect(screen.getByTestId('view-content').textContent).toBe('workspace')
    expect(mocks.shellMounted).toHaveBeenCalledTimes(1)
    expect(mocks.shellUnmounted).not.toHaveBeenCalled()

    view.unmount()
    expect(mocks.shellUnmounted).toHaveBeenCalledTimes(1)
  })
})
