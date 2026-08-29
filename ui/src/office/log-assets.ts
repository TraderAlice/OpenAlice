import type { AgentRuntimeEventType } from '../api/agentRuntimeLog'

/** Generated pixel-art category badges for the Office operations journal. */
export const OFFICE_LOG_ASSETS = {
  lifecycle: '/office/log/lifecycle-v1.png',
  message: '/office/log/message-v1.png',
  tool: '/office/log/tool-action-v1.png',
  alert: '/office/log/alert-v1.png',
} as const

export type OfficeLogAssetKind = keyof typeof OFFICE_LOG_ASSETS

export function officeLogAssetKind(type: AgentRuntimeEventType): OfficeLogAssetKind {
  if (type === 'runtime.turn.text') return 'message'
  if (type === 'runtime.turn.tool') return 'tool'
  if (type === 'runtime.spawn_failed' || type === 'runtime.rejected' || type === 'runtime.turn.error') {
    return 'alert'
  }
  return 'lifecycle'
}
