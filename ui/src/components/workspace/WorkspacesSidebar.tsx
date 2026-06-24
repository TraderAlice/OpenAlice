/**
 * Adapter that pulls Workspaces state from WorkspacesContext and renders
 * the launcher's Sidebar component. Selection is driven entirely by which
 * tab is currently focused — clicking a workspace/session in the sidebar
 * opens (or focuses) the corresponding tab.
 */

import { useWorkspaces } from '../../contexts/WorkspacesContext'
import { useWorkspace } from '../../tabs/store'
import { getFocusedTab } from '../../tabs/types'
import { Sidebar, type SpawnOpts } from './Sidebar'

export function WorkspacesSidebar() {
  const ctx = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const focused = useWorkspace((s) => getFocusedTab(s)?.spec)

  const isWsFocus = focused?.kind === 'workspace'
  const selection = isWsFocus
    ? {
        wsId: focused.params.wsId,
        sessionId: focused.params.sessionId ?? null,
      }
    : null
  const overviewActive = focused?.kind === 'workspace-list'
  const templatesActive =
    focused?.kind === 'template-catalog' || focused?.kind === 'template-detail'

  return (
    <div className="flex flex-col h-full min-h-0">
      <Sidebar
        workspaces={ctx.workspaces}
        templates={ctx.templates}
        agents={ctx.agents}
        listError={ctx.listError}
        selection={selection}
        onSelectWorkspace={(wsId) => {
          if (wsId.length === 0) return
          openOrFocus({ kind: 'workspace', params: { wsId } })
        }}
        onSelectSession={(wsId, sessionId) => {
          openOrFocus({ kind: 'workspace', params: { wsId, sessionId } })
        }}
        onSpawn={(wsId, opts?: SpawnOpts) => void ctx.spawn(wsId, opts)}
        onPauseSession={(wsId, id) => void ctx.pauseSession(wsId, id)}
        onResumeSession={(wsId, id) => void ctx.resumeSession(wsId, id)}
        onDeleteSession={(wsId, id) => ctx.requestDeleteSession(wsId, id)}
        onChanged={() => void ctx.refresh()}
        onConfigureWorkspace={(wsId) => ctx.openAgentConfig(wsId)}
        onOpenOverview={() => openOrFocus({ kind: 'workspace-list', params: {} })}
        overviewActive={overviewActive}
        onOpenTemplates={() => openOrFocus({ kind: 'template-catalog', params: {} })}
        templatesActive={templatesActive}
      />
    </div>
  )
}
