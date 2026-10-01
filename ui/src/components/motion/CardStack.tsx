import type { CSSProperties, ReactNode } from 'react'
import './card-stack.css'

export const CARD_STACK_LAYOUT = [
  { x: 28, y: 20, rotation: 4, offsetX: 2, offsetY: -26, offsetRotation: 7 },
  { x: 12, y: 20, rotation: -8, offsetX: -4, offsetY: -6, offsetRotation: -7 },
  { x: 21, y: 26, rotation: 0, offsetX: 2, offsetY: 26, offsetRotation: 4 },
] as const

export interface CardStackItem {
  id: string
  label: string
  content: ReactNode
  position: { x: number; y: number; rotation: number; offsetX: number; offsetY: number; offsetRotation: number }
  onSelect: () => void
}

export function CardStack({ items, label }: { items: readonly CardStackItem[]; label: string }) {
  return <div className="oa-card-stack" role="group" aria-label={label}>
    {items.map(({ id, label: itemLabel, content, position, onSelect }, layer) => <button
      key={id}
      type="button"
      className="oa-card-stack-card"
      aria-label={itemLabel}
      onClick={onSelect}
      style={{
        '--card-stack-x': `${position.x}px`, '--card-stack-y': `${position.y}px`, '--card-stack-angle': `${position.rotation}deg`,
        '--card-stack-offset-x': `${position.offsetX}px`, '--card-stack-offset-y': `${position.offsetY}px`, '--card-stack-offset-angle': `${position.offsetRotation}deg`,
        '--card-stack-layer': layer,
      } as CSSProperties}
    >{content}</button>)}
  </div>
}
