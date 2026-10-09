export const VERSION_OVERVIEW_ID = 'settings-version-overview'

/** Navigation may mount Settings in the next frame. Keep the focus request
 * outside the URL so an ordinary /settings deep link retains its scroll state. */
export function focusVersionOverviewAfterNavigation(): void {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    const target = document.getElementById(VERSION_OVERVIEW_ID)
    if (!target) return
    target.scrollIntoView?.({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    target.focus({ preventScroll: true })
  }))
}
