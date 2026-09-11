/**
 * Issue / launch copy of Grok Build first-party CLI ids.
 *
 * Keep `id` values identical to `src/workspaces/adapters/grok-models.ts`
 * (research notes and live `grok models` rules live there). Semantics match
 * the xAI registry so native login can narrow effort without waiting on the
 * vault `xai-api` preset. Not a vault vendor catalog.
 */

import type { PresetModel } from '../api'

export const GROK_FIRST_PARTY_MODELS: readonly PresetModel[] = [
  {
    id: 'grok-4.6',
    label: 'Grok 4.6',
    semantics: {
      contextWindow: 500_000,
      reasoning: {
        mode: 'required',
        efforts: ['low', 'medium', 'high', 'xhigh'],
        defaultEffort: 'high',
      },
    },
  },
  {
    id: 'grok-4.5',
    label: 'Grok 4.5',
    semantics: {
      contextWindow: 500_000,
      reasoning: {
        mode: 'required',
        efforts: ['low', 'medium', 'high'],
        defaultEffort: 'high',
      },
    },
  },
]

export const GROK_FIRST_PARTY_MODEL_IDS: readonly string[] =
  GROK_FIRST_PARTY_MODELS.map((model) => model.id)
