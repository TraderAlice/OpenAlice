import {
  BarChart3,
  Building2,
  Code2,
  Inbox,
  LineChart,
  ListChecks,
  MessageSquare,
  Microscope,
  Binary,
  Plug,
  Settings,
  Telescope,
  TerminalSquare,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import type { Page } from '../App'
import { isNanoHiddenActivityPage, isNanoProduct } from '../lib/product-surfaces'
import type { ViewSpec } from '../tabs/types'
import {
  isBuiltinGroupId,
  normalizeUiLayout,
  PINNED_ACTIVITY_PAGE,
  type ActivityPageId,
  type UiLayout,
} from '../live/ui-layout'

type NavItemKey =
  | 'nav.item.inbox' | 'nav.item.tracked' | 'nav.item.chat' | 'nav.item.autoQuant' | 'nav.item.autoPrediction' | 'nav.item.workspaces'
  | 'nav.item.market' | 'nav.item.office' | 'nav.item.issue'
  | 'nav.item.trading' | 'nav.item.connectors' | 'nav.item.automation' | 'nav.item.settings' | 'nav.item.dev'

interface NavLeaf {
  page: Page
  labelKey: NavItemKey
  icon: LucideIcon
  /** Concrete landing surface opened by this Activity Bar item. */
  defaultTab: ViewSpec
}

export interface NavSection {
  /** Stable group id used by the layout JSON and collapse store. */
  id: string
  /** Empty string identifies the unlabeled, always-visible primary section. */
  sectionLabel: string
  labelKey?: 'nav.section.beta' | 'nav.section.system'
  items: NavLeaf[]
  defaultCollapsed?: boolean
  descriptionKey?: 'nav.betaDescription'
}

export interface EditorNavItem {
  page: ActivityPageId
  hidden: boolean
  pinned: boolean
  leaf: NavLeaf
}

export interface EditorNavGroup {
  id: string
  builtin: boolean
  label?: string
  labelKey?: NavSection['labelKey']
  items: EditorNavItem[]
}

export function filterNavSections(
  sections: readonly NavSection[],
  flags: { office: boolean },
): NavSection[] {
  return sections.flatMap((section) => {
    const items = section.items.filter((item) => item.page !== 'office' || flags.office)
    return items.length === 0 ? [] : [{ ...section, items }]
  })
}

export const NAV_SECTIONS: NavSection[] = [
  // Ask Alice is the product front door. Workspaces is deliberately absent:
  // it is the engineering container/debug surface beneath conversations.
  {
    id: 'primary',
    sectionLabel: '',
    items: [
      { page: 'chat',       labelKey: 'nav.item.chat',       icon: MessageSquare, defaultTab: { kind: 'chat-landing', params: {} } },
      { page: 'inbox',      labelKey: 'nav.item.inbox',      icon: Inbox, defaultTab: { kind: 'inbox', params: {} } },
      { page: 'issue',      labelKey: 'nav.item.issue',      icon: ListChecks, defaultTab: { kind: 'issue', params: {} } },
      { page: 'auto-quant', labelKey: 'nav.item.autoQuant',  icon: Microscope, defaultTab: { kind: 'auto-quant-landing', params: {} } },
      { page: 'tracked',    labelKey: 'nav.item.tracked',    icon: Telescope, defaultTab: { kind: 'tracked', params: {} } },
      // News is a Market navigator leaf, not a rail item.
      { page: 'market',     labelKey: 'nav.item.market',     icon: BarChart3, defaultTab: { kind: 'market-list', params: {} } },
    ],
  },
  {
    id: 'beta',
    sectionLabel: 'Beta',
    labelKey: 'nav.section.beta',
    descriptionKey: 'nav.betaDescription',
    items: [
      { page: 'prediction', labelKey: 'nav.item.autoPrediction', icon: Binary, defaultTab: { kind: 'auto-prediction-landing', params: {} } },
      { page: 'office',     labelKey: 'nav.item.office',     icon: Building2, defaultTab: { kind: 'office', params: {} } },
      // Trading as Git and broker accounts are Trading navigator leaves, not rail items.
      { page: 'portfolio',  labelKey: 'nav.item.trading',    icon: LineChart, defaultTab: { kind: 'portfolio', params: {} } },
      { page: 'connectors', labelKey: 'nav.item.connectors', icon: Plug, defaultTab: { kind: 'connectors', params: {} } },
    ],
  },
  {
    id: 'system',
    sectionLabel: 'System',
    labelKey: 'nav.section.system',
    items: [
      // Workspace management remains available for project/container control
      // and provenance debugging; conversation continuation belongs to Chat.
      { page: 'workspaces', labelKey: 'nav.item.workspaces', icon: TerminalSquare, defaultTab: { kind: 'workspace-list', params: {} } },
      { page: 'automation', labelKey: 'nav.item.automation', icon: Zap, defaultTab: { kind: 'automation', params: { section: 'runs' } } },
      { page: 'settings',   labelKey: 'nav.item.settings',   icon: Settings, defaultTab: { kind: 'settings', params: { category: 'general' } } },
      { page: 'dev',        labelKey: 'nav.item.dev',        icon: Code2, defaultTab: { kind: 'dev', params: { tab: 'tools' } } },
    ],
  },
]

export function navSectionsForProduct(product?: string | null): NavSection[] {
  if (!isNanoProduct(product)) return NAV_SECTIONS
  return NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !isNanoHiddenActivityPage(item.page)),
    }))
    .filter((section) => section.items.length > 0)
}

