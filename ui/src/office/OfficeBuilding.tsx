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
import {
  OfficeCollisionImpact,
  officeCollisionImpactPosition,
  type OfficeCollisionImpactState,
} from './OfficeCollisionImpact'
import { OfficeMapPod } from './OfficeMapPod'
import { OfficeRouteTrail } from './OfficeRouteTrail'
import { OfficeRouteTargetPointer } from './OfficeRouteTargetPointer'
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
  officeInteractionPromptPlacement,
} from './interaction-prompt'
import { officeCoworkerLabel } from './label'
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

const OFFICE_MOVEMENTS = {
  left: { x: -24, y: 0, direction: 'left' as const },
  right: { x: 24, y: 0, direction: 'right' as const },
  up: { x: 0, y: -24, direction: 'up' as const },
  down: { x: 0, y: 24, direction: 'down' as const },
}

type OfficeMovement = (typeof OFFICE_MOVEMENTS)[keyof typeof OFFICE_MOVEMENTS]
const OFFICE_DEPARTURE_MS = 260
export type OfficeLogOrigin = 'menu' | 'operations' | 'floor-terminal'
export interface OfficePlayerState {
  position: { x: number; y: number }
  direction: OfficeAliceDirection
}

export function OfficeBuilding({
  building,
  groupTitle,
  selected,
  replaySeq = null,
  interactionSuspended = false,
  initialPlayerState = null,
  onPlayerStateChange,
  onSelectEmployee,
  onOpenEmployee,
  onOpenWorkspace,
  onOpenFiles,
  onOpenRoster,
  onOpenLog,
  onReturnLive,
}: {
  building: OfficeBuildingSnapshot
  groupTitle?: (workspaceId: string, tag: string) => string
  selected?: { workspaceId: string; resumeId: string } | null
  replaySeq?: number | null
  interactionSuspended?: boolean
  initialPlayerState?: OfficePlayerState | null
  onPlayerStateChange?: (state: OfficePlayerState) => void
  onSelectEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenWorkspace: (workspaceId: string) => void
  onOpenFiles: (workspaceId: string) => void
  onOpenRoster: (workspaceId: string) => void
  onOpenLog: (origin: OfficeLogOrigin) => void
  onReturnLive?: () => void
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
  const routeTimerRef = useRef<number | null>(null)
  const departureTimerRef = useRef<number | null>(null)
  const routeGenerationRef = useRef(0)
  const menuOriginRef = useRef<'hud' | 'floor-terminal'>('hud')
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const awakeGroups = useMemo(
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
  const stats = useMemo(() => {
    const employees = groups.flatMap((office) => office.employees)
    return {
      occupied: employees.length,
      active: employees.filter((employee) => employee.mood !== 'idle').length,
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
  const routeTarget = routeTargetId ? interactionTargetById.get(routeTargetId) : null
  const routeTargetName = routeTarget
    ? routeTarget.kind === 'employee'
      ? officeCoworkerLabel(routeTarget.employee)
      : routeTarget.kind === 'operations'
        ? t('office.operationsBoard')
        : routeTarget.kind === 'floor-terminal'
          ? t('office.floorTerminal')
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
          nearbyTarget.kind === 'sign'
            ? OFFICE_PROMPT_DESTINATION_MAX_WIDTH
            : nearbyTarget.kind === 'employee' && nearbyTarget.employee.bubble
              ? viewportSize.width > 0 && viewportSize.width <= 520
                ? OFFICE_PROMPT_NARROW_DETAIL_MAX_WIDTH
                : OFFICE_PROMPT_DETAIL_MAX_WIDTH
              : undefined,
        )
      : null,
    [alice, camera, mapLayout.height, mapLayout.width, nearbyTarget, viewportSize],
  )
  const promptPresentation = (() => {
    if (!nearbyTarget) return null
    if (nearbyTarget.kind === 'employee') {
      const target = officeCoworkerLabel(nearbyTarget.employee)
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
        detail: null,
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
    return {
      icon: OFFICE_HUD_ASSETS.occupancyLog,
      action: t('office.interactActionOperations'),
      label: t('office.interactOperations'),
      detail: null,
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
  const stopTouchMove = () => {
    if (touchMoveDelayRef.current != null) window.clearTimeout(touchMoveDelayRef.current)
    if (touchMoveRepeatRef.current != null) window.clearInterval(touchMoveRepeatRef.current)
    touchMoveDelayRef.current = null
    touchMoveRepeatRef.current = null
  }
  const startTouchMove = (movement: OfficeMovement) => {
    if (floorInteractionSuspended || departingWorkspace) return
    cancelAutoWalk()
    stopTouchMove()
    moveAlice(movement)
    touchMoveDelayRef.current = window.setTimeout(() => {
      touchMoveRepeatRef.current = window.setInterval(() => moveAlice(movement), 96)
    }, 220)
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
      if ((key === 'enter' || key === ' ') && nearbyTarget && (fromIdlePage || target === viewport)) {
        event.preventDefault()
        activateNearbyTarget()
        return
      }
      const movement = {
        arrowleft: OFFICE_MOVEMENTS.left,
        a: OFFICE_MOVEMENTS.left,
        arrowright: OFFICE_MOVEMENTS.right,
        d: OFFICE_MOVEMENTS.right,
        arrowup: OFFICE_MOVEMENTS.up,
        w: OFFICE_MOVEMENTS.up,
        arrowdown: OFFICE_MOVEMENTS.down,
        s: OFFICE_MOVEMENTS.down,
      }[key]
      if (!movement) return
      event.preventDefault()
      if (fromFloor && target !== viewport) viewport?.focus({ preventScroll: true })
      cancelAutoWalk()
      moveAlice(movement)
    }
    document.addEventListener('keydown', handleAmbientKeyDown)
    return () => document.removeEventListener('keydown', handleAmbientKeyDown)
  })
  useEffect(() => () => {
    if (bumpFrameRef.current != null) window.cancelAnimationFrame(bumpFrameRef.current)
    if (bumpTimerRef.current != null) window.clearTimeout(bumpTimerRef.current)
    if (impactTimerRef.current != null) window.clearTimeout(impactTimerRef.current)
    if (walkTimerRef.current != null) window.clearTimeout(walkTimerRef.current)
    routeGenerationRef.current += 1
    if (routeTimerRef.current != null) window.clearTimeout(routeTimerRef.current)
    if (departureTimerRef.current != null) window.clearTimeout(departureTimerRef.current)
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
      setCamera((current) => clampOfficeCamera(current, rect, mapLayout))
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
          title={t('office.visibleGroupCount', {
            visible: defaultGroups.length,
            awake: awakeGroups.length,
            total: building.offices.length,
          })}
        >
          <span data-live={stats.active > 0}>
            {t('office.activeAgentRatio', { active: stats.active, total: stats.occupied })}
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
        <div className="oa-office-room-grid">
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
            {serviceLandmarks.map((landmark) => (
              <div
                key={landmark.id}
                className="oa-office-map-service"
                data-kind={landmark.kind}
                aria-hidden
                style={{
                  left: landmark.x,
                  top: landmark.y,
                  width: landmark.width,
                  height: landmark.height,
                  zIndex: officeDepthAt(landmark.y + landmark.collision.y + landmark.collision.height),
                }}
              >
                <img
                  src={landmark.kind === 'mail'
                    ? OFFICE_FURNITURE.generated.mailService
                    : OFFICE_FURNITURE.generated.archiveService}
                  alt=""
                  style={officePixelImg}
                />
              </div>
            ))}
            <button
              id="office-operations-board"
              type="button"
              className="oa-office-operations-board"
              data-live={stats.active > 0}
              data-nearby={nearbyTarget?.kind === 'operations'}
              data-route={routeTargetId === 'operations'}
              aria-label={t('office.operationsBoard')}
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
            {collisionImpact && (
              <OfficeCollisionImpact
                key={collisionImpact.serial}
                impact={collisionImpact}
                reducedMotion={reducedMotion}
                zIndex={officeDepthAt(Math.max(alice.y, collisionImpact.y)) + 200}
              />
            )}
            {routeTargetName && (
              <span className="sr-only" role="status" aria-live="polite">
                {t('office.walkingTo', { name: routeTargetName })}
              </span>
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
              />
            )
          })}
          {nearbyTarget && promptPlacement && promptPresentation && (
            <div
              className="oa-office-interact-prompt"
              role="status"
              aria-label={promptPresentation.detail
                ? `${promptPresentation.label} · ${promptPresentation.detail}`
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
                  {promptPresentation.detail && <small>{promptPresentation.detail}</small>}
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

        <div
          className="oa-office-map-controls"
          data-learned={controlsLearned}
          data-action-ready={Boolean(nearbyTarget) || undefined}
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
                startTouchMove(OFFICE_MOVEMENTS[direction])
              }}
              onPointerUp={stopTouchMove}
              onPointerCancel={stopTouchMove}
              onLostPointerCapture={stopTouchMove}
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
