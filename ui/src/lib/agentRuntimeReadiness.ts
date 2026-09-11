import type {
  AgentRuntimeReadinessRow,
  AgentRuntimeReadinessStatus,
} from '../components/workspace/api'

export type AgentRuntimeReadinessKind = AgentRuntimeReadinessStatus

export function classifyAgentRuntimeReadiness(
  row: Pick<AgentRuntimeReadinessRow, 'status'> | null | undefined,
): AgentRuntimeReadinessKind {
  return row?.status ?? 'unknown'
}

const PICKER_STATUS_KEYS = {
  unknown: null,
  ready: null,
  checking: 'chatLanding.pickerRuntimeChecking',
  auth_required: 'chatLanding.pickerRuntimeAuthRequired',
  provider_required: 'chatLanding.pickerRuntimeProviderRequired',
  timeout: 'chatLanding.pickerRuntimeTimeout',
  output_unrecognized: 'chatLanding.pickerRuntimeUnrecognized',
  failed: 'chatLanding.pickerRuntimeFailed',
  not_installed: 'chatLanding.pickerRuntimeNotInstalled',
} as const

const SETTINGS_STATUS_KEYS = {
  unknown: 'settings.agentRuntimes.status.unknown',
  ready: 'settings.agentRuntimes.status.ready',
  checking: 'settings.agentRuntimes.status.checking',
  auth_required: 'settings.agentRuntimes.status.authRequired',
  provider_required: 'settings.agentRuntimes.status.providerRequired',
  timeout: 'settings.agentRuntimes.status.timeout',
  output_unrecognized: 'settings.agentRuntimes.status.outputUnrecognized',
  failed: 'settings.agentRuntimes.status.failed',
  not_installed: 'settings.agentRuntimes.status.notInstalled',
} as const

export type AgentRuntimePickerStatusKey = Exclude<
  (typeof PICKER_STATUS_KEYS)[AgentRuntimeReadinessKind],
  null
>
export type AgentRuntimeSettingsStatusKey =
  (typeof SETTINGS_STATUS_KEYS)[AgentRuntimeReadinessKind]

/** Picker is selection, not diagnostics: hide unknown/ready; keep checking and confirmed problems. */
export function agentRuntimePickerStatusKey(
  row: Pick<AgentRuntimeReadinessRow, 'status'> | null | undefined,
): AgentRuntimePickerStatusKey | null {
  return PICKER_STATUS_KEYS[classifyAgentRuntimeReadiness(row)]
}

/** Settings always names the probe state, including Not checked and Ready. */
export function agentRuntimeSettingsStatusKey(
  row: Pick<AgentRuntimeReadinessRow, 'status'> | null | undefined,
): AgentRuntimeSettingsStatusKey {
  return SETTINGS_STATUS_KEYS[classifyAgentRuntimeReadiness(row)]
}
