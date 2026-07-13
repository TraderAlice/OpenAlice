import type { Workspace } from './api'

export function workspaceDisplayName(w: Workspace): string {
  return w.displayName?.trim() || w.tag
}

export function workspaceDisplayTitle(w: Workspace): string {
  const display = workspaceDisplayName(w)
  return display === w.tag ? w.tag : `${display}\n${w.tag}`
}
