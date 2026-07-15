import { useCallback, useEffect, useState } from 'react'

import type { InquiryRecord } from '../api/inquiries'

interface InquiryThreadOptions {
  load: () => Promise<InquiryRecord[]>
  ask: (prompt: string) => Promise<unknown>
}

/**
 * Shared transport state for object-scoped Agent follow-ups.
 *
 * Inbox and Issue intentionally render different interaction models: Inbox is
 * a reply thread, while Issue chooses a creator/owner/run target. They still
 * share durable loading, polling, dispatch, and error behavior here.
 */
export function useInquiryThread({ load, ask }: InquiryThreadOptions) {
  const [records, setRecords] = useState<InquiryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await load()
      setRecords(next)
      setError(null)
      return next
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return []
    } finally {
      setLoading(false)
    }
  }, [load])

  useEffect(() => {
    let live = true
    setLoading(true)
    void load().then((next) => {
      if (live) {
        setRecords(next)
        setError(null)
      }
    }).catch((err) => {
      if (live) setError(err instanceof Error ? err.message : String(err))
    }).finally(() => {
      if (live) setLoading(false)
    })
    return () => { live = false }
  }, [load])

  useEffect(() => {
    if (!records.some((record) => record.status === 'running')) return
    const timer = window.setInterval(() => { void refresh() }, 1500)
    return () => window.clearInterval(timer)
  }, [records, refresh])

  const submit = useCallback(async () => {
    const question = prompt.trim()
    if (!question || sending) return false
    setSending(true)
    setError(null)
    try {
      await ask(question)
      setPrompt('')
      await refresh()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setSending(false)
    }
  }, [ask, prompt, refresh, sending])

  return {
    records,
    loading,
    prompt,
    setPrompt,
    sending,
    error,
    submit,
  }
}
