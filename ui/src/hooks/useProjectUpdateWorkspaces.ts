import { useMemo } from 'react'
import { useWorkspaces } from '../contexts/workspaces-context'
import { useAgentLaunchPreferences } from './useAgentLaunchConfig'

/** Updates follow the persisted Harness defaults, never a name or last-active fallback. */
export function useProjectUpdateWorkspaces() {
  const context = useWorkspaces()
  const chat = useAgentLaunchPreferences()
  return useMemo(() => [
    { kind: 'chat', label: 'Chat', template: 'chat', id: chat.recentChatWorkspaceId, loaded: chat.loaded, error: null },
    { kind: 'auto-quant', label: 'Quant', template: 'auto-quant-v2', id: context.autoQuantDefaultWorkspaceId, loaded: context.autoQuantPreferenceLoaded, error: context.autoQuantPreferenceError },
    { kind: 'auto-prediction', label: 'Prediction', template: 'auto-prediction', id: context.autoPredictionDefaultWorkspaceId, loaded: context.autoPredictionPreferenceLoaded, error: context.autoPredictionPreferenceError },
  ].map(item => ({ ...item,
    loaded: Boolean(item.loaded && context.hasLoaded),
    error: item.error || context.listError,
    workspace: item.loaded ? context.workspaces.find(workspace => workspace.id === item.id && workspace.template === item.template) ?? null : null,
  })), [chat.recentChatWorkspaceId, chat.loaded, context.workspaces, context.hasLoaded, context.listError,
    context.autoQuantDefaultWorkspaceId, context.autoQuantPreferenceLoaded, context.autoQuantPreferenceError,
    context.autoPredictionDefaultWorkspaceId, context.autoPredictionPreferenceLoaded, context.autoPredictionPreferenceError])
}

export type ProjectUpdateWorkspace = ReturnType<typeof useProjectUpdateWorkspaces>[number]
