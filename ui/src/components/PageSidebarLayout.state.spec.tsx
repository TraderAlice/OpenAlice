// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels'

import { i18n } from '../i18n'

const resizableHarness = vi.hoisted(() => ({
  groupWidth: 941,
  navigatorSize: 312,
  navigatorCollapsed: false,
  onNavigatorResize: undefined as ((size: PanelSize) => void) | undefined,
  onLayoutChanged: undefined as ((layout: Record<string, number>) => void) | undefined,
}))

vi.mock('@/components/ui/resizable', async () => {
  const React = await import('react')

  function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
    if (typeof ref === 'function') ref(value)
    else if (ref) ref.current = value
  }

  function ResizablePanelGroup({
    children,
    id,
    elementRef,
    onLayoutChanged,
    onPointerDownCapture,
    onPointerUpCapture,
    onPointerCancelCapture,
  }: {
    children?: React.ReactNode
    id?: string
    elementRef?: React.Ref<HTMLDivElement>
    onLayoutChanged?: (layout: Record<string, number>) => void
    onPointerDownCapture?: React.PointerEventHandler<HTMLDivElement>
    onPointerUpCapture?: React.PointerEventHandler<HTMLDivElement>
    onPointerCancelCapture?: React.PointerEventHandler<HTMLDivElement>
  }) {
    resizableHarness.onLayoutChanged = onLayoutChanged
    return (
      <div
        ref={(element) => {
          if (element) {
            element.getBoundingClientRect = () => ({
              x: 0,
              y: 0,
              width: resizableHarness.groupWidth,
              height: 800,
              top: 0,
              right: resizableHarness.groupWidth,
              bottom: 800,
              left: 0,
              toJSON: () => ({}),
            })
          }
          assignRef(elementRef, element)
        }}
        data-testid={id}
        onPointerDownCapture={onPointerDownCapture}
        onPointerUpCapture={onPointerUpCapture}
        onPointerCancelCapture={onPointerCancelCapture}
      >
        {children}
      </div>
    )
  }

  function ResizablePanel({
    children,
    id,
    panelRef,
    onResize,
  }: {
    children?: React.ReactNode
    id?: string
    panelRef?: React.Ref<PanelImperativeHandle>
    onResize?: (size: PanelSize) => void
  }) {
    const isNavigator = id?.endsWith('-navigator') === true
    if (isNavigator) resizableHarness.onNavigatorResize = onResize

    React.useImperativeHandle(panelRef, () => ({
      collapse() {
        resizableHarness.navigatorCollapsed = true
        resizableHarness.navigatorSize = 44
        onResize?.({ asPercentage: 4.4, inPixels: 44 })
      },
      expand() {
        resizableHarness.navigatorCollapsed = false
        resizableHarness.navigatorSize = Math.max(200, resizableHarness.navigatorSize)
        onResize?.({
          asPercentage: resizableHarness.navigatorSize / 10,
          inPixels: resizableHarness.navigatorSize,
        })
      },
      getSize() {
        return {
          asPercentage: resizableHarness.navigatorSize / 10,
          inPixels: resizableHarness.navigatorSize,
        }
      },
      isCollapsed() {
        return resizableHarness.navigatorCollapsed
      },
      resize(nextSize) {
        const parsed = typeof nextSize === 'number' ? nextSize : Number.parseFloat(nextSize)
        if (!Number.isFinite(parsed)) return
        resizableHarness.navigatorSize = parsed
        resizableHarness.navigatorCollapsed = parsed <= 45
        onResize?.({ asPercentage: parsed / 10, inPixels: parsed })
      },
    }), [onResize])

    return <div data-testid={id}>{children}</div>
  }

  function ResizableHandle({
    id,
    elementRef,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    id?: string
    elementRef?: React.Ref<HTMLDivElement>
  }) {
    return (
      <div
        {...props}
        ref={(element) => {
          if (element) {
            element.getBoundingClientRect = () => ({
              x: resizableHarness.navigatorSize,
              y: 0,
              width: 1,
              height: 800,
              top: 0,
              right: resizableHarness.navigatorSize + 1,
              bottom: 800,
              left: resizableHarness.navigatorSize,
              toJSON: () => ({}),
            })
          }
          assignRef(elementRef, element)
        }}
        id={id}
        data-testid={id}
        role="separator"
        tabIndex={0}
      />
    )
  }

  return { ResizableHandle, ResizablePanel, ResizablePanelGroup }
})

import { PageSidebarLayout } from './PageSidebarLayout'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function driveNavigatorGeometry(inPixels: number, collapsed: boolean) {
  resizableHarness.navigatorSize = inPixels
  resizableHarness.navigatorCollapsed = collapsed
  act(() => {
    resizableHarness.onNavigatorResize?.({
      asPercentage: inPixels / 10,
      inPixels,
    })
  })
}

function settleNavigatorLayout(inPixels: number) {
  const percentage = (inPixels / (resizableHarness.groupWidth - 1)) * 100
  act(() => resizableHarness.onLayoutChanged?.({
    'page-sidebar-market-navigator': percentage,
    'page-sidebar-market-content': 100 - percentage,
  }))
}

