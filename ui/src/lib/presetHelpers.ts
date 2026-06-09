/**
 * Shared preset-catalog helpers — the single source for turning a serialized
 * Preset (from /api/config/presets) into the enumerations the UI surfaces
 * (endpoint dropdowns, model suggestions) and for resolving a vendor/baseUrl to
 * its preset. Used by both the AI Provider credential vault and the per-workspace
 * AI config modal so the vendor map can't drift between them.
 *
 * The preset is the enumeration backbone: its `endpoints` → schema.baseUrl.oneOf,
 * its `models` → schema.model.oneOf (see src/ai-providers/presets.ts buildJsonSchema).
 */

import type { Preset, SerializedRegion, WireShape } from '../api'

export interface LabeledOption {
  id: string
  label: string
}

// ==================== Wire shapes & regions ====================

/** Compact label for a wire shape (list chips / credential rows). */
export const WIRE_SHAPE_SHORT: Record<WireShape, string> = {
  anthropic: 'Anthropic',
  'openai-chat': 'OpenAI Chat',
  'openai-responses': 'OpenAI Responses',
}

/** The regions a preset offers (each carrying its per-shape endpoint map). */
export function presetRegions(p: Preset | null | undefined): SerializedRegion[] {
  return p?.regions ?? []
}

/** Look up a region by id (falls back to the first region). */
export function regionById(p: Preset | null | undefined, id: string): SerializedRegion | undefined {
  const regions = presetRegions(p)
  return regions.find((r) => r.id === id) ?? regions[0]
}

/** The wire shapes available in a region, in a stable display order. */
const SHAPE_ORDER: WireShape[] = ['anthropic', 'openai-chat', 'openai-responses']
export function regionShapes(region: SerializedRegion | undefined): WireShape[] {
  if (!region) return []
  return SHAPE_ORDER.filter((s) => s in region.wires)
}

/**
 * The wire shapes each agent can speak, in preference order — mirrors the
 * backend `AGENT_WIRE_PREFERENCE` (credential-injection.ts). A credential serves
 * an agent only if it declares a compatible wire (codex = Responses-only, so few
 * credentials can drive it — the intended funnel toward pi/opencode).
 */
export const AGENT_WIRE_PREFERENCE: Record<string, WireShape[]> = {
  claude: ['anthropic'],
  codex: ['openai-responses'],
  opencode: ['openai-chat', 'anthropic', 'openai-responses'],
  pi: ['openai-chat', 'anthropic', 'openai-responses'],
}

/** Pick the wire an agent should use from a credential's capabilities (null = none compatible). */
export function pickAgentWire(
  wires: Partial<Record<WireShape, string>>,
  agentId: string,
): { shape: WireShape; baseUrl: string } | null {
  const pref = AGENT_WIRE_PREFERENCE[agentId] ?? SHAPE_ORDER
  for (const shape of pref) {
    if (shape in wires) return { shape, baseUrl: wires[shape] ?? '' }
  }
  return null
}

function schemaProps(schema: Preset['schema']): Record<string, Record<string, unknown>> {
  return (schema?.properties as Record<string, Record<string, unknown>>) ?? {}
}

function oneOf(schema: Preset['schema'], field: string): LabeledOption[] {
  const f = schemaProps(schema)[field] as { oneOf?: Array<{ const: string; title: string }> } | undefined
  return f?.oneOf ? f.oneOf.map((o) => ({ id: o.const, label: o.title })) : []
}

/** Enumerated models for a preset (empty for custom / un-enumerated presets). */
export function presetModels(p: Preset): LabeledOption[] {
  return oneOf(p.schema, 'model')
}

/** Only api-key presets belong in the credential vault — oauth ones log in via the CLI. */
export function isApiKeyPreset(p: Preset): boolean {
  return 'apiKey' in schemaProps(p.schema)
}

/** Vendor tag stored on a credential, by preset id (api-key presets only). */
export const VENDOR_BY_PRESET: Record<string, string> = {
  'claude-api': 'anthropic',
  'codex-api': 'openai',
  gemini: 'google',
  minimax: 'minimax',
  glm: 'glm',
  kimi: 'kimi',
  deepseek: 'deepseek',
  custom: 'custom',
}

/** Reverse: the api-key preset for a vendor (falls back to 'custom'). */
export function vendorPreset(vendor: string, presets: Preset[]): Preset | undefined {
  const presetId = Object.entries(VENDOR_BY_PRESET).find(([, v]) => v === vendor)?.[0]
  return presets.find((p) => p.id === presetId) ?? presets.find((p) => p.id === 'custom')
}

// Mirrors the backend baseUrl→vendor heuristic (src/core/credential-inference.ts
// VENDORS_BY_BASEURL). Kept in sync by hand — it's a tiny, stable map.
const VENDOR_BY_BASEURL: Array<[RegExp, string]> = [
  [/bigmodel\.cn|z\.ai/i, 'glm'],
  [/minimaxi\.com|minimax\.io/i, 'minimax'],
  [/moonshot\.cn|moonshot\.ai/i, 'kimi'],
  [/deepseek\.com/i, 'deepseek'],
]

/**
 * Infer the provider vendor from a baseUrl, used to pick which model list to
 * suggest. A recognized gateway URL wins; otherwise `fallback` (the agent tab's
 * implied vendor, e.g. claude→anthropic, codex→openai) decides. Returns null
 * when nothing is known (e.g. a custom/local endpoint) → caller shows no
 * suggestions (free text), which is correct: custom providers have no catalog.
 */
export function baseUrlToVendor(baseUrl: string | null | undefined, fallback?: string | null): string | null {
  const url = (baseUrl ?? '').trim()
  for (const [pattern, vendor] of VENDOR_BY_BASEURL) {
    if (pattern.test(url)) return vendor
  }
  return fallback ?? null
}
