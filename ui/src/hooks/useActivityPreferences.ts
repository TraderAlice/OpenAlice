import { useEffect, useRef, useState } from 'react'
import type { ActivityPreferences } from '../../../apps/desktop/src/activity-policy'
export function useActivityPreferences() {
  const bridge = window.openAlice?.companion?.activity
  const [settings, setSettings] = useState<ActivityPreferences | null>(null)
  const [loading, setLoading] = useState(!!bridge)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const busy = useRef(false)
  useEffect(() => {
    if (!bridge) return
    let active = true, changed = false
    const off = bridge.onPreferences(value => { changed = true; if (active) setSettings(value) })
    void bridge.getPreferences().then(value => { if (active && !changed) setSettings(value) })
      .catch(() => { if (active) setError(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; off() }
  }, [bridge])
  const run = async (action: () => Promise<ActivityPreferences>) => {
    if (busy.current) return
    busy.current = true; setPending(true); setError(false)
    try { setSettings(await action()) } catch { setError(true) }
    finally { busy.current = false; setPending(false) }
  }
  return { settings, loading, pending, error,
    update: (patch: Partial<ActivityPreferences>) => bridge && run(() => bridge.updatePreferences(patch)),
    reset: () => bridge && run(() => bridge.resetPreferences()),
  }
}
