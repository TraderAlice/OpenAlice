import { useCallback, useRef, type PointerEvent } from 'react'

/** Drag phase passed to the parent's onResize callback. */
export type ResizePhase = 'start' | 'move' | 'end'

interface ResizerProps {
  /**
   * Drag axis. `horizontal` drags left/right (changes width); `vertical` drags
   * up/down (changes height). The cursor changes accordingly.
   */
  direction: 'horizontal' | 'vertical'
  /**
   * Called on each drag phase. `delta` is pixels moved from drag start
   * (signed: negative = left/up, positive = right/down). `phase` tells you
   * which lifecycle event fired so you can capture starting state on 'start'
   * and persist on 'end'.
   */
  onResize: (delta: number, phase: ResizePhase) => void
  /** Called on double-click — typical use is to reset to default size. */
  onReset?: () => void
  /**
   * Tailwind classes for positioning + appearance. Caller decides where the
   * handle lives (e.g. `absolute top-0 right-0 bottom-0 w-1`) and what color
   * it fades to on hover.
   */
  className?: string
}

/**
 * Generic resize handle. Pure pointer-events implementation with
 * setPointerCapture, so move/up events keep firing even if the cursor
 * leaves the handle. Wraps every state update in requestAnimationFrame
 * to throttle to display refresh rate.
 *
 * Pure-input: doesn't own any size state. Consumer maintains the actual
 * dimension; this component just streams pixel deltas.
 *
 * Usage:
 *   const [width, setWidth] = useState(240)
 *   const startRef = useRef(240)
 *   <Resizer
 *     direction="horizontal"
 *     onResize={(dx, phase) => {
 *       if (phase === 'start') startRef.current = width
 *       else if (phase === 'move') setWidth(clamp(startRef.current + dx, 150, 500))
 *     }}
 *     onReset={() => setWidth(240)}
 *     className="absolute top-0 right-0 bottom-0 w-1"
 *   />
 */
export function Resizer({ direction, onResize, onReset, className = '' }: ResizerProps) {
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const rafRef = useRef<number | null>(null)

  const handleDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    startRef.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
    // Lock body cursor and disable text selection during drag — without these,
    // dragging fast enough to leave the handle would either lose the cursor
    // hint or accidentally select page text.
    document.body.style.userSelect = 'none'
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    onResize(0, 'start')
  }, [direction, onResize])

  const handleMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return
    const delta = direction === 'horizontal'
      ? e.clientX - startRef.current.x
      : e.clientY - startRef.current.y
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => onResize(delta, 'move'))
  }, [direction, onResize])

  const handleUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return
    startRef.current = null
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    onResize(0, 'end')
  }, [onResize])

  const cursorClass = direction === 'horizontal' ? 'cursor-col-resize' : 'cursor-row-resize'

  return (
    <div
      role="separator"
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
      className={`${cursorClass} hover:bg-primary/40 active:bg-primary/60 transition-colors ${className}`}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      onDoubleClick={onReset}
    />
  )
}
