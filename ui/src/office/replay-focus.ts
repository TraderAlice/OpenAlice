import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'

export interface OfficeReplayFocus {
  seq: number
  targetIds: readonly string[]
  workspaceId?: string
  label: string
}

export function officeReplayFocusForEvent(
  event: AgentRuntimeEvent,
  label: string,
): OfficeReplayFocus {
  if (event.type === 'inbox.received') {
    return { seq: event.seq, targetIds: ['inbox-service'], label }
  }
  if (event.type === 'news.ingested') {
    return { seq: event.seq, targetIds: ['news-service'], label }
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
    }
  }
  if (workspaceId) {
    return {
      seq: event.seq,
      workspaceId,
      targetIds: [`sign:${workspaceId}`],
      label,
    }
  }
  return { seq: event.seq, targetIds: ['operations'], label }
}
