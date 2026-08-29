import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'

export type OfficeReplayChannel = 'all' | 'agent' | 'inbox' | 'news'

export interface OfficeReplayFocus {
  seq: number
  targetIds: readonly string[]
  workspaceId?: string
  resumeId?: string
  label: string
  summary: string
  channel: OfficeReplayChannel
}

export function officeReplayFocusForEvent(
  event: AgentRuntimeEvent,
  label: string,
  summary: string,
  channel: OfficeReplayChannel,
): OfficeReplayFocus {
  if (event.type === 'inbox.received') {
    return { seq: event.seq, targetIds: ['inbox-service'], label, summary, channel }
  }
  if (event.type === 'news.ingested') {
    return { seq: event.seq, targetIds: ['news-service'], label, summary, channel }
  }
  const workspaceId = event.payload.workspaceId
  const resumeId = event.payload.resumeId
  if (workspaceId && resumeId) {
    return {
      seq: event.seq,
      workspaceId,
      resumeId,
      targetIds: [
        `employee:${workspaceId}:${resumeId}`,
        `roster:${workspaceId}`,
        `sign:${workspaceId}`,
      ],
      label,
      summary,
      channel,
    }
  }
  if (workspaceId) {
    return {
      seq: event.seq,
      workspaceId,
      targetIds: [`sign:${workspaceId}`],
      label,
      summary,
      channel,
    }
  }
  return { seq: event.seq, targetIds: ['operations'], label, summary, channel }
}
