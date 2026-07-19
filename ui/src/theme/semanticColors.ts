/** Read a resolved semantic color for canvas-based renderers that cannot
 * consume CSS custom properties directly. DOM/SVG surfaces should keep using
 * `var(--token)` so the browser owns theme updates. */
export function readSemanticColor(token: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim()
  if (!value) throw new Error(`Missing semantic color token: --${token}`)
  return value
}
