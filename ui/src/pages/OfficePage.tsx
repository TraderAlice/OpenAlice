import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { OfficeDrawerItem, OfficeFloorEmployee } from '../api/office'
import { workspaceDisplayName } from '../components/workspace/display'
import { useWorkspaces } from '../contexts/workspaces-context'
import { useOfficeFloor } from '../hooks/useOfficeFloor'
import { useInboxSelection } from '../live/inbox-selection'
import { useWorkspaceSidePanels } from '../live/workspace-side-panels'
import { OfficeBuilding } from '../office/OfficeBuilding'
import { OfficeInspectRail } from '../office/OfficeInspectRail'
import { OFFICE_HUD_ASSETS } from '../office/hud-assets'
import { OfficeReplayBar } from '../office/OfficeReplayBar'
import { OfficeRosterWindow } from '../office/OfficeRosterWindow'
import '../office/office.css'
import { useWorkspace } from '../tabs/store'
import type { WorkspaceSource } from '../tabs/types'
import { OfficeRuntimeSection } from './OfficeRuntimeSection'

function sourceForTag(tag: string): WorkspaceSource | undefined {
  if (tag === 'chat') return 'chat'
  if (tag === 'auto-quant') return 'auto-quant'
  return undefined
}

/**
 * One spatial floor. Each Workspace is a bay of desks. Activity Bar is the only navigator.
 */
export function OfficePage() {
  const { t } = useTranslation()
  const { workspaces } = useWorkspaces()
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const [asOfSeq, setAsOfSeq] = useState<number | null>(null)
  const [selected, setSelected] = useState<{ workspaceId: string; resumeId: string } | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const logOriginRef = useRef<'menu' | 'operations'>('menu')
  const [rosterWorkspaceId, setRosterWorkspaceId] = useState<string | null>(null)
  const { building, loading, error } = useOfficeFloor(asOfSeq)

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
  const closeLog = () => {
    setLogOpen(false)
    requestAnimationFrame(() => {
      if (logOriginRef.current === 'operations') {
        document.getElementById('office-operations-board')?.focus()
      } else {
        document.querySelector<HTMLElement>('.oa-office-pause-trigger')?.focus()
      }
    })
  }
  const closeEmployee = () => {
    const resumeId = selected?.resumeId
    setSelected(null)
    requestAnimationFrame(() => {
      const desks = document.querySelectorAll<HTMLElement>('[data-testid^="office-desk-"]')
      Array.from(desks).find((desk) =>
        desk.dataset.testid === `office-desk-${resumeId}`)?.focus()
    })
  }
  const closeRoster = () => {
    const workspaceId = rosterWorkspaceId
    setRosterWorkspaceId(null)
    requestAnimationFrame(() => {
      document.getElementById(`office-roster-${workspaceId}`)?.focus()
    })
  }

  const openEmployee = (workspaceId: string, employee: OfficeFloorEmployee) => {
    const workspace = workspaces.find((item) => item.id === workspaceId)
    const source = workspace ? sourceForTag(workspace.tag) : undefined
    openOrFocus({
      kind: 'workspace',
      params: {
        wsId: workspaceId,
        ...(employee.sessionRecordId ? { sessionId: employee.sessionRecordId } : {}),
        ...(source ? { source } : {}),
      },
    })
  }

  const openFiles = (workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId)
    const source = workspace ? sourceForTag(workspace.tag) : undefined
    useWorkspaceSidePanels.getState().setFiles(true)
    openOrFocus({
      kind: 'workspace',
      params: { wsId: workspaceId, ...(source ? { source } : {}) },
    })
  }

  const openDrawer = (workspaceId: string, employee: OfficeFloorEmployee, item: OfficeDrawerItem) => {
    const workspace = workspaces.find((row) => row.id === workspaceId)
    const source = workspace ? sourceForTag(workspace.tag) : undefined
    if (item.kind === 'report' && item.path) {
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
      openOrFocus({ kind: 'issue-detail', params: { wsId: workspaceId, id: item.issueId } })
      return
    }
    if (item.kind === 'inbox' && item.inboxEntryId) {
      useInboxSelection.getState().select(item.inboxEntryId)
      openOrFocus({ kind: 'inbox', params: {} })
      return
    }
    if (item.kind === 'trade-decision') {
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
      {building && building.offices.length === 0 && (
        <p className="px-4 pt-3 text-sm text-muted-foreground md:px-6">{t('office.noWorkspace')}</p>
      )}
      {building && building.offices.length > 0 && (
        <div className="oa-office-layout">
          <div className="oa-office-main">
            <div
              className="oa-office-scene"
              aria-hidden={logOpen || Boolean(selectedSeat) || Boolean(rosterOffice) || undefined}
              inert={logOpen || Boolean(selectedSeat) || Boolean(rosterOffice) || undefined}
            >
              <OfficeBuilding
                building={building}
                groupTitle={(workspaceId, tag) => {
                  const workspace = workspaces.find((item) => item.id === workspaceId)
                  return workspace ? workspaceDisplayName(workspace) : tag
                }}
                selected={selected}
                onSelectEmployee={(workspaceId, employee) => {
                  setSelected({ workspaceId, resumeId: employee.resumeId })
                  setLogOpen(false)
                }}
                onOpenEmployee={openEmployee}
                onOpenFiles={openFiles}
                onOpenRoster={(workspaceId) => {
                  setRosterWorkspaceId(workspaceId)
                  setSelected(null)
                  setLogOpen(false)
                }}
                onOpenLog={(origin) => {
                  logOriginRef.current = origin
                  setLogOpen(true)
                }}
              />
            </div>
            {logOpen && (
              <>
                <div className="oa-office-window-scrim" aria-hidden />
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
                      <span aria-hidden>×</span>
                    </button>
                  </header>
                  <div className="oa-office-window__body">
                    <details className="oa-office-replay-panel">
                      <summary>{t('office.replay')}</summary>
                      <OfficeReplayBar
                        firstSeq={building.firstSeq}
                        lastSeq={building.lastSeq}
                        asOfSeq={asOfSeq}
                        onAsOfSeq={setAsOfSeq}
                      />
                    </details>
                    <OfficeRuntimeSection />
                  </div>
                </section>
              </>
            )}
            {!logOpen && selectedSeat && (
              <OfficeInspectRail
                employee={selectedSeat.employee}
                roomName={selectedSeat.roomName}
                onOpen={() => openEmployee(selectedSeat.office.workspace.id, selectedSeat.employee)}
                onOpenDrawer={(item) => openDrawer(selectedSeat.office.workspace.id, selectedSeat.employee, item)}
                onClose={closeEmployee}
              />
            )}
            {!logOpen && !selectedSeat && rosterOffice && (
              <OfficeRosterWindow
                group={rosterOffice.office}
                roomName={rosterOffice.roomName}
                onSelect={(employee) => {
                  setRosterWorkspaceId(null)
                  setSelected({
                    workspaceId: rosterOffice.office.workspace.id,
                    resumeId: employee.resumeId,
                  })
                }}
                onClose={closeRoster}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
