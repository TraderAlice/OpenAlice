import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import './gradient-text.css'

export interface GradientTextProps extends HTMLAttributes<HTMLSpanElement> {
  playing?: boolean
}

export function GradientText({ children, className, playing = false, ...props }: GradientTextProps) {
  return <span className={cn('oa-gradient-text', className)} data-playing={playing} {...props}>{children}</span>
}
