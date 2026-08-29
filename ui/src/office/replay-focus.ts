import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'

export type OfficeReplayChannel = 'all' | 'agent' | 'inbox' | 'news'

export interface OfficeReplayFocus {
  seq: number
  targetIds: readonly string[]
  workspaceId?: string
  label: string
  channel: OfficeReplayChannel
}

export function officeReplayFocusForEvent(
  event: AgentRuntimeEvent,
  label: string,
  channel: OfficeReplayChannel,
): OfficeReplayFocus {
  if (event.type === 'inbox.received') {
    return { seq: event.seq, targetIds: ['inbox-service'], label, channel }
  }
  if (event.type === 'news.ingested') {
    return { seq: event.seq, targetIds: ['news-service'], label, channel }
  }
  const workspaceId = event.payload.workspaceId
  const resumeId = event.payload.resumeId
  if (workspaceId && resumeId) {
    return {
      seq: event.seq,
      workspaceId,
      targetIds: [
        `employee:${workspaceId}:${resumeId}`,
        `roster:${workspaceId}`,
        `sign:${workspaceId}`,
      ],
      label,
      channel,
    }
  }
  if (workspaceId) {
    return {
      seq: event.seq,
      workspaceId,
      targetIds: [`sign:${workspaceId}`],
      label,
      channel,
    }
  }
  return { seq: event.seq, targetIds: ['operations'], label, channel }
}
