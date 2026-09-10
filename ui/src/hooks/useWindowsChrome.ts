import { useLayoutEffect } from 'react'
import { captionInsets, opaqueHex, type ChromeRect } from '../lib/window-chrome'

interface WindowControlsOverlay extends EventTarget {
  visible: boolean
  getTitlebarAreaRect(): DOMRect
}

const headers = '.oa-topbar, .oa-activity-brand, .harness-work-toolbar, [data-testid="mobile-context-bar"], [data-desktop-banner]'

/** Measure shared header primitives, never page-specific buttons. Native
 * geometry handles Windows scaling, maximization, RTL and fullscreen. */
export function useWindowsChrome(): void {
  useLayoutEffect(() => {
    const chrome = window.openAlice?.windowChrome
    if (chrome?.platform !== 'win32') return
    const root = document.documentElement
    root.dataset.windowChrome = 'windows'
    const overlay = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay }).windowControlsOverlay
    let frame = 0
    let lastTheme = ''
    const observed = new Set<HTMLElement>()
    // Loading/login/reconnection screens have no page header. Keep their
    // window movable without mounting App or starting its backend effects.
    const fallback = document.createElement('div')
    fallback.className = 'oa-windows-chrome-fallback'
    fallback.setAttribute('aria-hidden', 'true')
    document.body.append(fallback)
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const resize = new ResizeObserver(schedule)
    function update() {
      frame = 0
      const reported = overlay?.visible ? overlay.getTitlebarAreaRect() : null
      const safe: ChromeRect | null = overlay && !overlay.visible ? null
        : reported && reported.width > 0 && reported.height > 0 ? reported
          : { x: 0, y: 0, width: Math.max(0, window.innerWidth - 138), height: 44 }
      root.style.setProperty('--desktop-caption-height', `${safe ? safe.y + safe.height : 0}px`)
      const current = new Set(document.querySelectorAll<HTMLElement>(headers))
      let captionSurface: HTMLElement | undefined
      let hasHeader = false
      for (const element of current) {
        if (!observed.has(element)) { observed.add(element); resize.observe(element) }
        const rect = element.getBoundingClientRect()
        const inset = captionInsets(rect, element.closest('[inert], [aria-hidden="true"]') ? null : safe)
        hasHeader ||= inset.caption
        element.style.setProperty('--caption-left', `${inset.left}px`)
        element.style.setProperty('--caption-right', `${inset.right}px`)
        element.toggleAttribute('data-caption-row', inset.caption)
        // A very narrow split pane cannot fit controls beside native captions.
        // Put that toolbar below the caption band instead of overlapping it.
        element.toggleAttribute('data-caption-stacked', inset.caption && inset.left + inset.right > 0 && rect.width - inset.left - inset.right < 160)
        if (inset.right > 0 || inset.left > 0) captionSurface = element
      }
      for (const element of observed) {
        if (!current.has(element)) { resize.unobserve(element); observed.delete(element) }
      }
      fallback.hidden = hasHeader || !safe
      if (safe) {
        fallback.style.left = `${safe.x}px`
        fallback.style.top = `${safe.y}px`
        fallback.style.width = `${safe.width}px`
        fallback.style.height = `${safe.height}px`
      }
      // Use the surface behind the caption buttons (work panels use sidebar
      // material), rather than assuming that the OS and app themes agree.
      let surface: HTMLElement | null = captionSurface ?? document.body
      let color: string | null = null
      while (surface && !color) {
        color = opaqueHex(getComputedStyle(surface).backgroundColor)
        surface = surface.parentElement
      }
      const style = getComputedStyle(root)
      color ??= opaqueHex(style.getPropertyValue('--background').trim())
      const symbolColor = opaqueHex(style.getPropertyValue('--foreground').trim())
      if (color && symbolColor && `${color}:${symbolColor}` !== lastTheme) {
        lastTheme = `${color}:${symbolColor}`
        void chrome?.setTheme?.({ color, symbolColor }).catch(() => { lastTheme = '' })
      }
    }
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert', 'aria-hidden'] })
    const theme = new MutationObserver(schedule)
    theme.observe(root, { attributes: true, attributeFilter: ['data-palette', 'data-ui-style'] })
    resize.observe(document.body)
    overlay?.addEventListener('geometrychange', schedule)
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    update()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      theme.disconnect()
      fallback.remove()
      overlay?.removeEventListener('geometrychange', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
      delete root.dataset.windowChrome
      root.style.removeProperty('--desktop-caption-height')
      for (const element of observed) {
        element.style.removeProperty('--caption-left')
        element.style.removeProperty('--caption-right')
        element.removeAttribute('data-caption-row')
        element.removeAttribute('data-caption-stacked')
      }
    }
  }, [])
}
