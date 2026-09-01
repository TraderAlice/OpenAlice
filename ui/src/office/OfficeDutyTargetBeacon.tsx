import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import type { OfficeInteractionTarget } from './interaction-targets'
import { officeRouteTargetPointerPosition } from './OfficeRouteTargetPointer'

export function OfficeDutyTargetBeacon({
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
      className="oa-office-duty-target-beacon"
      data-kind={target.kind}
      data-reduced-motion={reducedMotion || undefined}
      data-testid="office-duty-target-beacon"
      aria-hidden="true"
      style={{ left: position.x, top: position.y, zIndex }}
    >
      <img
        src={OFFICE_FURNITURE.generated.routeDestination}
        alt=""
        aria-hidden
        style={officePixelImg}
      />
    </span>
  )
}
