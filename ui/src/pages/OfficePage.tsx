import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import type { OfficeDrawerItem, OfficeFloorEmployee } from '../api/office'
import { workspaceDisplayName } from '../components/workspace/display'
import { useWorkspaces } from '../contexts/workspaces-context'
import { useOfficeFloor } from '../hooks/useOfficeFloor'
import { useInboxSelection } from '../live/inbox-selection'
import { useWorkspaceSidePanels } from '../live/workspace-side-panels'
import { OfficeBuilding, type OfficeLogOrigin } from '../office/OfficeBuilding'
import { OfficeCadenceDutyDossier } from '../office/OfficeCadenceDutyDossier'
import { OfficeCabinetWindow } from '../office/OfficeCabinetWindow'
import {
  clearOfficeCadenceExcursion,
  readOfficeCadenceExcursion,
  rememberOfficeCadenceExcursion,
} from '../office/cadence-excursion'
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
import { useOfficeDuties } from '../office/useOfficeDuties'
import { useOfficeProductActivity, type OfficeActivityKind } from '../office/useOfficeProductActivity'
import type {
  OfficeCadenceDutyCandidate,
  OfficeResolvedDuty,
} from '../office/duty-registry'
import { useIssues } from '../hooks/useIssues'
import '../office/office.css'
import { useWorkspace } from '../tabs/store'
import type { WorkspaceSource } from '../tabs/types'
import {
  OfficeRuntimeSection,
  type OfficeDutyReview,
  type OfficeLogChannel,
} from './OfficeRuntimeSection'

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
  const cadenceExcursionRef = useRef(readOfficeCadenceExcursion())
  const [asOfSeq, setAsOfSeq] = useState<number | null>(null)
  const [replayFocus, setReplayFocus] = useState<OfficeReplayFocus | null>(null)
  const [replayPanelOpen, setReplayPanelOpen] = useState(false)
  const [retryingFloor, setRetryingFloor] = useState(false)
  const [selected, setSelected] = useState<{
    workspaceId: string
    resumeId: string
    dutyReview?: OfficeDutyReview
    dutyReviewIntent?: 'result' | 'run'
  } | null>(null)
  const [logView, setLogView] = useState<{
    origin: OfficeLogOrigin
    channel: OfficeLogChannel
    focusSeq: number | null
    dutyReview?: OfficeDutyReview
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
  const issues = useIssues()
  const officeDuties = useOfficeDuties(productActivity, issues)
  const [cadenceDuty, setCadenceDuty] = useState<OfficeCadenceDutyCandidate | null>(null)
  const [cadenceInitialStep, setCadenceInitialStep] = useState<'exception' | 'evidence'>('exception')
  const [dutyAcknowledgement, setDutyAcknowledgement] = useState<{
    token: number
    targetId: 'operations'
    label: string
    reviewed: string
    dutyKey: string
    announcement: string | null
  } | null>(null)
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
    || Boolean(cadenceDuty)
  const closeLogWithDestination = (destination: 'origin' | 'floor') => {
    const origin = logView?.origin ?? 'menu'
    setLogView(null)
    if (destination === 'floor') {
      setSelected(null)
      employeeOriginRef.current = { kind: 'map' }
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[data-testid="office-floor"]')?.focus()
      })
      return
    }
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

  const closeCadenceDuty = () => {
    clearOfficeCadenceExcursion()
    cadenceExcursionRef.current = null
    setCadenceDuty(null)
    setCadenceInitialStep('exception')
    requestAnimationFrame(() => {
      document.getElementById('office-operations-board')?.focus()
    })
  }

  const openRegisteredDuty = (duty: OfficeResolvedDuty) => {
    if (duty.kind === 'cadence') {
      clearOfficeCadenceExcursion()
      cadenceExcursionRef.current = null
      setCadenceInitialStep('exception')
      setCadenceDuty(duty)
      setSelected(null)
      setRosterWorkspaceId(null)
      setCabinetWorkspaceId(null)
      setLogView(null)
      return
    }
    const dutyReview: OfficeDutyReview = {
      kind: duty.receipt.family,
      throughSeq: duty.receipt.throughSeq,
      count: duty.count,
    }
    if (duty.kind === 'agent' && duty.targetId.startsWith('employee:')) {
      const subject = duty.destination.subject
      const office = subject
        ? building?.offices.find((item) => item.workspace.id === subject.workspaceId)
        : null
      const employee = subject
        ? office?.employees.find((item) => item.resumeId === subject.resumeId)
        : null
      if (subject && employee) {
        const dutyReviewIntent = duty.landmark.eventType === 'runtime.stopped'
          && duty.landmark.status === 'done'
          ? 'result' as const
          : 'run' as const
        employeeOriginRef.current = { kind: 'map' }
        setSelected({
          workspaceId: subject.workspaceId,
          resumeId: subject.resumeId,
          dutyReview,
          dutyReviewIntent,
        })
        setRosterFocusResumeId(null)
        setLogView(null)
        setCabinetWorkspaceId(null)
        return
      }
    }
    setLogView({
      origin: duty.kind === 'agent' ? 'operations' : `${duty.kind}-service`,
      channel: duty.kind,
      focusSeq: duty.receipt.throughSeq,
      dutyReview,
    })
    setReplayPanelOpen(false)
    setSelected(null)
    setRosterWorkspaceId(null)
    setCabinetWorkspaceId(null)
  }

  const latestCadenceDuty = cadenceDuty?.receipt.kind === 'evidence'
    ? officeDuties.evidenceBySubject.get(cadenceDuty.receipt.subjectKey)
    : null
  const latestMatchingCadenceDuty = latestCadenceDuty?.kind === 'cadence'
    ? latestCadenceDuty
    : null
  const nextDutyCandidate = officeDuties.candidates[0]
  const nextDutyKey = nextDutyCandidate
    ? nextDutyCandidate.receipt.kind === 'evidence'
      ? `${nextDutyCandidate.id}:${nextDutyCandidate.receipt.fingerprint}`
      : `${nextDutyCandidate.id}:${nextDutyCandidate.receipt.throughSeq}`
    : null
  const nextDutyAnnouncementName = (() => {
    const next = nextDutyCandidate
    if (!next) return null
    if (next.kind === 'cadence') return next.cadence.title
    if (next.kind === 'inbox') return t('office.inboxStation')
    if (next.kind === 'news') return t('office.newsStation')
    return t('office.logChannelAgent')
  })()
  useEffect(() => {
    if (!dutyAcknowledgement
      || dutyAcknowledgement.announcement
      || dutyAcknowledgement.dutyKey === nextDutyKey) return
    const announcement = nextDutyAnnouncementName
      ? t('office.cadenceReviewedNext', {
          reviewed: dutyAcknowledgement.reviewed,
          name: nextDutyAnnouncementName,
        })
      : officeDuties.status === 'ready'
        ? t('office.cadenceReviewedClear', { reviewed: dutyAcknowledgement.reviewed })
        : t('office.cadenceReviewedUnknown', { reviewed: dutyAcknowledgement.reviewed })
    setDutyAcknowledgement((current) => current?.token === dutyAcknowledgement.token
      ? { ...current, announcement }
      : current)
  }, [
    dutyAcknowledgement,
    nextDutyAnnouncementName,
    nextDutyKey,
    officeDuties.status,
    t,
  ])
  useEffect(() => {
    const excursion = cadenceExcursionRef.current
    if (!excursion || cadenceDuty) return
    if (officeDuties.cadenceStatus === 'loading') return
    cadenceExcursionRef.current = null
    clearOfficeCadenceExcursion()
    setCadenceInitialStep('evidence')
    setCadenceDuty(excursion.duty)
  }, [cadenceDuty, officeDuties.cadenceStatus])

  const selectedDutyReview = asOfSeq == null ? selected?.dutyReview : undefined
  const reviewSelectedActivity = selectedSeat && selectedReplayFocus
    ? () => {
      setLogView({
        origin: 'employee',
        channel: selectedReplayFocus.channel,
        focusSeq: selectedReplayFocus.seq,
      })
      setReplayPanelOpen(true)
    }
    : selectedSeat && selectedDutyReview
      ? () => {
        setLogView({
          origin: 'employee',
          channel: 'agent',
          focusSeq: selectedDutyReview.throughSeq,
          dutyReview: selectedDutyReview,
        })
        setReplayPanelOpen(false)
      }
      : selectedSeat && selectedSeat.employee.lastSeq > 0 && (
      selectedSeat.employee.mood === 'failed'
      || selectedSeat.employee.mood === 'waiting'
      || selectedSeat.employee.mood === 'review'
      || selectedSeat.employee.latestResult != null
    )
      ? () => {
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
      {dutyAcknowledgement?.announcement && (
        <p className="sr-only" role="status" aria-live="polite">
          {dutyAcknowledgement.announcement}
        </p>
      )}
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
                  const agentLandmark = productActivity.agent
                  const dutyReview = asOfSeq == null
                    && productActivity.attention.agent
                    && agentLandmark?.subject?.workspaceId === workspaceId
                    && agentLandmark.subject.resumeId === employee.resumeId
                    ? {
                        kind: 'agent' as const,
                        throughSeq: agentLandmark.seq,
                        count: productActivity.pending.agent,
                      }
                    : undefined
                  const dutyReviewIntent = dutyReview && agentLandmark
                    ? agentLandmark.eventType === 'runtime.stopped' && agentLandmark.status === 'done'
                      ? 'result' as const
                      : 'run' as const
                    : undefined
                  setSelected({
                    workspaceId,
                    resumeId: employee.resumeId,
                    ...(dutyReview ? { dutyReview } : {}),
                    ...(dutyReviewIntent ? { dutyReviewIntent } : {}),
                  })
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
                  const registeredDuty = officeDuties.candidates[0]
                  if (asOfSeq == null && origin === 'operations' && registeredDuty?.kind === 'cadence') {
                    openRegisteredDuty({ ...registeredDuty, targetId: 'operations' })
                    return
                  }
                  const replayLogView = replayFocus && replayFocus.seq === asOfSeq
                    ? { channel: replayFocus.channel, focusSeq: replayFocus.seq }
                    : null
                  const dutyReview = asOfSeq == null
                    && origin === 'operations'
                    && productActivity.attention.agent
                    && productActivity.agent
                    ? {
                        kind: 'agent' as const,
                        throughSeq: productActivity.agent.seq,
                        count: productActivity.pending.agent,
                      }
                    : undefined
                  setLogView({
                    origin,
                    channel: replayLogView?.channel ?? (dutyReview ? 'agent' : 'overview'),
                    focusSeq: replayLogView?.focusSeq
                      ?? (origin === 'operations' ? productActivity.agent?.seq ?? null : null),
                    ...(dutyReview ? { dutyReview } : {}),
                  })
                  setReplayPanelOpen(asOfSeq != null)
                  setCabinetWorkspaceId(null)
                }}
                productActivity={productActivity}
                dutyCandidates={officeDuties.candidates}
                dutyStatus={officeDuties.status}
                dutyAcknowledgement={dutyAcknowledgement}
                onOpenDuty={openRegisteredDuty}
                onOpenService={(kind, seq) => {
                  const throughSeq = seq ?? productActivity[kind]?.seq
                  const dutyReview = asOfSeq == null
                    && productActivity.attention[kind]
                    && throughSeq != null
                    ? {
                        kind: kind as OfficeActivityKind,
                        throughSeq,
                        count: productActivity.pending[kind],
                      }
                    : undefined
                  setLogView({
                    origin: `${kind}-service`,
                    channel: kind,
                    focusSeq: seq ?? null,
                    ...(dutyReview ? { dutyReview } : {}),
                  })
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
                    dutyReview={logView.dutyReview}
                    onConfirmDuty={logView.dutyReview
                      ? () => {
                          productActivity.acknowledgeThrough(
                            logView.dutyReview!.kind,
                            logView.dutyReview!.throughSeq,
                          )
                          closeLogToFloor()
                        }
                      : undefined}
                    onReplay={(focus) => {
                      setReplayFocus(focus)
                      setAsOfSeq(focus.seq)
                      closeLogToFloor()
                    }}
                  />
                </div>
              </section>
            )}
            {cadenceDuty && (
              <OfficeCadenceDutyDossier
                key={cadenceDuty.receipt.fingerprint}
                duty={cadenceDuty}
                latestDuty={latestMatchingCadenceDuty}
                sourceStatus={officeDuties.cadenceStatus}
                initialStep={cadenceInitialStep}
                onOpenIssue={() => {
                  const excursion = { duty: cadenceDuty }
                  rememberOfficeCadenceExcursion(excursion)
                  cadenceExcursionRef.current = excursion
                  markExcursion()
                  openOrFocus({
                    kind: 'issue-detail',
                    params: {
                      wsId: cadenceDuty.destination.workspaceId,
                      id: cadenceDuty.destination.issueId,
                    },
                  })
                }}
                onConfirm={() => {
                  clearOfficeCadenceExcursion()
                  cadenceExcursionRef.current = null
                  officeDuties.acknowledge(cadenceDuty)
                  setCadenceDuty(null)
                  setCadenceInitialStep('exception')
                  setDutyAcknowledgement((current) => ({
                    token: (current?.token ?? 0) + 1,
                    targetId: 'operations',
                    label: t('office.cadenceReviewedShort'),
                    reviewed: cadenceDuty.cadence.title,
                    dutyKey: `${cadenceDuty.id}:${cadenceDuty.receipt.fingerprint}`,
                    announcement: null,
                  }))
                  requestAnimationFrame(() => {
                    document.querySelector<HTMLElement>('[data-testid="office-floor"]')?.focus()
                  })
                }}
                onReviewLatest={(next) => {
                  setCadenceInitialStep('evidence')
                  setCadenceDuty(next)
                }}
                onClose={closeCadenceDuty}
              />
            )}
            {!logView && !cabinetOffice && selectedSeat && (
              <OfficeInspectRail
                employee={selectedSeat.employee}
                coworkerAsset={selectedCoworkerAsset}
                roomName={selectedSeat.roomName}
                replayFocus={selectedReplayFocus}
                dutyPending={Boolean(selectedDutyReview)}
                dutyReviewIntent={selected?.dutyReviewIntent}
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
