import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  it('persists the desktop focus mode and restores the full sidebar', () => {
    const view = render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Market' }))
    expect(window.localStorage.getItem('openalice.page-sidebar-collapsed.market.v1')).toBe('1')
    expect(screen.getByRole('button', { name: 'Open Market' })).toBeTruthy()
    expect(screen.queryByText('Market navigation')).toBeNull()

    view.unmount()
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )
    expect(screen.getByRole('button', { name: 'Open Market' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open Market' }))
    expect(window.localStorage.getItem('openalice.page-sidebar-collapsed.market.v1')).toBe('0')
    expect(screen.getByText('Market navigation')).toBeTruthy()
  })
})
