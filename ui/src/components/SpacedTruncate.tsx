import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'

/**
 * Single-line truncation with a spaced ellipsis mark.
 * Chromium ignores custom `text-overflow` strings, so we clip the text and
 * render a separate " …" when the label overflows — or when the caller marks
 * the text as an abbreviation of a longer source title.
 */
export function SpacedTruncate({
  text,
  className = '',
  title,
  abbreviated = false,
}: {
  readonly text: string
  readonly className?: string
  readonly title?: string
  /** Show the spaced mark even when the visible text fits (shortened chrome). */
  readonly abbreviated?: boolean
}): ReactElement {
  const textRef = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    const measure = () => {
      setOverflowing(el.scrollWidth > el.clientWidth + 1)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    const parent = el.parentElement
    if (parent) observer.observe(parent)
    return () => observer.disconnect()
  }, [text])

  const showMark = abbreviated || overflowing

  return (
    <span className={`oa-spaced-truncate ${className}`.trim()} title={title ?? text}>
      <span ref={textRef} className="oa-spaced-truncate__text">{text}</span>
      {showMark && <span className="oa-spaced-truncate__mark" aria-hidden="true">…</span>}
    </span>
  )
}
