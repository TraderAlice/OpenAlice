import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface ChartFrameSize {
  width: number
  height: number
}

interface MeasuredChartFrameProps {
  className?: string
  children: ReactNode | ((size: ChartFrameSize) => ReactNode)
}

/**
 * Recharts' ResponsiveContainer warns when it mounts before its parent has a
 * positive layout box. Flex/grid pages can briefly report width/height <= 0
 * during route transitions, so gate chart mounting on a measured frame.
 */
export function MeasuredChartFrame({ className, children }: MeasuredChartFrameProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<ChartFrameSize | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = (width: number, height: number) => {
      const nextWidth = Math.floor(width)
      const nextHeight = Math.floor(height)
      if (nextWidth <= 0 || nextHeight <= 0) return
      setSize(current => current?.width === nextWidth && current.height === nextHeight
        ? current
        : { width: nextWidth, height: nextHeight })
    }

    measure(el.clientWidth, el.clientHeight)
    const ro = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width, entry.contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={ref} className={cn('oa-chart', className)}>
      {size ? (typeof children === 'function' ? children(size) : children) : null}
    </div>
  )
}
