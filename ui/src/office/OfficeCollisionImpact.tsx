import type { CSSProperties } from 'react'

import { OFFICE_FURNITURE } from './furniture'
import type { OfficeFacingDirection } from './interaction-targets'

const ROTATION_BY_DIRECTION = {
  up: 0,
  right: 90,
  down: 180,
  left: 270,
} as const

export interface OfficeCollisionImpactState {
  serial: number
  x: number
  y: number
  direction: OfficeFacingDirection
}

export function officeCollisionImpactPosition(
  alice: { x: number; y: number },
  movement: { x: number; y: number; direction: OfficeFacingDirection },
  bounds?: { width: number; height: number },
): Pick<OfficeCollisionImpactState, 'x' | 'y' | 'direction'> {
  const x = alice.x + Math.round(movement.x * 1.25)
  const y = alice.y + Math.round(movement.y * 1.25)
  return {
    x: bounds ? Math.min(bounds.width - 12, Math.max(12, x)) : x,
    y: bounds ? Math.min(bounds.height - 12, Math.max(12, y)) : y,
    direction: movement.direction,
  }
}

export function OfficeCollisionImpact({
  impact,
  reducedMotion,
  zIndex,
}: {
  impact: OfficeCollisionImpactState
  reducedMotion: boolean
  zIndex: number
}) {
  return (
    <span
      className="oa-office-collision-impact"
      aria-hidden="true"
      data-testid="office-collision-impact"
      data-direction={impact.direction}
      data-reduced-motion={reducedMotion}
      data-serial={impact.serial}
      style={{
        '--office-impact-rotation': `${ROTATION_BY_DIRECTION[impact.direction]}deg`,
        left: impact.x,
        top: impact.y,
        zIndex,
      } as CSSProperties}
    >
      <span
        style={{ backgroundImage: `url(${OFFICE_FURNITURE.generated.collisionImpact})` }}
      />
    </span>
  )
}
