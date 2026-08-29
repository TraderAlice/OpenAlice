import type { CSSProperties } from 'react'

import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import type { OfficeInteractionPathStep } from './interaction-path'

const ROTATION_BY_DIRECTION = {
  up: 0,
  right: 90,
  down: 180,
  left: 270,
} as const

export function visibleOfficeRouteSteps(
  steps: readonly OfficeInteractionPathStep[],
): readonly OfficeInteractionPathStep[] {
  if (steps.length <= 3) return steps
  return steps.filter((step, index) => {
    if (index === 0 || index === steps.length - 1) return true
    const previous = steps[index - 1]
    const next = steps[index + 1]
    const turn = previous?.direction !== step.direction || next?.direction !== step.direction
    const gridParity = (Math.round(step.x / 24) + Math.round(step.y / 24)) % 2 === 0
    return turn || gridParity
  })
}

export function OfficeRouteTrail({
  steps,
}: {
  steps: readonly OfficeInteractionPathStep[]
}) {
  if (steps.length === 0) return null
  const destination = steps.at(-1)

  return (
    <ol className="oa-office-route-trail" aria-hidden="true" data-testid="office-route-trail">
      {visibleOfficeRouteSteps(steps).map((step) => (
        <li
          key={`${step.x}:${step.y}`}
          className="oa-office-route-trail__step"
          data-direction={step.direction}
          data-destination={step === destination}
          style={{
            '--office-route-rotation': `${ROTATION_BY_DIRECTION[step.direction]}deg`,
            left: step.x,
            top: step.y,
          } as CSSProperties}
        >
          <img src={OFFICE_FURNITURE.generated.routeChevron} alt="" style={officePixelImg} />
        </li>
      ))}
    </ol>
  )
}
