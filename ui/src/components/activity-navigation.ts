import {
  BarChart3,
  Code2,
  GitBranch,
  Inbox,
  LineChart,
  ListChecks,
  MessageSquare,
  Newspaper,
  Plug,
  Settings,
  Telescope,
  TerminalSquare,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import type { Page } from '../App'
import type { ViewSpec } from '../tabs/types'

type NavItemKey =
  | 'nav.item.inbox' | 'nav.item.tracked' | 'nav.item.chat' | 'nav.item.workspaces'
  | 'nav.item.market' | 'nav.item.news' | 'nav.item.tradingAsGit' | 'nav.item.issue'
  | 'nav.item.portfolio' | 'nav.item.connectors' | 'nav.item.automation' | 'nav.item.settings' | 'nav.item.dev'

interface NavLeaf {
  page: Page
  labelKey: NavItemKey
  icon: LucideIcon
  /** Concrete landing surface opened by this Activity Bar item. */
  defaultTab: ViewSpec
}

export interface NavSection {
  /** Empty string identifies the unlabeled, always-visible primary section. */
  sectionLabel: string
  labelKey?: 'nav.section.beta' | 'nav.section.system'
  items: NavLeaf[]
  defaultCollapsed?: boolean
  descriptionKey?: 'nav.betaDescription'
}

export const NAV_SECTIONS: NavSection[] = [
  // Ask Alice is the product front door. Workspaces is deliberately absent:
  // it is the engineering container/debug surface beneath conversations.
  {
    sectionLabel: '',
    items: [
      { page: 'chat',       labelKey: 'nav.item.chat',       icon: MessageSquare, defaultTab: { kind: 'chat-landing', params: {} } },
      { page: 'inbox',      labelKey: 'nav.item.inbox',      icon: Inbox, defaultTab: { kind: 'inbox', params: {} } },
      { page: 'issue',      labelKey: 'nav.item.issue',      icon: ListChecks, defaultTab: { kind: 'issue', params: {} } },
      { page: 'tracked',    labelKey: 'nav.item.tracked',    icon: Telescope, defaultTab: { kind: 'tracked', params: {} } },
      { page: 'market',     labelKey: 'nav.item.market',     icon: BarChart3, defaultTab: { kind: 'market-list', params: {} } },
      { page: 'news',       labelKey: 'nav.item.news',       icon: Newspaper, defaultTab: { kind: 'news', params: {} } },
    ],
  },
  {
    sectionLabel: 'Beta',
    labelKey: 'nav.section.beta',
    descriptionKey: 'nav.betaDescription',
    items: [
      { page: 'trading-as-git', labelKey: 'nav.item.tradingAsGit', icon: GitBranch, defaultTab: { kind: 'trading-as-git', params: {} } },
      { page: 'portfolio',      labelKey: 'nav.item.portfolio',    icon: LineChart, defaultTab: { kind: 'portfolio', params: {} } },
      { page: 'connectors',     labelKey: 'nav.item.connectors',   icon: Plug, defaultTab: { kind: 'connectors', params: {} } },
    ],
  },
  {
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
