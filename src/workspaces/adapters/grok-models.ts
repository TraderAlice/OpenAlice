/**
 * Grok Build first-party model suggestions (August 2026).
 *
 * Native `grok login` (grok.com session) and an xAI API key both speak the
 * same CLI ids. This is not a vault vendor catalog — `xai-api` already owns
 * that list for credential forms. Launch / Issue native-login suggestions
 * must not wait on that preset, and must not substitute OpenRouter slugs or
 * the retired `grok-build` docs alias.
 *
 * Live `grok models` on 1.0.5 (5115b46, grok.com login, 2026-08-22):
 *   - grok-4.6 (default)
 *   - grok-4.5
 * `~/.grok/models_cache.json` advertises 500k context on both. Effort menus:
 *   - grok-4.6: low / medium / high (default) / xhigh
 *   - grok-4.5: low / medium / high (default); no xhigh
 * CLI `--effort` still accepts the canonical set `none` through `max`
 * (`ultra` is rejected). A model only honors the levels its menu lists.
 *
 * Refresh: run `grok models` on a logged-in machine and compare.
 * The launch copy of this list is `ui/src/lib/grok-models.ts` — keep ids
 * identical.
 */

export interface GrokSuggestedModel {
  readonly id: string;
  readonly label: string;
}

export const GROK_FIRST_PARTY_MODELS: readonly GrokSuggestedModel[] = [
  { id: 'grok-4.6', label: 'Grok 4.6' },
  { id: 'grok-4.5', label: 'Grok 4.5' },
];

export const GROK_FIRST_PARTY_MODEL_IDS: readonly string[] =
  GROK_FIRST_PARTY_MODELS.map((model) => model.id);
