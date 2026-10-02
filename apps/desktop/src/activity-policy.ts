import type { AgentActivitySignal } from './activity-projection.js'
import type { NotificationInput } from './notification-queue.js'
export const EVENT_CLASSES = ['completion', 'failure', 'action', 'news', 'progress'] as const
export type EventClass = typeof EVENT_CLASSES[number]
export interface ActivityPreferences {
  version: 2
  defaultsVersion: number
  enabled: boolean
  events: Record<EventClass, boolean>
  main: boolean
  pet: boolean
  brief: boolean
  pausedUntil: number
}
export const DEFAULT_ACTIVITY_PREFERENCES: ActivityPreferences = {
  version: 2, defaultsVersion: 1, enabled: true, events: { completion: true, failure: true, action: true, news: true, progress: false },
  main: true, pet: true, brief: true, pausedUntil: 0,
}
export function eventClass(signal: Pick<AgentActivitySignal, 'kind' | 'failureKind'>): EventClass | null {
  switch (signal.kind) {
    case 'conversation-failed': return signal.failureKind === 'rejected' ? 'action' : 'failure'
    case 'sonner-test-error': return 'failure'
    case 'conversation-paused': return 'action'
    case 'conversation-completed': case 'inbox': case 'sonner-test-success': return 'completion'
    case 'news': return 'news'
    case 'conversation': case 'conversation-interrupted': case 'sonner-test-running': return 'progress'
    default: return null // Future Journal families are never announced without a reviewed mapping.
  }
}
export function allowsActivity(prefs: ActivityPreferences, signal: AgentActivitySignal, now = Date.now()): boolean {
  const kind = eventClass(signal)
  if (!kind || !prefs.enabled || prefs.pausedUntil > now) return false
  return prefs.events[kind]
}
export type ActivityContext = 'office' | 'inbox' | 'news'
export type SerializedNotification = Omit<NotificationInput, 'action' | 'duration' | 'onDismiss'> & {
  duration: number | null
  context: ActivityContext
}
export function briefNotification(input: SerializedNotification): SerializedNotification {
  const title = input.status === 'error' ? 'Work failed' : input.status === 'warning' ? 'Action needed'
    : input.context === 'news' ? 'News updated' : input.context === 'inbox' ? 'Report ready'
      : input.status === 'running' ? 'Work in progress' : input.status === 'success' ? 'Work completed' : 'Activity updated'
  // No names, raw details, article images or source labels reach the pet in brief mode.
  return { id: input.id, status: input.status, title, duration: input.duration, context: input.context,
    count: input.count, revision: input.revision }
}
