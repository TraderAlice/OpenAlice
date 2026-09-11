import { describe, expect, it } from 'vitest'

import type { AgentRuntimeReadinessRow } from '../components/workspace/api'
import {
  agentRuntimePickerStatusKey,
  agentRuntimeSettingsStatusKey,
  classifyAgentRuntimeReadiness,
} from './agentRuntimeReadiness'

function row(status: AgentRuntimeReadinessRow['status']): Pick<AgentRuntimeReadinessRow, 'status'> {
  return { status }
}

describe('agent runtime readiness presentation', () => {
  it('classifies a missing row as unknown', () => {
    expect(classifyAgentRuntimeReadiness(null)).toBe('unknown')
    expect(classifyAgentRuntimeReadiness(undefined)).toBe('unknown')
  })

  it('hides unknown and ready in the picker while Settings still names them', () => {
    expect(agentRuntimePickerStatusKey(row('unknown'))).toBeNull()
    expect(agentRuntimePickerStatusKey(row('ready'))).toBeNull()
    expect(agentRuntimePickerStatusKey(null)).toBeNull()
    expect(agentRuntimeSettingsStatusKey(row('unknown'))).toBe('settings.agentRuntimes.status.unknown')
    expect(agentRuntimeSettingsStatusKey(row('ready'))).toBe('settings.agentRuntimes.status.ready')
    expect(agentRuntimeSettingsStatusKey(null)).toBe('settings.agentRuntimes.status.unknown')
  })

  it('maps checking and confirmed non-ready results to specific keys on both surfaces', () => {
    expect(agentRuntimePickerStatusKey(row('checking'))).toBe('chatLanding.pickerRuntimeChecking')
    expect(agentRuntimePickerStatusKey(row('auth_required'))).toBe('chatLanding.pickerRuntimeAuthRequired')
    expect(agentRuntimePickerStatusKey(row('provider_required'))).toBe('chatLanding.pickerRuntimeProviderRequired')
    expect(agentRuntimePickerStatusKey(row('timeout'))).toBe('chatLanding.pickerRuntimeTimeout')
    expect(agentRuntimePickerStatusKey(row('output_unrecognized'))).toBe('chatLanding.pickerRuntimeUnrecognized')
    expect(agentRuntimePickerStatusKey(row('failed'))).toBe('chatLanding.pickerRuntimeFailed')
    expect(agentRuntimePickerStatusKey(row('not_installed'))).toBe('chatLanding.pickerRuntimeNotInstalled')

    expect(agentRuntimeSettingsStatusKey(row('checking'))).toBe('settings.agentRuntimes.status.checking')
    expect(agentRuntimeSettingsStatusKey(row('auth_required'))).toBe('settings.agentRuntimes.status.authRequired')
    expect(agentRuntimeSettingsStatusKey(row('provider_required'))).toBe('settings.agentRuntimes.status.providerRequired')
    expect(agentRuntimeSettingsStatusKey(row('timeout'))).toBe('settings.agentRuntimes.status.timeout')
    expect(agentRuntimeSettingsStatusKey(row('output_unrecognized'))).toBe('settings.agentRuntimes.status.outputUnrecognized')
    expect(agentRuntimeSettingsStatusKey(row('failed'))).toBe('settings.agentRuntimes.status.failed')
    expect(agentRuntimeSettingsStatusKey(row('not_installed'))).toBe('settings.agentRuntimes.status.notInstalled')
  })
})
