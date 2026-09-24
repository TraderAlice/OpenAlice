import { createContext, useContext, useEffect } from 'react'

/** The active upgrade dialog explains the planned backend restart itself. */
export const BackendOutageOverlayContext = createContext<(hidden: boolean) => void>(() => undefined)

export function useHideBackendOutageOverlay(hidden: boolean): void {
  const setHidden = useContext(BackendOutageOverlayContext)
  useEffect(() => {
    if (!hidden) return
    setHidden(true)
    return () => setHidden(false)
  }, [hidden, setHidden])
}
