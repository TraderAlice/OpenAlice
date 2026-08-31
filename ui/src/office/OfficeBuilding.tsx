import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  OfficeBuildingSnapshot,
  OfficeFloorEmployee,
} from '../api/office'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { useEffectivePreferenceSlot } from '../theme/useEffectiveTheme'
import { officeBubbleText } from './bubble-text'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import { OFFICE_HUD_ASSETS } from './hud-assets'
import { officeInteractionPath, type OfficeInteractionPathStep } from './interaction-path'
import { OFFICE_LOG_ASSETS } from './log-assets'
import { OfficeAliceSprite, type OfficeAliceDirection } from './OfficeAliceSprite'
import {
  OFFICE_COWORKER_EMOTES,
  officeCoworkerCast,
  type OfficeCoworkerSpriteAsset,
} from './coworker-sprites'
import {
  OfficeCollisionImpact,
  officeCollisionImpactPosition,
  type OfficeCollisionImpactState,
} from './OfficeCollisionImpact'
import { OfficeDutyTargetBeacon } from './OfficeDutyTargetBeacon'
import { OfficeMapPod } from './OfficeMapPod'
import { OfficeRouteTrail } from './OfficeRouteTrail'
import { OfficeRouteTargetPointer } from './OfficeRouteTargetPointer'
import { OfficeReplayBeacon } from './OfficeReplayBeacon'
import type { OfficeReplayFocus } from './replay-focus'
import {
  clampOfficeCamera,
  nearestOfficeInteractionTarget,
  officeCameraCenteredOn,
  officeCameraFollowingAlice,
  officeInteractionTargets,
  type OfficeInteractionTarget,
} from './interaction-targets'
import {
  OFFICE_PROMPT_DESTINATION_MAX_WIDTH,
  OFFICE_PROMPT_DETAIL_MAX_WIDTH,
  OFFICE_PROMPT_DIALOGUE_MAX_WIDTH,
  OFFICE_PROMPT_NARROW_DETAIL_MAX_WIDTH,
  OFFICE_PROMPT_NARROW_DIALOGUE_MAX_WIDTH,
  OFFICE_PROMPT_NARROW_SERVICE_MAX_WIDTH,
  OFFICE_PROMPT_SERVICE_MAX_HEIGHT,
  OFFICE_PROMPT_SERVICE_MAX_WIDTH,
  officeInteractionPromptPlacement,
  type OfficePromptAvoidBounds,
} from './interaction-prompt'
import { officeCoworkerCallsign } from './label'
import { stableDeskSlotsForOffice } from './desk-slots'
import {
  coreOfficeDutyRegistrations,
  projectOfficeDutyQueue,
  resolveOfficeDutyTarget,
  type OfficeCadenceDutyCandidate,
  type OfficeDutyCandidate,
  type OfficeDutySourceStatus,
  type OfficeDutyTargetId,
  type OfficeEmployeeDutyTargetId,
  type OfficeResolvedDuty,
} from './duty-registry'
import {
  isOfficePositionWalkable,
  moveAliceOnOfficeMap,
  officeCollisionRects,
} from './map-collision'
import {
  officeFloorTerminalPosition,
  officeOperationsBoardPosition,
  officeServiceLandmarks,
} from './map-landmarks'
import { layoutOfficeMap } from './map-layout'
import { officeDepthAt } from './scene-depth'
import { useReducedMotion } from './use-reduced-motion'
import type { OfficeShift } from './useOfficeShift'
import type { OfficeActivityKind, OfficeProductActivityState } from './useOfficeProductActivity'

const OFFICE_MOVEMENTS = {
  left: { x: -24, y: 0, direction: 'left' as const },
  right: { x: 24, y: 0, direction: 'right' as const },
  up: { x: 0, y: -24, direction: 'up' as const },
  down: { x: 0, y: 24, direction: 'down' as const },
}

export function officeRouteStatusEdge(
  alicePosition: { x: number; y: number },
  cameraPosition: { x: number; y: number },
  viewport: { width: number; height: number },
  mapHeight: number,
): 'top' | 'bottom' {
  return alicePosition.y + cameraPosition.y >= (viewport.height || mapHeight) / 2
    ? 'top'
    : 'bottom'
}

type OfficeMovement = { x: number; y: number; direction: OfficeAliceDirection }
const OFFICE_MOVEMENT_KEYS: Record<string, OfficeMovement> = {
  arrowleft: OFFICE_MOVEMENTS.left,
  a: OFFICE_MOVEMENTS.left,
  arrowright: OFFICE_MOVEMENTS.right,
  d: OFFICE_MOVEMENTS.right,
  arrowup: OFFICE_MOVEMENTS.up,
  w: OFFICE_MOVEMENTS.up,
  arrowdown: OFFICE_MOVEMENTS.down,
  s: OFFICE_MOVEMENTS.down,
}
const OFFICE_MANUAL_MOVE_INTERVAL_MS = 96
const OFFICE_DIAGONAL_STEP = 17
const OFFICE_DEPARTURE_MS = 520
const OFFICE_CAMERA_RECENTER_THRESHOLD = 48
const OFFICE_PROMPT_DESK_HALF_WIDTH = 46
const OFFICE_PROMPT_DESK_TOP = 35
const OFFICE_PROMPT_DESK_BOTTOM = 36
const OFFICE_PROMPT_SIGN_HALF_WIDTH = 132
const OFFICE_PROMPT_SIGN_HALF_HEIGHT = 32
const OFFICE_PROMPT_CABINET_HALF_WIDTH = 24
const OFFICE_PROMPT_CABINET_TOP = 36
const OFFICE_PROMPT_CABINET_BOTTOM = 32
const OFFICE_PROMPT_ROSTER_HALF_WIDTH = 34
const OFFICE_PROMPT_ROSTER_HALF_HEIGHT = 30
const OFFICE_PROMPT_OPERATIONS_HALF_WIDTH = 88
const OFFICE_PROMPT_OPERATIONS_HALF_HEIGHT = 66
const OFFICE_PROMPT_OPERATIONS_SIGN_CLEARANCE = 28
const OFFICE_PROMPT_TERMINAL_HALF_WIDTH = 26
const OFFICE_PROMPT_TERMINAL_TOP = 52
const OFFICE_PROMPT_TERMINAL_BOTTOM = 26
export type OfficeLogOrigin =
  | 'menu'
  | 'operations'
  | 'employee'
  | 'floor-terminal'
  | 'inbox-service'
  | 'news-service'
type OfficeAcknowledgementTarget =
  | 'operations'
  | 'floor-terminal'
  | 'inbox-service'
  | OfficeEmployeeDutyTargetId

function isOfficeEmployeeTargetId(targetId: string): targetId is OfficeEmployeeDutyTargetId {
  return targetId.startsWith('employee:')
}

export interface OfficePlayerState {
  position: { x: number; y: number }
  direction: OfficeAliceDirection
}

