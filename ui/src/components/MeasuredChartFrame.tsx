import { useEffect, useRef, useState, type ReactNode } from 'react'

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

    const measure = () => {
      const rect = el.getBoundingClientRect()
      setSize(rect.width > 0 && rect.height > 0
        ? { width: Math.floor(rect.width), height: Math.floor(rect.height) }
        : null)
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={ref} className={className}>
      {size ? (typeof children === 'function' ? children(size) : children) : null}
    </div>
  )
}
