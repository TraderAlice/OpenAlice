import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  type WorkspaceState,
  type Tab,
  type ViewSpec,
  type TabGroup,
  type ActivitySection,
  specEquals,
  getFocusedGroup,
} from './types'

/**
 * Zustand store backing the workspace.
 *
 * Tabs:
 * - openOrFocus(spec): if a tab with this spec exists in the focused group,
 *   focus it. Otherwise append a new tab and focus it.
 * - closeTab(id): drop the tab. If it was focused, focus the right neighbour
 *   (or left, if it was the rightmost). If the group becomes empty, leave
 *   it empty — TabHost shows the EmptyEditor view.
 * - focusTab(id): just set the focused tab. No-op if id isn't in the group.
 * - closeMatching(predicate): close every tab whose spec matches.
 *
 * Sidebar:
 * - setSidebar(section): show that section's sidebar. `null` collapses.
 * - toggleSidebar(section): same section → collapse to null; different or
 *   currently-null → switch to section. Drives ActivityBar click semantics.
 *
 * Persistence: zustand persist against localStorage["openalice.workspace.v2"].
 * Schema bumps clear stored state (no migrate function) — loud-fail beats
 * silent migration when shape changes.
 */

interface WorkspaceActions {
  openOrFocus: (spec: ViewSpec) => void
  closeTab: (id: string) => void
  focusTab: (id: string) => void
  closeMatching: (predicate: (spec: ViewSpec) => boolean) => void
  /** Bulk closers used by the tab context menu. All operate on the focused group. */
  closeOthers: (id: string) => void
  closeToRight: (id: string) => void
  closeToLeft: (id: string) => void
  closeAll: () => void
  setSidebar: (section: ActivitySection | null) => void
  toggleSidebar: (section: ActivitySection) => void
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions

const DEFAULT_GROUP_ID = 'g1'

function newId(): string {
  // Browser crypto.randomUUID() is only defined in secure contexts (HTTPS /
  // localhost). LAN-IP HTTP access gets undefined, so build a v4 id ourselves.
  // crypto.getRandomValues IS available over HTTP.
  const c = typeof crypto !== 'undefined' ? crypto : undefined
  if (c?.randomUUID) return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c?.getRandomValues) {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function buildInitialState(): WorkspaceState {
  // Phase 2 starts empty — no auto-default chat. The empty-editor view in
  // TabHost guides new users to the activity bar.
  const group: TabGroup = {
    id: DEFAULT_GROUP_ID,
    tabIds: [],
    activeTabId: null,
  }
  return {
    tabs: {},
    tree: { kind: 'leaf', group },
    focusedGroupId: DEFAULT_GROUP_ID,
    selectedSidebar: null,
  }
}

/** Phase 2 still single-leaf. Returns a new state with the focused group replaced. */
function withFocusedGroup(
  state: WorkspaceState,
  fn: (group: TabGroup) => TabGroup,
): WorkspaceState {
  const group = getFocusedGroup(state)
  if (!group) return state
  const next = fn(group)
  if (next === group) return state
  return { ...state, tree: { kind: 'leaf', group: next } }
}

export const useWorkspace = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      ...buildInitialState(),

      openOrFocus(spec) {
        set((state) => {
          const group = getFocusedGroup(state)
          if (!group) return state

          // Match existing tab by spec equality
          const existingId = group.tabIds.find((id) => {
            const tab = state.tabs[id]
            return tab != null && specEquals(tab.spec, spec)
          })
          if (existingId) {
            if (group.activeTabId === existingId) return state
            return withFocusedGroup(state, (g) => ({ ...g, activeTabId: existingId }))
          }

          // Append new tab + focus
          const tab: Tab = { id: newId(), spec }
          return {
            ...state,
            tabs: { ...state.tabs, [tab.id]: tab },
            tree: {
              kind: 'leaf',
              group: { ...group, tabIds: [...group.tabIds, tab.id], activeTabId: tab.id },
            },
          }
        })
      },

      closeTab(id) {
        set((state) => {
          const group = getFocusedGroup(state)
          if (!group) return state
          const idx = group.tabIds.indexOf(id)
          if (idx < 0) return state

          const tabIds = group.tabIds.filter((x) => x !== id)
          const tabs = { ...state.tabs }
          delete tabs[id]

          // Focus a neighbour if the closed tab was active.
          let activeTabId = group.activeTabId
          if (activeTabId === id) {
            // Prefer right neighbour (same index, since we filtered out the closed one),
            // fall back to left, fall back to null when group is empty.
            activeTabId = tabIds[idx] ?? tabIds[idx - 1] ?? null
          }

          return {
            ...state,
            tabs,
            tree: { kind: 'leaf', group: { ...group, tabIds, activeTabId } },
          }
        })
      },

      focusTab(id) {
        set((state) => {
          const group = getFocusedGroup(state)
          if (!group) return state
          if (!group.tabIds.includes(id)) return state
          if (group.activeTabId === id) return state
          return withFocusedGroup(state, (g) => ({ ...g, activeTabId: id }))
        })
      },

      closeMatching(predicate) {
        // Snapshot ids first — closeTab mutates the array we'd be iterating.
        const state = get()
        const group = getFocusedGroup(state)
        if (!group) return
        const toClose = group.tabIds
          .map((id) => state.tabs[id])
          .filter((t): t is Tab => t != null && predicate(t.spec))
          .map((t) => t.id)
        for (const id of toClose) {
          get().closeTab(id)
        }
      },

      // ============= Bulk closers (for the tab context menu) =============
      // All four delegate to closeTab so the neighbour-focus / no-fallback
      // semantics are consistent. Snapshot ids before iterating since
      // closeTab mutates the underlying array.

      closeOthers(id) {
        const group = getFocusedGroup(get())
        if (!group) return
        const toClose = group.tabIds.filter((x) => x !== id)
        for (const tid of toClose) get().closeTab(tid)
      },

      closeToRight(id) {
        const group = getFocusedGroup(get())
        if (!group) return
        const idx = group.tabIds.indexOf(id)
        if (idx < 0) return
        const toClose = group.tabIds.slice(idx + 1)
        for (const tid of toClose) get().closeTab(tid)
      },

      closeToLeft(id) {
        const group = getFocusedGroup(get())
        if (!group) return
        const idx = group.tabIds.indexOf(id)
        if (idx < 0) return
        const toClose = group.tabIds.slice(0, idx)
        for (const tid of toClose) get().closeTab(tid)
      },

      closeAll() {
        const group = getFocusedGroup(get())
        if (!group) return
        const toClose = [...group.tabIds]
        for (const tid of toClose) get().closeTab(tid)
      },

      setSidebar(section) {
        set((state) =>
          state.selectedSidebar === section ? state : { ...state, selectedSidebar: section },
        )
      },

      toggleSidebar(section) {
        set((state) => ({
          ...state,
          selectedSidebar: state.selectedSidebar === section ? null : section,
        }))
      },
    }),
    {
      name: 'openalice.workspace.v2',
      version: 3,
      // Persist only the data shape — actions are recreated by the store factory.
      partialize: (state) => ({
        tabs: state.tabs,
        tree: state.tree,
        focusedGroupId: state.focusedGroupId,
        selectedSidebar: state.selectedSidebar,
      }),
    },
  ),
)
