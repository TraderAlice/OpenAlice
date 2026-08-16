import { GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { SaveIndicator } from '../components/SaveIndicator'
import { Toggle } from '../components/Toggle'
import { editorGroupsFromLayout, NAV_SECTIONS } from '../components/activity-navigation'
import { PageHeader } from '../components/PageHeader'
import { SettingsScrollArea } from '../components/form'
import { Button } from '../components/ui/button'
import { useAliceProject } from '../hooks/useAliceProject'
import { useAutoSave } from '../hooks/useAutoSave'
import { useUiLayout } from '../hooks/useUiLayout'
import {
  addCustomGroup,
  createCustomGroupId,
  defaultUiLayout,
  deleteCustomGroup,
  moveGroup,
  movePage,
  renameCustomGroup,
  setPageHidden,
  type ActivityPageId,
  type UiLayout,
} from '../live/ui-layout'
import {
  adjustInsertIndex,
  insertIndexFromY,
  layoutRect,
  prefersReducedMotion,
  resolveItemInsert,
  type ItemGroupSlot,
  type SortRect,
} from './activity-bar-sort'

const DRAG_THRESHOLD_PX = 4

type DragSession =
  | {
      kind: 'item'
      page: ActivityPageId
      pointerId: number
      offsetX: number
      offsetY: number
      width: number
      height: number
    }
  | {
      kind: 'group'
      id: string
      pointerId: number
      offsetX: number
      offsetY: number
      width: number
      height: number
    }

type PendingDrag = {
  pointerId: number
  startX: number
  startY: number
  session: DragSession
}

function orderKey(layout: UiLayout): string {
  return layout.groups.map((group) => `${group.id}:${group.items.join(',')}`).join('|')
}

function measureItemGroups(root: HTMLElement): ItemGroupSlot[] {
  return [...root.querySelectorAll<HTMLElement>('[data-nav-group-card]')].map((card) => {
    const rect = layoutRect(card)
    return {
      id: card.dataset.navGroupCard ?? '',
      top: rect.top,
      bottom: rect.bottom,
      items: [...card.querySelectorAll<HTMLElement>('[data-nav-item]')].map((node) => {
        const itemRect = layoutRect(node)
        return { id: node.dataset.navItem ?? '', top: itemRect.top, bottom: itemRect.bottom }
      }),
    }
  })
}

function measureGroupRects(root: HTMLElement): SortRect[] {
  return [...root.querySelectorAll<HTMLElement>('[data-nav-group-card]')].map((card) => {
    const rect = layoutRect(card)
    return { id: card.dataset.navGroupCard ?? '', top: rect.top, bottom: rect.bottom }
  })
}

function placeOverlay(
  node: HTMLDivElement | null,
  session: DragSession | null,
  x: number,
  y: number,
): void {
  if (!node || !session) return
  node.style.transform = `translate(${x - session.offsetX}px, ${y - session.offsetY}px)`
}

export function ActivityBarSettingsPage() {
  const { t } = useTranslation()
  const { project } = useAliceProject()
  const { layout, save, reset, loading, error } = useUiLayout()
  const [draft, setDraft] = useState<UiLayout>(layout)
  const [dirty, setDirty] = useState(false)
  const [active, setActive] = useState<DragSession | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef(draft)
  const dragRef = useRef<DragSession | null>(null)
  const pendingRef = useRef<PendingDrag | null>(null)
  const lastSlotRef = useRef<string | null>(null)
  const startKeyRef = useRef<string | null>(null)
  const pointerRef = useRef({ x: 0, y: 0 })
  const slotsRef = useRef<ItemGroupSlot[]>([])
  const groupRectsRef = useRef<SortRect[]>([])
  const previousTops = useRef(new Map<string, number>())

  useEffect(() => {
    if (dragRef.current) return
    setDraft(layout)
    setDirty(false)
  }, [layout])

  const { status, retry } = useAutoSave({
    data: draft,
    save: async (next) => {
      await save(next)
      setDirty(false)
    },
    enabled: dirty && !active && !loading,
    // `enabled` becomes true only after an edit, so the first enabled cycle is
    // already user intent rather than initial hydration.
    skipInitialSave: false,
  })

  const update = (next: UiLayout) => {
    draftRef.current = next
    setDraft(next)
    if (!dragRef.current) setDirty(true)
  }

  if (!dragRef.current) draftRef.current = draft
  const groups = editorGroupsFromLayout(NAV_SECTIONS, draft, { product: project?.product })
  const currentOrder = orderKey(draft)
  const activeId = active?.kind === 'item' ? active.page : active?.id ?? null

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const nodes = [...root.querySelectorAll<HTMLElement>('[data-flip-id]')]
    for (const node of nodes) {
      if (typeof node.getAnimations === 'function') {
        for (const animation of node.getAnimations()) animation.cancel()
      }
    }
    slotsRef.current = measureItemGroups(root)
    groupRectsRef.current = measureGroupRects(root)
    const nextTops = new Map<string, number>()
    for (const node of nodes) {
      const id = node.dataset.flipId
      if (!id) continue
      nextTops.set(id, layoutRect(node).top)
    }
    if (activeId && !prefersReducedMotion()) {
      for (const node of nodes) {
        const id = node.dataset.flipId
        if (!id || id === activeId || id === `item:${activeId}` || id === `group:${activeId}`) continue
        const first = previousTops.current.get(id)
        const last = nextTops.get(id)
        if (first == null || last == null) continue
        const dy = first - last
        if (Math.abs(dy) < 1 || typeof node.animate !== 'function') continue
        node.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
          { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        )
      }
    }
    previousTops.current = nextTops
    placeOverlay(overlayRef.current, dragRef.current, pointerRef.current.x, pointerRef.current.y)
  }, [currentOrder, activeId])

  const applyItemHover = (clientY: number) => {
    const session = dragRef.current
    if (!session || session.kind !== 'item') return
    const sourceGroup = draftRef.current.groups.find((group) => group.items.includes(session.page))
    const hit = resolveItemInsert(slotsRef.current, clientY, {
      sourceGroupId: sourceGroup?.id,
      crossGroupInset: 20,
    })
    if (!hit) return
    const sourceIndex = sourceGroup?.items.indexOf(session.page) ?? -1
    const index = adjustInsertIndex(sourceIndex, hit.destIndex, sourceGroup?.id === hit.groupId)
    const slot = `${hit.groupId}:${index}`
    if (lastSlotRef.current === slot) return
    if (sourceGroup?.id === hit.groupId && index === sourceIndex) {
      lastSlotRef.current = slot
      return
    }
    lastSlotRef.current = slot
    update(movePage(draftRef.current, session.page, hit.groupId, index))
  }

  const applyGroupHover = (clientY: number) => {
    const session = dragRef.current
    if (!session || session.kind !== 'group') return
    const destIndex = insertIndexFromY(groupRectsRef.current, clientY)
    const sourceIndex = draftRef.current.groups.findIndex((group) => group.id === session.id)
    const index = adjustInsertIndex(sourceIndex, destIndex, true)
    const slot = `group:${index}`
    if (lastSlotRef.current === slot || index === sourceIndex) {
      lastSlotRef.current = slot
      return
    }
    lastSlotRef.current = slot
    update(moveGroup(draftRef.current, session.id, index))
  }

  const endDrag = () => {
    const changed = startKeyRef.current != null && startKeyRef.current !== orderKey(draftRef.current)
    pendingRef.current = null
    lastSlotRef.current = null
    startKeyRef.current = null
    dragRef.current = null
    setActive(null)
    document.body.style.removeProperty('cursor')
    document.body.classList.remove('select-none')
    if (changed) setDirty(true)
  }

  const onPointerMove = (event: PointerEvent) => {
    const pending = pendingRef.current
    if (pending && event.pointerId === pending.pointerId) {
      const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY)
      if (distance >= DRAG_THRESHOLD_PX) {
        pendingRef.current = null
        dragRef.current = pending.session
        lastSlotRef.current = null
        startKeyRef.current = orderKey(draftRef.current)
        pointerRef.current = { x: event.clientX, y: event.clientY }
        setActive(pending.session)
        document.body.style.cursor = 'grabbing'
        document.body.classList.add('select-none')
        if (rootRef.current) {
          slotsRef.current = measureItemGroups(rootRef.current)
          groupRectsRef.current = measureGroupRects(rootRef.current)
        }
      }
    }
    const session = dragRef.current
    if (!session || event.pointerId !== session.pointerId) return
    event.preventDefault()
    pointerRef.current = { x: event.clientX, y: event.clientY }
    placeOverlay(overlayRef.current, session, event.clientX, event.clientY)
    if (scrollSettingsIfNeeded(event.clientY) && rootRef.current) {
      slotsRef.current = measureItemGroups(rootRef.current)
      groupRectsRef.current = measureGroupRects(rootRef.current)
    }
    if (session.kind === 'item') applyItemHover(event.clientY)
    else applyGroupHover(event.clientY)
  }

  const onPointerUp = (event: PointerEvent) => {
    if (pendingRef.current?.pointerId === event.pointerId || dragRef.current?.pointerId === event.pointerId) {
      endDrag()
    }
  }

  const onPointerMoveRef = useRef(onPointerMove)
  const onPointerUpRef = useRef(onPointerUp)
  onPointerMoveRef.current = onPointerMove
  onPointerUpRef.current = onPointerUp

  useEffect(() => {
    const move = (event: PointerEvent) => onPointerMoveRef.current(event)
    const up = (event: PointerEvent) => onPointerUpRef.current(event)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.style.removeProperty('cursor')
      document.body.classList.remove('select-none')
    }
  }, [])

  const beginPending = (
    event: ReactPointerEvent<HTMLButtonElement>,
    session: DragSession,
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    pendingRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      session,
    }
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Pointer capture requires a browser-owned pointer. Synthetic events
      // and already-released ids must not abort the drag session.
    }
  }

  const overlay = active && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={overlayRef}
          className="oa-sortable-overlay rounded-md px-3 py-1.5"
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            width: active.width,
            minHeight: active.height,
            transform: `translate(${pointerRef.current.x - active.offsetX}px, ${pointerRef.current.y - active.offsetY}px)`,
          }}
        >
          {active.kind === 'item' ? (
            <OverlayItem page={active.page} groups={groups} />
          ) : (
            <OverlayGroup id={active.id} groups={groups} />
          )}
        </div>,
        document.body,
      )
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={t('settings.activityBar.title')}
        description={t('settings.activityBar.description')}
        right={<SaveIndicator status={status} onRetry={retry} />}
      />
      <SettingsScrollArea className="px-4 py-6 md:px-8">
        <div ref={rootRef} className="mx-auto flex w-full max-w-[880px] flex-col gap-4">
          {error && (
            <p className="text-[13px] text-destructive">{t('settings.activityBar.loadError')}</p>
          )}
          {groups.map((group) => (
            <section
              key={group.id}
              data-nav-group-card={group.id}
              data-flip-id={`group:${group.id}`}
              className={`rounded-xl border border-border/60 bg-secondary/40 ${
                active?.kind === 'group' && active.id === group.id ? 'oa-sortable-placeholder' : ''
              }`}
            >
              <div data-nav-group-header className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
                <button
                  type="button"
                  className="oa-icon-action flex size-8 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  onPointerDown={(event) => {
                    const header = event.currentTarget.closest<HTMLElement>('[data-nav-group-header]')
                    const rect = header?.getBoundingClientRect()
                    if (!rect) return
                    beginPending(event, {
                      kind: 'group',
                      id: group.id,
                      pointerId: event.pointerId,
                      offsetX: event.clientX - rect.left,
                      offsetY: event.clientY - rect.top,
                      width: rect.width,
                      height: rect.height,
                    })
                  }}
                  aria-label={t('settings.activityBar.dragGroup')}
                >
                  <GripVertical size={14} strokeWidth={1.75} aria-hidden />
                </button>
                {group.builtin ? (
                  <h3 className="min-w-0 flex-1 text-[12px] font-semibold text-muted-foreground">
                    {group.labelKey ? t(group.labelKey) : t('settings.activityBar.primaryGroup')}
                  </h3>
                ) : (
                  <input
                    value={group.label ?? ''}
                    maxLength={40}
                    aria-label={t('settings.activityBar.renameGroup')}
                    onChange={(event) => {
                      const value = event.target.value
                      if (!value.trim()) return
                      update(renameCustomGroup(draft, group.id, value))
                    }}
                    className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-foreground outline-none"
                  />
                )}
                {!group.builtin && (
                  <button
                    type="button"
                    className="oa-icon-action flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-destructive"
                    onClick={() => update(deleteCustomGroup(draft, group.id))}
                    aria-label={t('settings.activityBar.deleteGroup')}
                  >
                    <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                  </button>
                )}
              </div>
              <div data-nav-item-list className="flex flex-col py-1">
                {group.items.map((item) => {
                  const label = t(item.leaf.labelKey)
                  const Icon = item.leaf.icon
                  const lifting = active?.kind === 'item' && active.page === item.page
                  return (
                    <div
                      key={item.page}
                      data-nav-item={item.page}
                      data-flip-id={`item:${item.page}`}
                      className={`flex items-center gap-2 px-3 py-1.5 ${item.hidden ? 'opacity-50' : ''} ${
                        lifting ? 'oa-sortable-placeholder' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="oa-icon-action flex size-8 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                        onPointerDown={(event) => {
                          event.stopPropagation()
                          const row = event.currentTarget.closest<HTMLElement>('[data-nav-item]')
                          const rect = row?.getBoundingClientRect()
                          if (!rect) return
                          beginPending(event, {
                            kind: 'item',
                            page: item.page,
                            pointerId: event.pointerId,
                            offsetX: event.clientX - rect.left,
                            offsetY: event.clientY - rect.top,
                            width: rect.width,
                            height: rect.height,
                          })
                        }}
                        aria-label={t('settings.activityBar.dragItem', { label })}
                      >
                        <GripVertical size={14} strokeWidth={1.75} aria-hidden />
                      </button>
                      <Icon size={14} strokeWidth={1.75} className="text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{label}</span>
                      {item.pinned ? (
                        <span className="text-[11px] text-muted-foreground">{t('settings.activityBar.pinned')}</span>
                      ) : (
                        <Toggle
                          size="sm"
                          checked={!item.hidden}
                          ariaLabel={t(item.hidden ? 'settings.activityBar.show' : 'settings.activityBar.hide', { label })}
                          onChange={(visible) => update(setPageHidden(draft, item.page, !visible))}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => update(addCustomGroup(
                  draft,
                  createCustomGroupId(),
                  t('settings.activityBar.newGroup'),
                ))}
              >
                <Plus data-icon="inline-start" />
                {t('settings.activityBar.addGroup')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (window.confirm(t('settings.activityBar.resetConfirm'))) {
                    void reset()
                    setDraft(defaultUiLayout())
                    setDirty(false)
                  }
                }}
              >
                <RotateCcw data-icon="inline-start" />
                {t('settings.activityBar.reset')}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">{t('settings.activityBar.path')}</p>
          </div>
        </div>
      </SettingsScrollArea>
      {overlay}
    </div>
  )
}

function scrollSettingsIfNeeded(clientY: number): boolean {
  const scroller = document.querySelector<HTMLElement>('[data-settings-scroll-area]')
  if (!scroller) return false
  const rect = scroller.getBoundingClientRect()
  const before = scroller.scrollTop
  if (clientY < rect.top + 48) scroller.scrollTop -= 16
  else if (clientY > rect.bottom - 48) scroller.scrollTop += 16
  return scroller.scrollTop !== before
}

function OverlayItem({
  page,
  groups,
}: {
  page: ActivityPageId
  groups: ReturnType<typeof editorGroupsFromLayout>
}): ReactNode {
  const { t } = useTranslation()
  const item = groups.flatMap((group) => group.items).find((entry) => entry.page === page)
  if (!item) return null
  const Icon = item.leaf.icon
  return (
    <div className="flex items-center gap-2">
      <GripVertical size={14} strokeWidth={1.75} className="text-muted-foreground" aria-hidden />
      <Icon size={14} strokeWidth={1.75} className="text-muted-foreground" aria-hidden />
      <span className="truncate text-[13px] text-foreground">{t(item.leaf.labelKey)}</span>
    </div>
  )
}

function OverlayGroup({
  id,
  groups,
}: {
  id: string
  groups: ReturnType<typeof editorGroupsFromLayout>
}): ReactNode {
  const { t } = useTranslation()
  const group = groups.find((entry) => entry.id === id)
  if (!group) return null
  return (
    <div className="flex items-center gap-2 py-1">
      <GripVertical size={14} strokeWidth={1.75} className="text-muted-foreground" aria-hidden />
      <span className="text-[12px] font-semibold text-foreground">
        {group.labelKey ? t(group.labelKey) : group.label ?? t('settings.activityBar.primaryGroup')}
      </span>
    </div>
  )
}
