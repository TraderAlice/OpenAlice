import type { Tab, ViewKind } from './types'

export type PersistentTabLifecycle = 'active-only' | 'keep-mounted'

/**
 * Choose which keep-mounted tabs stay on screen while another view is focused.
 *
 * Workspace transcripts can be huge; mounting every historical workspace tab
 * would pin multiple multi‑MB DOMs. Keep at most one warm workspace frame: the
 * active workspace tab, or the last focused workspace while the user is away
 * on Trading / Market / etc.
 */
export function selectPersistentTabs(input: {
  readonly isDesktop: boolean
  readonly tabIds: readonly string[]
  readonly tabs: Readonly<Record<string, Tab | undefined>>
  readonly activeTabId: string | null
  readonly lastWorkspaceTabId: string | null
  readonly lifecycleOf: (kind: ViewKind) => PersistentTabLifecycle | undefined
}): Tab[] {
  if (!input.isDesktop) return []

  const keepMounted = input.tabIds
    .map((id) => input.tabs[id])
    .filter((tab): tab is Tab =>
      tab != null && input.lifecycleOf(tab.spec.kind) === 'keep-mounted')

  const active = input.activeTabId ? input.tabs[input.activeTabId] ?? null : null
  const activeIsWorkspace = active?.spec.kind === 'workspace'
  const warmWorkspaceId = activeIsWorkspace
    ? null
    : input.lastWorkspaceTabId && input.tabIds.includes(input.lastWorkspaceTabId)
      ? input.lastWorkspaceTabId
      : null

  return keepMounted.filter((tab) => {
    if (tab.spec.kind !== 'workspace') return true
    if (tab.id === input.activeTabId) return true
    return warmWorkspaceId !== null && tab.id === warmWorkspaceId
  })
}
