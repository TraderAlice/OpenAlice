import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import type { OfficeDrawerItem, OfficeFloorEmployee } from '../api/office'
import { workspaceDisplayName } from '../components/workspace/display'
import { useWorkspaces } from '../contexts/workspaces-context'
import { useOfficeFloor } from '../hooks/useOfficeFloor'
import { useInboxSelection } from '../live/inbox-selection'
import { useWorkspaceSidePanels } from '../live/workspace-side-panels'
import { OfficeBuilding, type OfficeLogOrigin } from '../office/OfficeBuilding'
import { OfficeCabinetWindow } from '../office/OfficeCabinetWindow'
import { officeActivityActors } from '../office/activity-actors'
import { officeCoworkerCast, type OfficeCoworkerSpriteAsset } from '../office/coworker-sprites'
import { readOfficeCoworkerCasts, writeOfficeCoworkerCasts } from '../office/coworker-cast-storage'
import { officePixelImg } from '../office/furniture'
import { OfficeConnectionBanner, OfficeConnectionScreen } from '../office/OfficeConnectionState'
import { OfficeInspectRail } from '../office/OfficeInspectRail'
import { OfficeWindowControlGlyph } from '../office/OfficeWindowControlGlyph'
import { OFFICE_HUD_ASSETS } from '../office/hud-assets'
import {
  readOfficePlayerState,
  rememberOfficePlayerState,
} from '../office/office-excursion'
import { OfficeReplayBar } from '../office/OfficeReplayBar'
import type { OfficeReplayFocus } from '../office/replay-focus'
import { OfficeRosterWindow } from '../office/OfficeRosterWindow'
import { useOfficeProductActivity } from '../office/useOfficeProductActivity'
import '../office/office.css'
import { useWorkspace } from '../tabs/store'
import type { WorkspaceSource } from '../tabs/types'
import { OfficeRuntimeSection, type OfficeLogChannel } from './OfficeRuntimeSection'

function sourceForTag(tag: string): WorkspaceSource | undefined {
  if (tag === 'chat') return 'chat'
  if (tag === 'auto-quant') return 'auto-quant'
  if (tag === 'prediction') return 'prediction'
  return undefined
}

/**
 * One spatial floor. Each Workspace is a bay of desks. Activity Bar is the only navigator.
 */
