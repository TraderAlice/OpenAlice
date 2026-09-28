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
    return <div data-testid={`view-content-${spec.kind}`}>{spec.kind}</div>
  }

  return {
    getView: (kind: string) => ({
      kind,
      lifecycle: kind === 'workspace' ? 'keep-mounted' : 'active-only',
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

const portfolioTab: Tab = {
  id: 'portfolio-tab',
  spec: { kind: 'portfolio', params: {} },
}

describe('TabHost shared product shells', () => {
  it('keeps a warm Workspace frame while Trading is focused', async () => {
    useWorkspace.setState({
      tabs: {
        [workspaceTab.id]: workspaceTab,
        [portfolioTab.id]: portfolioTab,
      },
      tree: {
        kind: 'leaf',
        group: {
          id: 'g1',
          tabIds: [workspaceTab.id, portfolioTab.id],
          activeTabId: workspaceTab.id,
        },
      },
      focusedGroupId: 'g1',
      selectedSidebar: 'chat',
    })
    const view = render(<TabHost />)

    await waitFor(() => expect(screen.getByTestId('view-content-workspace')).toBeTruthy())
    expect(mocks.shellMounted).toHaveBeenCalledTimes(1)

    act(() => {
      useWorkspace.setState({
        tabs: {
          [workspaceTab.id]: workspaceTab,
          [portfolioTab.id]: portfolioTab,
        },
        tree: {
          kind: 'leaf',
          group: {
            id: 'g1',
            tabIds: [workspaceTab.id, portfolioTab.id],
            activeTabId: portfolioTab.id,
          },
        },
        focusedGroupId: 'g1',
        selectedSidebar: null,
      })
    })

    expect(screen.getByTestId('view-content-portfolio')).toBeTruthy()
    expect(screen.getByTestId('view-content-workspace')).toBeTruthy()
    expect(document.querySelector('[data-view-frame="workspace"]')?.getAttribute('data-view-visible')).toBe('false')
    expect(mocks.shellUnmounted).not.toHaveBeenCalled()

    act(() => {
      useWorkspace.setState({
        tabs: {
          [workspaceTab.id]: workspaceTab,
          [portfolioTab.id]: portfolioTab,
        },
        tree: {
          kind: 'leaf',
          group: {
            id: 'g1',
            tabIds: [workspaceTab.id, portfolioTab.id],
            activeTabId: workspaceTab.id,
          },
        },
        focusedGroupId: 'g1',
        selectedSidebar: 'chat',
      })
    })

    expect(screen.getByTestId('view-content-workspace')).toBeTruthy()
    expect(screen.queryByTestId('view-content-portfolio')).toBeNull()
    expect(mocks.shellMounted).toHaveBeenCalledTimes(1)

    view.unmount()
    expect(mocks.shellUnmounted).toHaveBeenCalledTimes(1)
  })

  it('keeps the Ask Alice shell mounted across Session → file → Session navigation', async () => {
    // File viewer is active-only and shares the chat shell; the warm Workspace
    // frame stays mounted underneath while the file view uses the shared slot.
    const view = render(<TabHost />)

    await waitFor(() => expect(mocks.shellMounted).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('view-content-workspace').textContent).toBe('workspace')

    act(() => focus(fileTab.id))
    expect(screen.getByTestId('view-content-file-viewer').textContent).toBe('file-viewer')
    // Warm workspace shell + active file shell.
    expect(mocks.shellMounted).toHaveBeenCalledTimes(2)
    expect(mocks.shellUnmounted).not.toHaveBeenCalled()
    expect(screen.getByTestId('view-content-workspace')).toBeTruthy()

    act(() => focus(workspaceTab.id))
    expect(screen.getByTestId('view-content-workspace').textContent).toBe('workspace')
    expect(screen.queryByTestId('view-content-file-viewer')).toBeNull()

    view.unmount()
  })
})
