import type { CSSProperties } from 'react'

import type { OfficeEmployeeMood } from '../api/office'
import { officeCoworkerSpriteForAgent } from './coworker-sprites'

export function OfficeCoworkerSprite({
  agent,
  mood,
  reducedMotion,
  label,
  scale = 0.2,
}: {
  agent: string
  mood: OfficeEmployeeMood
  reducedMotion: boolean
  label: string
  scale?: number
}) {
  const asset = officeCoworkerSpriteForAgent(agent)
  const height = 208 * scale

  return (
    <span
      aria-hidden
      title={label}
      className="oa-office-coworker"
      data-agent={asset.id}
      data-mood={mood}
      data-reduced-motion={reducedMotion || undefined}
      style={{
        '--oa-coworker-accent': asset.accent,
        width: height * 0.72,
        height,
      } as CSSProperties}
    >
      <img src={asset.src} alt="" />
    </span>
  )
}
