import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const mobileSectionLink =
  'oa-pressable inline-flex min-h-10 shrink-0 items-center rounded-md px-3 py-2 text-xs font-medium transition-colors'

type IssueSectionId =
  | 'issue-work-item'
  | 'issue-what'
  | 'issue-activity'
  | 'issue-reply'
  | 'issue-runs'
  | 'issue-inbox-reports'

function findVerticalScrollContainer(element: HTMLElement): HTMLElement | Window {
  let current = element.parentElement
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return current
    current = current.parentElement
  }
  return window
}

export function IssueSectionNavigation({
  hasRuns,
  hasInboxReports,
}: {
  hasRuns: boolean
  hasInboxReports: boolean
}) {
  const { t } = useTranslation()
  const navRef = useRef<HTMLElement>(null)
  const [activeId, setActiveId] = useState<IssueSectionId>('issue-work-item')
  const sections: readonly { id: IssueSectionId; label: string }[] = [
    { id: 'issue-work-item', label: t('issues.detail.workItem') },
    { id: 'issue-what', label: t('issues.detail.what') },
    { id: 'issue-activity', label: t('issues.detail.activity') },
    { id: 'issue-reply', label: t('issues.detail.replyNavigation') },
    ...(hasRuns ? [{ id: 'issue-runs' as const, label: t('issues.detail.runs') }] : []),
    ...(hasInboxReports
      ? [{ id: 'issue-inbox-reports' as const, label: t('issues.detail.inboxReports') }]
      : []),
  ]
  const sectionIdsKey = sections.map(({ id }) => id).join(':')

  useEffect(() => {
    const nav = navRef.current
    const firstSection = document.getElementById(sections[0].id)
    if (!nav || !firstSection) return

    const scrollContainer = findVerticalScrollContainer(firstSection)
    let frame = 0
    const updateActiveSection = () => {
      frame = 0
      const threshold = nav.getBoundingClientRect().bottom + 32
      let nextId: IssueSectionId = sections[0].id
      let foundRenderedSection = false
      const atBottom = scrollContainer instanceof HTMLElement
        ? scrollContainer.scrollHeight > scrollContainer.clientHeight + 1
          && scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight <= 2
        : document.documentElement.scrollHeight > window.innerHeight + 1
          && document.documentElement.scrollHeight - window.scrollY - window.innerHeight <= 2
      for (const { id } of sections) {
        const section = document.getElementById(id)
        if (!section) continue
        const rect = section.getBoundingClientRect()
        // JSDOM and prerendered hidden surfaces expose zero-size rectangles.
        if (rect.width === 0 && rect.height === 0) continue
        foundRenderedSection = true
        if (rect.top <= threshold) nextId = id
      }
      if (atBottom) {
        const lastRenderedSection = [...sections].reverse().find(({ id }) => {
          const section = document.getElementById(id)
          if (!section) return false
          const rect = section.getBoundingClientRect()
          return rect.width > 0 || rect.height > 0
        })
        if (lastRenderedSection) nextId = lastRenderedSection.id
      }
      if (foundRenderedSection) setActiveId(nextId)
    }
    const scheduleUpdate = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateActiveSection)
    }

    scrollContainer.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    updateActiveSection()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      scrollContainer.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [sectionIdsKey])

  useEffect(() => {
    const nav = navRef.current
    const activeLink = nav?.querySelector<HTMLAnchorElement>(`a[href="#${activeId}"]`)
    if (!nav || !activeLink) return
    const navRect = nav.getBoundingClientRect()
    const linkRect = activeLink.getBoundingClientRect()
    if (linkRect.left >= navRect.left && linkRect.right <= navRect.right) return
    const centeredLeft = activeLink.offsetLeft - (nav.clientWidth - activeLink.clientWidth) / 2
    nav.scrollTo({ left: Math.max(0, centeredLeft), behavior: 'auto' })
  }, [activeId])

  return (
    <nav
      ref={navRef}
      aria-label={t('issues.detail.sectionNavigation')}
      className="scrollbar-hide sticky top-0 z-20 -mx-4 mt-3 flex flex-nowrap gap-1 overflow-x-auto overscroll-x-contain border-y border-border/60 bg-background/95 px-4 py-1.5 shadow-sm backdrop-blur md:-mx-6 md:px-6 lg:hidden"
    >
      {sections.map(({ id, label }) => {
        const active = activeId === id
        return (
          <a
            key={id}
            href={`#${id}`}
            aria-current={active ? 'location' : undefined}
            onClick={(event) => {
              if (
                event.button !== 0
                || event.metaKey
                || event.ctrlKey
                || event.shiftKey
                || event.altKey
              ) return
              const target = document.getElementById(id)
              if (!target) return
              event.preventDefault()
              setActiveId(id)
              window.history.replaceState(window.history.state, '', `#${id}`)
              target.scrollIntoView({ block: 'start' })
            }}
            className={`${mobileSectionLink} ${
              active
                ? 'bg-primary-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {label}
          </a>
        )
      })}
    </nav>
  )
}
