import { Switch as SwitchPrimitive } from '@base-ui/react/switch'

import { cn } from '@/lib/utils'

type SwitchSize = 'sm' | 'md'

interface SwitchProps extends SwitchPrimitive.Root.Props {
  size?: SwitchSize
}

const switchSize = {
  sm: {
    footprint: '-mx-1 -my-[11px]',
    track: 'h-[18px] w-8',
    thumb: 'size-3 data-checked:translate-x-[14px]',
  },
  md: {
    footprint: '-my-[9px]',
    track: 'h-[22px] w-10',
    thumb: 'size-4 data-checked:translate-x-[18px]',
  },
} satisfies Record<SwitchSize, Record<'footprint' | 'track' | 'thumb', string>>

function Switch({ className, size = 'md', ...props }: SwitchProps) {
  const geometry = switchSize[size]

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      nativeButton
      render={<button type="button" />}
      className={cn(
        'group/switch inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none disabled:cursor-not-allowed disabled:opacity-40',
        'focus-visible:[&_[data-slot=switch-track]]:ring-2 focus-visible:[&_[data-slot=switch-track]]:ring-ring/45 focus-visible:[&_[data-slot=switch-track]]:ring-offset-1 focus-visible:[&_[data-slot=switch-track]]:ring-offset-background',
        geometry.footprint,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        data-slot="switch-track"
        className={cn(
          'inline-flex shrink-0 items-center rounded-full bg-muted p-[3px] transition-colors duration-[var(--motion-fast)] [transition-timing-function:var(--motion-ease-out)] group-data-checked/switch:bg-primary motion-reduce:transition-none',
          geometry.track,
        )}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className={cn(
            'block shrink-0 translate-x-0 rounded-full bg-muted-foreground transition-[translate,background-color] duration-[var(--motion-fast)] [transition-timing-function:var(--motion-ease-out)] data-checked:bg-primary-foreground motion-reduce:transition-none',
            geometry.thumb,
          )}
        />
      </span>
    </SwitchPrimitive.Root>
  )
}

export { Switch }
export type { SwitchProps }
