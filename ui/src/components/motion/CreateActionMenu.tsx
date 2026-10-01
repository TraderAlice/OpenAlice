import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Popover } from '@base-ui/react/popover'
import { Plus } from 'lucide-react'
import { readMotionNumber } from './motion-runtime'
import './create-action-menu.css'

export interface CreateMenuItem {
  id: string
  label: string
  fx: string
  fy: string
  icon: ReactNode
}

export function CreateActionMenu({ items, onSelect, label }: { items: CreateMenuItem[]; onSelect: (item: CreateMenuItem) => void; label: string }) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [instant, setInstant] = useState(false)
  const [filter, setFilter] = useState({ blur: 6, contrast: 18 })
  const filterId = `oa-create-menu-filter-${useId().replace(/:/g, '')}`
  const slotStyle = (fx: string, fy: string, index: number) => ({ '--fx': fx, '--fy': fy, '--i': index }) as CSSProperties
  return (
    <Popover.Root open={open} onOpenChange={(next, details) => {
      setInstant(details.event.type === 'keydown')
      if (next) setFilter({ blur: readMotionNumber('--create-menu-blur', 6), contrast: readMotionNumber('--create-menu-contrast', 18) })
      setOpen(next)
    }}>
      <div ref={anchorRef} className="oa-create-menu-anchor" data-open={open} data-instant={instant}>
      <svg className="oa-create-menu-layer" viewBox="0 0 200 140" aria-hidden="true" focusable="false">
        <defs>

          <filter
            id={filterId}
            x="-60%"
            y="-60%"
            width="220%"
            height="220%"
            colorInterpolationFilters="sRGB"
          >

            <feGaussianBlur in="SourceGraphic" stdDeviation={filter.blur} result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${filter.contrast} -7`}
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" result="shape" />

            <feColorMatrix
              in="shape"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 60 -29.5"
              result="ring-solid"
            />
            <feMorphology in="ring-solid" operator="dilate" radius="1" result="ring-a" />
            <feFlood floodColor="var(--shadow-color)" floodOpacity="0.06" result="ring-c" />
            <feComposite in="ring-c" in2="ring-a" operator="in" result="ring" />

            <feGaussianBlur in="shape" stdDeviation="3" result="s2-b" />
            <feOffset in="s2-b" dy="2" result="s2-o" />
            <feFlood floodColor="var(--shadow-color)" floodOpacity="0.05" result="s2-c" />
            <feComposite in="s2-c" in2="s2-o" operator="in" result="s2" />

            <feGaussianBlur in="shape" stdDeviation="21" result="s3-b" />
            <feOffset in="s3-b" dy="4" result="s3-o" />
            <feFlood floodColor="var(--shadow-color)" floodOpacity="0.06" result="s3-c" />
            <feComposite in="s3-c" in2="s3-o" operator="in" result="s3" />
            <feMerge>
              <feMergeNode in="s3" />
              <feMergeNode in="s2" />
              <feMergeNode in="ring" />
              <feMergeNode in="shape" />
            </feMerge>
          </filter>
        </defs>

        <g filter={`url(#${filterId})`}>
          {items.map((item, i) => (
            <circle
              key={item.id}
              className="oa-create-menu-blob"
              cx="100"
              cy="100"
              r="20"
              style={slotStyle(item.fx, item.fy, i)}
            />
          ))}
          <circle className="oa-create-menu-blob oa-create-menu-blob-main" cx="100" cy="100" r="20" />
        </g>
      </svg>

        <Popover.Portal container={anchorRef}>
        <Popover.Positioner side="top" sideOffset={-60} className="oa-create-menu-positioner">
          <Popover.Popup className="oa-create-menu-popup" aria-label={label}>
            {items.map((item, index) => (
              <button key={item.id} type="button" className="oa-create-menu-item" style={slotStyle(item.fx, item.fy, index)} aria-label={item.label} onClick={() => { setOpen(false); onSelect(item) }}>
                {item.icon}
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
        </Popover.Portal>
        <Popover.Trigger className="oa-create-menu-main" aria-label={label}>
          <span className="oa-create-menu-swap"><Plus aria-hidden="true" size={20} strokeWidth={1.75} /></span>
        </Popover.Trigger>
      </div>
    </Popover.Root>
  )
}
