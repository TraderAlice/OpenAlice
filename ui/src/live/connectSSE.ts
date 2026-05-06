/**
 * Open an SSE connection with exponential-backoff auto-reconnect.
 *
 * Vanilla function (not a React hook). Used inside LiveStore subscribe
 * callbacks — keeps the SSE-specific reconnect logic separate from the
 * transport-agnostic store abstraction. A future `connectWS` would have
 * the same signature so the consumer doesn't have to care.
 *
 * Returns a cleanup function. Safe to call multiple times (idempotent —
 * subsequent calls are a no-op).
 */
export function connectSSE<T = unknown>(
  url: string,
  onMessage: (data: T) => void,
): () => void {
  let es: EventSource | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let backoff = 1000
  let disposed = false

  const open = () => {
    if (disposed) return
    es = new EventSource(url)
    es.onopen = () => {
      backoff = 1000
    }
    es.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data) as T)
      } catch {
        /* ignore malformed events */
      }
    }
    es.onerror = () => {
      es?.close()
      es = null
      if (disposed) return
      timer = setTimeout(open, backoff)
      backoff = Math.min(backoff * 2, 30_000)
    }
  }

  open()

  return () => {
    if (disposed) return
    disposed = true
    if (timer) clearTimeout(timer)
    es?.close()
    es = null
  }
}
