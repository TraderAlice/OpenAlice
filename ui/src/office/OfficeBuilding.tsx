import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import { OFFICE_HUD_ASSETS } from './hud-assets'
import { officeInteractionPath } from './interaction-path'
import { OfficeAliceSprite, type OfficeAliceDirection } from './OfficeAliceSprite'
import { OfficeMapPod } from './OfficeMapPod'
import {
  nearestOfficeInteractionTarget,
  officeCameraFollowingAlice,
  officeInteractionTargets,
  type OfficeInteractionTarget,
} from './interaction-targets'
import { officeInteractionPromptPlacement } from './interaction-prompt'
import { officeCoworkerLabel } from './label'
import { moveAliceOnOfficeMap, officeCollisionRects } from './map-collision'
import { officeOperationsBoardPosition } from './map-landmarks'
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

export function OfficeBuilding({
  building,
  groupTitle,
  selected,
  interactionSuspended = false,
  onSelectEmployee,
  onOpenEmployee,
  onOpenFiles,
  onOpenRoster,
  onOpenLog,
}: {
  building: OfficeBuildingSnapshot
  groupTitle?: (workspaceId: string, tag: string) => string
  selected?: { workspaceId: string; resumeId: string } | null
  interactionSuspended?: boolean
  onSelectEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenFiles: (workspaceId: string, origin: 'sign' | 'cabinet') => void
  onOpenRoster: (workspaceId: string) => void
  onOpenLog: (origin: 'menu' | 'operations') => void
}) {
  const { t } = useTranslation()
  const officeTime = useEffectivePreferenceSlot()
  const reducedMotion = useReducedMotion()
  const [showAll, setShowAll] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [camera, setCamera] = useState({ x: 0, y: 0 })
  const [alice, setAlice] = useState({ x: 480, y: 336 })
  const aliceRef = useRef(alice)
  const [aliceDirection, setAliceDirection] = useState<OfficeAliceDirection>('down')
  const [aliceWalking, setAliceWalking] = useState(false)
  const [aliceBumped, setAliceBumped] = useState(false)
  const [panning, setPanning] = useState(false)
  const [controlsLearned, setControlsLearned] = useState(false)
  const [routeTargetId, setRouteTargetId] = useState<string | null>(null)
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
  const bumpFrameRef = useRef<number | null>(null)
  const walkTimerRef = useRef<number | null>(null)
  const touchMoveDelayRef = useRef<number | null>(null)
  const touchMoveRepeatRef = useRef<number | null>(null)
  const routeTimerRef = useRef<number | null>(null)
  const routeGenerationRef = useRef(0)
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
  const groups = showAll ? building.offices : defaultGroups
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
        : routeTarget.roomName
    : null
  const operationsBoard = useMemo(
    () => officeOperationsBoardPosition(mapLayout.width),
    [mapLayout.width],
  )
  const nearbyTarget = useMemo(
    () => interactionSuspended || selected
      ? null
      : nearestOfficeInteractionTarget(alice, aliceDirection, interactionTargets),
    [alice, aliceDirection, interactionSuspended, interactionTargets, selected],
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
      }
    }
    if (nearbyTarget.kind === 'cabinet' || nearbyTarget.kind === 'sign') {
      return {
        icon: OFFICE_HUD_ASSETS.drawerRecord,
        action: t('office.interactActionFiles'),
        label: t('office.interactFiles', { name: nearbyTarget.roomName }),
      }
    }
    if (nearbyTarget.kind === 'roster') {
      return {
        icon: OFFICE_HUD_ASSETS.rosterBadge,
        action: t('office.interactActionRoster'),
        label: t('office.interactRoster', { name: nearbyTarget.roomName }),
      }
    }
    return {
      icon: OFFICE_HUD_ASSETS.occupancyLog,
      action: t('office.interactActionOperations'),
      label: t('office.interactOperations'),
    }
  })()
  const sleepAfterDays = Math.max(
    1,
    Math.round(building.config.workspaceSleepAfterMs / (24 * 60 * 60 * 1000)),
  )
  const clampCamera = (x: number, y: number) => {
    const viewport = viewportRef.current?.getBoundingClientRect()
    if (!viewport) return { x, y }
    return {
      x: Math.min(0, Math.max(viewport.width - mapLayout.width, x)),
      y: Math.min(0, Math.max(viewport.height - mapLayout.height, y)),
    }
  }
  const centeredCamera = () => {
    const viewport = viewportRef.current?.getBoundingClientRect()
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) return { x: 0, y: 0 }
    return clampCamera(
      Math.round(viewport.width / 2 - mapLayout.alice.x),
      mapLayout.height > 720
        ? Math.round(viewport.height / 2 - mapLayout.alice.y)
        : 0,
    )
  }
  const resetMap = () => {
    cancelAutoWalk()
    setCamera(centeredCamera())
    aliceRef.current = mapLayout.alice
    setAlice(mapLayout.alice)
    setAliceDirection('down')
    setAliceWalking(false)
  }
  const showCollisionBump = () => {
    if (walkTimerRef.current != null) window.clearTimeout(walkTimerRef.current)
    setAliceWalking(false)
    if (bumpFrameRef.current != null) window.cancelAnimationFrame(bumpFrameRef.current)
    if (bumpTimerRef.current != null) window.clearTimeout(bumpTimerRef.current)
    setAliceBumped(false)
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
  const moveAlice = (movement: OfficeMovement) => {
    setControlsLearned(true)
    setAliceDirection(movement.direction)
    const move = moveAliceOnOfficeMap(aliceRef.current, movement, mapLayout, collisionRects)
    if (move.bumped) {
      showCollisionBump()
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
      onOpenFiles(target.workspaceId, 'sign')
    } else if (target.kind === 'cabinet') {
      onOpenFiles(target.workspaceId, 'cabinet')
    } else if (target.kind === 'roster') {
      onOpenRoster(target.workspaceId)
    } else {
      onOpenLog('operations')
    }
  }
  const activateNearbyTarget = () => {
    if (!nearbyTarget || selected) return
    activateTarget(nearbyTarget)
  }
  function cancelAutoWalk() {
    routeGenerationRef.current += 1
    if (routeTimerRef.current != null) window.clearTimeout(routeTimerRef.current)
    routeTimerRef.current = null
    setRouteTargetId(null)
  }
  const requestTargetInteraction = (targetId: string, activate?: () => void) => {
    if (selected || interactionSuspended) return
    const target = interactionTargetById.get(targetId)
    if (!target) return
    cancelAutoWalk()
    const generation = routeGenerationRef.current
    const path = officeInteractionPath(aliceRef.current, target, mapLayout, collisionRects)
    if (!path) {
      showCollisionBump()
      return
    }
    setControlsLearned(true)
    setRouteTargetId(targetId)
    let stepIndex = 0
    const finish = () => {
      if (routeGenerationRef.current !== generation) return
      setAliceDirection(path.facing)
      setAliceWalking(false)
      setRouteTargetId(null)
      routeTimerRef.current = window.setTimeout(() => {
        if (routeGenerationRef.current !== generation) return
        routeTimerRef.current = null
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
      moveAlice(OFFICE_MOVEMENTS[step.direction])
      stepIndex += 1
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
    cancelAutoWalk()
    stopTouchMove()
    moveAlice(movement)
    touchMoveDelayRef.current = window.setTimeout(() => {
      touchMoveRepeatRef.current = window.setInterval(() => moveAlice(movement), 96)
    }, 220)
  }
  useEffect(() => () => {
    if (bumpFrameRef.current != null) window.cancelAnimationFrame(bumpFrameRef.current)
    if (bumpTimerRef.current != null) window.clearTimeout(bumpTimerRef.current)
    if (walkTimerRef.current != null) window.clearTimeout(walkTimerRef.current)
    routeGenerationRef.current += 1
    if (routeTimerRef.current != null) window.clearTimeout(routeTimerRef.current)
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
      setCamera((current) => ({
        x: Math.min(0, Math.max(rect.width - mapLayout.width, current.x)),
        y: Math.min(0, Math.max(rect.height - mapLayout.height, current.y)),
      }))
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
    aliceRef.current = mapLayout.alice
    setAlice(mapLayout.alice)
    setAliceDirection('down')
    setAliceWalking(false)
    setCamera(centeredCamera())
  // Reframe only when the visible map geometry changes, not on every live poll.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLayout.width, mapLayout.height])

  return (
    <div
      data-testid="office-building"
      className="oa-office-building"
      data-office-time={officeTime}
    >
      <header
        data-testid="office-wall"
        className="oa-office-hud"
      >
        <div className="oa-office-hud__identity">
          <span className="oa-office-hud__signal" aria-hidden>
            <img src={OFFICE_HUD_ASSETS.signalReceiver} alt="" style={officePixelImg} />
          </span>
          <div>
            <p className="oa-office-kicker">{t('office.commandCenter')}</p>
            <p className="oa-office-hud__title">{t('office.liveFloor')}</p>
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
          <span data-live={stats.active > 0}>{stats.active} {t('office.active')}</span>
          <span>{stats.occupied} {t('office.occupied')}</span>
          <span>{groups.length}/{building.offices.length} {t('office.groups')}</span>
        </div>

        <div className="oa-office-hud__actions">
          <DropdownMenu
            open={menuOpen}
            onOpenChange={(open) => {
              if (open) cancelAutoWalk()
              setMenuOpen(open)
            }}
          >
            <DropdownMenuTrigger
              render={<button
                type="button"
                className="oa-office-pause-trigger"
                aria-label={t('office.pauseMenu')}
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
              aria-label={t('office.floorView')}
              align="end"
              sideOffset={8}
              className="oa-office-pause-menu"
            >
              <div className="oa-office-pause-menu__header" role="presentation">
                <img src={OFFICE_HUD_ASSETS.menuTerminal} alt="" style={officePixelImg} />
                <span>{t('office.floorView')}</span>
              </div>
              <DropdownMenuRadioGroup
                value={showAll ? 'all' : 'live'}
                onValueChange={(value) => {
                  setShowAll(value === 'all')
                  setCamera({ x: 0, y: 0 })
                  setMenuOpen(false)
                }}
              >
                <DropdownMenuRadioItem value="live">
                  <img src={OFFICE_HUD_ASSETS.resetCompass} alt="" aria-hidden style={officePixelImg} />
                  <span>{t('office.liveMap')}</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="all">
                  <img src={OFFICE_HUD_ASSETS.groupGrid} alt="" aria-hidden style={officePixelImg} />
                  <span>{t('office.allGroups')}</span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuItem
                onClick={() => {
                  setMenuOpen(false)
                  onOpenLog('menu')
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
        data-panning={panning}
        aria-label={t('office.mapLabel')}
        onKeyDown={(event) => {
          const key = event.key.toLowerCase()
          if ((key === 'enter' || key === ' ') && nearbyTarget && !selected) {
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
          cancelAutoWalk()
          moveAlice(movement)
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return
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
            />
            <div
              className="oa-office-map-landmark oa-office-map-landmark--plant"
              aria-hidden
              style={{ zIndex: officeDepthAt(178) }}
            >
              <img src={OFFICE_FURNITURE.generated.plant} alt="" style={officePixelImg} />
            </div>
            <div
              className="oa-office-map-landmark oa-office-map-landmark--terminal"
              aria-hidden
              style={{ zIndex: officeDepthAt(183) }}
            >
              <img src={OFFICE_FURNITURE.generated.terminal} alt="" style={officePixelImg} />
            </div>
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
              <small>ALICE</small>
            </div>
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
                title={resolveGroupTitle(
                  group.workspace.id,
                  group.workspace.tag,
                )}
                harnessTitle={t(`office.harness.${group.workspace.harness}`)}
                selected={selected}
                reducedMotion={reducedMotion}
                onSelectEmployee={(workspaceId, employee) => requestTargetInteraction(
                  `employee:${workspaceId}:${employee.resumeId}`,
                )}
                onOpenEmployee={(workspaceId, employee) => requestTargetInteraction(
                  `employee:${workspaceId}:${employee.resumeId}`,
                  () => onOpenEmployee(workspaceId, employee),
                )}
                onOpenFiles={(workspaceId, origin) => requestTargetInteraction(
                  `${origin}:${workspaceId}`,
                )}
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
              aria-label={promptPresentation.label}
              data-kind={nearbyTarget.kind}
              data-side={promptPlacement.side}
              style={{
                left: promptPlacement.x,
                top: promptPlacement.y,
                zIndex: officeDepthAt(nearbyTarget.y) + 1000,
              }}
            >
              <button
                type="button"
                className="oa-office-interact-prompt__action"
                aria-label={t('office.interactNow', { action: promptPresentation.label })}
                onClick={activateNearbyTarget}
              >
                <img src={promptPresentation.icon} alt="" aria-hidden style={officePixelImg} />
                <span className="oa-office-interact-prompt__copy" aria-hidden>
                  <strong>{promptPresentation.action}</strong>
                </span>
                <kbd aria-hidden>{t('office.interactKey')}</kbd>
              </button>
            </div>
          )}
          </div>
        </div>

        <div className="oa-office-map-controls" data-learned={controlsLearned}>
          <span className="oa-office-map-controls__move">
            <img src={OFFICE_HUD_ASSETS.movePad} alt="" aria-hidden style={officePixelImg} />
            <span>{t('office.mapHint')}</span>
          </span>
          <button type="button" onClick={resetMap} aria-label={t('office.resetMap')}>
            <img
              src={OFFICE_HUD_ASSETS.resetCompass}
              alt=""
              aria-hidden
              style={officePixelImg}
            />
          </button>
        </div>
        <div className="oa-office-touch-dpad" role="group" aria-label={t('office.touchControls')}>
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
      </div>
    </div>
  )
}
