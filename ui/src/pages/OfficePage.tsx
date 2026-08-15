import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { OfficeDrawerItem, OfficeFloorEmployee } from '../api/office'
import { workspaceDisplayName } from '../components/workspace/display'
import { PageHeader } from '../components/PageHeader'
import { useWorkspaces } from '../contexts/workspaces-context'
import { useOfficeFloor } from '../hooks/useOfficeFloor'
import { useInboxSelection } from '../live/inbox-selection'
import { useWorkspaceSidePanels } from '../live/workspace-side-panels'
import { OfficeBuilding } from '../office/OfficeBuilding'
import { OfficeInspectRail } from '../office/OfficeInspectRail'
import { OfficeReplayBar } from '../office/OfficeReplayBar'
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
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t('nav.item.office')}
        description={t('office.description')}
      />
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
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          <div className="flex min-h-[28rem] min-w-0 flex-1 flex-col">
            <OfficeBuilding
              building={building}
              roomTitle={(workspaceId, tag) => {
                const workspace = workspaces.find((item) => item.id === workspaceId)
                return workspace ? workspaceDisplayName(workspace) : tag
              }}
              selected={selected}
              onSelectEmployee={(workspaceId, employee) => setSelected({ workspaceId, resumeId: employee.resumeId })}
              onOpenEmployee={openEmployee}
              onOpenFiles={openFiles}
            />
            <div className="shrink-0 border-t border-border px-4 py-2 md:px-6">
              <OfficeReplayBar
                firstSeq={building.firstSeq}
                lastSeq={building.lastSeq}
                asOfSeq={asOfSeq}
                onAsOfSeq={setAsOfSeq}
              />
            </div>
          </div>
          <OfficeInspectRail
            employee={selectedSeat?.employee ?? null}
            roomName={selectedSeat?.roomName}
            onOpen={() => selectedSeat && openEmployee(selectedSeat.office.workspace.id, selectedSeat.employee)}
            onOpenDrawer={(item) => selectedSeat && openDrawer(selectedSeat.office.workspace.id, selectedSeat.employee, item)}
          >
            <OfficeRuntimeSection />
          </OfficeInspectRail>
        </div>
      )}
    </div>
  )
}
