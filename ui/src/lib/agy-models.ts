/**
 * Issue / launch copy of Antigravity first-party CLI ids.
 *
 * Keep `id` values identical to `src/workspaces/adapters/agy-models.ts`
 * (research notes and auth-path rules live there). Key-path Gemini API
 * ids first, then the documented Antigravity account slugs. Not a vault
 * vendor catalog.
 */

export interface AgySuggestedModel {
  readonly id: string
  readonly label: string
}

export const AGY_FIRST_PARTY_MODELS: readonly AgySuggestedModel[] = [
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { id: 'gemini-3.7-flash-high', label: 'Gemini 3.7 Flash (High)' },
  { id: 'gemini-3.7-flash-medium', label: 'Gemini 3.7 Flash (Medium)' },
  { id: 'gemini-3.6-flash-high', label: 'Gemini 3.6 Flash (High)' },
  { id: 'gemini-3.6-flash-medium', label: 'Gemini 3.6 Flash (Medium)' },
  { id: 'gemini-3.5-flash-medium', label: 'Gemini 3.5 Flash (Medium)' },
  { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
]

export const AGY_FIRST_PARTY_MODEL_IDS: readonly string[] =
  AGY_FIRST_PARTY_MODELS.map((model) => model.id)
