import type { ConnectorDefinition, ConnectorHealth, PublicConnectorConfig } from '../api'

export type ConnectorRuntime = NonNullable<ConnectorHealth['service']>['adapters'][number]
export type ConnectorSetupStage =
  | 'needs_credentials'
  | 'ready_to_link'
  | 'starting'
  | 'awaiting_link'
  | 'linked'
  | 'linked_offline'
  | 'error'

export interface ConnectorSetupState {
  stage: ConnectorSetupStage
  ready: boolean
  linked: boolean
  linkCommand?: string
}

export function getConnectorSetupState(input: {
  definition: ConnectorDefinition
  adapter: PublicConnectorConfig['adapters'][string]
  serviceEnabled: boolean
  runtime?: ConnectorRuntime
}): ConnectorSetupState {
  const { definition, adapter, serviceEnabled, runtime } = input
  const ready = definition.fields
    .filter((field) => field.required && !field.learnedBy)
    .every((field) => field.kind === 'secret'
      ? adapter.configuredSecrets.includes(field.key) || hasValue(adapter.settings[field.key])
      : hasValue(adapter.settings[field.key]))
  const learnedFields = definition.fields.filter((field) => field.learnedBy)
  const linkCommand = learnedFields[0]?.learnedBy
  const linked = learnedFields.length === 0
    || learnedFields.every((field) => hasValue(adapter.settings[field.key]))
    || Boolean(runtime?.owner)
  const running = serviceEnabled && adapter.enabled

  if (!ready) return { stage: 'needs_credentials', ready, linked: false, linkCommand }
  if (linked && !running) return { stage: 'linked_offline', ready, linked, linkCommand }
  if (!linked && !running) return { stage: 'ready_to_link', ready, linked, linkCommand }
  if (runtime?.status === 'degraded' || runtime?.status === 'stopped') {
    return { stage: 'error', ready, linked, linkCommand }
  }
  if (!linked && (runtime?.status === 'awaiting_link' || runtime?.status === 'healthy')) {
    return { stage: 'awaiting_link', ready, linked, linkCommand }
  }
  if (linked && runtime?.status === 'healthy') {
    return { stage: 'linked', ready, linked, linkCommand }
  }
  return { stage: 'starting', ready, linked, linkCommand }
}

function hasValue(value: string | number | boolean | undefined): boolean {
  return typeof value === 'boolean'
    || typeof value === 'number'
    || (typeof value === 'string' && value.trim().length > 0)
}
