/**
 * Issue / launch copy of Cursor Agent first-party CLI ids.
 *
 * Keep `id` values identical to `src/workspaces/adapters/cursor-models.ts`
 * (research notes and official-pool rules live there). Labels match
 * `cursor-agent models` on 2026.08.11-e8db854. Not a vault vendor catalog.
 */

export interface CursorSuggestedModel {
  readonly id: string
  readonly label: string
}

export const CURSOR_FIRST_PARTY_MODELS: readonly CursorSuggestedModel[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'composer-2.5-fast', label: 'Composer 2.5 Fast' },
  { id: 'composer-2.5', label: 'Composer 2.5' },
  { id: 'cursor-grok-4.6-high-fast', label: 'Cursor Grok 4.6 Fast' },
  { id: 'cursor-grok-4.6-high', label: 'Cursor Grok 4.6' },
  { id: 'cursor-grok-4.6-xhigh-fast', label: 'Cursor Grok 4.6 Extra High Fast' },
  { id: 'cursor-grok-4.6-xhigh', label: 'Cursor Grok 4.6 Extra High' },
  { id: 'cursor-grok-4.6-medium-fast', label: 'Cursor Grok 4.6 Medium Fast' },
  { id: 'cursor-grok-4.6-medium', label: 'Cursor Grok 4.6 Medium' },
  { id: 'cursor-grok-4.6-low-fast', label: 'Cursor Grok 4.6 Low Fast' },
  { id: 'cursor-grok-4.6-low', label: 'Cursor Grok 4.6 Low' },
  { id: 'cursor-grok-4.5-high-fast', label: 'Cursor Grok 4.5 Fast' },
  { id: 'cursor-grok-4.5-high', label: 'Cursor Grok 4.5' },
  { id: 'cursor-grok-4.5-medium-fast', label: 'Cursor Grok 4.5 Medium Fast' },
  { id: 'cursor-grok-4.5-medium', label: 'Cursor Grok 4.5 Medium' },
  { id: 'cursor-grok-4.5-low-fast', label: 'Cursor Grok 4.5 Low Fast' },
  { id: 'cursor-grok-4.5-low', label: 'Cursor Grok 4.5 Low' },
]

export const CURSOR_FIRST_PARTY_MODEL_IDS: readonly string[] =
  CURSOR_FIRST_PARTY_MODELS.map((model) => model.id)
