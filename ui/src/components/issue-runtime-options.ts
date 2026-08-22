import type {
  ModelReasoningEffort,
  ModelSemantics,
  Preset,
  PresetModel,
} from '../api'
import { AGY_FIRST_PARTY_MODELS } from '../lib/agy-models'
import { CURSOR_FIRST_PARTY_MODELS } from '../lib/cursor-models'
import { GROK_FIRST_PARTY_MODELS } from '../lib/grok-models'
import type {
  SavedCredential,
  WorkspaceRuntimeModeSettings,
  WorkspaceRuntimePreference,
} from './workspace/api'

export interface IssueAiOverrides {
  readonly credential?: string
  readonly credentialSource?: 'native'
  readonly model?: string
  readonly effort?: ModelReasoningEffort
}

export interface ResolvedIssueAiSelection {
  readonly accessMode: 'native' | 'vault'
  readonly credentialSlug?: string
  readonly model?: string
  readonly reasoningEffort?: ModelReasoningEffort
  readonly accessOrigin: 'issue' | 'workspace-fixed' | 'workspace-recent' | 'runtime'
  readonly preference?: WorkspaceRuntimePreference
}

/** Mirror the server's headless selection semantics for display/editing. Issue
 * fields are one-Session overrides; omitted fields inherit fixed Workspace
 * values, then recent values for the same runtime, then native Agent state. */
export function resolveIssueAiSelection(input: {
  readonly mode: WorkspaceRuntimeModeSettings | null
  readonly agent: string | null
  readonly issue: IssueAiOverrides
}): ResolvedIssueAiSelection {
  const agent = input.agent
  const fixed = agent ? input.mode?.agents[agent] : undefined
  const recent = agent ? input.mode?.recent.agents[agent] : undefined
  const preference = fixed ?? recent
  const explicitNative = input.issue.credentialSource === 'native'
  const explicitVault = Boolean(input.issue.credential)
  const accessMode = explicitNative
    ? 'native' as const
    : explicitVault
      ? 'vault' as const
      : preference?.accessMode ?? 'native'
  const credentialSlug = accessMode === 'vault'
    ? input.issue.credential ?? (preference?.accessMode === 'vault' ? preference.credentialSlug : undefined)
    : undefined
  const sameCredential = explicitNative
    ? preference?.accessMode === 'native'
    : explicitVault
      ? preference?.accessMode === 'vault' && preference.credentialSlug === input.issue.credential
      : true

  return {
    accessMode,
    ...(credentialSlug ? { credentialSlug } : {}),
    ...(input.issue.model ?? (sameCredential ? preference?.model : undefined)
      ? { model: input.issue.model ?? preference?.model }
      : {}),
    ...(input.issue.effort ?? (sameCredential ? preference?.reasoningEffort : undefined)
      ? { reasoningEffort: input.issue.effort ?? preference?.reasoningEffort }
      : {}),
    accessOrigin: explicitNative || explicitVault
      ? 'issue'
      : fixed
        ? 'workspace-fixed'
        : recent
          ? 'workspace-recent'
          : 'runtime',
    ...(preference ? { preference } : {}),
  }
}

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

// Issue properties and interactive launchers deliberately share one catalog
// and effort policy. Keep the old names as compatibility aliases for the Issue
// surface while newer launchers use the ownership-neutral names.
export const issueModelOptions = runtimeModelOptions
export const issueModelSemantics = runtimeModelSemantics
export const issueEffortOptions = runtimeEffortOptions