export function OfficePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { workspaces } = useWorkspaces()
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const initialPlayerStateRef = useRef(readOfficePlayerState())
  const [asOfSeq, setAsOfSeq] = useState<number | null>(null)
  const [replayFocus, setReplayFocus] = useState<OfficeReplayFocus | null>(null)
  const [replayPanelOpen, setReplayPanelOpen] = useState(false)
  const [retryingFloor, setRetryingFloor] = useState(false)
  const [selected, setSelected] = useState<{ workspaceId: string; resumeId: string } | null>(null)
  const [logView, setLogView] = useState<{
    origin: OfficeLogOrigin
    channel: OfficeLogChannel
    focusSeq: number | null
  } | null>(null)
  const [menuResumeToken, setMenuResumeToken] = useState(0)
  const [rosterWorkspaceId, setRosterWorkspaceId] = useState<string | null>(null)
  const [rosterFocusResumeId, setRosterFocusResumeId] = useState<string | null>(null)
  const employeeOriginRef = useRef<
    | { kind: 'map' }
    | { kind: 'roster'; workspaceId: string; resumeId: string }
  >({ kind: 'map' })
  const [cabinetWorkspaceId, setCabinetWorkspaceId] = useState<string | null>(null)
  const { building, error, refresh } = useOfficeFloor(asOfSeq)
  const productActivity = useOfficeProductActivity()
  const retryFloor = async () => {
    setRetryingFloor(true)
    try {
      await refresh()
    } finally {
      setRetryingFloor(false)
    }
  }
  const markExcursion = () => {
    navigate('/office/return', { state: { officeExcursion: true } })
  }

  const selectedSeat = useMemo(() => {
    if (!building || !selected) return null
    const office = building.offices.find((item) => item.workspace.id === selected.workspaceId)
    const employee = office?.employees.find((item) => item.resumeId === selected.resumeId) ?? null
    if (!office || !employee) return null
    const workspace = workspaces.find((item) => item.id === office.workspace.id)
    return {
      office,
      employee,
      roomName: workspace ? workspaceDisplayName(workspace) : office.workspace.tag,
    }
  }, [building, selected, workspaces])
  const initialCoworkerCasts = useMemo(readOfficeCoworkerCasts, [])
  const committedCastsRef = useRef<ReadonlyMap<
    string,
    ReadonlyMap<string, OfficeCoworkerSpriteAsset>
  >>(initialCoworkerCasts)
  const coworkerCastSnapshot = useMemo(() => {
    const byWorkspace = new Map(committedCastsRef.current)
    const assets = new Map<string, OfficeCoworkerSpriteAsset>()
    for (const office of building?.offices ?? []) {
      const cast = officeCoworkerCast(
        office.employees,
        committedCastsRef.current.get(office.workspace.id),
      )
      const rememberedCast = new Map(committedCastsRef.current.get(office.workspace.id))
      for (const [resumeId, asset] of cast) rememberedCast.set(resumeId, asset)
      byWorkspace.set(office.workspace.id, rememberedCast)
      for (const [resumeId, asset] of cast) assets.set(resumeId, asset)
    }
    return { assets, byWorkspace }
  }, [building])
  useLayoutEffect(() => {
    committedCastsRef.current = coworkerCastSnapshot.byWorkspace
    writeOfficeCoworkerCasts(coworkerCastSnapshot.byWorkspace)
  }, [coworkerCastSnapshot])
  const rosterOffice = useMemo(() => {
    if (!building || !rosterWorkspaceId) return null
    const office = building.offices.find((item) => item.workspace.id === rosterWorkspaceId)
    if (!office) return null
    const workspace = workspaces.find((item) => item.id === office.workspace.id)
    return {
      office,
      roomName: workspace ? workspaceDisplayName(workspace) : office.workspace.tag,
    }
  }, [building, rosterWorkspaceId, workspaces])
  const selectedCoworkerAsset = selectedSeat
    ? coworkerCastSnapshot.assets.get(selectedSeat.employee.resumeId)
    : undefined
  const selectedReplayFocus = selectedSeat
    && replayFocus?.seq === asOfSeq
    && replayFocus.workspaceId === selectedSeat.office.workspace.id
    && replayFocus.resumeId === selectedSeat.employee.resumeId
    ? replayFocus
    : null
  const activityActors = useMemo(() => building
    ? officeActivityActors(building.offices, (workspaceId, tag) => {
        const workspace = workspaces.find((item) => item.id === workspaceId)
        return workspace ? workspaceDisplayName(workspace) : tag
      }, coworkerCastSnapshot.assets)
    : new Map(), [building, coworkerCastSnapshot.assets, workspaces])
  const cabinetOffice = useMemo(() => {
    if (!building || !cabinetWorkspaceId) return null
    const office = building.offices.find((item) => item.workspace.id === cabinetWorkspaceId)
    if (!office) return null
    const workspace = workspaces.find((item) => item.id === office.workspace.id)
    return {
      office,
      roomName: workspace ? workspaceDisplayName(workspace) : office.workspace.tag,
    }
  }, [building, cabinetWorkspaceId, workspaces])
  const modalOpen = Boolean(logView)
    || Boolean(selectedSeat)
    || Boolean(rosterOffice)
    || Boolean(cabinetOffice)
  const closeLogWithDestination = (destination: 'origin' | 'floor') => {
    const origin = logView?.origin ?? 'menu'
    setLogView(null)
    if (origin === 'menu' && destination === 'origin') {
      setMenuResumeToken((current) => current + 1)
      return
    }
    requestAnimationFrame(() => {
      if (origin === 'operations') {
        document.getElementById('office-operations-board')?.focus()
      } else if (origin === 'employee') {
        document.querySelector<HTMLElement>('.oa-office-inspect__activity')?.focus()
      } else if (origin === 'floor-terminal') {
        document.getElementById('office-floor-terminal')?.focus()
      } else if (origin === 'inbox-service' || origin === 'news-service') {
        document.getElementById(`office-${origin}`)?.focus()
      } else {
        document.querySelector<HTMLElement>('[data-testid="office-floor"]')?.focus()
      }
    })
  }
  const closeLog = () => closeLogWithDestination('origin')
  const closeLogToFloor = () => closeLogWithDestination('floor')
  const closeEmployee = () => {
    setSelected(null)
    if (employeeOriginRef.current.kind === 'roster') {
      setRosterWorkspaceId(employeeOriginRef.current.workspaceId)
      setRosterFocusResumeId(employeeOriginRef.current.resumeId)
      return
    }
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-testid="office-floor"]')?.focus()
    })
  }
  const closeRoster = () => {
    const workspaceId = rosterWorkspaceId
    setRosterWorkspaceId(null)
    setRosterFocusResumeId(null)
    requestAnimationFrame(() => {
      document.getElementById(`office-roster-${workspaceId}`)?.focus()
    })
  }
  const closeCabinet = () => {
    const workspaceId = cabinetWorkspaceId
    setCabinetWorkspaceId(null)
    requestAnimationFrame(() => {
      document.getElementById(`office-cabinet-${workspaceId}`)?.focus()
    })
  }

  const openEmployee = (workspaceId: string, employee: OfficeFloorEmployee) => {
    const workspace = workspaces.find((item) => item.id === workspaceId)
    const source = workspace ? sourceForTag(workspace.tag) : undefined
    markExcursion()
    openOrFocus({
      kind: 'workspace',
      params: {
        wsId: workspaceId,
        ...(employee.sessionRecordId ? { sessionId: employee.sessionRecordId } : {}),
        ...(source ? { source } : {}),
      },
    })
  }

  const openWorkspaceFiles = (workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId)
    const source = workspace ? sourceForTag(workspace.tag) : undefined
    useWorkspaceSidePanels.getState().setFiles(true)
    markExcursion()
    openOrFocus({
      kind: 'workspace',
      params: { wsId: workspaceId, ...(source ? { source } : {}) },
    })
  }

  const openWorkspace = (workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId)
    const source = workspace ? sourceForTag(workspace.tag) : undefined
    useWorkspaceSidePanels.getState().setFiles(false)
    markExcursion()
    openOrFocus({
      kind: 'workspace',
      params: { wsId: workspaceId, ...(source ? { source } : {}) },
    })
  }

  const openDrawer = (workspaceId: string, employee: OfficeFloorEmployee, item: OfficeDrawerItem) => {
    const workspace = workspaces.find((row) => row.id === workspaceId)
    const source = workspace ? sourceForTag(workspace.tag) : undefined
    if (item.kind === 'report' && item.path) {
      markExcursion()
      openOrFocus({
        kind: 'file-viewer',
        params: {
          wsId: workspaceId,
          path: item.path,
          ...(source ? { source } : {}),
          ...(employee.sessionRecordId ? { returnSessionId: employee.sessionRecordId } : {}),
        },
      })
      return
    }
    if (item.kind === 'issue' && item.issueId) {
      markExcursion()
      openOrFocus({ kind: 'issue-detail', params: { wsId: workspaceId, id: item.issueId } })
      return
    }
    if (item.kind === 'inbox' && item.inboxEntryId) {
      useInboxSelection.getState().select(item.inboxEntryId)
      markExcursion()
      openOrFocus({ kind: 'inbox', params: {} })
      return
    }
    if (item.kind === 'trade-decision') {
      markExcursion()
      openOrFocus({ kind: 'trading-as-git', params: {} })
    }
  }

  const reviewSelectedActivity = selectedSeat && selectedReplayFocus
    ? () => {
      productActivity.acknowledge('agent')
      setLogView({
        origin: 'employee',
        channel: selectedReplayFocus.channel,
        focusSeq: selectedReplayFocus.seq,
      })
      setReplayPanelOpen(true)
    }
    : selectedSeat && selectedSeat.employee.lastSeq > 0 && (
      selectedSeat.employee.mood === 'failed'
      || selectedSeat.employee.mood === 'waiting'
      || selectedSeat.employee.mood === 'review'
      || selectedSeat.employee.latestResult != null
    )
      ? () => {
        productActivity.acknowledge('agent')
        setLogView({
          origin: 'employee',
          channel: 'agent',
          focusSeq: selectedSeat.employee.lastSeq,
        })
        setReplayPanelOpen(false)
      }
      : undefined

  return (
    <div className="oa-office-page">
      <div className="sr-only">
        <h2>{t('nav.item.office')}</h2>
        <p>{t('office.description')}</p>
      </div>
      {!building && (
        <OfficeConnectionScreen
          error={error}
          retrying={retryingFloor}
          onRetry={() => { void retryFloor() }}
        />
      )}
      {building && (
        <div className="oa-office-layout">
          <div className="oa-office-main">
            <div
              className="oa-office-scene"
              aria-hidden={modalOpen || undefined}
              inert={modalOpen || undefined}
            >
              <OfficeBuilding
                building={building}
                coworkerAssets={coworkerCastSnapshot.assets}
                groupTitle={(workspaceId, tag) => {
                  const workspace = workspaces.find((item) => item.id === workspaceId)
                  return workspace ? workspaceDisplayName(workspace) : tag
                }}
                selected={selected}
                replaySeq={asOfSeq}
                replayFocus={replayFocus}
                interactionSuspended={modalOpen}
                menuResumeToken={menuResumeToken}
                initialPlayerState={initialPlayerStateRef.current}
                onPlayerStateChange={rememberOfficePlayerState}
                onSelectEmployee={(workspaceId, employee) => {
                  employeeOriginRef.current = { kind: 'map' }
                  setSelected({ workspaceId, resumeId: employee.resumeId })
                  setRosterFocusResumeId(null)
                  setLogView(null)
                  setCabinetWorkspaceId(null)
                }}
                onOpenEmployee={openEmployee}
                onOpenWorkspace={openWorkspace}
                onOpenFiles={(workspaceId) => {
                  setCabinetWorkspaceId(workspaceId)
                  setSelected(null)
                  setRosterWorkspaceId(null)
                  setLogView(null)
                }}
                onOpenRoster={(workspaceId) => {
                  setRosterWorkspaceId(workspaceId)
                  setRosterFocusResumeId(null)
                  setSelected(null)
                  setCabinetWorkspaceId(null)
                  setLogView(null)
                }}
                onOpenLog={(origin) => {
                  productActivity.acknowledge('agent')
                  const replayLogView = replayFocus && replayFocus.seq === asOfSeq
                    ? { channel: replayFocus.channel, focusSeq: replayFocus.seq }
                    : null
                  setLogView({
                    origin,
                    channel: replayLogView?.channel ?? 'overview',
                    focusSeq: replayLogView?.focusSeq
                      ?? (origin === 'operations' ? productActivity.agent?.seq ?? null : null),
                  })
                  setReplayPanelOpen(asOfSeq != null)
                  setCabinetWorkspaceId(null)
                }}
                productActivity={productActivity}
                onOpenService={(kind, seq) => {
                  productActivity.acknowledge(kind)
                  setLogView({ origin: `${kind}-service`, channel: kind, focusSeq: seq ?? null })
                  setReplayPanelOpen(asOfSeq != null)
                  setSelected(null)
                  setRosterWorkspaceId(null)
                  setCabinetWorkspaceId(null)
                }}
                onReturnLive={() => {
                  setAsOfSeq(null)
                  setReplayFocus(null)
                }}
              />
            </div>
            {error && (
              <OfficeConnectionBanner
                error={error}
                retrying={retryingFloor}
                onRetry={() => { void retryFloor() }}
              />
            )}
            {modalOpen && <div className="oa-office-window-scrim" aria-hidden />}
            {logView && (
              <section
                role="dialog"
                aria-modal="true"
                aria-label={t('office.timeline')}
                className="oa-office-window oa-office-window--log"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeLog()
                }}
              >
                <header className="oa-office-window__header">
                  <div>
                    <img src={OFFICE_HUD_ASSETS.occupancyLog} alt="" aria-hidden />
                    <span>{t('office.timeline')}</span>
                  </div>
                  <button type="button" autoFocus aria-label={t('common.close')} onClick={closeLog}>
                    <OfficeWindowControlGlyph kind="close" />
                  </button>
                </header>
                <div className="oa-office-window__body">
                  {building.lastSeq > 0 && (
                    <details
                      className="oa-office-replay-panel"
                      open={replayPanelOpen}
                      onToggle={(event) => setReplayPanelOpen(event.currentTarget.open)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Escape' || !replayPanelOpen) return
                        event.preventDefault()
                        event.stopPropagation()
                        setReplayPanelOpen(false)
                        event.currentTarget.querySelector('summary')?.focus()
                      }}
                    >
                      <summary>
                        <img src={OFFICE_HUD_ASSETS.replayLatch} alt="" aria-hidden style={officePixelImg} />
                        <span className="oa-office-replay-panel__title">{t('office.replay')}</span>
                        <span
                          className="oa-office-replay-panel__state"
                          data-live={asOfSeq == null}
                        >
                          {asOfSeq == null && <span className="oa-office-live-dot" aria-hidden />}
                          {asOfSeq == null
                            ? t('office.replayLive')
                            : t('office.replayAt', { seq: asOfSeq })}
                        </span>
                      </summary>
                      <OfficeReplayBar
                        firstSeq={building.firstSeq}
                        lastSeq={building.lastSeq}
                        asOfSeq={asOfSeq}
                        onAsOfSeq={(seq) => {
                          setReplayFocus(null)
                          setAsOfSeq(seq)
                        }}
                        onViewFloor={closeLogToFloor}
                      />
                    </details>
                  )}
                  <OfficeRuntimeSection
                    actors={activityActors}
                    initialChannel={logView.channel}
                    initialSelectedSeq={logView.focusSeq}
                    replaySeq={asOfSeq}
                    onReplay={(focus) => {
                      setReplayFocus(focus)
                      setAsOfSeq(focus.seq)
                      closeLogToFloor()
                    }}
                  />
                </div>
              </section>
            )}
            {!logView && !cabinetOffice && selectedSeat && (
              <OfficeInspectRail
                employee={selectedSeat.employee}
                coworkerAsset={selectedCoworkerAsset}
                roomName={selectedSeat.roomName}
                replayFocus={selectedReplayFocus}
                onOpen={() => openEmployee(selectedSeat.office.workspace.id, selectedSeat.employee)}
                onReviewActivity={reviewSelectedActivity}
                onOpenDrawer={(item) => openDrawer(selectedSeat.office.workspace.id, selectedSeat.employee, item)}
                onClose={closeEmployee}
                returnToRoster={employeeOriginRef.current.kind === 'roster'}
              />
            )}
            {!logView && !selectedSeat && !cabinetOffice && rosterOffice && (
              <OfficeRosterWindow
                group={rosterOffice.office}
                roomName={rosterOffice.roomName}
                focusResumeId={rosterFocusResumeId}
                replayFocusResumeId={replayFocus?.seq === asOfSeq
                  && replayFocus.workspaceId === rosterOffice.office.workspace.id
                  ? replayFocus.resumeId
                  : null}
                coworkerAssets={coworkerCastSnapshot.assets}
                onSelect={(employee) => {
                  employeeOriginRef.current = {
                    kind: 'roster',
                    workspaceId: rosterOffice.office.workspace.id,
                    resumeId: employee.resumeId,
                  }
                  setRosterWorkspaceId(null)
                  setSelected({
                    workspaceId: rosterOffice.office.workspace.id,
                    resumeId: employee.resumeId,
                  })
                }}
                onClose={closeRoster}
              />
            )}
            {!logView && !selectedSeat && !rosterOffice && cabinetOffice && (
              <OfficeCabinetWindow
                group={cabinetOffice.office}
                roomName={cabinetOffice.roomName}
                coworkerAssets={coworkerCastSnapshot.assets}
                onOpenWorkspaceFiles={() => openWorkspaceFiles(cabinetOffice.office.workspace.id)}
                onOpenRecord={(employee, item) => {
                  openDrawer(cabinetOffice.office.workspace.id, employee, item)
                }}
                onClose={closeCabinet}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
