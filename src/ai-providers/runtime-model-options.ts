/** Shared picker policy for Chat, Issues and external Session controls. No I/O. */
import type { ModelReasoningEffort, ModelSemantics } from './model-semantics.js'
import { AGY_FIRST_PARTY_MODELS } from '../workspaces/adapters/agy-models.js'
import { CURSOR_FIRST_PARTY_MODELS } from '../workspaces/adapters/cursor-models.js'
import { GROK_FIRST_PARTY_MODELS } from '../workspaces/adapters/grok-models.js'
type PresetModel = { id: string; label: string; semantics?: ModelSemantics }
type Preset = { id: string; models?: readonly PresetModel[] }
type SavedCredential = { vendor: string }

const ALL_RUNTIME_EFFORTS: readonly ModelReasoningEffort[] = [
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
]

const CLAUDE_RUNTIME_EFFORTS: readonly ModelReasoningEffort[] = [
  'low', 'medium', 'high', 'max',
]

/** Canonical Grok CLI `--effort` set. A model only honors its own menu. */
const GROK_RUNTIME_EFFORTS: readonly ModelReasoningEffort[] = [
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
]

/** Live grok-4.6 (CLI default) advertised menu. Used when no model is selected. */
const GROK_DEFAULT_MODEL_EFFORTS: readonly ModelReasoningEffort[] = [
  'low', 'medium', 'high', 'xhigh',
]

const OMP_RUNTIME_EFFORTS: readonly ModelReasoningEffort[] = [
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
]

const AGY_RUNTIME_EFFORTS: readonly ModelReasoningEffort[] = [
  'low', 'medium', 'high',
]

const PROVIDER_PRESET_BY_VENDOR: Readonly<Record<string, string>> = {
  anthropic: 'claude-api',
  openai: 'codex-api',
  google: 'gemini',
  xai: 'xai-api',
  openrouter: 'openrouter',
}

const NATIVE_PRESET_BY_AGENT: Readonly<Record<string, string>> = {
  claude: 'claude-oauth',
  codex: 'codex-oauth',
}

function uniqueModels(models: readonly PresetModel[]): PresetModel[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (seen.has(model.id)) return false
    seen.add(model.id)
    return true
  })
}

function vendorCatalog(input: {
  readonly agent: string | null
  readonly credential: SavedCredential | null
  readonly presets: readonly Preset[]
}): readonly PresetModel[] {
  // Cursor consumes a provider credential directly rather than selecting a
  // protocol catalog. Its CLI model ids therefore come from the Cursor catalog;
  // binding some other provider key must not make those ids valid `--model` values.
  if (input.agent === 'cursor') return CURSOR_FIRST_PARTY_MODELS
  if (input.agent === 'agy') return AGY_FIRST_PARTY_MODELS
  // Native grok login uses the live CLI catalog. A bound vault credential
  // keeps that provider's ids (OpenRouter slugs are valid `--model` values
  // once GROK_MODELS_BASE_URL is projected).
  if (input.agent === 'grok' && !input.credential) return GROK_FIRST_PARTY_MODELS
  const presetId = input.credential
    ? PROVIDER_PRESET_BY_VENDOR[input.credential.vendor] ?? input.credential.vendor
    : input.agent ? NATIVE_PRESET_BY_AGENT[input.agent] : undefined
  return presetId
    ? input.presets.find((preset) => preset.id === presetId)?.models ?? []
    : []
}

export function runtimeModelOptions(input: {
  readonly agent: string | null
  readonly credential: SavedCredential | null
  readonly defaultModel: string | null
  readonly presets: readonly Preset[]
}): PresetModel[] {
  const catalog = vendorCatalog(input)
  const preferredModel = input.defaultModel
  return uniqueModels([
    ...(preferredModel && !catalog.some((model) => model.id === preferredModel)
      ? [{ id: preferredModel, label: preferredModel }]
      : []),
    ...catalog,
  ])
}

export function runtimeModelSemantics(
  model: string | null,
  models: readonly PresetModel[],
): ModelSemantics | null {
  return models.find((candidate) => candidate.id === model)?.semantics ?? null
}

export function runtimeEffortOptions(input: {
  readonly agent: string | null
  readonly semantics: ModelSemantics | null
  readonly modelKnown: boolean
  readonly model?: string | null
}): readonly ModelReasoningEffort[] {
  // Live Cursor Agent encodes effort in the model id (`gpt-5.2-low`).
  // Brackets and a separate effort flag both fail; do not show a fake scale.
  if (input.agent === 'cursor') return []
  const declared = input.semantics?.reasoning?.efforts
  if (declared) return declared
  // A known model without provider-native effort tiers must not receive a
  // fabricated scale. Unknown/private ids preserve the runtime's native knobs.
  if (input.modelKnown) return []
  if (input.agent === 'claude') return CLAUDE_RUNTIME_EFFORTS
  if (input.agent === 'agy') return AGY_RUNTIME_EFFORTS
  if (input.agent === 'grok') {
    return input.model ? GROK_RUNTIME_EFFORTS : GROK_DEFAULT_MODEL_EFFORTS
  }
  if (input.agent === 'omp') return OMP_RUNTIME_EFFORTS
  return ALL_RUNTIME_EFFORTS
}
