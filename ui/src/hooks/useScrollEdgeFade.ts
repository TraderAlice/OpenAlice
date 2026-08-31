import { useEffect, type RefObject } from 'react'

const EDGE_EPSILON_PX = 1

/** Marks real scroll edges so CSS can fade only the clipped side. */
export function useScrollEdgeFade<T extends HTMLElement>(ref: RefObject<T | null>): void {
  useEffect(() => {
    const node = ref.current
    if (!node) return

    const update = () => {
      const before = node.scrollTop > EDGE_EPSILON_PX
      const after = node.scrollHeight - node.clientHeight - node.scrollTop > EDGE_EPSILON_PX
      node.toggleAttribute('data-scroll-before', before)
      node.toggleAttribute('data-scroll-after', after)
    }

    const observeChildren = (observer: ResizeObserver) => {
      for (const child of node.children) observer.observe(child)
    }
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(update)
    if (resizeObserver) {
      resizeObserver.observe(node)
      observeChildren(resizeObserver)
    } else {
      window.addEventListener('resize', update)
    }
    const mutationObserver = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => {
          if (resizeObserver) observeChildren(resizeObserver)
          update()
        })
    mutationObserver?.observe(node, { childList: true, subtree: true })

    update()
    node.addEventListener('scroll', update, { passive: true })
    return () => {
      node.removeEventListener('scroll', update)
      if (resizeObserver) resizeObserver.disconnect()
      else window.removeEventListener('resize', update)
      mutationObserver?.disconnect()
    }
  }, [ref])
}
