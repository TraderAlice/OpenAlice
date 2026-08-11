import { createContext, useContext } from 'react'

import type { WorkspacesContextValue } from './workspaces-context'

/**
 * Stable action-only surface for content renderers. Consumers that only need
 * to open a Session should not subscribe to every polled Workspace snapshot.
 * Keeping this contract in its own module also lets feature tests replace the
 * broad Workspace state context without erasing the action boundary.
 */
export interface WorkspaceActionsContextValue {
  openHeadlessRun: WorkspacesContextValue['openHeadlessRun']
}

const unavailableActions: WorkspaceActionsContextValue = {
  async openHeadlessRun() {
    throw new Error('openHeadlessRun is unavailable outside WorkspacesProvider')
  },
}

export const WorkspaceActionsContext = createContext<WorkspaceActionsContextValue>(unavailableActions)

export function useWorkspaceActions(): WorkspaceActionsContextValue {
  return useContext(WorkspaceActionsContext)
}
