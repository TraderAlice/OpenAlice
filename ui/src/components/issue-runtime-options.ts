import type {
  ModelReasoningEffort,
  ModelSemantics,
  Preset,
  PresetModel,
} from '../api'
import type { SavedCredential } from './workspace/api'

const ALL_RUNTIME_EFFORTS: readonly ModelReasoningEffort[] = [
  'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
]

const CLAUDE_RUNTIME_EFFORTS: readonly ModelReasoningEffort[] = [
  'low', 'medium', 'high', 'max',
]

const PROVIDER_PRESET_BY_VENDOR: Readonly<Record<string, string>> = {
  anthropic: 'claude-api',
  openai: 'codex-api',
  google: 'gemini',
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

export function runtimeModelOptions(input: {
  readonly agent: string | null
  readonly credential: SavedCredential | null
  readonly defaultModel: string | null
  readonly presets: readonly Preset[]
}): PresetModel[] {
  const presetId = input.credential
    ? PROVIDER_PRESET_BY_VENDOR[input.credential.vendor] ?? input.credential.vendor
    : input.agent ? NATIVE_PRESET_BY_AGENT[input.agent] : undefined
  const catalog = presetId
    ? input.presets.find((preset) => preset.id === presetId)?.models ?? []
    : []
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
}): readonly ModelReasoningEffort[] {
  const declared = input.semantics?.reasoning?.efforts
  if (declared) return declared
  // A known model without provider-native effort tiers must not receive a
  // fabricated scale. Unknown/private ids preserve the runtime's native knobs.
  if (input.modelKnown) return []
  return input.agent === 'claude' ? CLAUDE_RUNTIME_EFFORTS : ALL_RUNTIME_EFFORTS
}

// Issue properties and interactive launchers deliberately share one catalog
// and effort policy. Keep the old names as compatibility aliases for the Issue
// surface while newer launchers use the ownership-neutral names.
export const issueModelOptions = runtimeModelOptions
export const issueModelSemantics = runtimeModelSemantics
export const issueEffortOptions = runtimeEffortOptions
