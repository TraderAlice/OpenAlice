import { useEffect, useRef } from 'react'

interface UseSSEOptions {
  url: string
  onMessage: (data: any) => void
  onStatus?: (connected: boolean) => void
  enabled?: boolean
}

/**
 * SSE hook with automatic reconnection and exponential backoff.
 * Callbacks are ref-stable — changing them won't tear down the connection.
 */
export function useSSE({ url, onMessage, onStatus, enabled = true }: UseSSEOptions) {
  const onMessageRef = useRef(onMessage)
  const onStatusRef = useRef(onStatus)
  onMessageRef.current = onMessage
  onStatusRef.current = onStatus

  useEffect(() => {
    if (!enabled) return

    let es: EventSource | null = null
    let timer: ReturnType<typeof setTimeout>
    let backoff = 1000
    let disposed = false

    const connect = () => {
      if (disposed) return
      es = new EventSource(url)

      es.onopen = () => {
        backoff = 1000
        onStatusRef.current?.(true)
      }

      es.onmessage = (event) => {
        try {
          onMessageRef.current(JSON.parse(event.data))
        } catch { /* ignore parse errors */ }
      }

      es.onerror = () => {
        onStatusRef.current?.(false)
        es?.close()
        es = null
        if (!disposed) {
          timer = setTimeout(connect, backoff)
          backoff = Math.min(backoff * 2, 30_000)
        }
      }
    }

    connect()

    return () => {
      disposed = true
      clearTimeout(timer)
      es?.close()
      onStatusRef.current?.(false)
    }
  }, [url, enabled])
}
