/**
 * Single workspace/session detail page.
 *
 * Renders the launcher's WorkspaceView (terminal + files panel) bound
 * to whatever workspace+session this tab's spec points at:
 *
 *   { wsId }                — workspace selected, no session pinned: shows
 *                             a CTA prompting the user to spawn one.
 *   { wsId, sessionId }     — session pinned: shows the terminal slot for
 *                             that session, with the workspace's files
 *                             panel alongside.
 *
 * Each session is its own tab; multiple session tabs for the same workspace
 * each carry their own WorkspaceView (with their own files polling).
 * Closing a tab via the X button does NOT terminate the session — the PTY
 * keeps running on the server. Use the sidebar's × to actually delete.
 */

import { useEffect } from 'react'
import '@xterm/xterm/css/xterm.css'

import { useWorkspaces } from '../contexts/WorkspacesContext'
import { useWorkspace } from '../tabs/store'
import { WorkspaceView } from '../components/workspace/WorkspaceView'
import { WorkspaceFilesToggle } from '../components/workspace/WorkspaceFilesToggle'
import type { KeyMap } from '../components/workspace/Terminal'
import type { ViewSpec } from '../tabs/types'

const APP_KEY_MAP: KeyMap = {
  'shift+enter': '\x1b\r',
}

interface Props {
  spec: Extract<ViewSpec, { kind: 'workspace' }>
  visible: boolean
}

export function WorkspacePage({ spec, visible }: Props) {
  const ctx = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const wsId = spec.params.wsId
  const sessionId = spec.params.sessionId ?? null

  const workspace = ctx.workspaces.find((w) => w.id === wsId)
  const sessions = workspace?.sessions ?? []
  const activeRecord = sessionId
    ? sessions.find((s) => s.id === sessionId) ?? null
    : null

  // Cmd+T / Ctrl+T: spawn fresh session in this workspace; only when this
  // tab is visible, to avoid double-spawns when multiple workspace tabs are
  // open.
  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 't' && e.key !== 'T') return
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.shiftKey || e.altKey) return
      e.preventDefault()
      e.stopPropagation()
      void ctx.spawn(wsId, {})
    }
    document.addEventListener('keydown', handler, { capture: true })
    return () => document.removeEventListener('keydown', handler, { capture: true })
  }, [visible, ctx, wsId])

  if (!workspace) {
    return (
      <div className="workspaces-root flex flex-col items-center justify-center h-full text-text-muted text-sm">
        Workspace not found. It may have been deleted.
      </div>
    )
  }

  // Sessions list: pass the full workspace.sessions. WorkspaceView's
  // `runningSlots` is gated on sessionId so the multi-terminal mount
  // only happens when a session is pinned (one session per tab still
  // holds for the active path); when sessionId is null, the empty
  // state needs the full list to render resume/continue cards.
  return (
    <div className="workspaces-root flex-1 min-h-0 flex flex-col">
      {/* OpenAlice-side header bar above the launcher's WorkspaceView. The
       *  launcher component itself is byte-faithful; we add the AI-provider
       *  affordance here. */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-bg-secondary/30 shrink-0">
        <span className="text-[12px] text-text-muted font-medium">{workspace.tag}</span>
        <div className="flex items-center gap-1">
          <WorkspaceFilesToggle />
          <button
            type="button"
            onClick={() => ctx.openAgentConfig(wsId)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors"
            title="Configure this workspace's AI provider (claude / codex)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            AI Provider
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col p-3">
        <WorkspaceView
          wsId={wsId}
          sessionId={sessionId}
          activeRecord={activeRecord}
          sessions={workspace.sessions}
          label={workspace.tag}
          keyMap={APP_KEY_MAP}
          onSpawnFresh={() => void ctx.spawn(wsId, {})}
          onResume={(id) => void ctx.resumeSession(wsId, id)}
          onSelectSession={(id) => {
            // Running session — already alive on the server, just
            // navigate. Mirrors the sidebar's onSelectSession path.
            openOrFocus({ kind: 'workspace', params: { wsId, sessionId: id } })
          }}
          onSessionLost={() => {
            // 4404 from the WS upgrade — the session is gone server-side.
            // Refresh the list; the reconcile effect will close this tab.
            void ctx.refresh()
          }}
        />
      </div>
    </div>
  )
}
