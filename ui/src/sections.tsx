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
import { TraditionalChatSidebar } from './components/TraditionalChatSidebar'
import { NotificationsLegacySidebar } from './components/NotificationsLegacySidebar'
import { ConnectorsLegacySidebar } from './components/ConnectorsLegacySidebar'
import { NewChannelButton } from './components/NewChannelButton'
import { InboxSidebar } from './components/InboxSidebar'
import { WorkspacesSidebar } from './components/workspace/WorkspacesSidebar'
import { PushApprovalPanel } from './components/PushApprovalPanel'
import { SettingsCategoryList } from './components/SettingsCategoryList'
import { DevCategoryList } from './components/DevCategoryList'
import { MarketSidebar } from './components/MarketSidebar'
import { PortfolioSidebar } from './components/PortfolioSidebar'
import { AutomationSidebar } from './components/AutomationSidebar'
import { NewsSidebar } from './components/NewsSidebar'
import type { ActivitySection } from './tabs/types'

export interface SidebarSection {
  /** Header title shown at the top of the sidebar. */
  title: string
  /** The actual navigator content. */
  Secondary: ComponentType
  /** Optional right-aligned action buttons in the sidebar header (e.g. "+ new"). */
  Actions?: ComponentType
}

const SECTION_BY_KEY: Record<ActivitySection, SidebarSection> = {
  // Chat is the workspace-chat shortcut now — the "夺舍" of the Chat
  // shortcut by chat-template workspaces. Channel creation is no longer
  // an Action here; that affordance moved to traditional-chat.
  chat: {
    title: 'Chat',
    Secondary: ChatChannelListContainer,
  },
  inbox: {
    title: 'Inbox',
    Secondary: InboxSidebar,
  },
  workspaces: {
    title: 'Workspaces',
    Secondary: WorkspacesSidebar,
  },
  'trading-as-git': {
    title: 'Trading as Git',
    Secondary: PushApprovalPanel,
  },
  settings: {
    title: 'Settings',
    Secondary: SettingsCategoryList,
  },
  dev: {
    title: 'Dev',
    Secondary: DevCategoryList,
  },
  market: {
    title: 'Market',
    Secondary: MarketSidebar,
  },
  portfolio: {
    title: 'Portfolio',
    Secondary: PortfolioSidebar,
  },
  automation: {
    title: 'Automation',
    Secondary: AutomationSidebar,
  },
  news: {
    title: 'News',
    Secondary: NewsSidebar,
  },
  // Legacy entries — pre-Workspace artifacts. Sidebars include a
  // muted explanatory note so users opening them understand the
  // lifecycle context.
  'traditional-chat': {
    title: 'Traditional chat',
    Secondary: TraditionalChatSidebar,
    Actions: NewChannelButton,
  },
  'notifications-legacy': {
    title: 'Notifications',
    Secondary: NotificationsLegacySidebar,
  },
  'connectors-legacy': {
    title: 'Connectors',
    Secondary: ConnectorsLegacySidebar,
  },
}

/** Resolve the sidebar config for the currently selected ActivitySection. */
export function findSectionForActivity(
  section: ActivitySection | null | undefined,
): SidebarSection | null {
  if (!section) return null
  return SECTION_BY_KEY[section]
}
