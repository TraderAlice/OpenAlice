import { create } from 'zustand'

export type WorkTab = { id: string; kind: 'files' | 'studio' | 'browser'; title?: string } | { id: string; kind: 'file'; path: string }
export interface WorkbenchState {
  tabs: WorkTab[]
  active: string | null
  open: boolean
  width: number
  sessionId?: string
}
const empty: WorkbenchState = { tabs: [], active: null, open: false, width: 48 }
interface Store {
  workspaces: Record<string, WorkbenchState>
  patch(id: string, update: Partial<WorkbenchState>): void
  openTab(id: string, tab: WorkTab): void
  closeTab(id: string, tabId: string): void
}
/** Runtime view state: Workspace-scoped, never persisted into native sessions. */
export const useHarnessWorkbench = create<Store>((set) => ({
  workspaces: {},
  patch: (id, update) => set((s) => ({ workspaces: { ...s.workspaces, [id]: { ...(s.workspaces[id] ?? empty), ...update } } })),
  openTab: (id, tab) => set((s) => {
    const state = s.workspaces[id] ?? empty
    return { workspaces: { ...s.workspaces, [id]: { ...state, width: !state.tabs.length && tab.kind === 'studio' ? 62 : state.width, tabs: state.tabs.some((t) => t.id === tab.id) ? state.tabs : [...state.tabs, tab], active: tab.id, open: true } } }
  }),
  closeTab: (id, tabId) => set((s) => {
    const state = s.workspaces[id] ?? empty
    const index = state.tabs.findIndex((t) => t.id === tabId)
    const tabs = state.tabs.filter((t) => t.id !== tabId)
    const active = state.active === tabId ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null : state.active
    return { workspaces: { ...s.workspaces, [id]: { ...state, tabs, active, open: tabs.length > 0 && state.open } } }
  }),
}))
export const emptyWorkbench = empty
