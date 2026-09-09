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
        resizableHarness.navigatorSize = 0
        onResize?.({ asPercentage: 0, inPixels: 0 })
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
          ? 0
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
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PageSidebarLayout applied state', () => {
  it('disables primitive collapse and ignores the retired collapsed state', () => {
    window.localStorage.setItem('openalice.page-sidebar-collapsed.market.v1', '1')
    window.localStorage.setItem('openalice.page-sidebar-width.market.v1', '312')
    render(<PageSidebarLayout storageKey="market" title="Market" sidebar={<button>Navigation</button>}>
      <div>Content</div>
    </PageSidebarLayout>)
    expect(resizableHarness.navigatorCollapsible).toBe(false)
    expect(resizableHarness.navigatorDefaultSizes).toEqual([312])
    expect(screen.getByRole('button', { name: 'Navigation' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Collapse Market' })).toBeNull()
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

})
