// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UrlAdopter } from './UrlAdopter'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
  setSidebar: vi.fn(),
}))

const emptyState = {
  tabs: {},
  tree: {
    kind: 'leaf' as const,
    group: { id: 'g1', tabIds: [], activeTabId: null },
  },
  openOrFocus: mocks.openOrFocus,
  setSidebar: mocks.setSidebar,
}

vi.mock('./store', () => {
  const useWorkspace = Object.assign(
    (selector: (state: typeof emptyState) => unknown) => selector(emptyState),
    { getState: () => emptyState },
  )
  return { useWorkspace }
})

vi.mock('./registry', () => ({
  getView: vi.fn(),
}))

vi.mock('../hooks/useAliceProject', () => ({
  useAliceProject: () => ({
    project: { product: 'trader' },
    loading: false,
    error: null,
    refresh: async () => undefined,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('UrlAdopter file provenance', () => {
  it('restores an Auto Prediction file deep link with its Session return context', async () => {
    render(
      <MemoryRouter initialEntries={[
        '/prediction/workspaces/prediction-1/view/evidence%2Fmarket.md?sessionId=codex-forecast',
      ]}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'file-viewer',
      params: {
        wsId: 'prediction-1',
        path: 'evidence/market.md',
        source: 'prediction',
        returnSessionId: 'codex-forecast',
      },
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('prediction')
  })

  it('restores an Ask Alice file deep link with its Session return context', async () => {
    render(
      <MemoryRouter initialEntries={[
        '/chat/workspaces/chat-1/view/research%2Fnote.md?sessionId=pi-crisp-granite-pencil',
      ]}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'file-viewer',
      params: {
        wsId: 'chat-1',
        path: 'research/note.md',
        source: 'chat',
        returnSessionId: 'pi-crisp-granite-pencil',
      },
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('chat')
  })

  it('keeps legacy Workspace file deep links in Workspaces', async () => {
    render(
      <MemoryRouter initialEntries={['/workspaces/workspace-1/view/README.md']}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'file-viewer',
      params: { wsId: 'workspace-1', path: 'README.md' },
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('workspaces')
  })

  it('restores a Tracked file deep link with its entity return context', async () => {
    render(
      <MemoryRouter initialEntries={[
        '/tracked/files/workspace-1/research%2Fpower.md?entity=stock-vst',
      ]}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'file-viewer',
      params: {
        wsId: 'workspace-1',
        path: 'research/power.md',
        source: 'tracked',
        returnTrackedName: 'stock-vst',
      },
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('tracked')
  })
})

describe('UrlAdopter Auto Prediction', () => {
  it('adopts the managed Prediction Studio route', async () => {
    render(
      <MemoryRouter initialEntries={['/prediction/workspaces/prediction-1/studio']}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'harness-surface',
      params: { wsId: 'prediction-1', capability: 'studio', source: 'prediction' },
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('prediction')
  })

  it('adopts the Prediction landing route', async () => {
    render(
      <MemoryRouter initialEntries={['/prediction']}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'auto-prediction-landing',
      params: {},
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('prediction')
  })
})

describe('UrlAdopter Settings Harness', () => {
  it('adopts the Harness settings category from /settings/harness', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/harness']}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'settings',
      params: { category: 'harness' },
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('settings')
  })
})

describe('UrlAdopter Settings Agent runtimes', () => {
  it('adopts the Agent runtimes settings category from /settings/agent-runtimes', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/agent-runtimes']}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'settings',
      params: { category: 'agent-runtimes' },
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('settings')
  })
})

describe('UrlAdopter Settings Beta', () => {
  it('adopts the Beta settings category from /settings/beta', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/beta']}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'settings',
      params: { category: 'beta' },
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('settings')
  })
})

describe('UrlAdopter Office occupancy', () => {
  it('adopts the Office surface from /office', async () => {
    render(
      <MemoryRouter initialEntries={['/office']}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'office',
      params: {},
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('office')
  })

  it('redirects the retired Automation Runtime route to Office', async () => {
    render(
      <MemoryRouter initialEntries={['/automation/runtime']}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'office',
      params: {},
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('office')
  })
})

describe('UrlAdopter Tracked selection', () => {
  it('restores a Workspace Issue from query parameters', async () => {
    render(
      <MemoryRouter initialEntries={[
        '/tracked?workspace=workspace-1&issue=power-watch',
      ]}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'tracked',
      params: { workspace: 'workspace-1', issue: 'power-watch' },
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('tracked')
  })
})

describe('UrlAdopter Market News', () => {
  it('adopts News under Market from /market/news', async () => {
    render(
      <MemoryRouter initialEntries={['/market/news']}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'news',
      params: {},
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('market')
  })

  it('redirects the retired /news rail route into Market', async () => {
    render(
      <MemoryRouter initialEntries={['/news']}>
        <UrlAdopter />
      </MemoryRouter>,
    )

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'news',
      params: {},
    }))
    expect(mocks.setSidebar).toHaveBeenCalledWith('market')
  })
})
