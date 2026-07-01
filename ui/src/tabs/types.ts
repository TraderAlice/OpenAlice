/**
 * Tabs / Workspace data model.
 *
 * Conceptually mirrors VS Code's editor area:
 *   ViewSpec       = "what is being shown" (kind + params, like a key)
 *   Tab            = a ViewSpec instance with a stable id
 *   TabGroup       = an ordered set of tabs with one active
 *   WorkspaceTree  = recursive — leaf is a TabGroup, branch is a split
 *   WorkspaceState = the whole workspace (tabs + tree + focus)
 *
 * Phase 1 collapses the tree to always be `{ kind: 'leaf', group }` —
 * the recursive shape exists so phase 3 can introduce splits without
 * a data-model change.
 */

export type WorkspaceSource = 'chat'

export type ViewSpec =
  | { kind: 'workspace-list'; params: Record<string, never> }
  | { kind: 'workspace';      params: { wsId: string; sessionId?: string; source?: WorkspaceSource } }
  | { kind: 'template-catalog'; params: Record<string, never> }
  | { kind: 'template-detail';  params: { name: string } }
  | { kind: 'portfolio';      params: Record<string, never> }
  | { kind: 'issue';          params: Record<string, never> }
  | { kind: 'issue-detail';   params: { wsId: string; id: string } }
  | { kind: 'tracked-issue-detail'; params: { wsId: string; id: string } }
  | { kind: 'automation';     params: { section: 'runs' | 'api' | 'flow' | 'webhook' } }
  | { kind: 'news';           params: Record<string, never> }
  | { kind: 'market-list';    params: Record<string, never> }
  | { kind: 'market-rotation'; params: Record<string, never> }
  | { kind: 'market-board';   params: { board: 'movers' | 'calendar' | 'macro' | 'term-structure' | 'global-macro' | 'shipping' | 'fed' } }
  | { kind: 'market-detail';  params: { assetClass: 'equity' | 'crypto' | 'currency' | 'commodity'; symbol: string; source?: string } }
  | { kind: 'settings';       params: { category: 'general' | 'ai-provider' | 'trading' | 'mcp' | 'market-data' | 'news-collector' } }
  | { kind: 'uta-detail';     params: { id: string } }
  | { kind: 'dev';            params: { tab: 'tools' | 'snapshots' | 'logs' | 'simulator' } }
  | { kind: 'inbox';               params: Record<string, never> }
  | { kind: 'tracked';             params: Record<string, never> }
  | { kind: 'chat-landing';        params: { targetWsId?: string } }
  | { kind: 'file-viewer';         params: { wsId: string; path: string } }

export type ViewKind = ViewSpec['kind']

/**
 * Activity Bar sections — the left-rail icon set. Each section may have its
 * own secondary sidebar; clicking the activity icon toggles which sidebar
 * is shown. Decoupled from focused-tab kind: the sidebar you see is whichever
 * section the user picked, regardless of what tab is focused.
 *
 * Note: trading-as-git has no associated tab kind — it's sidebar-only
 * (the approval queue lives in the sidebar; future commit-detail tabs will
 * be opened from there).
 */
export type ActivitySection =
  | 'chat'
  | 'inbox'
  | 'tracked'
  | 'workspaces'
  | 'trading-as-git'
  | 'settings'
  | 'dev'
  | 'market'
  | 'portfolio'
  | 'issue'
  | 'automation'
  | 'news'

export interface Tab {
  id: string
  spec: ViewSpec
}

export interface TabGroup {
  id: string
  tabIds: string[]
  activeTabId: string | null
}

export type WorkspaceTree =
  | { kind: 'leaf'; group: TabGroup }
  | { kind: 'split'; orientation: 'horizontal' | 'vertical'; sizes: number[]; children: WorkspaceTree[] }

export interface WorkspaceState {
  tabs: Record<string, Tab>
  tree: WorkspaceTree
  focusedGroupId: string
  /**
   * Which sidebar is currently shown. Independent of focused tab — the
   * user picks via ActivityBar. `null` means no sidebar (all collapsed).
   */
  selectedSidebar: ActivitySection | null
}

/**
 * Two ViewSpecs are equal when kind matches and all params are shallow-equal.
 * Used by openOrFocus to find an existing tab for a given spec.
 *
 * All params today are flat (string / boolean) — shallow equal is sufficient.
 * If a future kind needs deeper equality (e.g. a filter object), override per
 * kind in the view registry.
 */
export function specEquals(a: ViewSpec, b: ViewSpec): boolean {
  if (a.kind !== b.kind) return false
  const aParams = a.params as Record<string, unknown>
  const bParams = b.params as Record<string, unknown>
  const aKeys = Object.keys(aParams)
  const bKeys = Object.keys(bParams)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (aParams[k] !== bParams[k]) return false
  }
  return true
}

/** Phase 1 helper: workspace tree is always a leaf, so this just unwraps it. */
export function getFocusedGroup(state: WorkspaceState): TabGroup | null {
  return state.tree.kind === 'leaf' ? state.tree.group : null
}

/** Phase 1 helper: derive the focused tab from state, or null if there is none. */
export function getFocusedTab(state: WorkspaceState): Tab | null {
  const group = getFocusedGroup(state)
  if (!group?.activeTabId) return null
  return state.tabs[group.activeTabId] ?? null
}
