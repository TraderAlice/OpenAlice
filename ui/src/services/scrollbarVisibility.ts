const ACTIVE_ATTRIBUTE = 'data-scrollbar-active'
const FALLBACK_HIDE_DELAY_MS = 650

function scrollOwner(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target
  if (target === document && document.scrollingElement instanceof HTMLElement) {
    return document.scrollingElement
  }
  return null
}

/** Reveals a thumb during active scrolling and clears it after settlement. */
export function installScrollbarVisibilityController(): () => void {
  const activeOwners = new Set<HTMLElement>()
  const hideTimers = new Map<HTMLElement, number>()

  const clearOwner = (owner: HTMLElement) => {
    owner.removeAttribute(ACTIVE_ATTRIBUTE)
    activeOwners.delete(owner)
    const timer = hideTimers.get(owner)
    if (timer !== undefined) window.clearTimeout(timer)
    hideTimers.delete(owner)
  }

  const show = (event: Event) => {
    const owner = scrollOwner(event.target)
    if (owner === null) return
    owner.setAttribute(ACTIVE_ATTRIBUTE, '')
    activeOwners.add(owner)
    const previous = hideTimers.get(owner)
    if (previous !== undefined) window.clearTimeout(previous)
    hideTimers.set(owner, window.setTimeout(() => clearOwner(owner), FALLBACK_HIDE_DELAY_MS))
  }

  const hide = (event: Event) => {
    const owner = scrollOwner(event.target)
    if (owner !== null) clearOwner(owner)
  }

  document.addEventListener('scroll', show, true)
  document.addEventListener('scrollend', hide, true)

  return () => {
    document.removeEventListener('scroll', show, true)
    document.removeEventListener('scrollend', hide, true)
    for (const owner of activeOwners) clearOwner(owner)
  }
}
