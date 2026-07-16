export const WORKSPACE_DEFAULTS_CHANGED_EVENT = 'openalice:workspace-defaults-changed'

/** Notify long-lived launch surfaces after Settings changes creation defaults. */
export function notifyWorkspaceDefaultsChanged(target: EventTarget = window): void {
  target.dispatchEvent(new Event(WORKSPACE_DEFAULTS_CHANGED_EVENT))
}
