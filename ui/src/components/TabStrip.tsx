import { useState, type MouseEvent, type WheelEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useChannels } from '../contexts/ChannelsContext'
import { useWorkspaces } from '../contexts/WorkspacesContext'
import { useWorkspace } from '../tabs/store'
import { getView } from '../tabs/registry'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'

/**
 * The strip of tab buttons above the main content area. Click to focus,
 * × or middle-click to close, right-click for context menu (close /
 * close others / close to the right / close all / copy URL).
 *
 * The strip scrolls horizontally when the row of tabs overflows, but the
 * scrollbar itself is hidden — a thick scrollbar across the full width
 * just to indicate "there's more" steals editor space and looks ugly.
 * Vertical mouse-wheel deltas are translated to horizontal scroll so a
 * regular mouse can still navigate; trackpads pass `deltaX` through
 * naturally.
 *
 * Hidden on mobile (`< md`) — mobile is single-tab mode where the strip
 * would just be noise.
 */
export function TabStrip() {
  const { t } = useTranslation()
  const { channels } = useChannels()
  const { workspaces } = useWorkspaces()
  const tabIds = useWorkspace((state) =>
    state.tree.kind === 'leaf' ? state.tree.group.tabIds : [],
  )
  const activeTabId = useWorkspace((state) =>
    state.tree.kind === 'leaf' ? state.tree.group.activeTabId : null,
  )
  const tabsMap = useWorkspace((state) => state.tabs)
  const focusTab = useWorkspace((state) => state.focusTab)
  const closeTab = useWorkspace((state) => state.closeTab)
  const closeOthers = useWorkspace((state) => state.closeOthers)
  const closeToRight = useWorkspace((state) => state.closeToRight)
  const closeToLeft = useWorkspace((state) => state.closeToLeft)
  const closeAll = useWorkspace((state) => state.closeAll)

  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)

  if (tabIds.length === 0) return null

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    // Trackpads emit horizontal deltas natively; only translate the
    // mouse-wheel case (deltaX === 0 && deltaY !== 0). Otherwise let the
    // browser handle the native horizontal scroll.
    if (e.deltaX === 0 && e.deltaY !== 0) {
      e.currentTarget.scrollLeft += e.deltaY
    }
  }

  const buildMenuItems = (tabId: string): ContextMenuItem[] => {
    const tab = tabsMap[tabId]
    if (!tab) return []
    const idx = tabIds.indexOf(tabId)
    const onlyOne = tabIds.length === 1
    const view = getView(tab.spec.kind)
    const url = view.toUrl(tab.spec as never)
    return [
      { kind: 'item', label: t('common.close'), danger: true, onClick: () => closeTab(tabId) },
      {
        kind: 'item',
        label: t('common.closeOthers'),
        disabled: onlyOne,
        onClick: () => closeOthers(tabId),
      },
      {
        kind: 'item',
        label: t('common.closeToRight'),
        disabled: idx === tabIds.length - 1,
        onClick: () => closeToRight(tabId),
      },
      {
        kind: 'item',
        label: t('common.closeToLeft'),
        disabled: idx <= 0,
        onClick: () => closeToLeft(tabId),
      },
      { kind: 'item', label: t('common.closeAll'), onClick: () => closeAll() },
      { kind: 'separator' },
      {
        kind: 'item',
        label: t('common.copyUrl'),
        onClick: () => {
          const fullUrl = window.location.origin + url
          navigator.clipboard.writeText(fullUrl).catch(() => {
            /* clipboard refusal is fine; nothing to surface here */
          })
        },
      },
    ]
  }

  return (
    <>
      <div
        onWheel={handleWheel}
        className="scrollbar-hide hidden md:flex shrink-0 h-9 bg-bg-secondary border-b border-border overflow-x-auto"
      >
        {tabIds.map((id) => {
          const tab = tabsMap[id]
          if (!tab) return null
          const view = getView(tab.spec.kind)
          const title = view.title(tab.spec as never, { channels, workspaces })
          const isActive = id === activeTabId
          return (
            <TabButton
              key={id}
              title={title}
              active={isActive}
              onSelect={() => focusTab(id)}
              onClose={() => closeTab(id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ tabId: id, x: e.clientX, y: e.clientY })
              }}
            />
          )
        })}
      </div>

      {menu && (
        <ContextMenu
          anchor={{ x: menu.x, y: menu.y }}
          items={buildMenuItems(menu.tabId)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

interface TabButtonProps {
  title: string
  active: boolean
  onSelect: () => void
  onClose: () => void
  onContextMenu: (e: MouseEvent<HTMLDivElement>) => void
}

function TabButton({ title, active, onSelect, onClose, onContextMenu }: TabButtonProps) {
  return (
    <div
      onClick={onSelect}
      onAuxClick={(e) => {
        // Middle click closes the tab (matches VS Code / browser convention).
        if (e.button === 1) {
          e.preventDefault()
          onClose()
        }
      }}
      onContextMenu={onContextMenu}
      className={`group flex items-center gap-2 pl-3 pr-2 h-full text-[13px] cursor-pointer border-r border-border transition-colors ${
        active
          ? 'bg-bg text-text'
          : 'text-text-muted hover:text-text hover:bg-bg-tertiary/40'
      }`}
    >
      <span className="truncate max-w-[200px]">{title}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        className="w-4 h-4 rounded flex items-center justify-center text-text-muted/60 hover:text-text hover:bg-bg-tertiary"
        aria-label={`Close ${title}`}
      >
        <X size={11} strokeWidth={2.5} />
      </button>
    </div>
  )
}
