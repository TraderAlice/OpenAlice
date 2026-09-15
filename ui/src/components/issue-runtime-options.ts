import type { ModelReasoningEffort } from '../api'
import { runtimeModelOptions, runtimeModelSemantics, runtimeEffortOptions } from '../../../src/ai-providers/runtime-model-options.js'
export { runtimeModelOptions, runtimeModelSemantics, runtimeEffortOptions }
import type {
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

// Issue properties and interactive launchers deliberately share one catalog
// and effort policy. Keep the old names as compatibility aliases for the Issue
// surface while newer launchers use the ownership-neutral names.
export const issueModelOptions = runtimeModelOptions
export const issueModelSemantics = runtimeModelSemantics
export const issueEffortOptions = runtimeEffortOptions
