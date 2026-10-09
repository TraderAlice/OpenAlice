import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { DiscoveryStore } from '@traderalice/update-lifecycle'

/** Internal React binding only. Production exposes useUpdateLifecycle; the
 * rehearsal substitutes its reader. All request/cache state lives in core.
 * One current scope per owner bounds memory and prevents A -> B -> A revival. */
export function useDiscoverySnapshot<T>(scope: string) {
  const store = useMemo(() => new DiscoveryStore<T>(), [scope])
  const current = useRef(store)
  current.current = store
  useEffect(() => () => store.clear(), [store])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const check = useCallback(async (read: () => Promise<T>) => {
    if (current.current !== store) return null
    const value = await store.check(read)
    return current.current === store ? value : null
  }, [store])
  return { ...snapshot, check, clear: store.clear }
}
