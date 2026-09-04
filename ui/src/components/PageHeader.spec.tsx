// @vitest-environment jsdom

import { StrictMode, createContext, useContext, useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PageHeader } from './PageHeader'
import { PageContentLayout, PageTopBar } from './PageTopBar'
import { PrimaryNavigationContext } from '../contexts/PrimaryNavigationContext'

afterEach(cleanup)

describe('shared page toolbar', () => {
  it('keeps exactly one shell control through fallback and page-header handoff', () => {
    function View({ loaded }: { loaded: boolean }) {
      return <PrimaryNavigationContext.Provider value={<button>Toggle navigation</button>}>
        <PageContentLayout title="Loading">
          {loaded && <PageTopBar title="Page" />}
        </PageContentLayout>
      </PrimaryNavigationContext.Provider>
    }
    const view = render(<View loaded={false} />)
    expect(screen.getAllByRole('button', { name: 'Toggle navigation' })).toHaveLength(1)
    view.rerender(<View loaded />)
    expect(screen.getAllByRole('button', { name: 'Toggle navigation' })).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Loading' })).toBeNull()
  })
  it('keeps title/actions in the compact row and description outside it', () => {
    const { container } = render(<PageHeader title="Portfolio" description="Across accounts" right={<button>Refresh</button>} />)
    const bar = container.querySelector('[data-slot="page-topbar"]') as HTMLElement
    expect(within(bar).getByRole('heading', { name: 'Portfolio' })).toBeTruthy()
    expect(within(bar).getByRole('button', { name: 'Refresh' })).toBeTruthy()
    expect(within(bar).queryByText('Across accounts')).toBeNull()
    expect(screen.getByText('Across accounts')).toBeTruthy()
  })

  it('projects page actions into the fixed layout without losing context or local state', () => {
    const Label = createContext('wrong context')
    function Action() {
      const label = useContext(Label)
      const [count, setCount] = useState(0)
      return <button onClick={() => setCount(count + 1)}>{label} {count}</button>
    }
    const { container } = render(
      <StrictMode>
        <PageContentLayout title="Trading" leading={<button>Open Trading</button>}>
          <Label.Provider value="Refresh"><div data-testid="body">
            <PageHeader title="Portfolio" right={<Action />} />
            Contents
          </div></Label.Provider>
        </PageContentLayout>
      </StrictMode>,
    )
    const bar = container.querySelector('.oa-topbar-host') as HTMLElement
    expect(within(bar).getByRole('heading', { name: 'Portfolio' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Trading' })).toBeNull()
    expect(within(screen.getByTestId('body')).queryByRole('heading')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Open Trading' })).toHaveLength(1)
    fireEvent.click(within(bar).getByRole('button', { name: 'Refresh 0' }))
    expect(within(bar).getByRole('button', { name: 'Refresh 1' })).toBeTruthy()
  })

  it('removes stale actions and restores the fallback when the next page has no header', () => {
    function View({ page }: { page: boolean }) {
      return <PageContentLayout title="Chat" leading={<button>Open Chat</button>}>
        {page ? <PageTopBar title="Session" actions={<button>Files</button>} /> : <p>Start a conversation</p>}
      </PageContentLayout>
    }
    const view = render(<View page />)
    expect(screen.getByRole('button', { name: 'Files' })).toBeTruthy()
    view.rerender(<View page={false} />)
    expect(screen.queryByRole('button', { name: 'Files' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Open Chat' })).toHaveLength(1)
    view.rerender(<View page />)
    expect(screen.queryByRole('heading', { name: 'Chat' })).toBeNull()
    expect(screen.getAllByRole('heading', { name: 'Session' })).toHaveLength(1)
  })
})
