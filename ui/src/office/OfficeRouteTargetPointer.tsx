import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import type { OfficeInteractionTarget } from './interaction-targets'

const ROUTE_TARGET_POINTER_LIFT = {
  employee: 2,
  sign: 34,
  cabinet: 50,
  roster: 44,
  operations: 72,
  'floor-terminal': 62,
} as const satisfies Record<OfficeInteractionTarget['kind'], number>

const ROUTE_TARGET_POINTER_NUDGE_X = {
  employee: 0,
  sign: 0,
  cabinet: -8,
  roster: -8,
  operations: 0,
  'floor-terminal': 0,
} as const satisfies Record<OfficeInteractionTarget['kind'], number>

export function officeRouteTargetPointerPosition(
  target: OfficeInteractionTarget,
): { x: number; y: number } {
  return {
    x: target.x + ROUTE_TARGET_POINTER_NUDGE_X[target.kind],
    y: target.y - ROUTE_TARGET_POINTER_LIFT[target.kind],
  }
}

export function OfficeRouteTargetPointer({
  target,
  reducedMotion,
  zIndex,
}: {
  target: OfficeInteractionTarget
  reducedMotion: boolean
  zIndex: number
}) {
  const position = officeRouteTargetPointerPosition(target)

  return (
    <span
      className="oa-office-route-target-pointer"
      data-kind={target.kind}
      data-reduced-motion={reducedMotion || undefined}
      data-testid="office-route-target-pointer"
      aria-hidden="true"
      style={{ left: position.x, top: position.y, zIndex }}
    >
      <img
        src={OFFICE_FURNITURE.generated.routeTargetPointer}
        alt=""
        aria-hidden
        style={officePixelImg}
      />
    </span>
  )
}
