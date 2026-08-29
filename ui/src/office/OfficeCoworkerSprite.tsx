import type { CSSProperties } from 'react'

import type { OfficeEmployeeMood } from '../api/office'
import { officeCoworkerSpriteForAgent } from './coworker-sprites'

export function OfficeCoworkerSprite({
  agent,
  identity,
  mood,
  reducedMotion,
  label,
  scale = 0.2,
  pose = 'portrait',
}: {
  agent: string
  identity?: string
  mood: OfficeEmployeeMood
  reducedMotion: boolean
  label: string
  scale?: number
  pose?: 'portrait' | 'desk'
}) {
  const asset = officeCoworkerSpriteForAgent(agent, identity)
  const height = 208 * scale

  return (
    <span
      aria-hidden
      title={label}
      className="oa-office-coworker"
      data-agent={asset.id}
      data-pose={pose}
      data-mood={mood}
      data-reduced-motion={reducedMotion || undefined}
      style={{
        '--oa-coworker-accent': asset.accent,
        '--oa-coworker-typing-phase': `${asset.typingPhaseMs}ms`,
        width: pose === 'desk' ? height : height * 0.72,
        height,
      } as CSSProperties}
    >
      <img
        className="oa-office-coworker__frame oa-office-coworker__frame--base"
        src={pose === 'desk' ? asset.deskSrc : asset.portraitSrc}
        alt=""
      />
      {pose === 'desk' && mood === 'working' && (
        <img
          className="oa-office-coworker__frame oa-office-coworker__frame--work"
          src={asset.deskWorkSrc}
          alt=""
        />
      )}
    </span>
  )
}