beforeEach(async () => {
  resizableHarness.navigatorSize = 312
  resizableHarness.navigatorCollapsed = false
  resizableHarness.onNavigatorResize = undefined
  resizableHarness.onLayoutChanged = undefined
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

describe('PageSidebarLayout applied state', () => {
  it('derives the interactive surface from panel geometry without overwriting width preference', async () => {
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '312')
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    driveNavigatorGeometry(44, true)
    await waitFor(() => {
      expect(screen.getByTestId('page-sidebar-desktop').getAttribute('data-state')).toBe('collapsed')
    })
    expect(screen.getByTestId('page-sidebar-expanded').hasAttribute('inert')).toBe(true)
    expect(screen.getByTestId('page-sidebar-collapsed').hasAttribute('inert')).toBe(false)
    expect(window.localStorage.getItem('openalice.page-sidebar-collapsed.market.v1')).toBe('1')
    expect(window.localStorage.getItem('openalice.page-sidebar-width.market.v1')).toBe('312')

    driveNavigatorGeometry(220, false)
    await waitFor(() => {
      expect(screen.getByTestId('page-sidebar-desktop').getAttribute('data-state')).toBe('expanded')
    })
    expect(screen.getByTestId('page-sidebar-expanded').hasAttribute('inert')).toBe(false)
    expect(screen.getByTestId('page-sidebar-collapsed').hasAttribute('inert')).toBe(true)
    expect(window.localStorage.getItem('openalice.page-sidebar-collapsed.market.v1')).toBe('0')
    expect(window.localStorage.getItem('openalice.page-sidebar-width.market.v1')).toBe('312')
  })

  it('captures resize intent from a neighboring panel inside the enlarged hit region', () => {
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '312')
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    const contentPanel = screen.getByTestId('page-sidebar-market-content')
    fireEvent.pointerDown(contentPanel, {
      button: 0,
      buttons: 1,
      clientX: 315,
      isPrimary: true,
      pointerId: 7,
      pointerType: 'mouse',
    })
    driveNavigatorGeometry(268, false)
    settleNavigatorLayout(268)

    expect(window.localStorage.getItem('openalice.page-sidebar-width.market.v1')).toBe('268')
    expect(window.localStorage.getItem('openalice.page-sidebar-collapsed.market.v1')).not.toBe('1')
  })

  it('captures coarse-pointer resize intent from the navigator side of the separator', () => {
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '312')
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    fireEvent.pointerDown(screen.getByTestId('page-sidebar-market-navigator'), {
      button: 0,
      buttons: 1,
      clientX: 300,
      isPrimary: true,
      pointerId: 12,
      pointerType: 'touch',
    })
    driveNavigatorGeometry(276, false)
    settleNavigatorLayout(276)

    expect(window.localStorage.getItem('openalice.page-sidebar-width.market.v1')).toBe('276')
  })

  it('does not persist a passive responsive cap or a pointer click without resize', () => {
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '312')
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    driveNavigatorGeometry(200, false)
    settleNavigatorLayout(200)
    expect(window.localStorage.getItem('openalice.page-sidebar-width.market.v1')).toBe('312')

    const contentPanel = screen.getByTestId('page-sidebar-market-content')
    const group = screen.getByTestId('page-sidebar-market')
    fireEvent.pointerDown(contentPanel, {
      button: 0,
      buttons: 1,
      clientX: 700,
      isPrimary: true,
      pointerId: 8,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(group, {
      button: 0,
      buttons: 0,
      isPrimary: true,
      pointerId: 8,
      pointerType: 'mouse',
    })
    expect(window.localStorage.getItem('openalice.page-sidebar-width.market.v1')).toBe('312')
  })

  it('persists the settled keyboard layout instead of the previous painted width', () => {
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '247')
    resizableHarness.navigatorSize = 247
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })
    // The primitive has settled its internal layout at 294px, but the browser
    // has not painted that flex width yet and the imperative handle still reads
    // the previous 247px DOM width.
    settleNavigatorLayout(294)

    expect(resizableHarness.navigatorSize).toBe(247)
    expect(window.localStorage.getItem('openalice.page-sidebar-width.market.v1')).toBe('294')
  })

  it('keeps the last expanded width when a pointer resize settles collapsed', () => {
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '312')
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    fireEvent.pointerDown(screen.getByTestId('page-sidebar-market-content'), {
      button: 0,
      buttons: 1,
      clientX: 315,
      isPrimary: true,
      pointerId: 9,
      pointerType: 'mouse',
    })
    driveNavigatorGeometry(44, true)
    settleNavigatorLayout(44)

    expect(screen.getByTestId('page-sidebar-desktop').getAttribute('data-state')).toBe('collapsed')
    expect(window.localStorage.getItem('openalice.page-sidebar-collapsed.market.v1')).toBe('1')
    expect(window.localStorage.getItem('openalice.page-sidebar-width.market.v1')).toBe('312')
  })
})
