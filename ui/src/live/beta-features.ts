import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('live/beta-features')

/**
 * Device-local preview flags. These are chrome visibility only — they do not
 * change persisted Workspace state or backend preferences. Unknown or
 * malformed values stay off so a half-finished surface cannot appear by
 * accident.
 */
export const BETA_FEATURES_STORAGE_KEY = 'openalice.beta-features.v1'

export interface BetaFeatures {
  /** Show Office in the Activity Bar. `/office` still adopts if opened. */
  office: boolean
}

interface BetaFeaturesStore extends BetaFeatures {
  setOffice: (office: boolean) => void
}

export const DEFAULT_BETA_FEATURES: BetaFeatures = {
  office: false,
}

export function normalizeBetaFeatures(persisted: unknown): BetaFeatures {
  const stored = persisted && typeof persisted === 'object'
    ? persisted as Record<string, unknown>
    : {}
  return {
    office: stored.office === true,
  }
}

export const useBetaFeatures = create<BetaFeaturesStore>()(
  persist(
    (set) => ({
      ...DEFAULT_BETA_FEATURES,
      setOffice: (office) => set({ office }),
    }),
    {
      name: BETA_FEATURES_STORAGE_KEY,
      version: 1,
      merge: (persisted, current) => ({
        ...current,
        ...normalizeBetaFeatures(persisted),
      }),
    },
  ),
)
