import type { SessionRecord, Workspace } from './api'

export function workspaceDisplayName(w: Workspace): string {
  return w.displayName?.trim() || w.tag
}

/** Workspace-owned coworker nametag → conversation title → sticky launcher name. */
export function sessionCoworkerLabel(
  session: Pick<SessionRecord, 'title' | 'name' | 'displayName'>,
): string {
  return session.displayName?.trim() || session.title?.trim() || session.name
}

export function workspaceDisplayTitle(w: Workspace): string {
  const display = workspaceDisplayName(w)
  return display === w.tag ? w.tag : `${display}\n${w.tag}`
}
