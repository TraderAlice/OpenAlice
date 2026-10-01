import { useLayoutEffect, useRef, type Ref } from 'react'
import { layout, prepare, type PreparedText } from '@chenglou/pretext'

export function MeasuredText({ children, as: Tag = 'span', className }: { children: string; as?: 'p' | 'span'; className?: string }) {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    let disposed = false
    let cachedKey = ''
    let prepared: PreparedText | undefined
    const measure = () => {
      if (disposed) return
      const style = getComputedStyle(element)
      const horizontalInsets = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'] as const
      const width = Number.parseFloat(style.width) - (style.boxSizing === 'border-box' ? horizontalInsets.reduce((total, property) => total + Number.parseFloat(style[property]), 0) : 0)
      const lineHeight = Number.parseFloat(style.lineHeight)
      const letterSpacing = Number.parseFloat(style.letterSpacing) || 0
      if (!style.font || !Number.isFinite(lineHeight) || !Number.isFinite(width) || width <= 0) return
      const locale = element.closest('[lang]')?.getAttribute('lang') ?? document.documentElement.lang
      const key = `${children}:${style.font}:${letterSpacing}:${locale}:${style.whiteSpace}:${style.wordBreak}`
      try {
        if (key !== cachedKey) {
          prepared = prepare(children, style.font, { letterSpacing, whiteSpace: 'normal', wordBreak: 'normal' })
          cachedKey = key
        }
        if (!prepared) return
        const metrics = layout(prepared, width, lineHeight)
        element.style.minHeight = `${metrics.height}px`
        element.dataset.measuredHeight = String(metrics.height)
        element.dataset.measuredLines = String(metrics.lineCount)
      } catch {
        element.style.removeProperty('min-height')
      }
    }
    void document.fonts?.ready.then(measure)
    if (!document.fonts || document.fonts.status === 'loaded') measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    return () => { disposed = true; observer?.disconnect() }
  }, [children])
  return <Tag ref={ref as Ref<HTMLParagraphElement & HTMLSpanElement>} className={className}>{children}</Tag>
}
