import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useWindowsChrome } from './useWindowsChrome'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (navigator as unknown as Record<string, unknown>).windowControlsOverlay
  delete (window as unknown as Record<string, unknown>).openAlice
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('style')
})

it('updates actual header insets, theme and fullscreen state, then releases observers', async () => {
  let pending: FrameRequestCallback | undefined
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { pending = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect = disconnect })
  const overlay = Object.assign(new EventTarget(), {
    visible: true,
    getTitlebarAreaRect: () => new DOMRect(0, 0, 862, 44),
  })
  Object.defineProperty(navigator, 'windowControlsOverlay', { configurable: true, value: overlay })
  const setTheme = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(window, 'openAlice', { configurable: true, value: { windowChrome: { platform: 'win32', setTheme } } })
  document.documentElement.style.setProperty('--foreground', '#eeeeee')
  const top = document.createElement('div')
  top.className = 'oa-topbar'
  top.style.backgroundColor = 'rgb(24, 24, 24)'
  let topRect = new DOMRect(260, 0, 740, 44)
  top.getBoundingClientRect = () => topRect
  document.body.append(top)
  const view = renderHook(useWindowsChrome)
  expect(top.style.getPropertyValue('--caption-right')).toBe('138px')
  expect(top.hasAttribute('data-caption-row')).toBe(true)
  expect(setTheme).toHaveBeenLastCalledWith({ color: '#181818', symbolColor: '#eeeeee' })
  const flush = async () => {
    await act(async () => { await Promise.resolve(); const callback = pending; pending = undefined; callback?.(0) })
  }
  overlay.visible = false
  overlay.dispatchEvent(new Event('geometrychange'))
  await flush()
  expect(top.style.getPropertyValue('--caption-right')).toBe('0px')
  expect(top.hasAttribute('data-caption-row')).toBe(false)
  expect(document.documentElement.style.getPropertyValue('--desktop-caption-height')).toBe('0px')
  overlay.visible = true
  top.style.backgroundColor = 'rgb(250, 249, 246)'
  document.documentElement.style.setProperty('--foreground', '#252629')
  overlay.dispatchEvent(new Event('geometrychange'))
  await flush()
  expect(top.style.getPropertyValue('--caption-right')).toBe('138px')
  expect(setTheme).toHaveBeenLastCalledWith({ color: '#faf9f6', symbolColor: '#252629' })
  topRect = new DOMRect(850, 0, 150, 44)
  overlay.dispatchEvent(new Event('geometrychange'))
  await flush()
  expect(top.hasAttribute('data-caption-stacked')).toBe(true)
  top.setAttribute('inert', '')
  await flush()
  expect(top.hasAttribute('data-caption-row')).toBe(false)
  expect(document.querySelector<HTMLElement>('.oa-windows-chrome-fallback')?.hidden).toBe(false)
  view.unmount()
  expect(disconnect).toHaveBeenCalled()
  expect(top.style.getPropertyValue('--caption-right')).toBe('')
  expect(document.documentElement.dataset.windowChrome).toBeUndefined()
  expect(document.querySelector('.oa-windows-chrome-fallback')).toBeNull()
})

it('leaves ordinary browser chrome untouched', () => {
  renderHook(useWindowsChrome)
  expect(document.documentElement.dataset.windowChrome).toBeUndefined()
})
