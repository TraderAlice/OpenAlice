import { useRef, type CSSProperties, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { useMotionActivity } from './motion-runtime'
import './status-indicator.css'

export type StatusState = 'loading' | 'done' | 'error'

export interface StatusIndicatorProps extends HTMLAttributes<HTMLSpanElement> {
  state?: StatusState
  size?: number
  label?: string
}

export function StatusIndicator({ state = 'loading', size = 22, label, className, style, ...props }: StatusIndicatorProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const active = useMotionActivity(ref, state === 'loading')
  return (
    <span
      ref={ref}
      className={cn('oa-status-indicator-badge', className)}
      data-state={state}
      data-playing={active}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ '--status-indicator-size': `${size}px`, ...style } as CSSProperties}
      {...props}
    >
      <span className="oa-status-indicator-ring" />
      <span className="oa-status-indicator-arc" />
      <span className="oa-status-indicator-fill" />
      <svg className="oa-status-indicator-disc" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path className="oa-status-indicator-mark" pathLength="1" d="M7.5 12.5 10.8 15.5 16.5 9" />
        <path className="oa-status-indicator-error" d="M12 7.5v5M12 16h.01" />
      </svg>
    </span>
  )
}
