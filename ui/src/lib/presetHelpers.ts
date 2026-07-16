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
  'google-generative-ai': 'Google Gemini',
  'openai-chat': 'OpenAI Chat',
  'openai-responses': 'OpenAI Responses',
}

/** Plain-language labels for the custom endpoint mode picker. */
export const WIRE_SHAPE_GUIDANCE: Record<WireShape, string> = {
  anthropic: 'Anthropic Messages',
  'google-generative-ai': 'Google Generative AI',
  'openai-chat': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
}

export const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'opencode',
  pi: 'Pi',
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
const SHAPE_ORDER: WireShape[] = ['anthropic', 'google-generative-ai', 'openai-chat', 'openai-responses']
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
  opencode: ['google-generative-ai', 'openai-chat', 'anthropic', 'openai-responses'],
  pi: ['google-generative-ai', 'openai-chat', 'anthropic', 'openai-responses'],
}

/** Pick the wire an agent should use from a credential's capabilities (null = none compatible). */
export function pickAgentWire(
  wires: Partial<Record<WireShape, string>>,
  agentId: string,
  requestedShape?: WireShape,
): { shape: WireShape; baseUrl: string } | null {
  const pref = AGENT_WIRE_PREFERENCE[agentId] ?? SHAPE_ORDER
  if (requestedShape !== undefined) {
    if (!pref.includes(requestedShape) || !(requestedShape in wires)) return null
    return { shape: requestedShape, baseUrl: wires[requestedShape] ?? '' }
  }
  for (const shape of pref) {
    if (shape in wires) return { shape, baseUrl: wires[shape] ?? '' }
  }
  return null
}

/** All declared wire shapes this agent can speak, in runtime preference order. */
export function agentWireShapes(
  wires: Partial<Record<WireShape, string>>,
  agentId: string,
): WireShape[] {
  const pref = AGENT_WIRE_PREFERENCE[agentId] ?? SHAPE_ORDER
  return pref.filter((shape) => shape in wires)
}

/** Agent runtimes that can consume at least one declared wire shape. */
export function compatibleAgentIds(wires: Partial<Record<WireShape, string>>): string[] {
  return Object.keys(AGENT_WIRE_PREFERENCE).filter((agentId) => pickAgentWire(wires, agentId) !== null)
}

/** Compatibility summary for a preset before a region has been selected. */
export function presetCompatibleAgentIds(preset: Preset): string[] {
  const wires: Partial<Record<WireShape, string>> = {}
  for (const region of presetRegions(preset)) Object.assign(wires, region.wires)
  return compatibleAgentIds(wires)
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

/** Use the catalog's actual field default instead of assuming list order. */
export function presetDefaultModel(p: Preset | null | undefined): string {
  if (!p) return ''
  const value = schemaProps(p.schema)['model']?.default
  return typeof value === 'string' ? value : presetModels(p)[0]?.id ?? ''
}

/** Model shown when a saved credential is loaded into a Workspace editor. */
export function savedCredentialModel(
  credential: { lastModel?: string } | null | undefined,
  preset: Preset | null | undefined,
): string {
  return credential?.lastModel?.trim() || presetDefaultModel(preset)
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
  longcat: 'longcat',
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
  [/generativelanguage\.googleapis\.com/i, 'google'],
  [/bigmodel\.cn|z\.ai/i, 'glm'],
  [/minimaxi\.com|minimax\.io/i, 'minimax'],
  [/moonshot\.cn|moonshot\.ai/i, 'kimi'],
  [/deepseek\.com/i, 'deepseek'],
  [/longcat\.chat/i, 'longcat'],
]

/** Mirror the backend's intentionally narrow Anthropic bearer inference. */
export function anthropicAuthModeForBaseUrl(baseUrl: string | null | undefined): 'x-api-key' | 'bearer' {
  return /api\.minimaxi\.com|api\.minimax\.io|api\.longcat\.chat/i.test(baseUrl ?? '')
    ? 'bearer'
    : 'x-api-key'
}

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
