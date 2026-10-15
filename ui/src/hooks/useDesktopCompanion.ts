import { useEffect, useRef, useState } from 'react'

/** Machine-local desktop visibility; no remote backend or browser substitute. */
export function useDesktopCompanion(menuOpen: boolean) {
  const bridge = window.openAlice?.companion
  const [visible, setVisible] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const busy = useRef(false)
  useEffect(() => {
    if (!bridge) return
    let active = true
    let changed = false
    const unsubscribe = bridge.onVisibility(value => {
      changed = true
      if (active) { setVisible(value); setFailed(false) }
    })
    void bridge.getVisible().then(value => {
      if (active && !changed) setVisible(value)
    }).catch(() => { if (active) setVisible(null) })
    return () => { active = false; unsubscribe() }
  }, [bridge, menuOpen])
  const toggle = async () => {
    if (!bridge || busy.current || visible === null) return
    busy.current = true
    setPending(true)
    setFailed(false)
    try { setVisible(await bridge.toggle()) }
    catch { setFailed(true) }
    finally { busy.current = false; setPending(false) }
  }
  return { visible, pending, failed, toggle }
}
