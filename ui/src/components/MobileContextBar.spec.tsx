// @vitest-environment jsdom

import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { MobileContextBar } from './MobileContextBar'

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('MobileContextBar', () => {
  it('keeps the global entry and adds the current page navigator in one bar', () => {
    const openRail = vi.fn()
    const closeRail = vi.fn()
    const openPage = vi.fn()
    const closePage = vi.fn()

    render(
      <MobileContextBar
        railOpen={false}
        railTriggerRef={createRef<HTMLButtonElement>()}
        pageNavigation={{
          title: 'Inbox',
          controlsId: 'inbox-drawer',
          expanded: false,
          triggerRef: createRef<HTMLButtonElement>(),
          open: openPage,
          close: closePage,
        }}
        openRail={openRail}
        closeRail={closeRail}
      />,
    )

    const bar = screen.getByTestId('mobile-context-bar')
    expect(bar.className).toContain('h-12')
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.getByText('Inbox')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Expand activity bar' }))
    expect(closePage).toHaveBeenCalledOnce()
    expect(openRail).toHaveBeenCalledOnce()

    const pageButton = screen.getByRole('button', { name: 'Open Inbox' })
    expect(pageButton.getAttribute('aria-controls')).toBe('inbox-drawer')
    expect(pageButton.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.click(pageButton)
    expect(closeRail).toHaveBeenCalledOnce()
    expect(openPage).toHaveBeenCalledOnce()
  })

  it('falls back to the product identity when the page has no navigator', () => {
    render(
      <MobileContextBar
        railOpen={false}
        railTriggerRef={createRef<HTMLButtonElement>()}
        pageNavigation={null}
        openRail={vi.fn()}
        closeRail={vi.fn()}
      />,
    )

    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByText('OpenAlice')).toBeTruthy()
  })
})
