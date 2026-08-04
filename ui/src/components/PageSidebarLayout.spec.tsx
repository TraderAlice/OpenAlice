// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMobilePageNavigation, MobilePageNavigationProvider } from '../contexts/MobilePageNavigationContext'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { PageSidebarLayout } from './PageSidebarLayout'

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

describe('PageSidebarLayout', () => {
  it('registers its phone navigator into the app context bar without rendering a second bar', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))

    function ContextTrigger() {
      const navigation = useMobilePageNavigation()
      if (!navigation) return null
      return (
        <button
          ref={navigation.triggerRef}
          type="button"
          onClick={navigation.open}
          aria-controls={navigation.controlsId}
        >
          Context {navigation.title}
        </button>
      )
    }

    render(
      <MobilePageNavigationProvider>
        <ContextTrigger />
        <PageSidebarLayout storageKey="inbox" title="Inbox" sidebar={<div>Inbox navigation</div>}>
          <div>Inbox message</div>
        </PageSidebarLayout>
      </MobilePageNavigationProvider>,
    )

    expect(screen.queryByRole('button', { name: 'Open Inbox' })).toBeNull()
    const contextTrigger = screen.getByRole('button', { name: 'Context Inbox' })
    expect(contextTrigger.getAttribute('aria-controls')).toBeTruthy()
    expect(screen.queryByTestId('page-sidebar-drawer')).toBeNull()

    await user.click(contextTrigger)
    const drawer = screen.getByTestId('page-sidebar-drawer')
    expect(contextTrigger.getAttribute('aria-controls')).toBe(drawer.id)
    expect(drawer.hasAttribute('data-open')).toBe(true)
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('page-sidebar-drawer')).toBeNull()
    expect(document.activeElement).toBe(contextTrigger)
  })

  it('persists the desktop focus mode and restores the full sidebar', () => {
    const view = render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    const desktopSidebar = screen.getByTestId('page-sidebar-desktop')
    const expandedSurface = screen.getByTestId('page-sidebar-expanded')
    const collapsedSurface = screen.getByTestId('page-sidebar-collapsed')
    expect(desktopSidebar.getAttribute('data-state')).toBe('expanded')
    expect(desktopSidebar.getAttribute('style')).toContain('width: 270px')
    expect(desktopSidebar.className).toContain('transition-[width]')
    expect(desktopSidebar.className).toContain('motion-reduce:transition-none')
    expect(expandedSurface.hasAttribute('inert')).toBe(false)
    expect(collapsedSurface.hasAttribute('inert')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Market' }))
    expect(window.localStorage.getItem('openalice.page-sidebar-collapsed.market.v1')).toBe('1')
    expect(desktopSidebar.getAttribute('data-state')).toBe('collapsed')
    expect(desktopSidebar.getAttribute('style')).toContain('width: 44px')
    expect(expandedSurface.hasAttribute('inert')).toBe(true)
    expect(collapsedSurface.hasAttribute('inert')).toBe(false)
    expect(screen.getByRole('button', { name: 'Open Market' })).toBeTruthy()

    view.unmount()
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )
    expect(screen.getByRole('button', { name: 'Open Market' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open Market' }))
    expect(window.localStorage.getItem('openalice.page-sidebar-collapsed.market.v1')).toBe('0')
    expect(screen.getByTestId('page-sidebar-desktop').getAttribute('data-state')).toBe('expanded')
    expect(screen.getByTestId('page-sidebar-expanded').hasAttribute('inert')).toBe(false)
    expect(screen.getByText('Market navigation')).toBeTruthy()
  })

  it('lets a phone sidebar selection close the navigation drawer', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))

    render(
      <PageSidebarLayout
        storageKey="inbox"
        title="Inbox"
        sidebar={({ closeMobileDrawer }) => (
          <button type="button" onClick={closeMobileDrawer}>Select message</button>
        )}
      >
        <div>Inbox message</div>
      </PageSidebarLayout>,
    )

    const opener = screen.getByRole('button', { name: 'Open Inbox' })
    expect(screen.queryByTestId('page-sidebar-drawer')).toBeNull()
    expect(opener.getAttribute('aria-expanded')).toBe('false')
    expect(opener.getAttribute('aria-controls')).toBeTruthy()
    expect(opener.getAttribute('aria-haspopup')).toBe('dialog')

    await user.click(opener)
    const drawer = screen.getByTestId('page-sidebar-drawer')
    expect(drawer.hasAttribute('data-open')).toBe(true)
    expect(opener.getAttribute('aria-controls')).toBe(drawer.id)
    expect(drawer.getAttribute('role')).toBe('dialog')
    expect(drawer.getAttribute('aria-modal')).toBe('true')
    expect(opener.getAttribute('aria-expanded')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close Inbox' })))
    expect(screen.getByText('Inbox message').closest('[inert]')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Select message' }))
    expect(screen.queryByTestId('page-sidebar-drawer')).toBeNull()
    expect(opener.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(opener)
    expect(screen.getByText('Inbox message').closest('[inert]')).toBeNull()
  })

  it('contains phone drawer focus and closes on Escape', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))

    render(
      <PageSidebarLayout
        storageKey="tracked"
        title="Tracked"
        sidebar={(
          <>
            <button type="button">First item</button>
            <button type="button" aria-current="page">Current item</button>
            <button type="button">Last item</button>
          </>
        )}
      >
        <button type="button">Background action</button>
      </PageSidebarLayout>,
    )

    const opener = screen.getByRole('button', { name: 'Open Tracked' })
    await user.click(opener)

    const close = screen.getByRole('button', { name: 'Close Tracked' })
    const current = screen.getByRole('button', { name: 'Current item' })
    const last = screen.getByRole('button', { name: 'Last item' })
    await waitFor(() => expect(document.activeElement).toBe(current))

    last.focus()
    await user.tab()
    await waitFor(() => expect(document.activeElement).toBe(close))

    close.focus()
    await user.tab({ shift: true })
    await waitFor(() => expect(document.activeElement).toBe(last))

    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('page-sidebar-drawer')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('keeps a page navigator in the drawer below its custom desktop breakpoint', async () => {
    const user = userEvent.setup()
    render(
      <PageSidebarLayout
        storageKey="settings"
        title="Settings"
        desktopMinWidth={960}
        sidebar={({ closeMobileDrawer }) => (
          <button type="button" onClick={closeMobileDrawer}>Select General</button>
        )}
      >
        <div>Settings content</div>
      </PageSidebarLayout>,
    )

    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 960px)')
    expect(screen.queryByTestId('page-sidebar-drawer')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Open Settings' }))
    const drawer = screen.getByTestId('page-sidebar-drawer')
    expect(drawer.hasAttribute('data-open')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Select General' }))
    expect(screen.queryByTestId('page-sidebar-drawer')).toBeNull()
  })
})
