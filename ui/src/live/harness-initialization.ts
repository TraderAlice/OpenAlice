import { create } from 'zustand'

interface Initialization {
  pending: boolean
  error: string | null
}

interface Store {
  templates: Record<string, Initialization>
  initialize(template: string, run: () => Promise<unknown>): Promise<void>
}

export const idleInitialization: Initialization = { pending: false, error: null }

// The request and its feedback outlive setup pages, including Quick Start tabs.
export const useHarnessInitialization = create<Store>((set, get) => ({
  templates: {},
  initialize: async (template, run) => {
    if (get().templates[template]?.pending) return
    const update = (state: Initialization) => set((current) => ({
      templates: { ...current.templates, [template]: state },
    }))
    update({ pending: true, error: null })
    try {
      await run()
      update(idleInitialization)
    } catch (cause) {
      update({ pending: false, error: cause instanceof Error ? cause.message : String(cause) })
    }
  },
}))
