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
import { officePixelImg } from '../office/furniture'
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
  const [selected, setSelected] = useState<{ workspaceId: string; resumeId: string } | null>(null)
  const [logView, setLogView] = useState<{
    origin: OfficeLogOrigin
    channel: OfficeLogChannel
    focusSeq: number | null
  } | null>(null)
  const [rosterWorkspaceId, setRosterWorkspaceId] = useState<string | null>(null)
  const [rosterFocusResumeId, setRosterFocusResumeId] = useState<string | null>(null)
  const employeeOriginRef = useRef<
    | { kind: 'map' }
    | { kind: 'roster'; workspaceId: string; resumeId: string }
  >({ kind: 'map' })
  const [cabinetWorkspaceId, setCabinetWorkspaceId] = useState<string | null>(null)
  const { building, loading, error } = useOfficeFloor(asOfSeq)
  const productActivity = useOfficeProductActivity()
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
  const committedCastsRef = useRef<ReadonlyMap<
    string,
    ReadonlyMap<string, OfficeCoworkerSpriteAsset>
  >>(new Map())
  const coworkerCastSnapshot = useMemo(() => {
    const byWorkspace = new Map<string, ReadonlyMap<string, OfficeCoworkerSpriteAsset>>()
    const assets = new Map<string, OfficeCoworkerSpriteAsset>()
    for (const office of building?.offices ?? []) {
      const cast = officeCoworkerCast(
        office.employees,
        committedCastsRef.current.get(office.workspace.id),
      )
      byWorkspace.set(office.workspace.id, cast)
      for (const [resumeId, asset] of cast) assets.set(resumeId, asset)
    }
    return { assets, byWorkspace }
  }, [building])
  useLayoutEffect(() => {
    committedCastsRef.current = coworkerCastSnapshot.byWorkspace
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
  const closeLog = () => {
    const origin = logView?.origin ?? 'menu'
    setLogView(null)
    requestAnimationFrame(() => {
      if (origin === 'operations') {
        document.getElementById('office-operations-board')?.focus()
      } else if (origin === 'floor-terminal') {
        document.getElementById('office-floor-terminal')?.focus()
      } else if (origin === 'inbox-service' || origin === 'news-service') {
        document.getElementById(`office-${origin}`)?.focus()
      } else {
        document.querySelector<HTMLElement>('.oa-office-pause-trigger')?.focus()
      }
    })
  }
  const closeEmployee = () => {
    const resumeId = selected?.resumeId
    setSelected(null)
    if (employeeOriginRef.current.kind === 'roster') {
      setRosterWorkspaceId(employeeOriginRef.current.workspaceId)
      setRosterFocusResumeId(employeeOriginRef.current.resumeId)
      return
    }
    requestAnimationFrame(() => {
      const desks = document.querySelectorAll<HTMLElement>('[data-testid^="office-desk-"]')
      Array.from(desks).find((desk) =>
        desk.dataset.testid === `office-desk-${resumeId}`)?.focus()
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

  return (
    <div className="oa-office-page">
      <div className="sr-only">
        <h2>{t('nav.item.office')}</h2>
        <p>{t('office.description')}</p>
      </div>
      {error && (
        <p role="alert" className="px-4 pt-3 text-sm text-destructive md:px-6">{t('office.loadFailed')}: {error}</p>
      )}
      {loading && !building && (
        <p className="px-4 pt-3 text-sm text-muted-foreground md:px-6">{t('office.loadingFloor')}</p>
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
                  setCabinetWorkspaceId(null)
                }}
                productActivity={productActivity}
                onOpenService={(kind, seq) => {
                  productActivity.acknowledge(kind)
                  setLogView({ origin: `${kind}-service`, channel: kind, focusSeq: seq ?? null })
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
                  <details className="oa-office-replay-panel">
                    <summary>
                      <img src={OFFICE_HUD_ASSETS.replayLatch} alt="" aria-hidden style={officePixelImg} />
                      <span>{t('office.replay')}</span>
                    </summary>
                    <OfficeReplayBar
                      firstSeq={building.firstSeq}
                      lastSeq={building.lastSeq}
                      asOfSeq={asOfSeq}
                      onAsOfSeq={(seq) => {
                        setReplayFocus(null)
                        setAsOfSeq(seq)
                      }}
                      onViewFloor={closeLog}
                    />
                  </details>
                  <OfficeRuntimeSection
                    actors={activityActors}
                    initialChannel={logView.channel}
                    initialSelectedSeq={logView.focusSeq}
                    replaySeq={asOfSeq}
                    onReplay={(focus) => {
                      setReplayFocus(focus)
                      setAsOfSeq(focus.seq)
                      closeLog()
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
                onOpen={() => openEmployee(selectedSeat.office.workspace.id, selectedSeat.employee)}
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
