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
import { OfficeAliceSprite, type OfficeAliceDirection } from './OfficeAliceSprite'
import { officeCoworkerCast, type OfficeCoworkerSpriteAsset } from './coworker-sprites'
import {
  OfficeCollisionImpact,
  officeCollisionImpactPosition,
  type OfficeCollisionImpactState,
} from './OfficeCollisionImpact'
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
  OFFICE_PROMPT_NARROW_DETAIL_MAX_WIDTH,
  OFFICE_PROMPT_NARROW_SERVICE_MAX_WIDTH,
  OFFICE_PROMPT_SERVICE_MAX_HEIGHT,
  OFFICE_PROMPT_SERVICE_MAX_WIDTH,
  officeInteractionPromptPlacement,
} from './interaction-prompt'
import { officeCoworkerCallsign } from './label'
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
import type { OfficeProductActivityState } from './useOfficeProductActivity'

const OFFICE_MOVEMENTS = {
  left: { x: -24, y: 0, direction: 'left' as const },
  right: { x: 24, y: 0, direction: 'right' as const },
  up: { x: 0, y: -24, direction: 'up' as const },
  down: { x: 0, y: 24, direction: 'down' as const },
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
export type OfficeLogOrigin =
  | 'menu'
  | 'operations'
  | 'floor-terminal'
  | 'inbox-service'
  | 'news-service'
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
    freshKind: null,
  },
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
  initialPlayerState?: OfficePlayerState | null
  onPlayerStateChange?: (state: OfficePlayerState) => void
  onSelectEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenWorkspace: (workspaceId: string) => void
  onOpenFiles: (workspaceId: string) => void
  onOpenRoster: (workspaceId: string) => void
  onOpenLog: (origin: OfficeLogOrigin) => void
  productActivity?: OfficeProductActivityState
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
  const [aliceWalking, setAliceWalking] = useState(false)
  const [aliceBumped, setAliceBumped] = useState(false)
  const [collisionImpact, setCollisionImpact] = useState<OfficeCollisionImpactState | null>(null)
  const [panning, setPanning] = useState(false)
  const [controlsLearned, setControlsLearned] = useState(false)
  const [routeTargetId, setRouteTargetId] = useState<string | null>(null)
  const [routeTrail, setRouteTrail] = useState<readonly OfficeInteractionPathStep[]>([])
  const [departingWorkspace, setDepartingWorkspace] = useState<{
    workspaceId: string
    roomName: string
  } | null>(null)
  const controlsSuspended = floorInteractionSuspended || Boolean(departingWorkspace)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
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
  const bumpFrameRef = useRef<number | null>(null)
  const walkTimerRef = useRef<number | null>(null)
  const touchMoveDelayRef = useRef<number | null>(null)
  const touchMoveRepeatRef = useRef<number | null>(null)
  const touchMovePointersRef = useRef(new Map<number, OfficeAliceDirection>())
  const lastTouchMoveDirectionRef = useRef<OfficeAliceDirection | null>(null)
  const manualMoveRepeatRef = useRef<number | null>(null)
  const manualMoveKeysRef = useRef(new Set<string>())
  const lastManualMoveKeyRef = useRef<string | null>(null)
  const manualMoveTickRef = useRef<() => void>(() => {})
  const routeTimerRef = useRef<number | null>(null)
  const departureTimerRef = useRef<number | null>(null)
  const routeGenerationRef = useRef(0)
  const replayFocusKeyRef = useRef<string | null>(null)
  const menuOriginRef = useRef<'hud' | 'floor-terminal'>('hud')
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
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
  const cameraPannable = viewportSize.width <= 0 || viewportSize.height <= 0
    || viewportSize.width < mapLayout.width
    || viewportSize.height < mapLayout.height
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
  const interactionTargets = useMemo(
    () => officeInteractionTargets(groups, mapLayout, resolveGroupTitle),
    [groups, mapLayout, resolveGroupTitle],
  )
  const availableInteractionTargets = useMemo(
    () => replaySeq == null
      ? interactionTargets
      : interactionTargets.filter((target) => target.kind === 'operations'),
    [interactionTargets, replaySeq],
  )
  const interactionTargetById = useMemo(
    () => new Map(interactionTargets.map((target) => [target.id, target])),
    [interactionTargets],
  )
  const replayFocusTarget = useMemo(() => {
    if (replaySeq == null || replayFocus?.seq !== replaySeq) return null
    for (const targetId of replayFocus.targetIds) {
      const target = interactionTargetById.get(targetId)
      if (target) return target
    }
    return null
  }, [interactionTargetById, replayFocus, replaySeq])
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
  const nearbyTarget = useMemo(
    () => floorInteractionSuspended || departingWorkspace || selected
      ? null
      : nearestOfficeInteractionTarget(alice, aliceDirection, availableInteractionTargets),
    [alice, aliceDirection, availableInteractionTargets, departingWorkspace, floorInteractionSuspended, selected],
  )
  const nearbyService = nearbyTarget?.kind === 'inbox-service'
    || nearbyTarget?.kind === 'news-service'
    || nearbyTarget?.kind === 'operations'
  const promptPlacement = useMemo(
    () => nearbyTarget
      ? officeInteractionPromptPlacement(
          alice,
          nearbyTarget,
          {
            width: viewportSize.width || mapLayout.width,
            height: viewportSize.height || mapLayout.height,
          },
          camera,
          nearbyService
            ? viewportSize.width > 0 && viewportSize.width <= 520
              ? OFFICE_PROMPT_NARROW_SERVICE_MAX_WIDTH
              : OFFICE_PROMPT_SERVICE_MAX_WIDTH
            : nearbyTarget.kind === 'sign'
            ? OFFICE_PROMPT_DESTINATION_MAX_WIDTH
            : nearbyTarget.kind === 'employee' && nearbyTarget.employee.bubble
              ? viewportSize.width > 0 && viewportSize.width <= 520
                ? OFFICE_PROMPT_NARROW_DETAIL_MAX_WIDTH
                : OFFICE_PROMPT_DETAIL_MAX_WIDTH
              : undefined,
          nearbyService ? OFFICE_PROMPT_SERVICE_MAX_HEIGHT : undefined,
        )
      : null,
    [alice, camera, mapLayout.height, mapLayout.width, nearbyService, nearbyTarget, viewportSize],
  )
  const promptPresentation: {
    icon: string
    action: string
    label: string
    detail: string | null
    source?: string | null
  } | null = (() => {
    if (!nearbyTarget) return null
    if (nearbyTarget.kind === 'employee') {
      const target = officeCoworkerCallsign(
        nearbyTarget.employee,
        coworkerAssets.get(nearbyTarget.employee.resumeId),
      )
      return {
        icon: OFFICE_HUD_ASSETS.talkBubble,
        action: t('office.interactActionTalk'),
        label: t('office.interactTalk', { name: target }),
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
        detail: productActivity.inbox?.detail ?? productActivity.inbox?.source ?? null,
        source: productActivity.inbox?.source,
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
    if (replaySeq != null) {
      const focusedReplay = replayFocus?.seq === replaySeq ? replayFocus : null
      return {
        icon: OFFICE_HUD_ASSETS.occupancyLog,
        action: t('office.replayAt', { seq: replaySeq }),
        label: `${t('office.replay')} · ${t('office.replayAt', { seq: replaySeq })}`,
        detail: focusedReplay?.summary ?? null,
        source: focusedReplay?.label,
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
  }
  const showCollisionBump = (movement: OfficeMovement = OFFICE_MOVEMENTS[aliceDirection]) => {
    if (walkTimerRef.current != null) window.clearTimeout(walkTimerRef.current)
    setAliceWalking(false)
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
  const showAliceWalking = () => {
    if (walkTimerRef.current != null) window.clearTimeout(walkTimerRef.current)
    setAliceWalking(true)
    walkTimerRef.current = window.setTimeout(() => setAliceWalking(false), 150)
  }
  const moveAlice = (movement: OfficeMovement, learnsManualControls = true) => {
    if (learnsManualControls) setControlsLearned(true)
    setAliceDirection(movement.direction)
    const move = moveAliceOnOfficeMap(aliceRef.current, movement, mapLayout, collisionRects)
    if (move.bumped) {
      showCollisionBump(movement)
      return
    }
    const next = move.position
    aliceRef.current = next
    setAlice(next)
    showAliceWalking()
    const viewport = viewportRef.current?.getBoundingClientRect()
    if (viewport) {
      setCamera((currentCamera) => officeCameraFollowingAlice(
        next,
        currentCamera,
        viewport,
        mapLayout,
      ))
    }
  }
  const activateTarget = (target: OfficeInteractionTarget) => {
    if (target.kind === 'employee') {
      onSelectEmployee(target.workspaceId, target.employee)
    } else if (target.kind === 'sign') {
      enterWorkspace(target)
    } else if (target.kind === 'cabinet') {
      onOpenFiles(target.workspaceId)
    } else if (target.kind === 'roster') {
      onOpenRoster(target.workspaceId)
    } else if (target.kind === 'floor-terminal') {
      menuOriginRef.current = 'floor-terminal'
      setMenuOpen(true)
      window.setTimeout(() => {
        document.querySelector<HTMLElement>(
          '.oa-office-pause-menu :is([role="menuitemradio"], [role="menuitem"])',
        )?.focus()
      }, 0)
    } else if (target.kind === 'inbox-service') {
      onOpenService?.('inbox', productActivity.inbox?.seq)
    } else if (target.kind === 'news-service') {
      onOpenService?.('news', productActivity.news?.seq)
    } else {
      onOpenLog('operations')
    }
  }
  const closeFloorMenu = (restoreFocus = true) => {
    setMenuOpen(false)
    if (!restoreFocus) return
    requestAnimationFrame(() => {
      if (document.querySelector('.oa-office-window[aria-modal="true"]')) return
      if (menuOriginRef.current === 'floor-terminal') {
        document.getElementById('office-floor-terminal')?.focus()
      } else {
        menuTriggerRef.current?.focus()
      }
    })
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
    setRouteTargetId(null)
    setRouteTrail([])
  }
  const requestTargetInteraction = (targetId: string, activate?: () => void) => {
    if (selected || departingWorkspace || floorInteractionSuspended) return
    const target = interactionTargetById.get(targetId)
    if (!target) return
    if (replaySeq != null && target.kind !== 'operations') return
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
      routeTimerRef.current = window.setTimeout(() => {
        if (routeGenerationRef.current !== generation) return
        routeTimerRef.current = null
        setRouteTrail([])
        const action = activate ?? (() => activateTarget(target))
        action()
      }, reducedMotion ? 0 : 80)
    }
    const advance = () => {
      if (routeGenerationRef.current !== generation) return
      const step = path.steps[stepIndex]
      if (!step) {
        finish()
        return
      }
      moveAlice(OFFICE_MOVEMENTS[step.direction], false)
      stepIndex += 1
      setRouteTrail(stepIndex < path.steps.length ? path.steps.slice(stepIndex) : [step])
      routeTimerRef.current = window.setTimeout(advance, reducedMotion ? 0 : 96)
    }
    advance()
  }
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
  const moveAliceFromHeldKeys = () => {
    const movement = movementForHeldKeys()
    if (movement) moveAlice(movement)
  }
  manualMoveTickRef.current = () => {
    if (floorInteractionSuspended || departingWorkspace || selected) {
      stopManualMove()
      return
    }
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
      if (!fromIdlePage && !fromFloor) return
      const key = event.key.toLowerCase()
      if (key === 'escape' && routeTargetId) {
        event.preventDefault()
        cancelAutoWalk()
        return
      }
      if ((key === 'enter' || key === ' ') && nearbyTarget && (fromIdlePage || target === viewport)) {
        event.preventDefault()
        activateNearbyTarget()
        return
      }
      const movement = OFFICE_MOVEMENT_KEYS[key]
      if (!movement) return
      event.preventDefault()
      if (fromFloor && target !== viewport) viewport?.focus({ preventScroll: true })
      if (manualMoveKeysRef.current.has(key)) return
      manualMoveKeysRef.current.add(key)
      lastManualMoveKeyRef.current = key
      cancelAutoWalk()
      moveAliceFromHeldKeys()
      if (manualMoveRepeatRef.current == null) {
        manualMoveRepeatRef.current = window.setInterval(
          () => manualMoveTickRef.current(),
          OFFICE_MANUAL_MOVE_INTERVAL_MS,
        )
      }
    }
    const handleAmbientKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (!OFFICE_MOVEMENT_KEYS[key]) return
      manualMoveKeysRef.current.delete(key)
      if (lastManualMoveKeyRef.current === key) {
        lastManualMoveKeyRef.current = Array.from(manualMoveKeysRef.current).at(-1) ?? null
      }
      if (manualMoveKeysRef.current.size === 0) stopManualMove()
    }
    document.addEventListener('keydown', handleAmbientKeyDown)
    document.addEventListener('keyup', handleAmbientKeyUp)
    window.addEventListener('blur', stopManualMove)
    return () => {
      document.removeEventListener('keydown', handleAmbientKeyDown)
      document.removeEventListener('keyup', handleAmbientKeyUp)
      window.removeEventListener('blur', stopManualMove)
    }
  })
  useEffect(() => () => {
    if (bumpFrameRef.current != null) window.cancelAnimationFrame(bumpFrameRef.current)
    if (bumpTimerRef.current != null) window.clearTimeout(bumpTimerRef.current)
    if (impactTimerRef.current != null) window.clearTimeout(impactTimerRef.current)
    if (walkTimerRef.current != null) window.clearTimeout(walkTimerRef.current)
    routeGenerationRef.current += 1
    if (routeTimerRef.current != null) window.clearTimeout(routeTimerRef.current)
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
    const layoutKey = `${mapLayout.width}x${mapLayout.height}`
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
    const viewport = viewportRef.current?.getBoundingClientRect()
    setCamera(viewport && viewport.width > 0 && viewport.height > 0
      ? officeCameraCenteredOn(nextPosition, viewport, mapLayout)
      : { x: 0, y: 0 })
  // Reframe only when the visible map geometry changes, not on every live poll.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLayout.width, mapLayout.height])

  useLayoutEffect(() => {
    if (replaySeq == null || !replayFocus || !replayFocusTarget) {
      replayFocusKeyRef.current = null
      return
    }
    const focusKey = `${replayFocus.seq}:${building.asOfSeq ?? 'loading'}:${replayFocusTarget.id}`
    if (replayFocusKeyRef.current === focusKey) return
    const viewport = viewportRef.current?.getBoundingClientRect()
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) return
    replayFocusKeyRef.current = focusKey
    setCamera(officeCameraCenteredOn(replayFocusTarget, viewport, mapLayout))
    viewportRef.current?.focus({ preventScroll: true })
  }, [building.asOfSeq, mapLayout, replayFocus, replayFocusTarget, replaySeq])

  useEffect(() => {
    if (!initialLayoutKeyRef.current) return
    onPlayerStateChange?.({ position: alice, direction: aliceDirection })
  }, [alice, aliceDirection, onPlayerStateChange])

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
              onClick={onReturnLive}
            >
              <span className="oa-office-live-dot" aria-hidden />
              {t('office.replayLive')}
            </button>
          )}
          <DropdownMenu
            open={menuOpen}
            onOpenChange={(open) => {
              if (open) {
                cancelAutoWalk()
                stopTouchMove()
                setPanning(false)
              }
              if (open) {
                setMenuOpen(true)
              } else {
                closeFloorMenu()
              }
            }}
          >
            <DropdownMenuTrigger
              render={<button
                type="button"
                ref={menuTriggerRef}
                className="oa-office-pause-trigger"
                aria-label={t('office.pauseMenu')}
                data-open={menuOpen}
                onPointerDown={() => { menuOriginRef.current = 'hud' }}
                onKeyDown={() => { menuOriginRef.current = 'hud' }}
                onClick={() => { menuOriginRef.current = 'hud' }}
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
              aria-label={t('office.floorView')}
              align="end"
              sideOffset={8}
              className="oa-office-pause-menu"
            >
              <div className="oa-office-pause-menu__header" role="presentation">
                <img src={OFFICE_HUD_ASSETS.menuTerminal} alt="" style={officePixelImg} />
                <span>{t('office.floorView')}</span>
              </div>
              {hiddenGroupCount > 0 ? (
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
                onClick={() => {
                  closeFloorMenu(false)
                  onOpenLog(menuOriginRef.current === 'floor-terminal'
                    ? 'floor-terminal'
                    : 'menu')
                }}
              >
                <img src={OFFICE_HUD_ASSETS.occupancyLog} alt="" aria-hidden style={officePixelImg} />
                <span>{t('office.timeline')}</span>
              </DropdownMenuItem>
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
        <div className="oa-office-map-stage">
          <div
            ref={mapRef}
            className="oa-office-map"
            style={{
              width: mapLayout.width,
              height: mapLayout.height,
              transform: `translate3d(${camera.x}px, ${camera.y}px, 0)`,
              backgroundImage: `url(${OFFICE_FURNITURE.generated.floorTile})`,
            }}
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
              className="oa-office-map-landmark oa-office-map-landmark--terminal"
              aria-label={t('office.floorTerminal')}
              title={replaySeq == null ? t('office.floorTerminalHint') : t('office.replayLockedHint')}
              disabled={replaySeq != null}
              data-replay-locked={replaySeq != null || undefined}
              data-nearby={nearbyTarget?.kind === 'floor-terminal'}
              data-route={routeTargetId === 'floor-terminal'}
              onClick={() => requestTargetInteraction('floor-terminal')}
              style={{ zIndex: officeDepthAt(floorTerminal.y + 19) }}
            >
              <img
                src={OFFICE_FURNITURE.generated.terminal}
                alt=""
                aria-hidden
                style={officePixelImg}
              />
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
              const needsAttention = productActivity.attention[landmark.kind]
              const serviceName = landmark.kind === 'inbox'
                ? t('office.inboxStation')
                : t('office.newsStation')
              return (
              <button
                key={landmark.id}
                id={`office-${landmark.id}`}
                type="button"
                className="oa-office-map-service"
                data-kind={landmark.kind}
                data-fresh={fresh || undefined}
                data-attention={needsAttention || undefined}
                data-has-activity={Boolean(activity) || undefined}
                data-nearby={nearbyTarget?.kind === interactionKind || undefined}
                data-route={routeTargetId === landmark.id || undefined}
                data-replay-locked={replaySeq != null || undefined}
                aria-label={needsAttention
                  ? t('office.serviceNeedsAttention', { name: serviceName })
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
                {needsAttention && (
                  <span className="oa-office-map-service__signal" aria-hidden>!</span>
                )}
              </button>
              )
            })}
            <button
              id="office-operations-board"
              type="button"
              className="oa-office-operations-board"
              data-live={(replaySeq == null ? stats.working : stats.active) > 0}
              data-has-activity={Boolean(productActivity.agent) || undefined}
              data-attention={productActivity.attention.agent || undefined}
              data-fresh={productActivity.freshKind === 'agent' || undefined}
              data-nearby={nearbyTarget?.kind === 'operations'}
              data-route={routeTargetId === 'operations'}
              aria-label={productActivity.attention.agent
                ? t('office.serviceNeedsAttention', { name: t('office.operationsBoard') })
                : t('office.operationsBoard')}
              title={t('office.operationsBoardHint')}
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
              {productActivity.attention.agent && (
                <span className="oa-office-operations-board__signal" aria-hidden>!</span>
              )}
            </button>
            <img
              src={OFFICE_FURNITURE.generated.spawnCompass}
              alt=""
              aria-hidden
              data-testid="office-spawn-compass"
              className="oa-office-spawn-compass"
              style={{
                ...officePixelImg,
                left: mapLayout.alice.x,
                top: mapLayout.alice.y,
              }}
            />
            <OfficeRouteTrail steps={routeTrail} />
            {routeTarget && (
              <OfficeRouteTargetPointer
                target={routeTarget}
                reducedMotion={reducedMotion}
                zIndex={officeDepthAt(routeTarget.y) + 1200}
              />
            )}
            {replayFocus && replayFocusTarget && replayFocus.seq === replaySeq && (
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
              data-bumped={aliceBumped}
              style={{ left: alice.x, top: alice.y, zIndex: officeDepthAt(alice.y) }}
            >
              <span className="oa-office-alice__sprite" aria-hidden>
                <OfficeAliceSprite
                  direction={aliceDirection}
                  walking={aliceWalking}
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
                  () => onOpenEmployee(workspaceId, employee),
                )}
                onOpenWorkspace={(workspaceId) => requestTargetInteraction(`sign:${workspaceId}`)}
                onOpenFiles={(workspaceId) => requestTargetInteraction(`cabinet:${workspaceId}`)}
                onOpenRoster={(workspaceId) => requestTargetInteraction(`roster:${workspaceId}`)}
                nearbyTargetId={nearbyTarget?.id}
                routeTargetId={routeTargetId}
                replayFocusResumeId={replayFocus?.seq === replaySeq
                  && replayFocus.workspaceId === group.workspace.id
                  ? replayFocus.resumeId
                  : null}
                coworkerAssets={coworkerAssets}
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
              data-side={promptPlacement.side}
              data-has-detail={Boolean(promptPresentation.detail) || undefined}
              style={{
                left: promptPlacement.x,
                top: promptPlacement.y,
                width: promptPlacement.width,
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
          <button type="button" onClick={centerCameraOnAlice} aria-label={t('office.centerMapOnAlice')}>
            <img
              src={OFFICE_HUD_ASSETS.resetCompass}
              alt=""
              aria-hidden
              style={officePixelImg}
            />
          </button>
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
