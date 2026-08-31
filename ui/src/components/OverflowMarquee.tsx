import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type MouseEventHandler,
} from 'react'

import { cn } from '@/lib/utils'

const MARQUEE_GAP_PX = 24
const MARQUEE_SPEED_PX_PER_SECOND = 28
const MARQUEE_MIN_DURATION_SECONDS = 4
const OVERFLOW_EPSILON_PX = 1

interface OverflowMeasurement {
  readonly text: string
  readonly overflowing: boolean
  readonly cycleDistance: number
  readonly duration: number
}

type MarqueeStyle = CSSProperties & {
  '--oa-marquee-distance'?: string
  '--oa-marquee-duration'?: string
}

/**
 * Preserves a stable single-line label, then reveals clipped text through a
 * delayed marquee for fine-pointer hover. The duplicated track is decorative;
 * the static label remains the accessible source.
 */
export function OverflowMarquee({
  text,
  className,
}: {
  readonly text: string
  readonly className?: string
}) {
  const [viewport, setViewport] = useState<HTMLSpanElement | null>(null)
  const [staticLabel, setStaticLabel] = useState<HTMLSpanElement | null>(null)
  const [hovered, setHovered] = useState(false)
  const [measurement, setMeasurement] = useState<OverflowMeasurement>()

  useLayoutEffect(() => {
    if (!hovered || viewport === null || staticLabel === null) return

    const measure = () => {
      const cycleDistance = staticLabel.scrollWidth + MARQUEE_GAP_PX
      const next: OverflowMeasurement = {
        text,
        overflowing: viewport.clientWidth > 0
          && staticLabel.scrollWidth - viewport.clientWidth > OVERFLOW_EPSILON_PX,
        cycleDistance,
        duration: Math.max(
          MARQUEE_MIN_DURATION_SECONDS,
          cycleDistance / MARQUEE_SPEED_PX_PER_SECOND,
        ),
      }
      setMeasurement((current) => current?.text === next.text
        && current.overflowing === next.overflowing
        && current.cycleDistance === next.cycleDistance
        ? current
        : next)
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(staticLabel)
    return () => observer.disconnect()
  }, [hovered, staticLabel, text, viewport])

  const current = measurement?.text === text ? measurement : undefined
  const active = hovered && current?.overflowing === true
  const style: MarqueeStyle | undefined = current
    ? {
        '--oa-marquee-distance': `${current.cycleDistance}px`,
        '--oa-marquee-duration': `${current.duration}s`,
      }
    : undefined
  const enter: MouseEventHandler<HTMLSpanElement> = () => setHovered(true)
  const leave: MouseEventHandler<HTMLSpanElement> = () => setHovered(false)

  return (
    <span
      ref={setViewport}
      data-overflow-marquee="viewport"
      data-overflowing={current?.overflowing ? 'true' : 'false'}
      data-marquee-active={active ? 'true' : 'false'}
      className={cn('oa-overflow-marquee relative block min-w-0 overflow-hidden', className)}
      onMouseEnter={enter}
      onMouseLeave={leave}
      title={current?.overflowing ? text : undefined}
      style={style}
    >
      <span
        ref={setStaticLabel}
        data-overflow-marquee="label"
        className="oa-overflow-marquee-label block truncate"
      >
        {text}
      </span>
      {current?.overflowing && (
        <span
          aria-hidden="true"
          data-overflow-marquee="track"
          className="oa-overflow-marquee-track pointer-events-none absolute inset-y-0 left-0 hidden w-max items-center whitespace-nowrap"
        >
          <span>{text}</span>
          <span>{text}</span>
        </span>
      )}
    </span>
  )
}
