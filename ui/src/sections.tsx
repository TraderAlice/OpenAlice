/**
 * Section config — what the secondary sidebar shows for each ActivitySection.
 *
 * Sidebar selection is driven by `selectedSidebar` in the workspace store,
 * which the ActivityBar updates via `toggleSidebar`. Sidebar content is
 * decoupled from focused-tab kind: switching tabs doesn't change which
 * sidebar shows.
 *
 * Routes have moved to tabs/UrlAdopter.tsx (URL → spec adoption) and
 * tabs/registry.tsx (spec → URL projection). This file is now just the
 * activity-section → sidebar lookup.
 *
 * Subsection-header convention: a sidebar uses subsection headers (e.g.
 * Portfolio's "Overview" / "Accounts (N)") IF AND ONLY IF it lists items
 * of more than one shape — typically an aggregate view alongside per-
 * instance rows. Sidebars listing one kind of thing (Settings categories,
 * Workspace instances, Market list, Chat channels) do NOT use headers;
 * adding them for symmetry would perform a categorization that isn't in
 * the underlying data. Portfolio is the only sidebar that qualifies today.
 */

import type { ComponentType } from 'react'
import { ChatChannelListContainer } from './components/ChatChannelListContainer'
import { InboxSidebar, InboxViewToggle } from './components/InboxSidebar'
import { TrackedSidebar } from './components/TrackedSidebar'
import { WorkspacesSidebar } from './components/workspace/WorkspacesSidebar'
import { PushApprovalPanel } from './components/PushApprovalPanel'
import { SettingsCategoryList } from './components/SettingsCategoryList'
import { DevCategoryList } from './components/DevCategoryList'
import { MarketSidebar } from './components/MarketSidebar'
import { PortfolioSidebar } from './components/PortfolioSidebar'
import { AutomationSidebar } from './components/AutomationSidebar'
import type { ActivitySection } from './tabs/types'

type NavTitleKey = 'nav.item.chat' | 'nav.item.inbox' | 'nav.item.tracked' | 'nav.item.workspaces' | 'nav.item.tradingAsGit' | 'nav.item.settings' | 'nav.item.dev' | 'nav.item.market' | 'nav.item.portfolio' | 'nav.item.automation'

export interface SidebarSection {
  /** Header title shown at the top of the sidebar. */
  titleKey: NavTitleKey
  /** The actual navigator content. */
  Secondary: ComponentType
  /** Optional right-aligned action buttons in the sidebar header (e.g. "+ new"). */
  Actions?: ComponentType
}

/**
 * Activities WITHOUT an entry here are sidebar-less: clicking them in the
 * ActivityBar opens their default tab full-width, no secondary column.
 * (News is the first — its sidebar was a single-row placeholder.)
 */
const SECTION_BY_KEY: Partial<Record<ActivitySection, SidebarSection>> = {
  // Chat is the workspace-chat shortcut now — the "夺舍" of the Chat
  // shortcut by chat-template workspaces. Channel creation is no longer
  // an Action here; that affordance moved to traditional-chat.
  chat: {
    titleKey: 'nav.item.chat',
    Secondary: ChatChannelListContainer,
  },
  inbox: {
    titleKey: 'nav.item.inbox',
    Secondary: InboxSidebar,
    Actions: InboxViewToggle,
  },
  tracked: {
    titleKey: 'nav.item.tracked',
    Secondary: TrackedSidebar,
  },
  workspaces: {
    titleKey: 'nav.item.workspaces',
    Secondary: WorkspacesSidebar,
  },
  'trading-as-git': {
    titleKey: 'nav.item.tradingAsGit',
    Secondary: PushApprovalPanel,
  },
  settings: {
    titleKey: 'nav.item.settings',
    Secondary: SettingsCategoryList,
  },
  dev: {
    titleKey: 'nav.item.dev',
    Secondary: DevCategoryList,
  },
  market: {
    titleKey: 'nav.item.market',
    Secondary: MarketSidebar,
  },
  portfolio: {
    titleKey: 'nav.item.portfolio',
    Secondary: PortfolioSidebar,
  },
  // issue: sidebar-less (Linear-style) — clicking Issues opens the board
  // full-width; no secondary column. Filter views (All/Active/Backlog) belong
  // at the top of the board, not in a sidebar.
  automation: {
    titleKey: 'nav.item.automation',
    Secondary: AutomationSidebar,
  },
}

/** Resolve the sidebar config for the currently selected ActivitySection. */
export function findSectionForActivity(
  section: ActivitySection | null | undefined,
): SidebarSection | null {
  if (!section) return null
  return SECTION_BY_KEY[section] ?? null
}
