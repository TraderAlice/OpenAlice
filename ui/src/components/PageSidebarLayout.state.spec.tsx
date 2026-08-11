// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels'

import { i18n } from '../i18n'

const resizableHarness = vi.hoisted(() => ({
  groupWidth: 941,
  navigatorSize: 312,
  paintedNavigatorSize: null as number | null,
  navigatorCollapsed: false,
  navigatorCollapsible: true,
  collapseCalls: 0,
  expandCalls: 0,
  resizeCalls: 0,
  groupMounts: 0,
  navigatorMounts: 0,
  navigatorDefaultSizes: [] as number[],
  onNavigatorResize: undefined as ((size: PanelSize) => void) | undefined,
  onLayoutChanged: undefined as ((layout: Record<string, number>) => void) | undefined,
}))

const resizeObserverHarness = vi.hoisted(() => ({
  instances: [] as Array<{
    callback: ResizeObserverCallback
    elements: Element[]
  }>,
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
    onPointerMoveCapture,
    onPointerUpCapture,
    onPointerCancelCapture,
  }: {
    children?: React.ReactNode
    id?: string
    elementRef?: React.Ref<HTMLDivElement>
    onLayoutChanged?: (layout: Record<string, number>) => void
    onPointerDownCapture?: React.PointerEventHandler<HTMLDivElement>
    onPointerMoveCapture?: React.PointerEventHandler<HTMLDivElement>
    onPointerUpCapture?: React.PointerEventHandler<HTMLDivElement>
    onPointerCancelCapture?: React.PointerEventHandler<HTMLDivElement>
  }) {
    resizableHarness.onLayoutChanged = onLayoutChanged
    React.useEffect(() => {
      resizableHarness.groupMounts++
    }, [])
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
        onPointerMoveCapture={onPointerMoveCapture}
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
    elementRef,
    defaultSize,
    onResize,
    collapsible,
    'data-page-sidebar-panel': pageSidebarPanel,
  }: {
    children?: React.ReactNode
    id?: string
    panelRef?: React.Ref<PanelImperativeHandle>
    elementRef?: React.Ref<HTMLDivElement>
    defaultSize?: number
    onResize?: (size: PanelSize) => void
    collapsible?: boolean
    'data-page-sidebar-panel'?: string
  }) {
    const isNavigator = id?.endsWith('-navigator') === true
    if (isNavigator) {
      resizableHarness.onNavigatorResize = onResize
      resizableHarness.navigatorCollapsible = collapsible ?? false
    }

    React.useEffect(() => {
      if (isNavigator && typeof defaultSize === 'number') {
        resizableHarness.navigatorMounts++
        if (resizableHarness.navigatorMounts > 1) {
          resizableHarness.paintedNavigatorSize = null
        }
        resizableHarness.navigatorDefaultSizes.push(defaultSize)
      }
    }, [defaultSize, isNavigator])

    React.useImperativeHandle(panelRef, () => ({
      collapse() {
        resizableHarness.collapseCalls++
        resizableHarness.navigatorCollapsed = true
        resizableHarness.navigatorSize = 44
        onResize?.({ asPercentage: 4.4, inPixels: 44 })
      },
      expand() {
        resizableHarness.expandCalls++
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
        resizableHarness.resizeCalls++
        const parsed = typeof nextSize === 'number' ? nextSize : Number.parseFloat(nextSize)
        if (!Number.isFinite(parsed)) return
        const applied = isNavigator && resizableHarness.navigatorCollapsible && parsed < 200
          ? 44
          : parsed
        resizableHarness.navigatorSize = applied
        resizableHarness.navigatorCollapsed = applied <= 45
        onResize?.({ asPercentage: applied / 10, inPixels: applied })
      },
    }), [onResize])

    return (
      <div
        ref={(element) => {
          if (element) {
            element.getBoundingClientRect = () => {
              const paintedNavigatorSize = resizableHarness.paintedNavigatorSize ?? resizableHarness.navigatorSize
              const width = isNavigator
                ? paintedNavigatorSize
                : Math.max(0, resizableHarness.groupWidth - 1 - paintedNavigatorSize)
              const left = isNavigator ? 0 : paintedNavigatorSize + 1
              return {
                x: left,
                y: 0,
                width,
                height: 800,
                top: 0,
                right: left + width,
                bottom: 800,
                left,
                toJSON: () => ({}),
              }
            }
          }
          assignRef(elementRef, element)
        }}
        data-testid={id}
        data-page-sidebar-panel={pageSidebarPanel}
      >
        {children}
      </div>
    )
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
  private readonly record: {
    callback: ResizeObserverCallback
    elements: Element[]
  }

  constructor(callback: ResizeObserverCallback) {
    this.record = { callback, elements: [] }
    resizeObserverHarness.instances.push(this.record)
  }

  observe(element: Element) {
    this.record.elements.push(element)
  }

  unobserve(element: Element) {
    this.record.elements = this.record.elements.filter((candidate) => candidate !== element)
  }

  disconnect() {
    this.record.elements = []
  }
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

function notifyPaintedPanelResize() {
  const navigator = screen.getByTestId('page-sidebar-market-navigator')
  const content = screen.getByTestId('page-sidebar-market-content')
  const observer = resizeObserverHarness.instances.find(({ elements }) => (
    elements.includes(navigator) && elements.includes(content)
  ))
  if (!observer) throw new Error('Panel geometry ResizeObserver was not registered')
  act(() => observer.callback([], {} as ResizeObserver))
}

beforeEach(async () => {
  resizableHarness.navigatorSize = 312
  resizableHarness.paintedNavigatorSize = null
  resizableHarness.navigatorCollapsed = false
  resizableHarness.navigatorCollapsible = true
  resizableHarness.collapseCalls = 0
  resizableHarness.expandCalls = 0
  resizableHarness.resizeCalls = 0
  resizableHarness.groupMounts = 0
  resizableHarness.navigatorMounts = 0
  resizableHarness.navigatorDefaultSizes = []
  resizableHarness.onNavigatorResize = undefined
  resizableHarness.onLayoutChanged = undefined
  resizeObserverHarness.instances = []
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
  vi.restoreAllMocks()
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

  it('resists pointer overdrag and springs back before the commit boundary', () => {
    resizableHarness.navigatorSize = 200
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '200')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    const group = screen.getByTestId('page-sidebar-market')
    const handle = screen.getByRole('separator')
    fireEvent.pointerDown(handle, {
      button: 0,
      buttons: 1,
      clientX: 200,
      isPrimary: true,
      pointerId: 14,
      pointerType: 'mouse',
    })
    expect(resizableHarness.navigatorCollapsible).toBe(true)

    fireEvent.pointerMove(group, {
      buttons: 1,
      clientX: 160,
      isPrimary: true,
      pointerId: 14,
      pointerType: 'mouse',
    })
    expect(group.getAttribute('data-overdrag-state')).toBe('resisting')
    expect(Number.parseFloat(group.style.getPropertyValue('--oa-page-sidebar-overdrag'))).toBeCloseTo(22.14, 1)

    fireEvent.pointerUp(group, {
      button: 0,
      buttons: 0,
      clientX: 160,
      isPrimary: true,
      pointerId: 14,
      pointerType: 'mouse',
    })
    expect(group.getAttribute('data-overdrag-motion')).toBe('returning')
    expect(group.style.getPropertyValue('--oa-page-sidebar-overdrag')).toBe('0px')
    expect(screen.getByTestId('page-sidebar-desktop').getAttribute('data-state')).toBe('expanded')
    expect(window.localStorage.getItem('openalice.page-sidebar-collapsed.market.v1')).not.toBe('1')
  })

  it('captures the active pointer so an outside release cannot strand gesture state', () => {
    resizableHarness.navigatorSize = 200
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '200')
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    const group = screen.getByTestId('page-sidebar-market')
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    group.setPointerCapture = setPointerCapture
    group.hasPointerCapture = vi.fn(() => true)
    group.releasePointerCapture = releasePointerCapture

    fireEvent.pointerDown(screen.getByRole('separator'), {
      button: 0,
      buttons: 1,
      clientX: 200,
      isPrimary: true,
      pointerId: 41,
      pointerType: 'mouse',
    })
    expect(setPointerCapture).toHaveBeenCalledWith(41)

    fireEvent.pointerUp(group, {
      buttons: 0,
      clientX: -40,
      isPrimary: true,
      pointerId: 41,
      pointerType: 'mouse',
    })
    expect(releasePointerCapture).toHaveBeenCalledWith(41)
  })

  it('keeps resistance when a new drag interrupts the previous spring', () => {
    vi.useFakeTimers()
    resizableHarness.navigatorSize = 200
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '200')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    const group = screen.getByTestId('page-sidebar-market')
    const handle = screen.getByRole('separator')
    fireEvent.pointerDown(handle, {
      button: 0,
      buttons: 1,
      clientX: 200,
      isPrimary: true,
      pointerId: 30,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(group, {
      buttons: 1,
      clientX: 160,
      isPrimary: true,
      pointerId: 30,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(group, {
      buttons: 0,
      clientX: 160,
      isPrimary: true,
      pointerId: 30,
      pointerType: 'mouse',
    })
    act(() => vi.advanceTimersByTime(50))

    fireEvent.pointerDown(handle, {
      button: 0,
      buttons: 1,
      clientX: 200,
      isPrimary: true,
      pointerId: 31,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(group, {
      buttons: 1,
      clientX: 155,
      isPrimary: true,
      pointerId: 31,
      pointerType: 'mouse',
    })
    act(() => vi.advanceTimersByTime(350))

    expect(group.getAttribute('data-overdrag-state')).toBe('resisting')
    expect(Number.parseFloat(group.style.getPropertyValue('--oa-page-sidebar-overdrag'))).toBeCloseTo(23.6, 1)
    vi.useRealTimers()
  })

  it('keeps collapse motion cursor-attached when a held drag reverses direction', () => {
    vi.useFakeTimers()
    resizableHarness.navigatorSize = 200
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '200')
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    const group = screen.getByTestId('page-sidebar-market')
    fireEvent.pointerDown(screen.getByRole('separator'), {
      button: 0,
      buttons: 1,
      clientX: 200,
      isPrimary: true,
      pointerId: 42,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(group, {
      buttons: 1,
      clientX: 110,
      isPrimary: true,
      pointerId: 42,
      pointerType: 'mouse',
    })
    expect(group.getAttribute('data-collapse-motion')).toBe('armed')

    act(() => vi.advanceTimersByTime(400))
    expect(group.getAttribute('data-collapse-motion')).toBe('armed')

    fireEvent.pointerMove(group, {
      buttons: 1,
      clientX: 160,
      isPrimary: true,
      pointerId: 42,
      pointerType: 'mouse',
    })
    expect(group.getAttribute('data-collapse-motion')).toBeNull()
    expect(group.getAttribute('data-overdrag-state')).toBe('resisting')

    fireEvent.pointerUp(group, {
      buttons: 0,
      clientX: 160,
      isPrimary: true,
      pointerId: 42,
      pointerType: 'mouse',
    })
    vi.useRealTimers()
  })

  it('commits collapse only after deliberate pointer overdrag', async () => {
    resizableHarness.navigatorSize = 200
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '200')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    const group = screen.getByTestId('page-sidebar-market')
    fireEvent.pointerDown(screen.getByRole('separator'), {
      button: 0,
      buttons: 1,
      clientX: 200,
      isPrimary: true,
      pointerId: 15,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(group, {
      buttons: 1,
      clientX: 110,
      isPrimary: true,
      pointerId: 15,
      pointerType: 'mouse',
    })
    expect(group.getAttribute('data-overdrag-state')).toBe('armed')

    // react-resizable-panels owns the actual midpoint transition. Product
    // code observes that applied geometry but must not issue a second collapse
    // after pointer-up.
    driveNavigatorGeometry(44, true)

    fireEvent.pointerUp(group, {
      button: 0,
      buttons: 0,
      clientX: 110,
      isPrimary: true,
      pointerId: 15,
      pointerType: 'mouse',
    })
    expect(group.getAttribute('data-overdrag-motion')).toBe('committing')
    await waitFor(() => expect(resizableHarness.navigatorSize).toBe(44))
    expect(resizableHarness.collapseCalls).toBe(0)
    expect(screen.getByTestId('page-sidebar-desktop').getAttribute('data-state')).toBe('collapsed')
    expect(window.localStorage.getItem('openalice.page-sidebar-width.market.v1')).toBe('200')
  })

  it('cancels an armed overdrag without collapsing', () => {
    resizableHarness.navigatorSize = 200
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '200')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    const group = screen.getByTestId('page-sidebar-market')
    fireEvent.pointerDown(screen.getByRole('separator'), {
      button: 0,
      buttons: 1,
      clientX: 200,
      isPrimary: true,
      pointerId: 16,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(group, {
      buttons: 1,
      clientX: 130,
      isPrimary: true,
      pointerId: 16,
      pointerType: 'mouse',
    })
    expect(group.getAttribute('data-overdrag-state')).toBe('armed')

    fireEvent.pointerCancel(group, {
      buttons: 0,
      clientX: 130,
      isPrimary: true,
      pointerId: 16,
      pointerType: 'mouse',
    })
    expect(group.getAttribute('data-overdrag-motion')).toBe('returning')
    expect(resizableHarness.navigatorSize).toBe(200)
    expect(screen.getByTestId('page-sidebar-desktop').getAttribute('data-state')).toBe('expanded')
  })

  it('keeps keyboard collapse motion independent from pointer overdrag', () => {
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    const group = screen.getByTestId('page-sidebar-market')
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'Home' })
    expect(group.getAttribute('data-collapse-motion')).toBe('armed')
  })

  it('collapses immediately when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(min-width: 768px)' || query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame')
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    const resizeCallsBeforeCollapse = resizableHarness.resizeCalls
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Market' }))

    expect(requestAnimationFrame).not.toHaveBeenCalled()
    expect(screen.getByTestId('page-sidebar-desktop').getAttribute('data-state')).toBe('collapsed')
    expect(resizableHarness.navigatorSize).toBe(44)
    expect(resizableHarness.collapseCalls).toBe(0)
    expect(resizableHarness.resizeCalls).toBe(resizeCallsBeforeCollapse + 1)
  })

  it('uses one geometry transaction per repeated collapse and restore cycle', async () => {
    resizableHarness.navigatorSize = 312
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '312')
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    for (let cycle = 0; cycle < 8; cycle++) {
      fireEvent.click(screen.getByRole('button', { name: 'Collapse Market' }))
      await waitFor(() => {
        expect(screen.getByTestId('page-sidebar-desktop').getAttribute('data-state')).toBe('collapsed')
      })
      fireEvent.click(screen.getByRole('button', { name: 'Open Market' }))
      await waitFor(() => {
        expect(screen.getByTestId('page-sidebar-desktop').getAttribute('data-state')).toBe('expanded')
      })
      expect(resizableHarness.navigatorSize).toBe(312)
    }

    expect(resizableHarness.collapseCalls).toBe(0)
    expect(resizableHarness.expandCalls).toBe(0)
    expect(resizableHarness.resizeCalls).toBe(16)
    expect(resizableHarness.groupMounts).toBe(1)
    expect(resizableHarness.navigatorDefaultSizes).toEqual([312])
    expect(window.localStorage.getItem('openalice.page-sidebar-width.market.v1')).toBe('312')
  })

  it('does not reopen after a collapsed percentage arrives with stale painted pixels', () => {
    resizableHarness.navigatorSize = 312
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Market' }))
    expect(screen.getByTestId('page-sidebar-desktop').getAttribute('data-state')).toBe('collapsed')

    // The primitive commits its percentage before the flex item paints. The
    // callback can briefly pair the collapsed percentage with the previous
    // expanded offsetWidth; percentage geometry must remain authoritative.
    act(() => {
      resizableHarness.onNavigatorResize?.({
        asPercentage: (44 / (resizableHarness.groupWidth - 1)) * 100,
        inPixels: 312,
      })
    })

    expect(screen.getByTestId('page-sidebar-desktop').getAttribute('data-state')).toBe('collapsed')
  })

  it('repairs an impossible one-panel layout without persisting it', () => {
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '312')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    resizableHarness.navigatorSize = 940
    act(() => resizableHarness.onLayoutChanged?.({
      'page-sidebar-market-navigator': 100,
      'page-sidebar-market-content': 0,
    }))

    expect(resizableHarness.navigatorSize).toBe(312)
    expect(resizableHarness.resizeCalls).toBe(1)
    expect(window.localStorage.getItem('openalice.page-sidebar-width.market.v1')).toBe('312')
  })

  it('repairs a delayed impossible resize after the settled layout callback', () => {
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '312')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    driveNavigatorGeometry(940, false)

    expect(resizableHarness.navigatorSize).toBe(312)
    expect(resizableHarness.resizeCalls).toBe(1)
    expect(window.localStorage.getItem('openalice.page-sidebar-width.market.v1')).toBe('312')
  })

  it('rebuilds the group when painted flex geometry diverges from a valid panel store', () => {
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '312')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    // The imperative store still reports the valid 312px size, but a stale
    // registration write has left the actual flex items at 940px / 0px.
    resizableHarness.paintedNavigatorSize = 940
    notifyPaintedPanelResize()

    expect(resizableHarness.groupMounts).toBe(2)
    expect(resizableHarness.navigatorSize).toBe(312)
    expect(resizableHarness.paintedNavigatorSize).toBeNull()
    expect(window.localStorage.getItem('openalice.page-sidebar-width.market.v1')).toBe('312')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Market' }))

    expect(screen.getByTestId('page-sidebar-desktop').getAttribute('data-state')).toBe('collapsed')
    expect(resizableHarness.navigatorSize).toBe(44)
    expect(screen.getByTestId('page-sidebar-collapsed').textContent).toBe('')
  })

  it('clears pointer overdrag immediately when reduced motion is requested', () => {
    resizableHarness.navigatorSize = 200
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '200')
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(min-width: 768px)' || query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame')
    render(
      <PageSidebarLayout storageKey="market" title="Market" sidebar={<div>Market navigation</div>}>
        <div>Market content</div>
      </PageSidebarLayout>,
    )

    const group = screen.getByTestId('page-sidebar-market')
    fireEvent.pointerDown(screen.getByRole('separator'), {
      button: 0,
      buttons: 1,
      clientX: 200,
      isPrimary: true,
      pointerId: 17,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(group, {
      buttons: 1,
      clientX: 160,
      isPrimary: true,
      pointerId: 17,
      pointerType: 'mouse',
    })
    expect(group.getAttribute('data-overdrag-state')).toBe('resisting')

    fireEvent.pointerUp(group, {
      buttons: 0,
      clientX: 160,
      isPrimary: true,
      pointerId: 17,
      pointerType: 'mouse',
    })
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    expect(group.getAttribute('data-overdrag-state')).toBeNull()
    expect(group.getAttribute('data-overdrag-motion')).toBeNull()
    expect(group.style.getPropertyValue('--oa-page-sidebar-overdrag')).toBe('')
    expect(screen.getByTestId('page-sidebar-desktop').getAttribute('data-state')).toBe('expanded')
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
