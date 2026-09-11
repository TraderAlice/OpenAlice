import type { OfficeHarness } from '../api/office'
import type { ViewSpec, WorkspaceSource } from '../tabs/types'

export interface OfficeWorkspaceDestination {
  readonly id: string
  readonly harness: OfficeHarness
}

export function officeWorkspaceSource(harness: OfficeHarness): WorkspaceSource | undefined {
  return harness === 'other' ? undefined : harness
}

export function officeWorkspaceDestination(
  workspace: OfficeWorkspaceDestination,
  sessionId?: string,
): Extract<ViewSpec, { kind: 'workspace' }> {
  const source = officeWorkspaceSource(workspace.harness)
  return {
    kind: 'workspace',
    params: {
      wsId: workspace.id,
      ...(sessionId ? { sessionId } : {}),
      ...(source ? { source } : {}),
    },
  }
}
