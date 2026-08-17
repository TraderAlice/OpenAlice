/**
 * Antigravity first-party model suggestions (August 2026).
 *
 * This is not a vault vendor catalog. `inferCredentialVendor('agy')` stays
 * `custom`; do not add an `agy` / `antigravity` preset to `preset-catalog.ts`.
 * Native auth is Google keyring / browser login. A vault Gemini key is
 * optional and is ignored by the CLI unless the user already set
 * `modelProvider: "gemini"` in `~/.gemini/antigravity-cli/settings.json` —
 * Alice does not write that file.
 *
 * `agy models` is not a global catalog. Upstream says the list depends on
 * account and auth type
 * (https://github.com/google-antigravity/antigravity-cli/issues/83). Two
 * first-party pools show up in practice:
 *
 * 1. Gemini API key path (`modelProvider: "gemini"`). Live 1.1.13 on a
 *    free-tier AI Studio key returned raw Gemini API ids — no `-high` /
 *    `-medium` suffix, no Claude, and `--effort` is rejected. This is
 *    Antigravity's key-path allowlist, not `ListModels` for the whole
 *    Gemini API (3.7 Flash is free on the API pricing page but was absent
 *    here; `gemini-3.1-pro-preview` has no Gemini free tier but was listed).
 * 2. Antigravity account / subscription catalog from the official headless
 *    docs (https://www.antigravity.google/docs/cli/headless/). Effort is
 *    often already in the slug. Claude and other third-party ids stay
 *    free-typed.
 *
 * Suggestions are the union of those Gemini pools. A short `agy models` on
 * one machine is not proof a documented slug is gone. Do not rewrite slugs.
 *
 * The launch copy of this list is `ui/src/lib/agy-models.ts` — keep ids
 * identical.
 */

export interface AgySuggestedModel {
  readonly id: string;
  readonly label: string;
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
];

export const AGY_FIRST_PARTY_MODEL_IDS: readonly string[] =
  AGY_FIRST_PARTY_MODELS.map((model) => model.id);