export function OfficeBuilding({
  building,
  groupTitle,
  selected,
  replaySeq = null,
  replayFocus = null,
  interactionSuspended = false,
  menuResumeToken = 0,
  initialPlayerState = null,
  onPlayerStateChange,
  onSelectEmployee,
  onOpenEmployee,
  onOpenWorkspace,
  onOpenFiles,
  onOpenRoster,
  onOpenLog,
  productActivity = {
    agent: null,
    inbox: null,
    news: null,
    attention: { agent: false, inbox: false, news: false },
    pending: { agent: 0, inbox: 0, news: 0 },
    freshKind: null,
  },
  dutyCandidates,
  dutyStatus = 'ready',
  dutyShift,
  inboxBacklogCount = 0,
  dutyAcknowledgement,
  onOpenDuty,
  reviewedCadenceFollowUps = [],
  onOpenCadenceFollowUp,
  onStartNextShift,
  onOpenService,
  onReturnLive,
  coworkerAssets: retainedCoworkerAssets,
}: {
  building: OfficeBuildingSnapshot
  groupTitle?: (workspaceId: string, tag: string) => string
  selected?: { workspaceId: string; resumeId: string } | null
  replaySeq?: number | null
  replayFocus?: OfficeReplayFocus | null
  interactionSuspended?: boolean
  menuResumeToken?: number
  initialPlayerState?: OfficePlayerState | null
  onPlayerStateChange?: (state: OfficePlayerState) => void
  onSelectEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenWorkspace: (workspaceId: string) => void
  onOpenFiles: (workspaceId: string) => void
  onOpenRoster: (workspaceId: string) => void
  onOpenLog: (origin: OfficeLogOrigin) => void
  productActivity?: OfficeProductActivityState
  dutyCandidates?: readonly OfficeDutyCandidate[]
  dutyStatus?: OfficeDutySourceStatus
  dutyShift?: Pick<OfficeShift,
    'state' | 'total' | 'completed' | 'position' | 'remainingMinutes' | 'backlogCount' | 'canStartNext'>
  inboxBacklogCount?: number
  dutyAcknowledgement?: {
    readonly token: number
    readonly targetId: OfficeDutyTargetId
    readonly label?: string
  } | null
  onOpenDuty?: (duty: OfficeResolvedDuty) => void
  reviewedCadenceFollowUps?: readonly OfficeCadenceDutyCandidate[]
  onOpenCadenceFollowUp?: (duty: OfficeCadenceDutyCandidate) => void
  onStartNextShift?: () => void
  onOpenService?: (kind: 'inbox' | 'news', seq?: number) => void
  onReturnLive?: () => void
  coworkerAssets?: ReadonlyMap<string, OfficeCoworkerSpriteAsset>
}) {
  const { t } = useTranslation()
  const hiddenGroupCountId = useId()
  const officeTime = useEffectivePreferenceSlot()
  const reducedMotion = useReducedMotion()
  const [showAll, setShowAll] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const floorInteractionSuspended = interactionSuspended || menuOpen
  const [camera, setCamera] = useState({ x: 0, y: 0 })
  const initialPlayerStateRef = useRef(initialPlayerState)
  const initialLayoutKeyRef = useRef<string | null>(null)
  const [alice, setAlice] = useState(initialPlayerState?.position ?? { x: 480, y: 336 })
  const aliceRef = useRef(alice)
  const [aliceDirection, setAliceDirection] = useState<OfficeAliceDirection>(
    initialPlayerState?.direction ?? 'down',
  )
  const liveExcursionRef = useRef({
    player: initialPlayerState ?? { position: { x: 480, y: 336 }, direction: 'down' as const },
    camera,
  })
  const previousReplaySeqRef = useRef(replaySeq)
  const [aliceWalking, setAliceWalking] = useState(false)
  const [aliceSprinting, setAliceSprinting] = useState(false)
  const [alicePushing, setAlicePushing] = useState(false)
  const [aliceBumped, setAliceBumped] = useState(false)
  const [collisionImpact, setCollisionImpact] = useState<OfficeCollisionImpactState | null>(null)
  const [panning, setPanning] = useState(false)
  const [controlsLearned, setControlsLearned] = useState(false)
  const [interactionAnchorTargetId, setInteractionAnchorTargetId] = useState<string | null>(null)
  const [acknowledgedTargetId, setAcknowledgedTargetId] = useState<OfficeAcknowledgementTarget | null>(null)
  const [acknowledgementLabel, setAcknowledgementLabel] = useState('OK')
  const previousAttentionRef = useRef(productActivity.attention)
  const pendingAcknowledgementRef = useRef<OfficeAcknowledgementTarget | null>(null)
  const acknowledgementTimerRef = useRef<number | null>(null)
  const lastDutyAcknowledgementTokenRef = useRef(dutyAcknowledgement?.token ?? 0)
  const previousNextDutyIdRef = useRef<string | null | undefined>(undefined)
  const [routeTargetId, setRouteTargetId] = useState<string | null>(null)
  const [routeTrail, setRouteTrail] = useState<readonly OfficeInteractionPathStep[]>([])
  const [departingWorkspace, setDepartingWorkspace] = useState<{
    workspaceId: string
    roomName: string
  } | null>(null)
  const controlsSuspended = floorInteractionSuspended || Boolean(departingWorkspace)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const shouldClaimInitialFocusRef = useRef(!interactionSuspended && !selected)
  const mapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    cameraX: number
    cameraY: number
  } | null>(null)
  const bumpTimerRef = useRef<number | null>(null)
  const impactTimerRef = useRef<number | null>(null)
  const impactSerialRef = useRef(0)
  const pushDirectionRef = useRef<OfficeAliceDirection | null>(null)
  const bumpFrameRef = useRef<number | null>(null)
  const walkTimerRef = useRef<number | null>(null)
  const touchMoveDelayRef = useRef<number | null>(null)
  const touchMoveRepeatRef = useRef<number | null>(null)
  const touchMovePointersRef = useRef(new Map<number, OfficeAliceDirection>())
  const lastTouchMoveDirectionRef = useRef<OfficeAliceDirection | null>(null)
  const manualMoveRepeatRef = useRef<number | null>(null)
  const manualMoveKeysRef = useRef(new Set<string>())
  const manualMoveSprintRef = useRef(false)
  const lastManualMoveKeyRef = useRef<string | null>(null)
  const manualMoveOriginRef = useRef<{ x: number; y: number } | null>(null)
  const manualMoveHasRepeatedRef = useRef(false)
  const manualMoveTickRef = useRef<() => void>(() => {})
  const routeTimerRef = useRef<number | null>(null)
  const routeContinuationRef = useRef<(() => void) | null>(null)
  const routeContinuationDelayRef = useRef(0)
  const floorInteractionSuspendedRef = useRef(floorInteractionSuspended)
  const departureTimerRef = useRef<number | null>(null)

  const routeGenerationRef = useRef(0)
  const replayFocusKeyRef = useRef<string | null>(null)
  const restoreFloorFocusRef = useRef(true)
  const handledMenuResumeTokenRef = useRef(menuResumeToken)
  const activityLogMenuItemRef = useRef<HTMLDivElement | null>(null)
  const pauseMenuRef = useRef<HTMLDivElement | null>(null)
  const resumeActivityLogFocusRef = useRef(false)
  floorInteractionSuspendedRef.current = floorInteractionSuspended

  useLayoutEffect(() => {
    if (!shouldClaimInitialFocusRef.current) return
    viewportRef.current?.focus({ preventScroll: true })
  }, [])

  const recentGroups = useMemo(
    () => building.offices.filter((office) => !office.sleeping),
    [building.offices],
  )
  const defaultGroups = useMemo(() => {
    const minimumGroupIds = new Set<string>()
    for (const harness of ['chat', 'auto-quant', 'prediction', 'other'] as const) {
      const minimum = building.config.harnessMinimumVisibleGroups[harness]
      const candidates = building.offices
        .filter((office) => office.workspace.harness === harness)
        .sort((a, b) => (b.lastInteractionAt ?? 0) - (a.lastInteractionAt ?? 0))
      for (const office of candidates.slice(0, minimum)) {
        minimumGroupIds.add(office.workspace.id)
      }
    }
    return building.offices.filter((office) =>
      !office.sleeping || minimumGroupIds.has(office.workspace.id))
  }, [building.config.harnessMinimumVisibleGroups, building.offices])
  const hiddenGroupCount = building.offices.length - defaultGroups.length
  const showingAll = showAll && hiddenGroupCount > 0
  const groups = showingAll ? building.offices : defaultGroups
  useEffect(() => {
    if (
      replaySeq == null
      || !replayFocus?.workspaceId
      || hiddenGroupCount === 0
      || groups.some((group) => group.workspace.id === replayFocus.workspaceId)
    ) return
    if (building.offices.some((office) => office.workspace.id === replayFocus.workspaceId)) {
      setShowAll(true)
    }
  }, [building.offices, groups, hiddenGroupCount, replayFocus?.workspaceId, replaySeq])
  const stats = useMemo(() => {
    const employees = groups.flatMap((office) => office.employees)
    return {
      occupied: employees.length,
      awake: employees.filter((employee) => employee.awake).length,
      active: employees.filter((employee) => employee.mood !== 'idle').length,
      working: employees.filter((employee) =>
        employee.mood === 'working' || employee.mood === 'talking').length,
    }
  }, [groups])
  const mapLayout = useMemo(
    () => layoutOfficeMap(groups.map((group) => ({
      id: group.workspace.id,
      harness: group.workspace.harness,
    }))),
    [groups],
  )
  const mapLayoutGeometryKey = useMemo(() => [
    `${mapLayout.width}x${mapLayout.height}`,
    ...mapLayout.pods.map((pod) => `${pod.id}@${pod.x},${pod.y}:${pod.width}x${pod.height}`),
    `service@${mapLayout.serviceZone.x},${mapLayout.serviceZone.y}:${mapLayout.serviceZone.width}x${mapLayout.serviceZone.height}`,
  ].join('|'), [mapLayout])
  const cameraPannable = viewportSize.width <= 0 || viewportSize.height <= 0
    || viewportSize.width < mapLayout.width
    || viewportSize.height < mapLayout.height
  const centeredCamera = viewportSize.width > 0 && viewportSize.height > 0
    ? officeCameraCenteredOn(alice, viewportSize, mapLayout)
    : camera
  const cameraRecenterAvailable = cameraPannable && (
    Math.abs(camera.x - centeredCamera.x) >= OFFICE_CAMERA_RECENTER_THRESHOLD
    || Math.abs(camera.y - centeredCamera.y) >= OFFICE_CAMERA_RECENTER_THRESHOLD
  )
  const rosterWorkspaceIds = useMemo(
    () => new Set(groups.filter((group) => group.employees.length > 4).map((group) => group.workspace.id)),
    [groups],
  )
  const collisionRects = useMemo(
    () => officeCollisionRects(mapLayout, rosterWorkspaceIds),
    [mapLayout, rosterWorkspaceIds],
  )
  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.workspace.id, group])),
    [groups],
  )
  const localCoworkerAssets = useMemo(() => {
    const assets = new Map<string, OfficeCoworkerSpriteAsset>()
    for (const group of groups) {
      for (const [resumeId, asset] of officeCoworkerCast(group.employees)) assets.set(resumeId, asset)
    }
    return assets
  }, [groups])
  const coworkerAssets = retainedCoworkerAssets ?? localCoworkerAssets
  const resolveGroupTitle = useMemo(
    () => groupTitle ?? ((_workspaceId: string, tag: string) => tag),
    [groupTitle],
  )
  const previousDeskSeatIdsRef = useRef(new Map<string, readonly (string | null)[]>())
  const replaySeatFocus = replaySeq != null && replayFocus?.seq === replaySeq
    ? { workspaceId: replayFocus.workspaceId, resumeId: replayFocus.resumeId }
    : null
  const deskSlotsByWorkspace = useMemo(
    () => new Map(groups.map((group) => [
      group.workspace.id,
      stableDeskSlotsForOffice(
        group.employees,
        previousDeskSeatIdsRef.current.get(group.workspace.id) ?? [],
        4,
        replaySeatFocus?.workspaceId === group.workspace.id ? replaySeatFocus.resumeId : null,
      ),
    ])),
    [groups, replaySeatFocus?.resumeId, replaySeatFocus?.workspaceId],
  )
  useLayoutEffect(() => {
    previousDeskSeatIdsRef.current = new Map(Array.from(deskSlotsByWorkspace, ([workspaceId, slots]) => [
      workspaceId,
      slots.map((employee) => employee?.resumeId ?? null),
    ]))
  }, [deskSlotsByWorkspace])
  const interactionTargets = useMemo(
    () => officeInteractionTargets(groups, mapLayout, resolveGroupTitle, deskSlotsByWorkspace),
    [deskSlotsByWorkspace, groups, mapLayout, resolveGroupTitle],
  )
  const interactionTargetById = useMemo(
    () => new Map(interactionTargets.map((target) => [target.id, target])),
    [interactionTargets],
  )
  const interactionTargetByIdRef = useRef(interactionTargetById)
  useLayoutEffect(() => {
    interactionTargetByIdRef.current = interactionTargetById
  }, [interactionTargetById])
  const replayFocusTarget = useMemo(() => {
    if (replaySeq == null || replayFocus?.seq !== replaySeq) return null
    for (const targetId of replayFocus.targetIds) {
      const target = interactionTargetById.get(targetId)
      if (target) return target
    }
    return null
  }, [interactionTargetById, replayFocus, replaySeq])
  const availableInteractionTargets = useMemo(
    () => replaySeq == null
      ? interactionTargets
      : interactionTargets.filter((target) => (
          target.kind === 'operations' || target.id === replayFocusTarget?.id
        )),
    [interactionTargets, replayFocusTarget?.id, replaySeq],
  )
  const routeTarget = routeTargetId ? interactionTargetById.get(routeTargetId) : null
  const routeTargetName = routeTarget
    ? routeTarget.kind === 'employee'
      ? officeCoworkerCallsign(routeTarget.employee, coworkerAssets.get(routeTarget.employee.resumeId))
      : routeTarget.kind === 'operations'
        ? t('office.operationsBoard')
        : routeTarget.kind === 'floor-terminal'
          ? t('office.floorTerminal')
          : routeTarget.kind === 'inbox-service'
            ? t('office.inboxStation')
            : routeTarget.kind === 'news-service'
              ? t('office.newsStation')
              : routeTarget.kind === 'cabinet'
                ? `${t('office.cabinet')} · ${routeTarget.roomName}`
                : routeTarget.kind === 'roster'
                  ? `${t('office.roster')} · ${routeTarget.roomName}`
                  : routeTarget.roomName
    : null
  const legacyDutyCandidates = useMemo(() => projectOfficeDutyQueue(coreOfficeDutyRegistrations({
    now: Date.now(),
    inboxDeliveries: [],
    inboxStatus: 'ready',
    issues: null,
    issueStatus: 'ready',
  })).candidates, [productActivity])
  const currentDutyCandidates = dutyCandidates ?? legacyDutyCandidates
  const currentDutyStatus = dutyCandidates ? dutyStatus : 'ready'
  const currentShiftState = dutyShift?.state
    ?? (currentDutyCandidates.length > 0
      ? 'active'
      : currentDutyStatus === 'ready' ? 'quiet'
        : currentDutyStatus === 'loading' ? 'planning' : 'degraded')
  const currentDutyCandidate = currentDutyCandidates[0] ?? null
  const nextDuty = replaySeq == null && currentDutyCandidate
    ? resolveOfficeDutyTarget(
        currentDutyCandidate,
        (targetId) => interactionTargetById.has(targetId),
      )
    : null
  const nextDutyTarget = nextDuty ? interactionTargetById.get(nextDuty.targetId) : null
  const nextInboxRoutine = nextDuty?.kind === 'inbox'
    ? nextDuty.delivery.declaredIssue
    : null
  const nextDutyName = nextDuty
    ? nextDuty.kind === 'cadence'
      ? nextDuty.cadence.title
      : nextDuty.kind === 'inbox'
      ? nextInboxRoutine?.title ?? nextDuty.delivery.title
      : nextDutyTarget?.kind === 'employee'
        ? officeCoworkerCallsign(
            nextDutyTarget.employee,
            coworkerAssets.get(nextDutyTarget.employee.resumeId),
          )
        : t('office.operationsBoard')
    : null
  const nextDutyCategory = nextDuty
    ? nextDuty.kind === 'cadence'
      ? t('office.cadenceReview')
      : nextDuty.kind === 'inbox'
        ? t(nextInboxRoutine ? 'office.routineReport' : 'office.logChannelInbox')
        : t('office.logChannelAgent')
    : null
  const nextDutyContext = nextDuty
    ? nextDuty.kind === 'cadence'
      ? nextDuty.cadence.workspaceTag
      : nextDuty.kind === 'inbox'
        ? nextDuty.delivery.entry.workspaceLabel ?? nextDuty.delivery.entry.workspaceId
        : nextDuty.landmark.source
    : null
  const currentInboxDutyCandidate = currentDutyCandidate?.kind === 'inbox'
    ? currentDutyCandidate
    : null
  const currentInboxDuty = currentInboxDutyCandidate
    ? resolveOfficeDutyTarget(currentInboxDutyCandidate)
    : null
  const currentCadenceDutyCandidate = currentDutyCandidate?.kind === 'cadence'
    ? currentDutyCandidate
    : null
  const currentOperationsCadenceDuty = currentCadenceDutyCandidate
    ? resolveOfficeDutyTarget(currentCadenceDutyCandidate)
    : null
  const queuedCadenceDutyCandidate = currentDutyCandidates.find((duty) => duty.kind === 'cadence')
  const queuedOperationsCadenceDuty = queuedCadenceDutyCandidate?.kind === 'cadence'
    ? resolveOfficeDutyTarget(queuedCadenceDutyCandidate)
    : null
  const reviewedCadenceFollowUp = replaySeq == null
    ? reviewedCadenceFollowUps[0] ?? null
    : null
  const reviewedCadenceFollowUpCount = replaySeq == null
    ? reviewedCadenceFollowUps.length
    : 0
  const operationsFollowUp = !currentOperationsCadenceDuty
    && reviewedCadenceFollowUp
    && onOpenCadenceFollowUp
    ? reviewedCadenceFollowUp
    : null
  const operationsInteractionMode = currentOperationsCadenceDuty
    ? 'current-cadence'
    : operationsFollowUp
      ? 'reviewed-follow-up'
      : 'ambient'
  const operationsNeedsAttention = productActivity.attention.agent
    || Boolean(queuedOperationsCadenceDuty)
    || reviewedCadenceFollowUpCount > 0
  const operationsPending = operationsInteractionMode === 'current-cadence'
    ? currentCadenceDutyCandidate?.count ?? 0
    : operationsInteractionMode === 'reviewed-follow-up'
      ? reviewedCadenceFollowUpCount
      : queuedOperationsCadenceDuty?.count ?? productActivity.pending.agent
  const routeStatusEdge = officeRouteStatusEdge(alice, camera, viewportSize, mapLayout.height)
  const operationsBoard = useMemo(
    () => officeOperationsBoardPosition(mapLayout.width),
    [mapLayout.width],
  )
  const floorTerminal = useMemo(
    () => officeFloorTerminalPosition(mapLayout.width),
    [mapLayout.width],
  )
  const serviceLandmarks = useMemo(
    () => officeServiceLandmarks(mapLayout),
    [mapLayout],
  )
  useEffect(() => {
    const previous = previousAttentionRef.current
    const current = productActivity.attention
    const agentTarget = interactionAnchorTargetId === 'operations'
      || interactionAnchorTargetId === 'floor-terminal'
      || (interactionAnchorTargetId != null && isOfficeEmployeeTargetId(interactionAnchorTargetId))
      ? interactionAnchorTargetId
      : null
    if (previous.agent && !current.agent && agentTarget) {
      pendingAcknowledgementRef.current = agentTarget
    }
    previousAttentionRef.current = current
  }, [interactionAnchorTargetId, interactionSuspended, productActivity.attention])
  useEffect(() => {
    if (interactionSuspended || !pendingAcknowledgementRef.current) return
    const targetId = pendingAcknowledgementRef.current
    pendingAcknowledgementRef.current = null
    if (acknowledgementTimerRef.current != null) {
      window.clearTimeout(acknowledgementTimerRef.current)
    }
    setAcknowledgedTargetId(targetId)
    setAcknowledgementLabel('OK')
    acknowledgementTimerRef.current = window.setTimeout(() => {
      acknowledgementTimerRef.current = null
      setAcknowledgedTargetId(null)
    }, 900)
  }, [interactionSuspended, productActivity.attention])
  useEffect(() => {
    if (!dutyAcknowledgement
      || dutyAcknowledgement.token === lastDutyAcknowledgementTokenRef.current
      || interactionSuspended) return
    lastDutyAcknowledgementTokenRef.current = dutyAcknowledgement.token
    if (acknowledgementTimerRef.current != null) {
      window.clearTimeout(acknowledgementTimerRef.current)
    }
    setAcknowledgedTargetId(dutyAcknowledgement.targetId)
    setAcknowledgementLabel(dutyAcknowledgement.label ?? 'OK')
    acknowledgementTimerRef.current = window.setTimeout(() => {
      acknowledgementTimerRef.current = null
      setAcknowledgedTargetId(null)
    }, 900)
  }, [dutyAcknowledgement, interactionSuspended])
  const nearbyTarget = useMemo(
    () => {
      if (
        floorInteractionSuspended
        || departingWorkspace
        || selected
        || routeTargetId
        || acknowledgedTargetId
      ) return null
      const anchoredTarget = interactionAnchorTargetId
        ? availableInteractionTargets.find((target) => target.id === interactionAnchorTargetId)
        : null
      const anchoredNearbyTarget = anchoredTarget
        ? nearestOfficeInteractionTarget(alice, aliceDirection, [anchoredTarget])
        : null
      return anchoredNearbyTarget
        ?? nearestOfficeInteractionTarget(alice, aliceDirection, availableInteractionTargets)
    },
    [
      alice,
      aliceDirection,
      acknowledgedTargetId,
      availableInteractionTargets,
      departingWorkspace,
      floorInteractionSuspended,
      interactionAnchorTargetId,
      routeTargetId,
      selected,
    ],
  )
  const nearbyService = nearbyTarget?.kind === 'inbox-service'
    || nearbyTarget?.kind === 'news-service'
    || nearbyTarget?.kind === 'operations'
  const nearbyDialogue = replaySeq != null
    || (nearbyTarget?.kind === 'employee' && Boolean(nearbyTarget.employee.bubble))
  const nearbyRichPrompt = nearbyService || nearbyDialogue
  const replayFocusIsNearby = replayFocusTarget != null
    && nearbyTarget?.id === replayFocusTarget.id
  const promptAvoidBounds = useMemo<OfficePromptAvoidBounds[]>(() => {
    const bounds: OfficePromptAvoidBounds[] = []
    if (!nearbyTarget) return bounds
    const avoidWholeFloor = nearbyTarget.kind === 'operations'
    const nearbyWorkspaceId = 'workspaceId' in nearbyTarget
      ? nearbyTarget.workspaceId
      : null
    if (!avoidWholeFloor && nearbyTarget.kind !== 'roster' && !nearbyDialogue) return bounds
    bounds.push(...availableInteractionTargets.flatMap((target) => {
      if (target.id === nearbyTarget.id) return []
      if (target.kind === 'sign') {
        if (!avoidWholeFloor && target.workspaceId !== nearbyWorkspaceId) return []
        return [{
          left: target.x - OFFICE_PROMPT_SIGN_HALF_WIDTH,
          top: target.y - OFFICE_PROMPT_SIGN_HALF_HEIGHT,
          right: target.x + OFFICE_PROMPT_SIGN_HALF_WIDTH,
          bottom: target.y + OFFICE_PROMPT_SIGN_HALF_HEIGHT,
        }]
      }
      if (!('workspaceId' in target)) return []
      if (!avoidWholeFloor && target.workspaceId !== nearbyWorkspaceId) return []
      if (target.kind === 'employee') {
        return [{
          left: target.x - OFFICE_PROMPT_DESK_HALF_WIDTH,
          top: target.y - OFFICE_PROMPT_DESK_TOP,
          right: target.x + OFFICE_PROMPT_DESK_HALF_WIDTH,
          bottom: target.y + OFFICE_PROMPT_DESK_BOTTOM,
        }]
      }
      if (target.kind === 'cabinet') {
        return [{
          left: target.x - OFFICE_PROMPT_CABINET_HALF_WIDTH,
          top: target.y - OFFICE_PROMPT_CABINET_TOP,
          right: target.x + OFFICE_PROMPT_CABINET_HALF_WIDTH,
          bottom: target.y + OFFICE_PROMPT_CABINET_BOTTOM,
        }]
      }
      if (target.kind === 'roster') {
        return [{
          left: target.x - OFFICE_PROMPT_ROSTER_HALF_WIDTH,
          top: target.y - OFFICE_PROMPT_ROSTER_HALF_HEIGHT,
          right: target.x + OFFICE_PROMPT_ROSTER_HALF_WIDTH,
          bottom: target.y + OFFICE_PROMPT_ROSTER_HALF_HEIGHT,
        }]
      }
      return []
    }))
    return bounds
  }, [availableInteractionTargets, nearbyDialogue, nearbyTarget])
  const promptTargetBounds = useMemo<OfficePromptAvoidBounds | undefined>(() => {
    if (nearbyTarget?.kind === 'operations') {
      return {
        left: operationsBoard.x - OFFICE_PROMPT_OPERATIONS_HALF_WIDTH,
        top: operationsBoard.y - OFFICE_PROMPT_OPERATIONS_HALF_HEIGHT,
        right: operationsBoard.x + OFFICE_PROMPT_OPERATIONS_HALF_WIDTH,
        bottom: operationsBoard.y + OFFICE_PROMPT_OPERATIONS_HALF_HEIGHT,
      }
    }
    if (nearbyTarget?.kind === 'floor-terminal') {
      return {
        left: floorTerminal.x - OFFICE_PROMPT_TERMINAL_HALF_WIDTH,
        top: floorTerminal.y - OFFICE_PROMPT_TERMINAL_TOP,
        right: floorTerminal.x + OFFICE_PROMPT_TERMINAL_HALF_WIDTH,
        bottom: floorTerminal.y + OFFICE_PROMPT_TERMINAL_BOTTOM,
      }
    }
    if (nearbyTarget?.kind !== 'inbox-service' && nearbyTarget?.kind !== 'news-service') {
      return undefined
    }
    const landmark = serviceLandmarks.find((item) => item.id === nearbyTarget.id)
    if (!landmark) return undefined
    return {
      left: landmark.x,
      top: landmark.y,
      right: landmark.x + landmark.width,
      bottom: landmark.y + landmark.height,
    }
  }, [floorTerminal, nearbyTarget, operationsBoard, serviceLandmarks])
  const promptPlacement = useMemo(() => {
    if (!nearbyTarget) return null
    const narrowPrompt = viewportSize.width > 0 && viewportSize.width <= 520
    const maxWidth = nearbyDialogue
      ? narrowPrompt
        ? OFFICE_PROMPT_NARROW_DIALOGUE_MAX_WIDTH
        : OFFICE_PROMPT_DIALOGUE_MAX_WIDTH
      : nearbyService
        ? narrowPrompt
          ? OFFICE_PROMPT_NARROW_SERVICE_MAX_WIDTH
          : OFFICE_PROMPT_SERVICE_MAX_WIDTH
        : nearbyTarget.kind === 'sign'
          ? OFFICE_PROMPT_DESTINATION_MAX_WIDTH
          : nearbyTarget.kind === 'employee' && nearbyTarget.employee.bubble
            ? narrowPrompt
              ? OFFICE_PROMPT_NARROW_DETAIL_MAX_WIDTH
              : OFFICE_PROMPT_DETAIL_MAX_WIDTH
            : undefined
    const placement = officeInteractionPromptPlacement(
      alice,
      nearbyTarget,
      {
        width: viewportSize.width || mapLayout.width,
        height: viewportSize.height || mapLayout.height,
      },
      camera,
      maxWidth,
      nearbyRichPrompt ? OFFICE_PROMPT_SERVICE_MAX_HEIGHT : undefined,
      promptAvoidBounds,
      promptTargetBounds,
    )
    if (nearbyTarget.kind === 'operations' && placement.side === 'above') {
      return {
        ...placement,
        y: placement.y - OFFICE_PROMPT_OPERATIONS_SIGN_CLEARANCE,
      }
    }
    return placement
  }, [
    alice,
    camera,
    mapLayout.height,
    mapLayout.width,
    nearbyDialogue,
    nearbyRichPrompt,
    nearbyService,
    nearbyTarget,
    promptAvoidBounds,
    promptTargetBounds,
    viewportSize,
  ])
  const promptPresentation: {
    icon: string
    action: string
    label: string
    detail: string | null
    source?: string | null
  } | null = (() => {
    if (!nearbyTarget) return null
    if (replaySeq != null) {
      const focusedReplay = replayFocus?.seq === replaySeq ? replayFocus : null
      return {
        icon: OFFICE_HUD_ASSETS.occupancyLog,
        action: t('office.replayInspectAction'),
        label: t('office.replayInspect', { seq: replaySeq }),
        detail: focusedReplay?.summary ?? null,
        source: focusedReplay?.label,
      }
    }
    if (nearbyTarget.kind === 'employee') {
      const target = officeCoworkerCallsign(
        nearbyTarget.employee,
        coworkerAssets.get(nearbyTarget.employee.resumeId),
      )
      const isAgentDutyTarget = nextDuty?.kind === 'agent'
        && nextDuty.targetId === nearbyTarget.id
      const failed = nearbyTarget.employee.mood === 'failed'
        || (isAgentDutyTarget && (
          productActivity.agent?.eventType === 'runtime.spawn_failed'
          || productActivity.agent?.eventType === 'runtime.rejected'
          || productActivity.agent?.eventType === 'runtime.turn.error'
        ))
      const hasFreshResult = nearbyTarget.employee.mood === 'review'
        || (isAgentDutyTarget
          && productActivity.agent?.eventType === 'runtime.stopped'
          && productActivity.agent.status === 'done')
      const canTalk = nearbyTarget.employee.awake
      const interaction = failed
        ? {
            icon: OFFICE_LOG_ASSETS.alert,
            action: t('office.interactActionReview'),
            label: t('office.interactFailure', { name: target }),
          }
        : hasFreshResult
          ? {
              icon: OFFICE_COWORKER_EMOTES.review,
              action: t('office.interactActionReview'),
              label: t('office.interactResult', { name: target }),
            }
          : isAgentDutyTarget
            ? {
                icon: OFFICE_HUD_ASSETS.occupancyLog,
                action: t('office.interactActionReview'),
                label: t('office.interactDutyRun', { name: target }),
              }
          : canTalk
            ? {
                icon: OFFICE_HUD_ASSETS.talkBubble,
                action: t('office.interactActionTalk'),
                label: t('office.interactTalk', { name: target }),
              }
            : {
                icon: OFFICE_HUD_ASSETS.rosterBadge,
                action: t('office.interactActionCheck'),
                label: t('office.interactCheck', { name: target }),
              }
      return {
        ...interaction,
        detail: nearbyTarget.employee.bubble
          ? officeBubbleText(nearbyTarget.employee.bubble, t)
          : null,
      }
    }
    if (nearbyTarget.kind === 'sign') {
      return {
        icon: OFFICE_HUD_ASSETS.sessionPortal,
        action: t(`office.harness.${nearbyTarget.harness}`),
        label: t('office.interactWorkspace', { name: nearbyTarget.roomName }),
        detail: null,
      }
    }
    if (nearbyTarget.kind === 'cabinet') {
      return {
        icon: OFFICE_HUD_ASSETS.drawerRecord,
        action: t('office.interactActionFiles'),
        label: t('office.interactFiles', { name: nearbyTarget.roomName }),
        detail: null,
      }
    }
    if (nearbyTarget.kind === 'roster') {
      return {
        icon: OFFICE_HUD_ASSETS.rosterBadge,
        action: t('office.interactActionRoster'),
        label: t('office.interactRoster', { name: nearbyTarget.roomName }),
        detail: t('office.rosterAdditional', { count: nearbyTarget.additionalCount }),
      }
    }
    if (nearbyTarget.kind === 'floor-terminal') {
      return {
        icon: OFFICE_HUD_ASSETS.menuTerminal,
        action: t('office.interactActionTerminal'),
        label: t('office.interactTerminal'),
        detail: null,
      }
    }
    if (nearbyTarget.kind === 'inbox-service') {
      return {
        icon: OFFICE_FURNITURE.generated.inboxTerminal,
        action: t('office.interactActionInbox'),
        label: t('office.interactInbox'),
        detail: currentInboxDutyCandidate?.delivery.title
          ?? productActivity.inbox?.detail
          ?? productActivity.inbox?.source
          ?? null,
        source: currentInboxDutyCandidate?.delivery.entry.workspaceLabel
          ?? currentInboxDutyCandidate?.delivery.entry.workspaceId
          ?? productActivity.inbox?.source,
      }
    }
    if (nearbyTarget.kind === 'news-service') {
      return {
        icon: OFFICE_FURNITURE.generated.newsTerminal,
        action: t('office.interactActionNews'),
        label: t('office.interactNews'),
        detail: productActivity.news?.detail ?? productActivity.news?.source ?? null,
        source: productActivity.news?.source,
      }
    }
    if (currentOperationsCadenceDuty) {
      return {
        icon: OFFICE_HUD_ASSETS.occupancyLog,
        action: t('office.interactActionOperations'),
        label: t('office.cadenceReview'),
        detail: currentCadenceDutyCandidate?.cadence.title ?? null,
        source: currentCadenceDutyCandidate?.cadence.workspaceTag,
      }
    }
    if (reviewedCadenceFollowUp && !nextDuty) {
      return {
        icon: OFFICE_HUD_ASSETS.occupancyLog,
        action: t('office.cadenceFollowUpAction'),
        label: t('office.cadenceFollowUpIssue', {
          name: reviewedCadenceFollowUp.cadence.title,
        }),
        detail: reviewedCadenceFollowUp.cadence.title,
        source: reviewedCadenceFollowUp.cadence.workspaceTag,
      }
    }
    const agentDetail = (() => {
      if (productActivity.agent?.detail) return productActivity.agent.detail
      switch (productActivity.agent?.eventType) {
        case 'session.born': return t('office.agentMilestoneBorn')
        case 'runtime.started': return t('office.agentMilestoneStarted')
        case 'runtime.spawn_failed': return t('office.agentMilestoneSpawnFailed')
        case 'runtime.rejected': return t('office.agentMilestoneRejected')
        case 'runtime.turn.error': return t('office.agentMilestoneError')
        case 'runtime.stopped':
          return productActivity.agent.status === 'done'
            ? t('office.agentMilestoneCompleted')
            : productActivity.agent.status === 'paused'
              ? t('office.agentMilestonePaused')
              : productActivity.agent.status === 'interrupted'
                ? t('office.agentMilestoneInterrupted')
                : t('office.agentMilestoneStopped')
        case 'dev.sonner_test': return t('office.agentMilestoneTest')
        default: return null
      }
    })()
    return {
      icon: OFFICE_HUD_ASSETS.occupancyLog,
      action: t('office.interactActionOperations'),
      label: t('office.interactOperations'),
      detail: agentDetail,
      source: productActivity.agent?.source,
    }
  })()
  const sleepAfterDays = Math.max(
    1,
    Math.round(building.config.workspaceSleepAfterMs / (24 * 60 * 60 * 1000)),
  )
  const clampCamera = (x: number, y: number) => {
    const viewport = viewportRef.current?.getBoundingClientRect()
    if (!viewport) return { x, y }
    return clampOfficeCamera({ x, y }, viewport, mapLayout)
  }
  const centerCameraOnAlice = () => {
    const viewport = viewportRef.current?.getBoundingClientRect()
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) return
    setCamera(officeCameraCenteredOn(aliceRef.current, viewport, mapLayout))
    viewportRef.current?.focus({ preventScroll: true })
  }
  const clearAlicePushFeedback = () => {
    if (pushDirectionRef.current == null) return
    pushDirectionRef.current = null
    if (walkTimerRef.current != null) window.clearTimeout(walkTimerRef.current)
    walkTimerRef.current = null
    setAlicePushing(false)
    setAliceWalking(false)
    setAliceSprinting(false)
  }
  const showCollisionBump = (
    movement: OfficeMovement = OFFICE_MOVEMENTS[aliceDirection],
    sprinting = false,
  ) => {
    const sustainedInput = manualMoveKeysRef.current.size > 0
      || touchMovePointersRef.current.size > 0
    if (walkTimerRef.current != null) window.clearTimeout(walkTimerRef.current)
    walkTimerRef.current = null
    setAlicePushing(sustainedInput)
    setAliceWalking(sustainedInput)
    setAliceSprinting(sustainedInput && sprinting)
    if (sustainedInput && pushDirectionRef.current === movement.direction) return
    pushDirectionRef.current = sustainedInput ? movement.direction : null
    if (bumpFrameRef.current != null) window.cancelAnimationFrame(bumpFrameRef.current)
    if (bumpTimerRef.current != null) window.clearTimeout(bumpTimerRef.current)
    setAliceBumped(false)
    if (impactTimerRef.current != null) window.clearTimeout(impactTimerRef.current)
    impactSerialRef.current += 1
    setCollisionImpact({
      serial: impactSerialRef.current,
      ...officeCollisionImpactPosition(aliceRef.current, movement, mapLayout),
    })
    impactTimerRef.current = window.setTimeout(() => {
      impactTimerRef.current = null
      setCollisionImpact(null)
    }, reducedMotion ? 220 : 380)
    bumpFrameRef.current = window.requestAnimationFrame(() => {
      setAliceBumped(true)
      bumpTimerRef.current = window.setTimeout(() => setAliceBumped(false), 140)
    })
  }
  const showAliceWalking = (sprinting = false) => {
    if (walkTimerRef.current != null) window.clearTimeout(walkTimerRef.current)
    setAliceWalking(true)
    setAliceSprinting(sprinting)
    walkTimerRef.current = window.setTimeout(() => {
      setAliceWalking(false)
      setAliceSprinting(false)
    }, 150)
  }
  const moveAlice = (
    movement: OfficeMovement,
    learnsManualControls = true,
    sprinting = false,
  ): boolean => {
    if (learnsManualControls) {
      setControlsLearned(true)
      setInteractionAnchorTargetId(null)
    }
    setAliceDirection(movement.direction)
    const move = moveAliceOnOfficeMap(aliceRef.current, movement, mapLayout, collisionRects)
    if (move.bumped) {
      showCollisionBump(movement, sprinting)
      return false
    }
    clearAlicePushFeedback()
    const next = move.position
    aliceRef.current = next
    setAlice(next)
    showAliceWalking(sprinting)
    const viewport = viewportRef.current?.getBoundingClientRect()
    if (viewport) {
      setCamera((currentCamera) => officeCameraFollowingAlice(
        next,
        currentCamera,
        viewport,
        mapLayout,
      ))
    }
    return true
  }
  const activateTarget = (target: OfficeInteractionTarget) => {
    setInteractionAnchorTargetId(target.id)
    if (replaySeq != null) {
      onOpenLog('operations')
    } else if (target.kind === 'employee') {
      onSelectEmployee(target.workspaceId, target.employee)
    } else if (target.kind === 'sign') {
      enterWorkspace(target)
    } else if (target.kind === 'cabinet') {
      onOpenFiles(target.workspaceId)
    } else if (target.kind === 'roster') {
      onOpenRoster(target.workspaceId)
    } else if (target.kind === 'floor-terminal') {
      onOpenLog('floor-terminal')
    } else if (target.kind === 'inbox-service') {
      if (currentInboxDuty && onOpenDuty) onOpenDuty(currentInboxDuty)
      else onOpenService?.('inbox', productActivity.inbox?.seq)
    } else if (target.kind === 'news-service') {
      onOpenService?.('news', productActivity.news?.seq)
    } else {
      if (operationsInteractionMode === 'reviewed-follow-up' && operationsFollowUp) {
        onOpenCadenceFollowUp?.(operationsFollowUp)
      } else {
        onOpenLog('operations')
      }
    }
  }
  const closeFloorMenu = (restoreFocus = true) => {
    if (!restoreFocus) restoreFloorFocusRef.current = false
    setMenuOpen(false)
  }
  function openFloorMenu() {
    pauseAutoWalk()
    stopTouchMove()
    setPanning(false)
    restoreFloorFocusRef.current = true
    setMenuOpen(true)
  }
  const returnToLiveFloor = () => {
    cancelAutoWalk()
    onReturnLive?.()
    requestAnimationFrame(() => viewportRef.current?.focus({ preventScroll: true }))
  }
  const activateNearbyTarget = () => {
    if (!nearbyTarget || selected || departingWorkspace || floorInteractionSuspended) return
    activateTarget(nearbyTarget)
  }
  function enterWorkspace(target: Extract<OfficeInteractionTarget, { kind: 'sign' }>) {
    if (departingWorkspace) return
    if (reducedMotion) {
      onOpenWorkspace(target.workspaceId)
      return
    }
    stopTouchMove()
    setPanning(false)
    setDepartingWorkspace({ workspaceId: target.workspaceId, roomName: target.roomName })
    departureTimerRef.current = window.setTimeout(() => {
      departureTimerRef.current = null
      try {
        onOpenWorkspace(target.workspaceId)
      } finally {
        setDepartingWorkspace(null)
      }
    }, OFFICE_DEPARTURE_MS)
  }
  function cancelAutoWalk() {
    routeGenerationRef.current += 1
    if (routeTimerRef.current != null) window.clearTimeout(routeTimerRef.current)
    routeTimerRef.current = null
    routeContinuationRef.current = null
    routeContinuationDelayRef.current = 0
    setAliceWalking(false)
    setAliceSprinting(false)
    setRouteTargetId(null)
    setRouteTrail([])
  }
  function pauseAutoWalk() {
    if (routeTimerRef.current != null) window.clearTimeout(routeTimerRef.current)
    routeTimerRef.current = null
  }
  function scheduleAutoWalk(continuation: () => void, delay: number) {
    if (routeTimerRef.current != null) window.clearTimeout(routeTimerRef.current)
    routeTimerRef.current = null
    routeContinuationRef.current = continuation
    routeContinuationDelayRef.current = delay
    if (floorInteractionSuspendedRef.current) return
    routeTimerRef.current = window.setTimeout(() => {
      routeTimerRef.current = null
      if (
        floorInteractionSuspendedRef.current
        || routeContinuationRef.current !== continuation
      ) return
      routeContinuationRef.current = null
      routeContinuationDelayRef.current = 0
      continuation()
    }, delay)
  }
  function resumeAutoWalk() {
    const continuation = routeContinuationRef.current
    if (!continuation || routeTimerRef.current != null || floorInteractionSuspendedRef.current) return
    scheduleAutoWalk(continuation, routeContinuationDelayRef.current)
  }
  const requestTargetInteraction = (
    targetId: string,
    options: {
      activate?: () => void
      anchorTarget?: boolean
      allowReplay?: boolean
      fallbackTargetId?: string
      fallbackActivate?: () => void
    } = {},
  ) => {
    if (selected || departingWorkspace || floorInteractionSuspended) return
    const target = interactionTargetById.get(targetId)
    if (!target) return
    if (replaySeq != null && target.kind !== 'operations' && !options.allowReplay) return
    setInteractionAnchorTargetId(null)
    cancelAutoWalk()
    const generation = routeGenerationRef.current
    const path = officeInteractionPath(aliceRef.current, target, mapLayout, collisionRects)
    if (!path) {
      showCollisionBump()
      return
    }
    setRouteTargetId(targetId)
    setRouteTrail(path.steps)
    let stepIndex = 0
    const finish = () => {
      if (routeGenerationRef.current !== generation) return
      setAliceDirection(path.facing)
      setAliceWalking(false)
      setRouteTargetId(null)
      scheduleAutoWalk(() => {
        if (routeGenerationRef.current !== generation) return
        setRouteTrail([])
        const currentTarget = interactionTargetByIdRef.current.get(targetId)
        if (!currentTarget) {
          const fallbackTarget = options.fallbackTargetId
            ? interactionTargetByIdRef.current.get(options.fallbackTargetId)
            : null
          if (fallbackTarget) {
            if (options.fallbackActivate) {
              if (options.anchorTarget) setInteractionAnchorTargetId(fallbackTarget.id)
              options.fallbackActivate()
            } else activateTarget(fallbackTarget)
          }
          return
        }
        if (options.activate) {
          if (options.anchorTarget) setInteractionAnchorTargetId(currentTarget.id)
          options.activate()
        } else activateTarget(currentTarget)
      }, reducedMotion ? 0 : 80)
    }
    const advance = () => {
      if (routeGenerationRef.current !== generation) return
      const step = path.steps[stepIndex]
      if (!step) {
        finish()
        return
      }
      const movement = {
        x: step.x - aliceRef.current.x,
        y: step.y - aliceRef.current.y,
        direction: step.direction,
      }
      const moved = moveAlice(movement, false)
      if (!moved || aliceRef.current.x !== step.x || aliceRef.current.y !== step.y) {
        if (moved) showCollisionBump(movement)
        cancelAutoWalk()
        return
      }
      stepIndex += 1
      setRouteTrail(stepIndex < path.steps.length ? path.steps.slice(stepIndex) : [step])
      scheduleAutoWalk(advance, reducedMotion ? 0 : 96)
    }
    advance()
  }
  useLayoutEffect(() => {
    const nextDutyId = nextDuty?.id ?? null
    const previousDutyId = previousNextDutyIdRef.current
    previousNextDutyIdRef.current = nextDutyId
    if (previousDutyId === undefined || previousDutyId === nextDutyId) return

    // A shift handoff changes the world objective in the same frame as the HUD.
    // Never leave the former landmark anchored or keep walking toward stale work.
    cancelAutoWalk()
    setInteractionAnchorTargetId(null)
  // The route canceler intentionally follows the finite duty identity, not each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextDuty?.id])
  useEffect(() => {
    if (floorInteractionSuspended) pauseAutoWalk()
    else resumeAutoWalk()
  }, [floorInteractionSuspended])
  useEffect(() => {
    if (
      handledMenuResumeTokenRef.current === menuResumeToken
      || floorInteractionSuspended
      || selected
      || departingWorkspace
    ) return
    handledMenuResumeTokenRef.current = menuResumeToken
    resumeActivityLogFocusRef.current = true
    openFloorMenu()
  }, [departingWorkspace, floorInteractionSuspended, menuResumeToken, selected])
  const movementForDirections = (
    directions: OfficeAliceDirection[],
    lastDirection?: OfficeAliceDirection | null,
  ): OfficeMovement | null => {
    const horizontal = Number(directions.includes('right')) - Number(directions.includes('left'))
    const vertical = Number(directions.includes('down')) - Number(directions.includes('up'))
    if (horizontal === 0 && vertical === 0) return null
    const diagonal = horizontal !== 0 && vertical !== 0
    const direction = lastDirection
      ?? (horizontal < 0 ? 'left' : horizontal > 0 ? 'right' : vertical < 0 ? 'up' : 'down')
    return {
      x: horizontal * (diagonal ? OFFICE_DIAGONAL_STEP : 24),
      y: vertical * (diagonal ? OFFICE_DIAGONAL_STEP : 24),
      direction,
    }
  }
  const moveAliceFromTouchPointers = () => {
    const movement = movementForDirections(
      Array.from(touchMovePointersRef.current.values()),
      lastTouchMoveDirectionRef.current,
    )
    if (movement) moveAlice(movement)
  }
  const stopTouchMove = (pointerId?: number) => {
    if (pointerId != null) {
      touchMovePointersRef.current.delete(pointerId)
      if (touchMovePointersRef.current.size > 0) {
        lastTouchMoveDirectionRef.current = Array.from(touchMovePointersRef.current.values()).at(-1) ?? null
        return
      }
    } else {
      touchMovePointersRef.current.clear()
    }
    if (touchMoveDelayRef.current != null) window.clearTimeout(touchMoveDelayRef.current)
    if (touchMoveRepeatRef.current != null) window.clearInterval(touchMoveRepeatRef.current)
    touchMoveDelayRef.current = null
    touchMoveRepeatRef.current = null
    lastTouchMoveDirectionRef.current = null
    clearAlicePushFeedback()
  }
  const startTouchMove = (direction: OfficeAliceDirection, pointerId: number) => {
    if (floorInteractionSuspended || departingWorkspace) return
    cancelAutoWalk()
    touchMovePointersRef.current.set(pointerId, direction)
    lastTouchMoveDirectionRef.current = direction
    moveAliceFromTouchPointers()
    if (touchMoveDelayRef.current == null && touchMoveRepeatRef.current == null) {
      touchMoveDelayRef.current = window.setTimeout(() => {
        touchMoveDelayRef.current = null
        touchMoveRepeatRef.current = window.setInterval(moveAliceFromTouchPointers, 96)
      }, 220)
    }
  }
  const stopManualMove = () => {
    if (manualMoveRepeatRef.current != null) window.clearInterval(manualMoveRepeatRef.current)
    manualMoveRepeatRef.current = null
    manualMoveKeysRef.current.clear()
    lastManualMoveKeyRef.current = null
    manualMoveOriginRef.current = null
    manualMoveHasRepeatedRef.current = false
    clearAlicePushFeedback()
  }
  const movementForHeldKeys = (): OfficeMovement | null => {
    const held = Array.from(manualMoveKeysRef.current)
      .map((key) => OFFICE_MOVEMENT_KEYS[key])
      .filter((movement): movement is OfficeMovement => Boolean(movement))
    const lastDirection = lastManualMoveKeyRef.current
      ? OFFICE_MOVEMENT_KEYS[lastManualMoveKeyRef.current]?.direction
      : undefined
    return movementForDirections(held.map(({ direction }) => direction), lastDirection)
  }
  const moveAliceAtManualPace = (movement: OfficeMovement) => {
    const sprinting = manualMoveSprintRef.current
    const steps = sprinting ? 2 : 1
    for (let index = 0; index < steps; index += 1) {
      if (!moveAlice(movement, true, sprinting)) break
    }
  }
  const moveAliceFromHeldKeys = () => {
    const movement = movementForHeldKeys()
    if (movement) moveAliceAtManualPace(movement)
  }
  manualMoveTickRef.current = () => {
    if (floorInteractionSuspended || departingWorkspace || selected) {
      stopManualMove()
      return
    }
    manualMoveHasRepeatedRef.current = true
    moveAliceFromHeldKeys()
  }
  useEffect(() => {
    const handleAmbientKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented
        || event.isComposing
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || floorInteractionSuspended
        || departingWorkspace
        || selected
      ) return
      const viewport = viewportRef.current
      const target = event.target
      const fromIdlePage = target === document.body
      const fromFloor = target instanceof Node && Boolean(viewport?.contains(target))
      const fromNearbyWorldTarget = target instanceof HTMLElement
        && target.dataset.nearby === 'true'
      if (!fromIdlePage && !fromFloor) return
      const key = event.key.toLowerCase()
      if (key === 'shift') {
        manualMoveSprintRef.current = true
        return
      }
      if (key === 'escape') {
        event.preventDefault()
        if (routeTargetId) {
          cancelAutoWalk()
          viewport?.focus({ preventScroll: true })
        } else {
          openFloorMenu()
        }
        return
      }
      if (
        (key === 'enter' || key === ' ')
        && nearbyTarget
        && (fromIdlePage || target === viewport || fromNearbyWorldTarget)
      ) {
        event.preventDefault()
        activateNearbyTarget()
        return
      }
      const movement = OFFICE_MOVEMENT_KEYS[key]
      if (!movement) return
      event.preventDefault()
      manualMoveSprintRef.current = event.shiftKey
      if (fromFloor && target !== viewport) viewport?.focus({ preventScroll: true })
      if (manualMoveKeysRef.current.has(key)) return
      const beginsMove = manualMoveKeysRef.current.size === 0
      if (beginsMove) {
        manualMoveOriginRef.current = { ...aliceRef.current }
        manualMoveHasRepeatedRef.current = false
      }
      manualMoveKeysRef.current.add(key)
      lastManualMoveKeyRef.current = key
      cancelAutoWalk()
      if (beginsMove) {
        moveAliceFromHeldKeys()
      } else if (!manualMoveHasRepeatedRef.current && manualMoveOriginRef.current) {
        const movement = movementForHeldKeys()
        if (movement && movement.x !== 0 && movement.y !== 0) {
          aliceRef.current = manualMoveOriginRef.current
          moveAliceAtManualPace(movement)
        }
      }
      if (manualMoveRepeatRef.current == null) {
        manualMoveRepeatRef.current = window.setInterval(
          () => manualMoveTickRef.current(),
          OFFICE_MANUAL_MOVE_INTERVAL_MS,
        )
      }
    }
    const handleAmbientKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (key === 'shift') {
        manualMoveSprintRef.current = false
        return
      }
      if (!OFFICE_MOVEMENT_KEYS[key]) return
      manualMoveKeysRef.current.delete(key)
      if (lastManualMoveKeyRef.current === key) {
        lastManualMoveKeyRef.current = Array.from(manualMoveKeysRef.current).at(-1) ?? null
      }
      if (manualMoveKeysRef.current.size === 0) stopManualMove()
    }
    const handleWindowBlur = () => {
      manualMoveSprintRef.current = false
      stopManualMove()
    }
    document.addEventListener('keydown', handleAmbientKeyDown)
    document.addEventListener('keyup', handleAmbientKeyUp)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      document.removeEventListener('keydown', handleAmbientKeyDown)
      document.removeEventListener('keyup', handleAmbientKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  })
  useEffect(() => () => {
    if (bumpFrameRef.current != null) window.cancelAnimationFrame(bumpFrameRef.current)
    if (bumpTimerRef.current != null) window.clearTimeout(bumpTimerRef.current)
    if (impactTimerRef.current != null) window.clearTimeout(impactTimerRef.current)
    if (acknowledgementTimerRef.current != null) window.clearTimeout(acknowledgementTimerRef.current)
    if (walkTimerRef.current != null) window.clearTimeout(walkTimerRef.current)
    routeGenerationRef.current += 1
    if (routeTimerRef.current != null) window.clearTimeout(routeTimerRef.current)
    routeContinuationRef.current = null
    if (departureTimerRef.current != null) window.clearTimeout(departureTimerRef.current)
    stopManualMove()
    stopTouchMove()
  // Timer refs are stable for the component lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const updateViewportSize = () => {
      const rect = viewport.getBoundingClientRect()
      setViewportSize((current) => (
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height }
      ))
      setCamera((current) => officeCameraFollowingAlice(
        aliceRef.current,
        current,
        rect,
        mapLayout,
      ))
    }
    updateViewportSize()
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateViewportSize)
    observer?.observe(viewport)
    window.addEventListener('resize', updateViewportSize)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateViewportSize)
    }
  }, [mapLayout.height, mapLayout.width])
  useLayoutEffect(() => {
    cancelAutoWalk()
    const layoutKey = mapLayoutGeometryKey
    const remembered = initialLayoutKeyRef.current == null || initialLayoutKeyRef.current === layoutKey
      ? initialPlayerStateRef.current
      : null
    const canRestore = remembered && isOfficePositionWalkable(
      remembered.position,
      mapLayout,
      collisionRects,
    )
    const nextPosition = canRestore ? remembered.position : mapLayout.alice
    const nextDirection = canRestore ? remembered.direction : 'down'
    initialLayoutKeyRef.current = layoutKey
    aliceRef.current = nextPosition
    setAlice(nextPosition)
    setAliceDirection(nextDirection)
    setAliceWalking(false)
    setAliceSprinting(false)
    setAlicePushing(false)
    setInteractionAnchorTargetId(null)
    pushDirectionRef.current = null
    const viewport = viewportRef.current?.getBoundingClientRect()
    setCamera(viewport && viewport.width > 0 && viewport.height > 0
      ? officeCameraCenteredOn(nextPosition, viewport, mapLayout)
      : { x: 0, y: 0 })
  // Reframe only when the visible map geometry changes, not on every live poll.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLayoutGeometryKey])

  useLayoutEffect(() => {
    const wasReplay = previousReplaySeqRef.current != null
    const isReplay = replaySeq != null
    previousReplaySeqRef.current = replaySeq
    if (!wasReplay || isReplay) return

    cancelAutoWalk()
    stopTouchMove()
    stopManualMove()
    setPanning(false)
    setCollisionImpact(null)
    setInteractionAnchorTargetId(null)
    const checkpoint = liveExcursionRef.current
    const canRestore = isOfficePositionWalkable(checkpoint.player.position, mapLayout, collisionRects)
    const nextPosition = canRestore ? checkpoint.player.position : mapLayout.alice
    const nextDirection = canRestore ? checkpoint.player.direction : 'down'
    aliceRef.current = nextPosition
    setAlice(nextPosition)
    setAliceDirection(nextDirection)
    setAliceWalking(false)
    setAliceSprinting(false)
    setAlicePushing(false)
    pushDirectionRef.current = null
    const viewport = viewportRef.current?.getBoundingClientRect()
    const nextCamera = canRestore
      ? checkpoint.camera
      : viewport && viewport.width > 0 && viewport.height > 0
        ? officeCameraCenteredOn(nextPosition, viewport, mapLayout)
        : { x: 0, y: 0 }
    setCamera(nextCamera)
  // Replay is a temporary excursion; returning Live restores the last Live checkpoint.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaySeq])

  useLayoutEffect(() => {
    if (replaySeq == null || !replayFocus || !replayFocusTarget) {
      replayFocusKeyRef.current = null
      return
    }
    const focusKey = `${replayFocus.seq}:${building.asOfSeq ?? 'loading'}:${replayFocusTarget.id}`
    if (replayFocusKeyRef.current === focusKey) return
    replayFocusKeyRef.current = focusKey
    viewportRef.current?.focus({ preventScroll: true })
    if (
      replayFocusTarget.kind === 'employee'
      || replayFocusTarget.kind === 'inbox-service'
      || replayFocusTarget.kind === 'news-service'
    ) {
      requestTargetInteraction(replayFocusTarget.id, {
        allowReplay: true,
        activate: () => {},
      })
      return
    }
    const viewport = viewportRef.current?.getBoundingClientRect()
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
      replayFocusKeyRef.current = null
      return
    }
    setCamera(officeCameraCenteredOn(replayFocusTarget, viewport, mapLayout))
  // Route creation is intentionally keyed by replayFocusKeyRef rather than by
  // the request function identity; a live poll must not restart the same trip.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building.asOfSeq, mapLayout, replayFocus, replayFocusTarget, replaySeq])

  useEffect(() => {
    if (replaySeq == null) liveExcursionRef.current.camera = camera
  }, [camera, replaySeq])

  useEffect(() => {
    if (!initialLayoutKeyRef.current || replaySeq != null) return
    const player = { position: alice, direction: aliceDirection }
    liveExcursionRef.current.player = player
    onPlayerStateChange?.(player)
  }, [alice, aliceDirection, onPlayerStateChange, replaySeq])

  return (
    <div
      data-testid="office-building"
      className="oa-office-building"
      data-office-time={officeTime}
      data-replay={replaySeq != null || undefined}
      data-controls-suspended={controlsSuspended || undefined}
    >
      <header
        data-testid="office-wall"
        className="oa-office-hud"
      >
        <div className="oa-office-hud__identity">
          <span className="oa-office-hud__signal" aria-hidden>
            <img
              src={replaySeq == null ? OFFICE_HUD_ASSETS.signalReceiver : OFFICE_HUD_ASSETS.occupancyLog}
              alt=""
              style={officePixelImg}
            />
          </span>
          <div>
            <p className="oa-office-kicker">{t('office.commandCenter')}</p>
            <p className="oa-office-hud__title">
              {replaySeq == null ? t('office.liveFloor') : t('office.replayFloor', { seq: replaySeq })}
            </p>
          </div>
        </div>

        {replaySeq == null && (
          nextDuty && nextDutyName ? (
            <button
              type="button"
              className="oa-office-hud__duty"
              data-kind={nextDuty.kind}
              aria-label={t('office.shiftDutyPending', {
                name: [nextDutyCategory, nextDutyName, nextDutyContext]
                  .filter(Boolean)
                  .join(' · '),
                position: dutyShift?.position ?? 1,
                total: dutyShift?.total ?? currentDutyCandidates.length,
                minutes: dutyShift?.remainingMinutes ?? 0,
              })}
              onClick={() => requestTargetInteraction(
                nextDuty.targetId,
                {
                  ...(onOpenDuty
                    ? {
                        activate: () => onOpenDuty(nextDuty),
                        anchorTarget: nextDuty.receipt.kind === 'event-watermark'
                          || nextDuty.receipt.kind === 'inbox-read',
                      }
                    : {}),
                  ...(nextDuty.fallbackTargetId
                    ? {
                        fallbackTargetId: nextDuty.fallbackTargetId,
                        ...(onOpenDuty
                          ? {
                              fallbackActivate: () => {
                                onOpenDuty({
                                  ...nextDuty,
                                  targetId: nextDuty.fallbackTargetId!,
                                })
                              },
                            }
                          : {}),
                      }
                    : {}),
                },
              )}
            >
              <span className="oa-office-hud__duty-meta">
                <span className="oa-office-hud__duty-kicker">{t('office.shiftLabel')}</span>
                {dutyShift && (
                  <>
                    <i className="oa-office-hud__duty-separator" aria-hidden>·</i>
                    <span>{t('office.shiftTimeRemaining', {
                      minutes: dutyShift.remainingMinutes,
                    })}</span>
                  </>
                )}
                <i className="oa-office-hud__duty-separator" aria-hidden>·</i>
                <span className="oa-office-hud__duty-category">{nextDutyCategory}</span>
                {nextDutyContext && (
                  <>
                    <i className="oa-office-hud__duty-separator" aria-hidden>·</i>
                    <span className="oa-office-hud__duty-context">{nextDutyContext}</span>
                  </>
                )}
              </span>
              <strong title={nextDutyName}>{nextDutyName}</strong>
              <em>{dutyShift?.position ?? 1}/{dutyShift?.total ?? currentDutyCandidates.length}</em>
            </button>
          ) : currentShiftState === 'complete' && dutyShift?.canStartNext && onStartNextShift ? (
            <button
              type="button"
              className="oa-office-hud__duty oa-office-hud__duty--complete"
              aria-label={t('office.startNextShift', { count: dutyShift.backlogCount ?? 0 })}
              onClick={onStartNextShift}
            >
              <span className="oa-office-hud__duty-meta">{t('office.startNextShiftShort')}</span>
              <strong>{t('office.shiftComplete')}</strong>
              <em>+{dutyShift.backlogCount ?? 0}</em>
            </button>
          ) : reviewedCadenceFollowUp && onOpenCadenceFollowUp ? (
            <button
              type="button"
              className="oa-office-hud__duty oa-office-hud__duty--follow-up"
              data-kind="cadence-follow-up"
              aria-label={t('office.cadenceFollowUpDuty', {
                name: reviewedCadenceFollowUp.cadence.title,
                workspace: reviewedCadenceFollowUp.cadence.workspaceTag,
                count: reviewedCadenceFollowUpCount,
              })}
              onClick={() => requestTargetInteraction('operations', {
                activate: () => onOpenCadenceFollowUp(reviewedCadenceFollowUp),
              })}
            >
              <span className="oa-office-hud__duty-meta">
                <span>{t('office.shiftReviewed')}</span>
                <i className="oa-office-hud__duty-separator" aria-hidden>·</i>
                <span>{t('office.cadenceFollowUpAction')}</span>
                <i className="oa-office-hud__duty-separator" aria-hidden>·</i>
                <span className="oa-office-hud__duty-context">
                  {reviewedCadenceFollowUp.cadence.workspaceTag}
                </span>
              </span>
              <strong title={reviewedCadenceFollowUp.cadence.title}>
                {reviewedCadenceFollowUp.cadence.title}
              </strong>
              <em>{reviewedCadenceFollowUpCount > 1
                ? `+${reviewedCadenceFollowUpCount - 1}`
                : '!'}</em>
            </button>
          ) : currentShiftState === 'complete' ? (
            <div className="oa-office-hud__duty oa-office-hud__duty--complete" role="status">
              <span className="oa-office-hud__duty-meta">{t('office.shiftLabel')}</span>
              <strong>{t('office.shiftCarryover', { count: dutyShift?.backlogCount ?? 0 })}</strong>
            </div>
          ) : currentShiftState === 'quiet' ? (
            <div className="oa-office-hud__duty oa-office-hud__duty--clear">
              <span className="oa-office-hud__duty-meta">{t('office.shiftLabel')}</span>
              <strong>{t('office.shiftQuiet')}</strong>
            </div>
          ) : currentShiftState === 'clear' ? (
            <div className="oa-office-hud__duty oa-office-hud__duty--clear">
              <span className="oa-office-hud__duty-meta">{t('office.shiftLabel')}</span>
              <strong>{t('office.shiftClear')}</strong>
            </div>
          ) : (
            <div
              className="oa-office-hud__duty oa-office-hud__duty--clear"
              data-status={currentDutyStatus}
              role="status"
            >
              <span className="oa-office-hud__duty-meta">{t('office.shiftLabel')}</span>
              <strong>{t(currentShiftState === 'planning'
                ? 'office.dutySyncing'
                : 'office.dutySignalInterrupted')}</strong>
            </div>
          )
        )}

        <div
          className="oa-office-hud__status"
          title={t('office.visibleGroupSummary', {
            visible: defaultGroups.length,
            recent: recentGroups.length,
            total: building.offices.length,
          })}
        >
          <span data-live={(replaySeq == null ? stats.working : stats.active) > 0}>
            {replaySeq == null
              ? t('office.liveAgentSummary', { working: stats.working, awake: stats.awake })
              : t('office.activeAgentRatio', { active: stats.active, total: stats.occupied })}
          </span>
          <span>{groups.length}/{building.offices.length} {t('office.groups')}</span>
        </div>

        <div className="oa-office-hud__actions">
          {replaySeq != null && onReturnLive && !interactionSuspended && (
            <button
              type="button"
              className="oa-office-replay-exit"
              aria-label={t('office.replayReturnLive')}
              onClick={returnToLiveFloor}
            >
              <img
                className="oa-office-replay-exit__icon"
                src={OFFICE_HUD_ASSETS.windowBack}
                alt=""
                aria-hidden
                style={officePixelImg}
              />
              {t('office.replayLive')}
            </button>
          )}
          <DropdownMenu
            open={menuOpen}
            onOpenChange={(open) => {
              if (open) {
                openFloorMenu()
              } else {
                setMenuOpen(false)
              }
            }}
            onOpenChangeComplete={(open) => {
              if (open) {
                if (resumeActivityLogFocusRef.current) {
                  resumeActivityLogFocusRef.current = false
                  activityLogMenuItemRef.current?.focus({ preventScroll: true })
                } else {
                  window.requestAnimationFrame(() => {
                    const firstAction = Array.from(
                      pauseMenuRef.current?.querySelectorAll<HTMLElement>(
                        '[role="menuitem"], [role="menuitemradio"]',
                      ) ?? [],
                    ).find((item) => (
                      item.getAttribute('aria-disabled') !== 'true' && !item.hasAttribute('data-disabled')
                    ))
                    firstAction?.focus({ preventScroll: true })
                  })
                }
                return
              }
              const shouldRestoreFocus = restoreFloorFocusRef.current
              restoreFloorFocusRef.current = true
              if (!shouldRestoreFocus) return
              if (document.querySelector('.oa-office-window[aria-modal="true"]')) return
              viewportRef.current?.focus({ preventScroll: true })
            }}
          >
            <DropdownMenuTrigger
              render={<button
                type="button"
                className="oa-office-pause-trigger"
                aria-label={t('office.pauseMenu')}
                aria-keyshortcuts="Escape"
                data-open={menuOpen}
              />}
            >
              <img
                src={OFFICE_HUD_ASSETS.menuTerminal}
                alt=""
                aria-hidden
                style={officePixelImg}
              />
              {t('office.pauseMenu')}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              ref={pauseMenuRef}
              aria-label={t('office.floorView')}
              align="end"
              sideOffset={8}
              className="oa-office-pause-menu"
            >
              <div className="oa-office-pause-menu__header" role="presentation">
                <img src={OFFICE_HUD_ASSETS.menuTerminal} alt="" style={officePixelImg} />
                <span>{t('office.floorView')}</span>
              </div>
              {replaySeq != null ? (
                <>
                  <div
                    className="oa-office-pause-menu__current"
                    aria-label={t('office.currentFloorView', {
                      view: t('office.replayFloor', { seq: replaySeq }),
                    })}
                  >
                    <img src={OFFICE_HUD_ASSETS.occupancyLog} alt="" aria-hidden style={officePixelImg} />
                    <span>{t('office.replayFloor', { seq: replaySeq })}</span>
                    <small>{t('office.currentView')}</small>
                  </div>
                  {onReturnLive && (
                    <DropdownMenuItem
                      onClick={() => {
                        closeFloorMenu()
                        returnToLiveFloor()
                      }}
                    >
                      <img src={OFFICE_HUD_ASSETS.resetCompass} alt="" aria-hidden style={officePixelImg} />
                      <span>{t('office.liveMap')}</span>
                    </DropdownMenuItem>
                  )}
                </>
              ) : hiddenGroupCount > 0 ? (
                <DropdownMenuRadioGroup
                  value={showingAll ? 'all' : 'live'}
                  onValueChange={(value) => {
                    setShowAll(value === 'all')
                    setCamera({ x: 0, y: 0 })
                    closeFloorMenu()
                  }}
                >
                  <DropdownMenuRadioItem value="live">
                    <img src={OFFICE_HUD_ASSETS.resetCompass} alt="" aria-hidden style={officePixelImg} />
                    <span>{t('office.liveMap')}</span>
                    {!showingAll && (
                      <img
                        className="oa-office-pause-menu__selection"
                        src={OFFICE_HUD_ASSETS.journalCursor}
                        alt=""
                        aria-hidden
                        style={officePixelImg}
                      />
                    )}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem
                    value="all"
                    aria-label={t('office.allGroups')}
                    aria-describedby={hiddenGroupCountId}
                  >
                    <img src={OFFICE_HUD_ASSETS.groupGrid} alt="" aria-hidden style={officePixelImg} />
                    <span className="oa-office-pause-menu__option">
                      <span>{t('office.allGroups')}</span>
                      <small id={hiddenGroupCountId}>
                        {t('office.sleepingGroups', { count: hiddenGroupCount })}
                      </small>
                    </span>
                    {showingAll && (
                      <img
                        className="oa-office-pause-menu__selection"
                        src={OFFICE_HUD_ASSETS.journalCursor}
                        alt=""
                        aria-hidden
                        style={officePixelImg}
                      />
                    )}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              ) : (
                <div
                  className="oa-office-pause-menu__current"
                  aria-label={t('office.currentFloorView', { view: t('office.liveMap') })}
                >
                  <img src={OFFICE_HUD_ASSETS.resetCompass} alt="" aria-hidden style={officePixelImg} />
                  <span>{t('office.liveMap')}</span>
                  <small>{t('office.currentView')}</small>
                </div>
              )}
              <DropdownMenuItem
                ref={activityLogMenuItemRef}
                onClick={() => {
                  closeFloorMenu(false)
                  onOpenLog('menu')
                }}
              >
                <img src={OFFICE_HUD_ASSETS.occupancyLog} alt="" aria-hidden style={officePixelImg} />
                <span>{t('office.timeline')}</span>
              </DropdownMenuItem>
              <div
                className="oa-office-pause-menu__controls"
                role="group"
                aria-label={t('office.controls')}
                data-input="keyboard"
              >
                <strong>{t('office.controls')}</strong>
                <dl>
                  <div>
                    <dt><kbd>WASD</kbd><span aria-hidden>/</span><kbd>↑←↓→</kbd></dt>
                    <dd>{t('office.controlMove')}</dd>
                  </div>
                  <div>
                    <dt><kbd>Shift</kbd></dt>
                    <dd>{t('office.controlRun')}</dd>
                  </div>
                  <div>
                    <dt><kbd>Enter</kbd><span aria-hidden>/</span><kbd>Space</kbd></dt>
                    <dd>{t('office.controlInteract')}</dd>
                  </div>
                  <div>
                    <dt><kbd>Esc</kbd></dt>
                    <dd>{t('office.controlMenuCancel')}</dd>
                  </div>
                </dl>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div
        data-testid="office-floor"
        className="oa-office-campus"
        ref={viewportRef}
        tabIndex={0}
        aria-hidden={menuOpen || undefined}
        inert={menuOpen || undefined}
        data-menu-open={menuOpen || undefined}
        data-panning={panning}
        data-pannable={cameraPannable || undefined}
        data-departing={Boolean(departingWorkspace) || undefined}
        style={{
          '--office-building-foundation': `url(${OFFICE_FURNITURE.generated.buildingFoundation})`,
        } as CSSProperties}
        aria-busy={Boolean(departingWorkspace)}
        aria-label={replaySeq == null
          ? t(cameraPannable ? 'office.mapLabel' : 'office.mapLabelFixed')
          : t('office.replayMapLabel')}
        onPointerDown={(event) => {
          if (floorInteractionSuspended || departingWorkspace) return
          if ((event.target as HTMLElement).closest('button')) return
          if (!cameraPannable) return
          cancelAutoWalk()
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            cameraX: camera.x,
            cameraY: camera.y,
          }
          setPanning(true)
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag || drag.pointerId !== event.pointerId) return
          if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) >= 4) {
            setControlsLearned(true)
          }
          setCamera(clampCamera(
            drag.cameraX + event.clientX - drag.startX,
            drag.cameraY + event.clientY - drag.startY,
          ))
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return
          dragRef.current = null
          setPanning(false)
          event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => {
          dragRef.current = null
          setPanning(false)
        }}
      >
        <span
          key={officeTime}
          className="oa-office-time-shift"
          data-testid="office-time-shift"
          data-office-time={officeTime}
          data-reduced-motion={reducedMotion || undefined}
          aria-hidden
        />
        <div className="oa-office-map-stage">
          <div
            ref={mapRef}
            className="oa-office-map"
            style={{
              width: mapLayout.width,
              height: mapLayout.height,
              transform: `translate3d(${camera.x}px, ${camera.y}px, 0)`,
              backgroundImage: `url(${OFFICE_FURNITURE.generated.floorTile})`,
              '--office-floor-edge-bottom': `url(${OFFICE_FURNITURE.generated.floorEdgeBottom})`,
              '--office-floor-edge-side': `url(${OFFICE_FURNITURE.generated.floorEdgeSide})`,
            } as CSSProperties}
          >
            <div
              className="oa-office-map-wall"
              aria-hidden
              style={{
                '--office-wall-day': `url(${OFFICE_FURNITURE.generated.wallWindow})`,
                '--office-wall-night': `url(${OFFICE_FURNITURE.generated.wallWindowNight})`,
                zIndex: officeDepthAt(112),
              } as CSSProperties}
            >
              <img
                src={officeTime === 'night'
                  ? OFFICE_FURNITURE.generated.wallUtilityNight
                  : OFFICE_FURNITURE.generated.wallUtility}
                alt=""
                data-kind="operations-utility"
                style={{
                  ...officePixelImg,
                  left: Math.round((operationsBoard.x - 102) / 204) * 204,
                }}
              />
            </div>
            <span
              className="oa-office-floor-edge oa-office-floor-edge--left"
              aria-hidden
              style={{ zIndex: officeDepthAt(mapLayout.height) + 400 }}
            />
            <span
              className="oa-office-floor-edge oa-office-floor-edge--right"
              aria-hidden
              style={{ zIndex: officeDepthAt(mapLayout.height) + 400 }}
            />
            <span
              className="oa-office-floor-edge oa-office-floor-edge--bottom"
              aria-hidden
              style={{ zIndex: officeDepthAt(mapLayout.height) + 401 }}
            />
            <div
              className="oa-office-map-landmark oa-office-map-landmark--plant"
              aria-hidden
              style={{ zIndex: officeDepthAt(178) }}
            >
              <img src={OFFICE_FURNITURE.generated.plant} alt="" style={officePixelImg} />
            </div>
            <button
              id="office-floor-terminal"
              type="button"
              tabIndex={-1}
              className="oa-office-map-landmark oa-office-map-landmark--terminal"
              aria-label={t('office.floorTerminal')}
              title={replaySeq == null ? t('office.floorTerminalHint') : t('office.replayLockedHint')}
              disabled={replaySeq != null}
              data-replay-locked={replaySeq != null || undefined}
              data-nearby={nearbyTarget?.kind === 'floor-terminal'}
              data-route={routeTargetId === 'floor-terminal'}
              data-acknowledged={acknowledgedTargetId === 'floor-terminal' || undefined}
              onClick={() => requestTargetInteraction('floor-terminal')}
              style={{ zIndex: officeDepthAt(floorTerminal.y + 19) }}
            >
              <img
                src={OFFICE_FURNITURE.generated.terminal}
                alt=""
                aria-hidden
                style={officePixelImg}
              />
              {acknowledgedTargetId === 'floor-terminal' && (
                <span className="oa-office-landmark-ack" aria-hidden>{acknowledgementLabel}</span>
              )}
            </button>
            <div
              className="oa-office-service-zone"
              data-testid="office-service-zone"
              aria-hidden
              style={{
                left: mapLayout.serviceZone.x + 12,
                top: mapLayout.serviceZone.y + 52,
                width: mapLayout.serviceZone.width - 24,
                height: 138,
                zIndex: officeDepthAt(mapLayout.serviceZone.y + 50),
              }}
            >
              <img
                src={OFFICE_FURNITURE.generated.workspaceRug}
                alt=""
                aria-hidden
                style={officePixelImg}
              />
            </div>
            {serviceLandmarks.map((landmark) => {
              const activity = landmark.kind === 'inbox'
                ? productActivity.inbox
                : productActivity.news
              const interactionKind = landmark.kind === 'inbox'
                ? 'inbox-service'
                : 'news-service'
              const fresh = productActivity.freshKind === landmark.kind
              const needsAttention = landmark.kind === 'inbox'
                ? inboxBacklogCount > 0
                : false
              const pendingCount = landmark.kind === 'inbox'
                ? inboxBacklogCount
                : 0
              const pendingLabel = pendingCount >= 9 ? '9+' : String(pendingCount || '!')
              const serviceName = landmark.kind === 'inbox'
                ? t('office.inboxStation')
                : t('office.newsStation')
              return (
              <button
                key={landmark.id}
                id={`office-${landmark.id}`}
                type="button"
                tabIndex={-1}
                className="oa-office-map-service"
                data-kind={landmark.kind}
                data-fresh={fresh || undefined}
                data-attention={needsAttention || undefined}
                data-has-activity={Boolean(activity) || undefined}
                data-nearby={nearbyTarget?.kind === interactionKind || undefined}
                data-route={routeTargetId === landmark.id || undefined}
                data-acknowledged={acknowledgedTargetId === landmark.id || undefined}
                data-replay-locked={replaySeq != null || undefined}
                aria-label={needsAttention
                  ? pendingCount > 0
                    ? t(pendingCount >= 9
                        ? 'office.servicePendingActivityMore'
                        : 'office.servicePendingActivity', {
                      name: serviceName,
                      count: Math.min(9, pendingCount),
                    })
                    : t('office.serviceNeedsAttention', { name: serviceName })
                  : serviceName}
                title={replaySeq == null
                  ? landmark.kind === 'inbox'
                    ? t('office.inboxStationHint')
                    : t('office.newsStationHint')
                  : t('office.replayLockedHint')}
                disabled={replaySeq != null}
                onClick={() => requestTargetInteraction(landmark.id)}
                style={{
                  left: landmark.x,
                  top: landmark.y,
                  width: landmark.width,
                  height: landmark.height,
                  zIndex: officeDepthAt(landmark.y + landmark.collision.y + landmark.collision.height),
                }}
              >
                <img
                  src={landmark.kind === 'inbox'
                    ? OFFICE_FURNITURE.generated.inboxTerminal
                    : OFFICE_FURNITURE.generated.newsTerminal}
                  alt=""
                  aria-hidden
                  style={officePixelImg}
                />
                <span
                  className="oa-office-map-service__placard"
                  aria-hidden
                  style={{
                    '--office-service-placard': `url(${OFFICE_FURNITURE.generated.servicePlacard})`,
                  } as CSSProperties}
                >
                  <span>{t(landmark.kind === 'inbox'
                    ? 'office.logChannelInbox'
                    : 'office.logChannelNews')}</span>
                </span>
                {needsAttention && (
                  <span className="oa-office-map-service__signal" aria-hidden>{pendingLabel}</span>
                )}
                {acknowledgedTargetId === landmark.id && (
                  <span className="oa-office-landmark-ack" aria-hidden>{acknowledgementLabel}</span>
                )}
              </button>
              )
            })}
            <button
              id="office-operations-board"
              type="button"
              tabIndex={-1}
              className="oa-office-operations-board"
              data-live={(replaySeq == null ? stats.working : stats.active) > 0}
              data-has-activity={Boolean(productActivity.agent)
                || Boolean(queuedOperationsCadenceDuty)
                || reviewedCadenceFollowUpCount > 0
                || undefined}
              data-attention={operationsNeedsAttention || undefined}
              data-fresh={productActivity.freshKind === 'agent' || undefined}
              data-nearby={nearbyTarget?.kind === 'operations'}
              data-route={routeTargetId === 'operations'}
              data-acknowledged={acknowledgedTargetId === 'operations' || undefined}
              aria-label={operationsInteractionMode === 'reviewed-follow-up'
                ? t('office.operationsFollowUpPending', {
                    count: reviewedCadenceFollowUpCount,
                  })
                : operationsNeedsAttention
                  ? operationsPending > 0
                    ? t(operationsPending >= 9
                        ? 'office.servicePendingActivityMore'
                        : 'office.servicePendingActivity', {
                        name: t('office.operationsBoard'),
                        count: Math.min(9, operationsPending),
                      })
                    : t('office.serviceNeedsAttention', { name: t('office.operationsBoard') })
                  : t('office.operationsBoard')}
              title={operationsInteractionMode === 'reviewed-follow-up' && operationsFollowUp
                ? t('office.cadenceFollowUpIssue', {
                    name: operationsFollowUp.cadence.title,
                  })
                : t('office.operationsBoardHint')}
              onClick={() => requestTargetInteraction('operations')}
              style={{
                left: operationsBoard.x,
                top: operationsBoard.y,
                zIndex: officeDepthAt(operationsBoard.y + 43),
              }}
            >
              <img
                src={OFFICE_FURNITURE.generated.operationsBoard}
                alt=""
                aria-hidden
                style={officePixelImg}
              />
              {operationsNeedsAttention && (
                <span className="oa-office-operations-board__signal" aria-hidden>
                  {operationsPending >= 9 ? '9+' : operationsPending || '!'}
                </span>
              )}
              {acknowledgedTargetId === 'operations' && (
                <span className="oa-office-landmark-ack" aria-hidden>{acknowledgementLabel}</span>
              )}
            </button>
            <img
              src={OFFICE_FURNITURE.generated.spawnInlay}
              alt=""
              aria-hidden
              data-testid="office-spawn-inlay"
              className="oa-office-spawn-inlay"
              style={{
                ...officePixelImg,
                left: mapLayout.alice.x,
                top: mapLayout.alice.y,
              }}
            />
            <OfficeRouteTrail steps={routeTrail} />
            {!routeTarget
              && nextDuty
              && nextDutyTarget
              && !floorInteractionSuspended
              && acknowledgedTargetId !== nextDuty.targetId
              && nearbyTarget?.id !== nextDutyTarget.id && (
              <OfficeDutyTargetBeacon
                key={nextDuty.id}
                target={nextDutyTarget}
                reducedMotion={reducedMotion}
                zIndex={officeDepthAt(nextDutyTarget.y) + 1180}
              />
            )}
            {routeTarget && (
              <OfficeRouteTargetPointer
                target={routeTarget}
                reducedMotion={reducedMotion}
                zIndex={officeDepthAt(routeTarget.y) + 1200}
              />
            )}
            {replayFocus && replayFocusTarget && replayFocus.seq === replaySeq && !replayFocusIsNearby && (
              <OfficeReplayBeacon
                target={replayFocusTarget}
                label={replayFocus.label}
                sequenceLabel={t('office.replayAt', { seq: replayFocus.seq })}
                reducedMotion={reducedMotion}
                zIndex={officeDepthAt(replayFocusTarget.y) + 1250}
              />
            )}
            <div
              className="oa-office-alice"
              role="img"
              aria-label={t('office.aliceAvatar')}
              data-direction={aliceDirection}
              data-walking={aliceWalking}
              data-sprinting={aliceSprinting || undefined}
              data-pushing={alicePushing}
              data-bumped={aliceBumped}
              style={{ left: alice.x, top: alice.y, zIndex: officeDepthAt(alice.y) }}
            >
              <span className="oa-office-alice__sprite" aria-hidden>
                <OfficeAliceSprite
                  direction={aliceDirection}
                  walking={aliceWalking}
                  sprinting={aliceSprinting}
                  reducedMotion={reducedMotion}
                  label={t('office.aliceAvatar')}
                  scale={1}
                />
              </span>
            </div>
            {replaySeq !== null && (
              <span
                className="oa-office-replay-visitor"
                data-testid="office-replay-visitor"
                aria-hidden="true"
                style={{
                  left: alice.x,
                  top: alice.y,
                  zIndex: officeDepthAt(alice.y) + 1400,
                }}
              >
                <img src={OFFICE_HUD_ASSETS.replayVisitor} alt="" style={officePixelImg} />
              </span>
            )}
            {collisionImpact && (
              <OfficeCollisionImpact
                key={collisionImpact.serial}
                impact={collisionImpact}
                reducedMotion={reducedMotion}
                zIndex={officeDepthAt(Math.max(alice.y, collisionImpact.y)) + 200}
              />
            )}
          {groups.length === 0 && (
            <div
              className="oa-office-quiet"
              role="status"
              data-kind={building.offices.length === 0 ? 'empty' : 'sleeping'}
            >
              <span className="oa-office-quiet__radar" aria-hidden>
                <img src={OFFICE_HUD_ASSETS.signalReceiver} alt="" style={officePixelImg} />
              </span>
              <div className="oa-office-quiet__copy">
                <p>{building.offices.length === 0 ? t('office.noWorkspace') : t('office.floorQuiet')}</p>
                <span>
                  {building.offices.length === 0
                    ? t('office.emptyFloor')
                    : t('office.floorQuietHint', { days: sleepAfterDays })}
                </span>
                {building.offices.length > 0 && (
                  <button type="button" onClick={() => setShowAll(true)}>
                    {t('office.allGroups')}
                  </button>
                )}
              </div>
            </div>
          )}
          {mapLayout.pods.map((layout) => {
            const group = groupById.get(layout.id)
            if (!group) return null
            return (
              <OfficeMapPod
                key={layout.id}
                group={group}
                layout={layout}
                mapWidth={mapLayout.width}
                title={resolveGroupTitle(
                  group.workspace.id,
                  group.workspace.tag,
                )}
                harnessTitle={t(`office.harness.${group.workspace.harness}`)}
                selected={selected}
                reducedMotion={reducedMotion}
                interactionDisabled={replaySeq != null}
                onSelectEmployee={(workspaceId, employee) => requestTargetInteraction(
                  `employee:${workspaceId}:${employee.resumeId}`,
                )}
                onOpenEmployee={(workspaceId, employee) => requestTargetInteraction(
                  `employee:${workspaceId}:${employee.resumeId}`,
                  { activate: () => onOpenEmployee(workspaceId, employee) },
                )}
                onOpenWorkspace={(workspaceId) => requestTargetInteraction(`sign:${workspaceId}`)}
                onOpenFiles={(workspaceId) => requestTargetInteraction(`cabinet:${workspaceId}`)}
                onOpenRoster={(workspaceId) => requestTargetInteraction(`roster:${workspaceId}`)}
                nearbyTargetId={nearbyTarget?.id}
                routeTargetId={routeTargetId}
                acknowledgedTargetId={acknowledgedTargetId}
                replayFocusResumeId={replayFocus?.seq === replaySeq
                  && replayFocus.workspaceId === group.workspace.id
                  ? replayFocus.resumeId
                  : null}
                coworkerAssets={coworkerAssets}
                slots={deskSlotsByWorkspace.get(group.workspace.id) ?? []}
              />
            )
          })}
          {nearbyTarget && promptPlacement && promptPresentation && (
            <div
              className="oa-office-interact-prompt"
              role="status"
              aria-label={promptPresentation.detail
                ? `${promptPresentation.label} · ${promptPresentation.source
                  ? `${promptPresentation.source} · `
                  : ''}${promptPresentation.detail}`
                : promptPresentation.label}
              data-kind={nearbyTarget.kind}
              data-layout={nearbyDialogue ? 'dialogue' : nearbyService ? 'service' : undefined}
              data-side={promptPlacement.side}
              data-has-detail={Boolean(promptPresentation.detail) || undefined}
              style={{
                left: promptPlacement.x,
                top: promptPlacement.y,
                width: promptPresentation.detail ? promptPlacement.width : 'max-content',
                zIndex: officeDepthAt(nearbyTarget.y) + 1000,
                '--office-prompt-tail-shift': `${promptPlacement.tailShift}px`,
              } as CSSProperties}
            >
              <span
                className="oa-office-interact-prompt__action"
                aria-hidden
              >
                <img src={promptPresentation.icon} alt="" aria-hidden style={officePixelImg} />
                <span className="oa-office-interact-prompt__copy" aria-hidden>
                  <strong>{promptPresentation.action}</strong>
                  {promptPresentation.detail && (
                    <small>
                      {promptPresentation.source && (
                        <b>{promptPresentation.source}</b>
                      )}
                      {promptPresentation.source
                        && promptPresentation.detail !== promptPresentation.source
                        && <span aria-hidden> · </span>}
                      {promptPresentation.detail !== promptPresentation.source
                        && promptPresentation.detail}
                    </small>
                  )}
                </span>
                <kbd aria-hidden>
                  <span data-input="keyboard">{t('office.interactKey')}</span>
                  <span data-input="touch">{t('office.touchActionKey')}</span>
                </kbd>
              </span>
            </div>
          )}
          </div>
        </div>

        {departingWorkspace && (
          <div
            className="oa-office-departure"
            role="status"
            aria-live="assertive"
            data-testid="office-departure"
          >
            <span className="oa-office-departure__message">
              <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" aria-hidden style={officePixelImg} />
              <strong>{t('office.enteringWorkspace', { name: departingWorkspace.roomName })}</strong>
            </span>
          </div>
        )}

        {routeTargetName && !controlsSuspended && (
          <div
            className="oa-office-route-status"
            role="status"
            aria-live="polite"
            data-testid="office-route-status"
            data-edge={routeStatusEdge}
          >
            <img
              src={OFFICE_FURNITURE.generated.routeDestination}
              alt=""
              aria-hidden
              style={officePixelImg}
            />
            <span className="oa-office-route-status__copy">
              <small>{t('office.routeMode')}</small>
              <strong>{t('office.walkingTo', { name: routeTargetName })}</strong>
            </span>
            <span className="oa-office-route-status__cancel">
              <kbd data-input="keyboard">Esc</kbd>
              <span data-input="keyboard">{t('office.routeCancelHint')}</span>
              <span data-input="touch">{t('office.routeCancelTouchHint')}</span>
            </span>
          </div>
        )}

        <div
          className="oa-office-map-controls"
          data-learned={controlsLearned}
          data-action-ready={Boolean(nearbyTarget) || undefined}
          data-routing={Boolean(routeTargetName) || undefined}
          aria-hidden={controlsSuspended || undefined}
          inert={controlsSuspended || undefined}
        >
          <span
            className="oa-office-map-controls__move"
            aria-hidden={Boolean(nearbyTarget) || undefined}
          >
            <img src={OFFICE_HUD_ASSETS.movePad} alt="" aria-hidden style={officePixelImg} />
            <span>{t('office.mapHint')}</span>
          </span>
          {cameraRecenterAvailable && (
            <button
              type="button"
              tabIndex={-1}
              onClick={centerCameraOnAlice}
              aria-label={t('office.centerMapOnAlice')}
            >
              <img
                src={OFFICE_HUD_ASSETS.resetCompass}
                alt=""
                aria-hidden
                style={officePixelImg}
              />
            </button>
          )}
        </div>
        <div
          className="oa-office-touch-dpad"
          role="group"
          aria-label={t('office.touchControls')}
          aria-hidden={controlsSuspended || undefined}
          inert={controlsSuspended || undefined}
        >
          <img src={OFFICE_HUD_ASSETS.movePad} alt="" aria-hidden style={officePixelImg} />
          {([
            ['up', t('office.moveAliceUp')],
            ['left', t('office.moveAliceLeft')],
            ['right', t('office.moveAliceRight')],
            ['down', t('office.moveAliceDown')],
          ] as const).map(([direction, label]) => (
            <button
              key={direction}
              type="button"
              tabIndex={-1}
              data-direction={direction}
              aria-label={label}
              disabled={floorInteractionSuspended || Boolean(departingWorkspace)}
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                event.currentTarget.setPointerCapture?.(event.pointerId)
                startTouchMove(direction, event.pointerId)
              }}
              onPointerUp={(event) => stopTouchMove(event.pointerId)}
              onPointerCancel={(event) => stopTouchMove(event.pointerId)}
              onLostPointerCapture={(event) => stopTouchMove(event.pointerId)}
              onClick={(event) => {
                if (event.detail === 0) moveAlice(OFFICE_MOVEMENTS[direction])
              }}
            />
          ))}
        </div>
        <button
          type="button"
          tabIndex={-1}
          className="oa-office-touch-action"
          aria-hidden={controlsSuspended || undefined}
          data-ready={Boolean(nearbyTarget) && !selected && !departingWorkspace && !floorInteractionSuspended}
          disabled={!nearbyTarget || Boolean(selected) || Boolean(departingWorkspace) || floorInteractionSuspended}
          aria-label={nearbyTarget && promptPresentation
            ? promptPresentation.label
            : t('office.touchActionUnavailable')}
          onClick={(event) => {
            event.stopPropagation()
            activateNearbyTarget()
          }}
        >
          <img src={OFFICE_HUD_ASSETS.actionButton} alt="" aria-hidden style={officePixelImg} />
        </button>
      </div>
    </div>
  )
}
