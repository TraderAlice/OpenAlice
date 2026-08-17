/**
 * Cursor Agent first-party model suggestions (August 2026).
 *
 * Cursor Dashboard keys are represented by the ordinary provider credential
 * schema with vendor `cursor`; they are not generic OpenAI/Anthropic keys and
 * carry no API wire shape. `inferCredentialVendor('cursor')` intentionally
 * stays `custom` because manual native-config inference cannot prove that an
 * arbitrary value is a Dashboard key. The explicit Cursor preset owns that
 * classification. Suggestions are shared by the provider and Issue / launch
 * pickers. The adapter still
 * passes `--model <id>` through unchanged and does not validate the id —
 * Cursor owns the live list after `cursor-agent login`.
 *
 * Official billing split (https://cursor.com/docs/models-and-pricing):
 *   - Cursor Models pool (first-party): Grok 4.6, Grok 4.5, Composer 2.5
 *     (+ their Fast variants). Exempt from the Cursor Token Rate.
 *   - Other Models: everything else (GPT, Claude, Gemini, Kimi, GLM, …)
 *     and Composer 1. Do not put those ids here.
 *
 * Official “which to pick” (https://cursor.com/help/models-and-usage/grok-4-6):
 *   - Composer 2.5 — everyday coding, speed and cost. Fast is the product default.
 *   - Grok 4.6 — harder / longer agent runs. Named default effort is `high`.
 *     Fast is the default speed on Pro+. Docs tell people to prefer 4.6 over 4.5.
 *   - `auto` — CLI default. Router, not a first-party model. Auto Cost is
 *     exempt from the Token Rate; Balance / Intelligence may route third-party.
 *
 * CLI ids (live `cursor-agent models` on 2026.08.11-e8db854):
 *   - There is no bare `cursor-grok-4.6`. The labeled “Cursor Grok 4.6” is
 *     `cursor-grok-4.6-high`. Fast is `…-high-fast`.
 *   - Effort and Fast are suffixes on the id. Live CLI rejects
 *     `id[effort=…]` even though `--help` still documents brackets.
 *   - Grok 4.6 efforts: low / medium / high / xhigh.
 *   - Grok 4.5 efforts: low / medium / high (no xhigh on this login).
 *   - Composer 1 is not in the CLI list (hidden; billed as Other Models).
 *
 * Refresh: run `cursor-agent models` on a logged-in machine and compare.
 * Keep the Issue effort picker empty (`runtimeEffortOptions` for `cursor`).
 * The launch copy of this list is `ui/src/lib/cursor-models.ts` — keep ids
 * identical.
 */

export interface CursorSuggestedModel {
  readonly id: string;
  readonly label: string;
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
];

export const CURSOR_FIRST_PARTY_MODEL_IDS: readonly string[] =
  CURSOR_FIRST_PARTY_MODELS.map((model) => model.id);
