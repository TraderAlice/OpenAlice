import { useEffect } from 'react'
import { createStore } from 'zustand/vanilla'
import { useStore as useZustandStore } from 'zustand'

/**
 * `LiveStore` — the transport-agnostic abstraction for "real-time state
 * fed by a server-side push channel" (broker health, automation event
 * pulses, etc.).
 *
 * Key properties:
 *
 * 1. **Single connection regardless of subscriber count.** The live source
 *    `subscribe` callback is invoked once when the first React component
 *    mounts and disposed when the last one unmounts. Three components
 *    reading the same store do not open three EventSources.
 *
 * 2. **Transport-agnostic.** The `subscribe` callback decides how to open
 *    the underlying connection — SSE, WebSocket, Tauri `listen()`,
 *    Electron `ipcRenderer.on`. The hook signature on the consumer side
 *    never changes. When the desktop bundle lands, `subscribe` swaps to
 *    IPC and component code keeps working.
 *
 * 3. **Visibility-aware staleness check.** When the tab returns to
 *    `visibilitychange === 'visible'`, if no event has arrived within
 *    `staleAfterMs` (default 60s), the live source is torn down and
 *    re-opened. Catches the case where the connection died silently
 *    while backgrounded — neither SSE nor WS surface this reliably on
 *    their own.
 *
 * 4. **Sync read access** via `getState()` for non-React callers and
 *    `useStore(selector)` for React.
 */

/**
 * State updater. Function form receives current state and returns next.
 * Whole-state form replaces — no shallow merge, since live events vary
 * in granularity (some replace, some patch a single key) and the call
 * site knows which it intends.
 */
export type Apply<S> = (next: S | ((prev: S) => S)) => void

export interface LiveSourceContext<S> {
  apply: Apply<S>
}

export interface LiveStoreOptions<S> {
  /** Debug label — appears in error messages. */
  name: string
  initialState: S
  /**
   * Open the live source. Push updates via `ctx.apply()`. Return a
   * cleanup function. Called once per "first subscriber arrives" event.
   */
  subscribe: (ctx: LiveSourceContext<S>) => () => void
  /**
   * If no event arrives within this window while the tab is visible,
   * the next visibilitychange to 'visible' triggers a reconnect.
   * Default 60s.
   */
  staleAfterMs?: number
}

export interface LiveStore<S> {
  /** React hook — selector subscribes to a slice and bumps the connection refcount. */
  useStore: <T>(selector: (s: S) => T) => T
  /** Synchronous read. Does not bump refcount. */
  getState: () => S
  /**
   * Imperative subscribe (non-React). Use for plumbing into other stores
   * or tests. Bumps refcount; remember to call the returned dispose.
   */
  subscribe: (listener: (s: S) => void) => () => void
  /** Force a reconnect — used internally by visibility checks; exposed for testing. */
  reconnect: () => void
}

export function createLiveStore<S>(opts: LiveStoreOptions<S>): LiveStore<S> {
  const inner = createStore<S>(() => opts.initialState)
  const stale = opts.staleAfterMs ?? 60_000

  let refCount = 0
  let cleanup: (() => void) | null = null
  let lastEventTs = Date.now()
  let visibilityHandler: (() => void) | null = null

  const apply: Apply<S> = (next) => {
    if (typeof next === 'function') {
      inner.setState((prev) => (next as (p: S) => S)(prev), true)
    } else {
      inner.setState(next, true)
    }
    lastEventTs = Date.now()
  }

  function start() {
    if (cleanup) return
    lastEventTs = Date.now()
    cleanup = opts.subscribe({ apply })

    visibilityHandler = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastEventTs > stale) {
        // Connection might have died silently while backgrounded — take
        // the optimistic stance and reconnect. Worst case we drop a few
        // duplicate events; best case we recover from a zombie socket.
        reconnect()
      }
    }
    document.addEventListener('visibilitychange', visibilityHandler)
  }

  function stop() {
    cleanup?.()
    cleanup = null
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
      visibilityHandler = null
    }
  }

  function reconnect() {
    if (!cleanup) return
    stop()
    start()
  }

  function bumpRef(delta: 1 | -1) {
    refCount += delta
    if (refCount === 1 && delta === 1) start()
    else if (refCount === 0 && delta === -1) stop()
  }

  function useStore<T>(selector: (s: S) => T): T {
    useEffect(() => {
      bumpRef(1)
      return () => bumpRef(-1)
    }, [])
    return useZustandStore(inner, selector)
  }

  function subscribe(listener: (s: S) => void): () => void {
    bumpRef(1)
    const unsub = inner.subscribe(listener)
    return () => {
      unsub()
      bumpRef(-1)
    }
  }

  return {
    useStore,
    getState: inner.getState,
    subscribe,
    reconnect,
  }
}
