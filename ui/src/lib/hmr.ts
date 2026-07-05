/**
 * Some UI modules own process-wide singleton state: Zustand stores,
 * long-lived polling sources, tab registries. Letting Vite partially
 * hot-swap those can split the app between old and new store instances.
 *
 * Use this in singleton modules so development falls back to a full page
 * reload for that narrow class of changes while ordinary component edits
 * keep React Fast Refresh.
 */
export function reloadOnHotUpdate(label: string): void {
  if (!import.meta.env.DEV || !import.meta.hot) return
  import.meta.hot.accept(() => {
    console.info(`[hmr] ${label} changed; reloading to keep singleton state coherent`)
    globalThis.location?.reload()
  })
}
