// @vitest-environment jsdom

import { useRef } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MobilePageNavigationProvider,
  useMobilePageNavigation,
  useRegisterMobilePageNavigation,
} from './MobilePageNavigationContext'

afterEach(cleanup)

function Owner({ title }: { title: string }) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  useRegisterMobilePageNavigation({
    title,
    controlsId: `${title}-drawer`,
    expanded: false,
    triggerRef,
    open: noop,
    close: noop,
  }, true)
  return null
}

function noop() {}

function CurrentOwner() {
  const navigation = useMobilePageNavigation()
  return <span>{navigation?.title ?? 'none'}</span>
}

describe('MobilePageNavigationProvider', () => {
  it('does not let an old owner cleanup erase the current page registration', () => {
    const view = render(
      <MobilePageNavigationProvider>
        <CurrentOwner />
        <Owner title="Inbox" />
      </MobilePageNavigationProvider>,
    )
    expect(screen.getByText('Inbox')).toBeTruthy()

    view.rerender(
      <MobilePageNavigationProvider>
        <CurrentOwner />
        <Owner title="Inbox" />
        <Owner title="Tracked" />
      </MobilePageNavigationProvider>,
    )
    expect(screen.getByText('Tracked')).toBeTruthy()

    view.rerender(
      <MobilePageNavigationProvider>
        <CurrentOwner />
        <Owner title="Tracked" />
      </MobilePageNavigationProvider>,
    )
    expect(screen.getByText('Tracked')).toBeTruthy()
  })
})
