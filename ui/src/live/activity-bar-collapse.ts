import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('live/activity-bar-collapse')

/**
 * Per-section collapse state for the ActivityBar.
 *
 * Keyed by the section's stable group id (e.g. "system", "custom:desk").
 * The unlabeled primary group is never collapsible.
 *
 * Stores the **user's explicit preference**: `true` = collapsed,
 * `false` = expanded, absent = "use the section's `defaultCollapsed`
 * (or expanded if unset)". Three-state is necessary because some
 * sections (Legacy) default-collapsed; a two-state present/absent
 * model can't represent "user explicitly expanded a default-collapsed
 * section".
 *
 * Persists to localStorage so the user's preference survives reloads. A key
 * only gets pruned when the user-toggled-state matches the default (avoids the
 * store growing forever).
 */

interface ActivityBarCollapseState {
  collapsedSections: Record<string, boolean>
  railCollapsed: boolean
}

function migrateCollapseKeys(collapsed: Record<string, boolean>): Record<string, boolean> {
  const next = { ...collapsed }
  if ('Beta' in next && !('beta' in next)) {
    next.beta = next.Beta
    delete next.Beta
  }
  if ('System' in next && !('system' in next)) {
    next.system = next.System
    delete next.System
  }
  return next
}

interface ActivityBarCollapseActions {
  /** Set the user's explicit preference for a section. Pass
   *  `defaultCollapsed` so the store can prune the key when the user's
   *  preference now matches the default — keeps localStorage tight. */
  setCollapsed: (name: string, collapsed: boolean, defaultCollapsed?: boolean) => void
  setRailCollapsed: (collapsed: boolean) => void
}

export const useActivityBarCollapse = create<ActivityBarCollapseState & ActivityBarCollapseActions>()(
  persist(
    (set) => ({
      collapsedSections: {},
      railCollapsed: false,
      setCollapsed: (name, collapsed, defaultCollapsed) =>
        set((s) => {
          const next = { ...s.collapsedSections }
          if (collapsed === Boolean(defaultCollapsed)) {
            delete next[name]
          } else {
            next[name] = collapsed
          }
          return { collapsedSections: next }
        }),
      setRailCollapsed: (collapsed) => set({ railCollapsed: collapsed }),
    }),
    {
      name: 'openalice.activitybar-sections.v1',
      version: 3,
      migrate: (persisted, version) => {
        const state = persisted && typeof persisted === 'object'
          ? persisted as ActivityBarCollapseState
          : { collapsedSections: {}, railCollapsed: false }
        if (version < 3) {
          return {
            ...state,
            collapsedSections: migrateCollapseKeys(state.collapsedSections ?? {}),
          }
        }
        return state
      },
    },
  ),
)
