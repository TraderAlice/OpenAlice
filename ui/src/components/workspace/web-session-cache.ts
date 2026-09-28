import type { WebSessionSnapshot } from './api'

const cache = new Map<string, WebSessionSnapshot>()
const MAX_ENTRIES = 3

function key(wsId: string, sessionId: string): string {
  return `${wsId}\0${sessionId}`
}

/** Last-known web snapshots so a remount can paint before the next poll. */
export function readWebSessionCache(wsId: string, sessionId: string): WebSessionSnapshot | null {
  return cache.get(key(wsId, sessionId)) ?? null
}

export function writeWebSessionCache(
  wsId: string,
  sessionId: string,
  snapshot: WebSessionSnapshot,
): void {
  const id = key(wsId, sessionId)
  if (cache.has(id)) cache.delete(id)
  cache.set(id, snapshot)
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function clearWebSessionCache(
  wsId?: string,
  sessionId?: string,
): void {
  if (wsId === undefined || sessionId === undefined) {
    cache.clear()
    return
  }
  cache.delete(key(wsId, sessionId))
}
