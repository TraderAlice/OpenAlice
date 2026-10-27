import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentActivitySignal } from '../hooks/useGlobalAgentActivity'
import { useGlobalAgentActivity } from '../hooks/useGlobalAgentActivity'
import { useActivitySessionLabel } from '../hooks/useWorkspaceData'
import { useWorkspaces } from '../contexts/workspaces-context'
import { useWorkspace } from '../tabs/store'
import { useSessionDetailsDialog } from './workspace/session-details-store'
import { useNotifications } from './Toast'

import { ActivityAnnouncements } from '../../../apps/desktop/src/activity-announcements'
import type { SerializedNotification } from '../../../apps/desktop/src/activity-policy'

function newsDestination(context: string): string | undefined {
  return /^news:[a-z0-9][a-z0-9-]{0,79}$/.test(context) ? context.slice(5) : undefined
}

export function ActivityToasts() {
  const { t } = useTranslation()
  const queue = useNotifications()
  const openOrFocus = useWorkspace(state => state.openOrFocus)
  const sessionLabel = useActivitySessionLabel()
  const { workspaces } = useWorkspaces()
  const { signals, loading, error } = useGlobalAgentActivity()
  const announcements = useRef(new ActivityAnnouncements())
  const desktop = window.openAlice?.companion?.activity
  useEffect(() => {
    if (!desktop) return
    // Exact safe destinations only. The desktop owns source generation and target membership.
    const unsubscribe = desktop.onDisplay((event) => {
      if (event.type === 'hide') { queue.dismiss(event.displayId); return }
      const input: SerializedNotification = event.input
      queue.publish({ ...input, group: undefined, id: event.displayId, duration: input.duration ?? Infinity,
        onDismiss: () => { void desktop.dismiss(event.displayId) },
        action: { label: t(input.context === 'inbox' ? 'activityToast.viewInbox' : input.context === 'news' || newsDestination(input.context) ? 'activityToast.viewNews' : 'activityToast.viewSession'),
          onClick: () => { void desktop.open(event.displayId) } },
      })
    })
    const offRoute = desktop.onOpen(context => {
      const eventId = newsDestination(context)
      if (eventId) openOrFocus({ kind: 'news', params: { view: 'events', eventId } })
      else if (context === 'office' || context === 'inbox' || context === 'news') openOrFocus({ kind: context, params: {} })
    })
    return () => { unsubscribe(); offRoute() }
  }, [desktop, openOrFocus, queue, t])
  useEffect(() => {
    if (desktop || loading || error) return
    announcements.current.accept(signals, queue, {
      t: (key, values) => t(key as `activityToast.${"agent"}`, values),
      agent: signal => sessionLabel(signal) ?? signal.agent ?? t('activityToast.agent'),
      action: signal => ({ label: t('activityToast.viewSession'), onClick: () => {
        const record = workspaces.find(ws => ws.id === signal.workspaceId)?.sessions.find(session =>
          signal.sessionRecordId ? session.id === signal.sessionRecordId : session.resumeId === signal.resumeId)
        if (record) useSessionDetailsDialog.getState().show(record)
        else openOrFocus({ kind: 'office', params: {} })
      } }),
      open: context => {
        const eventId = newsDestination(context)
        if (eventId) openOrFocus({ kind: 'news', params: { view: 'events', eventId } })
        else if (context === 'office' || context === 'inbox' || context === 'news') openOrFocus({ kind: context, params: {} })
      },
    })
  }, [desktop, error, loading, openOrFocus, queue, sessionLabel, signals, t, workspaces])
  return null
}
