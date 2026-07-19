export const WORKSPACE_DEFAULTS_CHANGED_EVENT = 'openalice:workspace-defaults-changed'
export const WORKSPACE_AGENT_CONFIG_CHANGED_EVENT = 'openalice:workspace-agent-config-changed'

export interface WorkspaceAgentConfigChangedDetail {
  readonly wsId: string
  readonly agent: string
}

/** Notify long-lived launch surfaces after Settings changes creation defaults. */
export function notifyWorkspaceDefaultsChanged(target: EventTarget = window): void {
  target.dispatchEvent(new Event(WORKSPACE_DEFAULTS_CHANGED_EVENT))
}

/** Notify long-lived launch surfaces that the Workspace-native runtime config
 * changed. Consumers must discard any transient picker choice before reading
 * the on-disk binding again; the Workspace file is the post-save truth. */
export function notifyWorkspaceAgentConfigChanged(
  detail: WorkspaceAgentConfigChangedDetail,
  target: EventTarget = window,
): void {
  target.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_CONFIG_CHANGED_EVENT, { detail }))
}
