import type { TFunction } from 'i18next'

import type { AgentRuntimeSurface } from '../api/agentRuntimeLog'

export function officeRunModeLabel(
  surface: AgentRuntimeSurface | undefined,
  t: TFunction,
): string | null {
  if (surface === 'headless') return t('office.runModeBackground')
  if (surface === 'terminal') return t('office.runModeTerminal')
  if (surface === 'webpi') return t('office.runModeWorkspace')
  return null
}
