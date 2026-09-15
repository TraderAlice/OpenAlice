import { useCallback, useEffect, useRef, useState } from 'react'
import { getWorkspaceSessionDirectory, type SessionRecord } from '../components/workspace/api'
import { isHeadlessOccupying } from '../components/workspace/harness-sessions'

/** One automatic attempt per mounted route, never per polling update. */
export function useSessionActivation(options: {
  record: SessionRecord
  workspaceId?: string
  enabled: boolean
  automatic: boolean
  open(): Promise<void>
  busyMessage: string
}) {
  const latest = useRef(options)
  latest.current = options
  const attempted = useRef(false)
  const pending = useRef(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activate = useCallback(async () => {
    if (pending.current) return
    pending.current = true
    attempted.current = true
    setOpening(true)
    setError(null)
    const current = latest.current
    try {
      if (current.workspaceId) {
        const directory = await getWorkspaceSessionDirectory(current.workspaceId, current.record.resumeId)
        const entry = directory.sessions.find(row => row.resumeId === current.record.resumeId) ?? null
        if (isHeadlessOccupying(current.record, entry)) throw new Error(current.busyMessage)
      }
      await current.open()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setOpening(false)
    }
  }, [])
  useEffect(() => {
    if (options.enabled && options.automatic && !attempted.current) void activate()
  }, [options.enabled, options.automatic, activate])
  return { opening, error, activate }
}
