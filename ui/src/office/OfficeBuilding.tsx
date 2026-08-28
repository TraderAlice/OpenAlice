import { LocateFixed, Menu, Move, Radio, ScrollText, X } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  OfficeBuildingSnapshot,
  OfficeFloorEmployee,
} from '../api/office'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { OFFICE_FURNITURE, officePixelImg } from './furniture'
import { OfficeEmployeeSprite } from './OfficeEmployeeSprite'
import { OfficeMapPod } from './OfficeMapPod'
import {
  nearestOfficeInteractionTarget,
  officeCameraFollowingAlice,
  officeInteractionTargets,
} from './interaction-targets'
import { officeCoworkerLabel } from './label'
import { layoutOfficeMap } from './map-layout'
import { useReducedMotion } from './use-reduced-motion'

export function OfficeBuilding({
  building,
  groupTitle,
  selected,
  onSelectEmployee,
  onOpenEmployee,
  onOpenFiles,
  onOpenLog,
}: {
  building: OfficeBuildingSnapshot
  groupTitle?: (workspaceId: string, tag: string) => string
  selected?: { workspaceId: string; resumeId: string } | null
  onSelectEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenEmployee: (workspaceId: string, employee: OfficeFloorEmployee) => void
  onOpenFiles: (workspaceId: string) => void
  onOpenLog?: () => void
}) {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const [showAll, setShowAll] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [camera, setCamera] = useState({ x: 0, y: 0 })
  const [alice, setAlice] = useState({ x: 480, y: 336 })
  const [aliceDirection, setAliceDirection] = useState<'up' | 'right' | 'down' | 'left'>('down')
  const [panning, setPanning] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    cameraX: number
    cameraY: number
  } | null>(null)
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
  const nearbyTarget = useMemo(
    () => nearestOfficeInteractionTarget(alice, interactionTargets),
    [alice, interactionTargets],
  )
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
    setCamera(centeredCamera())
    setAlice(mapLayout.alice)
    setAliceDirection('down')
  }
  useLayoutEffect(() => {
    setAlice(mapLayout.alice)
    setAliceDirection('down')
    setCamera(centeredCamera())
  // Reframe only when the visible map geometry changes, not on every live poll.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLayout.width, mapLayout.height])

  return (
    <div
      data-testid="office-building"
      className="oa-office-building"
    >
      <header
        data-testid="office-wall"
        className="oa-office-hud"
      >
        <div className="oa-office-hud__identity">
          <span className="oa-office-hud__signal" aria-hidden>
            <Radio size={15} strokeWidth={2.2} />
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
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger
              render={<button
                type="button"
                className="oa-office-pause-trigger"
                aria-label={t('office.pauseMenu')}
              />}
            >
              {menuOpen ? <X size={15} /> : <Menu size={15} />}
              {t('office.pauseMenu')}
            </PopoverTrigger>
            <PopoverContent
              role="menu"
              aria-label={t('office.floorView')}
              align="end"
              sideOffset={8}
              className="oa-office-pause-menu"
            >
              <button
                type="button"
                role="menuitemradio"
                aria-pressed={!showAll}
                aria-checked={!showAll}
                onClick={() => {
                  setShowAll(false)
                  setCamera({ x: 0, y: 0 })
                  setMenuOpen(false)
                }}
              >
                <span className="oa-office-awake-dot" aria-hidden />
                {t('office.liveMap')}
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-pressed={showAll}
                aria-checked={showAll}
                onClick={() => {
                  setShowAll(true)
                  setCamera({ x: 0, y: 0 })
                  setMenuOpen(false)
                }}
              >
                {t('office.allGroups')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onOpenLog?.()
                }}
              >
                <ScrollText size={13} />
                {t('office.timeline')}
              </button>
            </PopoverContent>
          </Popover>
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
            if (nearbyTarget.kind === 'employee') {
              onSelectEmployee(nearbyTarget.workspaceId, nearbyTarget.employee)
            } else {
              onOpenFiles(nearbyTarget.workspaceId)
            }
            return
          }
          const movement = {
            arrowleft: { x: -24, y: 0, direction: 'left' as const },
            a: { x: -24, y: 0, direction: 'left' as const },
            arrowright: { x: 24, y: 0, direction: 'right' as const },
            d: { x: 24, y: 0, direction: 'right' as const },
            arrowup: { x: 0, y: -24, direction: 'up' as const },
            w: { x: 0, y: -24, direction: 'up' as const },
            arrowdown: { x: 0, y: 24, direction: 'down' as const },
            s: { x: 0, y: 24, direction: 'down' as const },
          }[key]
          if (!movement) return
          event.preventDefault()
          setAliceDirection(movement.direction)
          setAlice((current) => {
            const next = {
              x: Math.min(mapLayout.width - 24, Math.max(24, current.x + movement.x)),
              y: Math.min(mapLayout.height - 24, Math.max(24, current.y + movement.y)),
            }
            const viewport = viewportRef.current?.getBoundingClientRect()
            if (viewport) {
              setCamera((currentCamera) => officeCameraFollowingAlice(
                next,
                currentCamera,
                viewport,
                mapLayout,
              ))
            }
            return next
          })
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return
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
              style={{ backgroundImage: `url(${OFFICE_FURNITURE.generated.wallWindow})` }}
            />
            <div className="oa-office-map-landmark oa-office-map-landmark--plant" aria-hidden>
              <img src={OFFICE_FURNITURE.generated.plant} alt="" style={officePixelImg} />
            </div>
            <div className="oa-office-map-landmark oa-office-map-landmark--terminal" aria-hidden>
              <img src={OFFICE_FURNITURE.generated.terminal} alt="" style={officePixelImg} />
            </div>
            <div
              className="oa-office-alice"
              role="img"
              aria-label={t('office.aliceAvatar')}
              data-direction={aliceDirection}
              style={{ left: alice.x, top: alice.y }}
            >
              <span className="oa-office-alice__sprite" aria-hidden>
                <OfficeEmployeeSprite
                  mood="idle"
                  reducedMotion={reducedMotion}
                  label={t('office.aliceAvatar')}
                  scale={0.2}
                />
              </span>
              <small>ALICE</small>
            </div>
          {groups.length === 0 && (
            <div className="oa-office-quiet">
              <span className="oa-office-quiet__radar" aria-hidden>
                <Radio size={22} strokeWidth={1.5} />
              </span>
              <p>{t('office.floorQuiet')}</p>
              <span>{t('office.floorQuietHint', { days: sleepAfterDays })}</span>
              <button type="button" onClick={() => setShowAll(true)}>
                {t('office.allGroups')}
              </button>
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
                onSelectEmployee={onSelectEmployee}
                onOpenEmployee={onOpenEmployee}
                onOpenFiles={onOpenFiles}
                nearbyTargetId={nearbyTarget?.id}
              />
            )
          })}
          </div>
        </div>

        {nearbyTarget && !selected && (
          <div className="oa-office-interact-prompt" role="status">
            <kbd>{t('office.interactKey')}</kbd>
            <span>
              {nearbyTarget.kind === 'employee'
                ? t('office.interactTalk', { name: officeCoworkerLabel(nearbyTarget.employee) })
                : t('office.interactFiles', { name: nearbyTarget.roomName })}
            </span>
          </div>
        )}

        <div className="oa-office-map-controls">
          <span><Move size={12} />{t('office.mapHint')}</span>
          <button type="button" onClick={resetMap} aria-label={t('office.resetMap')}>
            <LocateFixed size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
