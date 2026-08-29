import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

import type { AgentActivitySignal } from '../hooks/useGlobalAgentActivity'
import { useGlobalAgentActivity } from '../hooks/useGlobalAgentActivity'

const MAX_ANNOUNCED_SIGNALS = 200

function toastId(signal: AgentActivitySignal): string {
  if (signal.kind === 'inbox' || signal.kind.startsWith('sonner-test-')) {
    return `openalice-activity:${signal.id}`
  }
  const operation = signal.taskId
    ? `task:${signal.taskId}`
    : `session:${signal.workspaceId}:${signal.resumeId ?? 'unknown'}`
  return `openalice-activity:${operation}`
}

/**
 * Projects significant Agent orchestration onto the shared notification layer.
 * This owns no history or navigation surface: Inbox, Sessions, Automation, and
 * Office remain the authoritative places for detail.
 */
export function ActivityToasts() {
  const { t } = useTranslation()
  const { signals, loading } = useGlobalAgentActivity()
  const announced = useRef(new Map<string, number>())
  const persistentSignals = useRef(new Set<string>())

  useEffect(() => {
    if (loading) return

    const nextActive = new Set(
      signals
        .filter((signal) => signal.kind === 'conversation' || signal.kind === 'sonner-test-running')
        .map(toastId),
    )
    const currentChannels = new Set(signals.map(toastId))
    for (const id of persistentSignals.current) {
      if (!currentChannels.has(id)) toast.dismiss(id)
    }

    for (const signal of signals) {
      const id = toastId(signal)
      if ((announced.current.get(id) ?? -1) >= signal.revision) continue
      announced.current.set(id, signal.revision)

      const agent = signal.agent ?? t('activityToast.agent')
      if (signal.kind === 'conversation') {
        toast.loading(t('activityToast.conversationRunning', { agent }), {
          id,
          duration: Number.POSITIVE_INFINITY,
        })
      } else if (signal.kind === 'conversation-failed') {
        toast.error(t('activityToast.conversationFailed', { agent }), {
          id,
          duration: 8_000,
        })
      } else if (signal.kind === 'inbox') {
        toast.success(t('activityToast.inboxDelivered', { agent }), {
          id,
          duration: 4_000,
        })
      } else if (signal.kind === 'sonner-test-running') {
        toast.loading(signal.detail ?? 'Sonner running test', {
          id,
          duration: Number.POSITIVE_INFINITY,
        })
      } else if (signal.kind === 'sonner-test-success') {
        toast.success(signal.detail ?? 'Sonner success test', { id, duration: 4_000 })
      } else {
        toast.error(signal.detail ?? 'Sonner error test', { id, duration: 8_000 })
      }
    }

    persistentSignals.current = nextActive
    while (announced.current.size > MAX_ANNOUNCED_SIGNALS) {
      const oldest = announced.current.keys().next().value as string | undefined
      if (!oldest) break
      announced.current.delete(oldest)
    }
  }, [loading, signals, t])

  return null
}