function catalogByPage(catalog: readonly NavSection[]): Map<Page, NavLeaf> {
  const index = new Map<Page, NavLeaf>()
  for (const section of catalog) {
    for (const leaf of section.items) {
      index.set(leaf.page, leaf)
    }
  }
  return index
}

function pageAllowedForProduct(page: Page, product?: string | null): boolean {
  return !isNanoProduct(product) || !isNanoHiddenActivityPage(page)
}

/**
 * Join the code catalog with a home-scoped overlay, then apply product and
 * Office-beta gates. Hidden items stay out of the rail.
 */
export function joinNavLayout(
  catalog: readonly NavSection[],
  layout: UiLayout,
  flags: { product?: string | null; office: boolean },
): NavSection[] {
  const catalogIndex = catalogByPage(catalog)
  const normalized = normalizeUiLayout(layout)
  const hidden = new Set(normalized.hidden)

  return normalized.groups.flatMap((group) => {
    const items = group.items.flatMap((page) => {
      if (hidden.has(page)) return []
      if (!pageAllowedForProduct(page, flags.product)) return []
      if (page === 'office' && !flags.office) return []
      const leaf = catalogIndex.get(page)
      return leaf ? [leaf] : []
    })
    if (items.length === 0) return []

    const builtin = catalog.find((section) => section.id === group.id)
    return [{
      id: group.id,
      sectionLabel: builtin?.sectionLabel ?? group.label ?? group.id,
      labelKey: builtin?.labelKey,
      descriptionKey: builtin?.descriptionKey,
      items,
    }]
  })
}

/** Editor view of the same overlay: hidden items stay visible and dimmed. */
export function editorGroupsFromLayout(
  catalog: readonly NavSection[],
  layout: UiLayout,
  flags: { product?: string | null } = {},
): EditorNavGroup[] {
  const catalogIndex = catalogByPage(catalog)
  const normalized = normalizeUiLayout(layout)
  const hidden = new Set(normalized.hidden)

  return normalized.groups.map((group) => {
    const builtin = catalog.find((section) => section.id === group.id)
    return {
      id: group.id,
      builtin: isBuiltinGroupId(group.id),
      label: group.label,
      labelKey: builtin?.labelKey,
      items: group.items.flatMap((page) => {
        if (!pageAllowedForProduct(page, flags.product)) return []
        const leaf = catalogIndex.get(page)
        if (!leaf) return []
        return [{
          page,
          hidden: hidden.has(page),
          pinned: page === PINNED_ACTIVITY_PAGE,
          leaf,
        }]
      }),
    }
  })
}
