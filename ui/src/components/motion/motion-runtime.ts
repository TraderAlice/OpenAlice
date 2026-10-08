import { useEffect, useState, type RefObject } from 'react'

export function useMotionActivity(ref: RefObject<HTMLElement | null>, enabled = true): boolean {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || !enabled) { setActive(false); return }
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    let visible = typeof IntersectionObserver === 'undefined'
    const update = () => setActive(visible && !document.hidden && !media?.matches)
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting)
      update()
    })
    observer?.observe(element)
    update()
    media?.addEventListener('change', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      observer?.disconnect()
      media?.removeEventListener('change', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [ref, enabled])
  return active
}
