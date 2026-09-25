import { create } from 'zustand'
import type { SessionRecord } from './api'
import { getFocusedTab, type WorkspaceSource } from '../../tabs/types'
import { useWorkspace } from '../../tabs/store'

interface BusyTarget { record: SessionRecord; workspaceId: string; source?: WorkspaceSource }
/** Transient inspection only: never persisted as a workspace tab or URL. */
export const useSessionBusyDialog = create<{
  target: BusyTarget | null
  show(target: BusyTarget): void
  close(): void
}>(set => ({ target: null, show: target => set({ target }), close: () => set({ target: null }) }))

/** A stale/deep-linked route must not become an empty occupancy page. */
export function inspectOccupiedSession(target: BusyTarget) {
  useSessionBusyDialog.getState().show(target)
  const tabs = useWorkspace.getState()
  tabs.closeMatching(candidate => candidate.kind === 'workspace'
    && candidate.params.wsId === target.workspaceId && candidate.params.sessionId === target.record.id)
  if (!getFocusedTab(useWorkspace.getState())) {
    tabs.openOrFocus({ kind: target.source === 'auto-quant' ? 'auto-quant-landing'
      : target.source === 'prediction' ? 'auto-prediction-landing' : 'chat-landing',
      params: { targetWsId: target.workspaceId } })
  }
}
