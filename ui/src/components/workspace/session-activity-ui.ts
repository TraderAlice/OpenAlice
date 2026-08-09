import type { SessionRecord } from './api'
import type { SessionAgentActivityPhase } from './protocol'

export type SessionPresentationPhase = SessionAgentActivityPhase | 'paused'

export function sessionPresentationPhase(session: SessionRecord): SessionPresentationPhase {
  if (session.state === 'paused') return 'paused'
  return session.activity?.phase ?? 'unavailable'
}

export function sessionActivityLabelKey(
  phase: SessionPresentationPhase,
):
  | 'workspace.paused'
  | 'workspace.activityStarting'
  | 'workspace.activityWorking'
  | 'workspace.activityReady'
  | 'workspace.activityUnavailable'
  | 'workspace.activityFailed'
  | 'workspace.activityStopped' {
  switch (phase) {
    case 'paused': return 'workspace.paused'
    case 'starting': return 'workspace.activityStarting'
    case 'working': return 'workspace.activityWorking'
    case 'waiting': return 'workspace.activityReady'
    case 'failed': return 'workspace.activityFailed'
    case 'stopped': return 'workspace.activityStopped'
    case 'unavailable': return 'workspace.activityUnavailable'
  }
}

export function sessionActivityTone(phase: SessionPresentationPhase): string {
  switch (phase) {
    case 'working': return 'text-primary'
    case 'waiting': return 'text-success'
    case 'starting': return 'text-warning'
    case 'failed': return 'text-destructive'
    case 'stopped':
    case 'paused':
    case 'unavailable':
      return 'text-muted-foreground'
  }
}

export function sessionActivityDot(phase: SessionPresentationPhase): string {
  switch (phase) {
    case 'working': return 'bg-primary'
    case 'waiting': return 'bg-success'
    case 'starting': return 'bg-warning'
    case 'failed': return 'bg-destructive'
    case 'stopped':
    case 'paused':
    case 'unavailable':
      return 'bg-muted-foreground/45'
  }
}
