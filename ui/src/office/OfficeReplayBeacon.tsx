import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import type { OfficeInteractionTarget } from './interaction-targets'
import { officeRouteTargetPointerPosition } from './OfficeRouteTargetPointer'

export function officeReplayBeaconAvoidBounds(target: OfficeInteractionTarget) {
  const position = officeRouteTargetPointerPosition(target)
  return target.kind === 'employee'
    ? {
        left: position.x - 212,
        top: position.y - 52,
        right: position.x - 8,
        bottom: position.y + 4,
      }
    : {
        left: position.x - 102,
        top: position.y - 52,
        right: position.x + 102,
        bottom: position.y + 4,
      }
}

export function OfficeReplayBeacon({
  target,
  label,
  sequenceLabel,
  reducedMotion,
  zIndex,
}: {
  target: OfficeInteractionTarget
  label: string
  sequenceLabel: string
  reducedMotion: boolean
  zIndex: number
}) {
  const position = officeRouteTargetPointerPosition(target)

  return (
    <div
      role="status"
      aria-label={`${sequenceLabel} · ${label}`}
      className="oa-office-replay-beacon"
      data-kind={target.kind}
      data-reduced-motion={reducedMotion || undefined}
      data-testid="office-replay-beacon"
      style={{ left: position.x, top: position.y, zIndex }}
    >
      <img src={OFFICE_FURNITURE.generated.routeDestination} alt="" aria-hidden style={officePixelImg} />
      <span>
        <small>{sequenceLabel}</small>
        <strong title={label}>{label}</strong>
      </span>
    </div>
  )
}
