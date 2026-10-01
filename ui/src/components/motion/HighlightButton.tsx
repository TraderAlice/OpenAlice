import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import './highlight-button.css'

export interface HighlightButtonProps extends ComponentProps<typeof Button> {
  playing?: boolean
}

export function HighlightButton({ children, playing = false, className, ...props }: HighlightButtonProps) {
  return (
    <Button type="button" variant="outline" className={cn('oa-highlight-button', className)}
      data-playing={playing} {...props}>
      <span className="oa-highlight-button-label">{children}</span>
    </Button>
  )
}
