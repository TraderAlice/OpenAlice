/**
 * English catalog — the SOURCE OF TRUTH for message keys. `zh`/`ja` are typed
 * against `Resources` (this shape with widened string leaves), so a missing or
 * extra key in a translation is a compile error. i18next key autocompletion is
 * driven off `typeof en` via CustomTypeOptions (see ../i18n.d.ts).
 *
 * Scope reminder: this catalog covers UI chrome ONLY. Never add agent-facing
 * copy here (skills / persona / templates / tool descriptions live in src/ and
 * are read by the model — translating them degrades behavior). The catalog
 * physically cannot import from src/, which keeps the boundary structural.
 *
 * Interpolation uses i18next `{{var}}` syntax.
 */

export const en = {
  nav: {
    item: {
      inbox: 'Inbox',
      tracked: 'Tracked',
      chat: 'Chat',
      workspaces: 'Workspaces',
      market: 'Market',
      news: 'News',
      tradingAsGit: 'Trading as Git',
      portfolio: 'Portfolio',
      automation: 'Automation',
      settings: 'Settings',
      dev: 'Dev',
    },
    section: {
      beta: 'Beta',
      system: 'System',
    },
    betaDescription:
      "Functional but not yet dependable. Trading-as-Git and Portfolio surface cross-broker unified state whose underlying abstraction is still being settled — try them, but don't depend on schema or UX as stable yet. Automation runs, but its trigger chain isn't closed in the current Harness architecture, so it can't fire end-to-end until Harness scheduling lands. Broker connection setup lives in Settings → Trading.",
    unread: '{{count}} unread',
    about: 'About {{label}}',
  },
  settings: {
    title: 'Settings',
    tab: {
      settings: 'Settings',
      tools: 'Tools',
    },
    language: {
      title: 'Language',
      description: 'Interface language. Takes effect immediately.',
    },
    category: {
      general: 'General',
      aiProvider: 'AI Provider',
      trading: 'Trading',
      mcpServer: 'MCP Server',
      marketData: 'Market Data',
      newsSources: 'News Sources',
    },
    agent: {
      title: 'Agent',
      description: 'Controls file-system and tool permissions for the AI. Changes apply on the next request.',
      evolutionMode: 'Evolution Mode',
      evolutionOn: 'Full project access — AI can modify source code',
      evolutionOff: 'Sandbox mode — AI can only edit data/brain/',
    },
    persona: {
      title: 'Persona',
      description: "The system prompt that defines Alice's personality and behavior. Changes take effect on next server restart.",
      loadError: 'Failed to load persona',
      saveError: 'Failed to save',
      loading: 'Loading...',
      saving: 'Saving...',
      save: 'Save',
      saved: 'Saved',
      unsaved: 'Unsaved changes',
    },
    compaction: {
      title: 'Compaction',
      description: 'Context window management. When conversation size approaches Max Context minus Max Output tokens, older messages are automatically summarized to free up space.',
      maxContextTokens: 'Max Context Tokens',
      maxOutputTokens: 'Max Output Tokens',
    },
    tools: {
      summary: '{{tools}} tools in {{groups}} groups — changes apply on next AI request',
      emptyTitle: 'No tools registered.',
      emptyDescription: 'Tools will appear here when the engine starts.',
      group: {
        thinking: 'Thinking Kit',
        cron: 'Cron Scheduler',
        equity: 'Equity Data',
        cryptoData: 'Crypto Data',
        currencyData: 'Currency Data',
        news: 'News',
        newsArchive: 'News Archive',
        analysis: 'Analysis Kit',
        cryptoTrading: 'Crypto Trading',
        securitiesTrading: 'Securities Trading',
      },
    },
  },
  common: {
    loading: 'Loading…',
    searching: 'searching…',
    tools: 'Tools',
    logs: 'Logs',
    off: 'off',
    delete: 'Delete',
  },
  chat: {
    workspaceChatHeader: 'Workspace chat',
    recommended: 'recommended',
    newChatWorkspace: 'New chat workspace',
    collapseSessions: 'Collapse sessions',
    expandSessions: 'Expand sessions',
    deleteWorkspace: 'Delete workspace',
    deleteWorkspaceTitle: 'Delete chat workspace',
    deleteWorkspaceMessage: "Delete chat workspace {{tag}}? The files on disk are kept; only the launcher's registry entry is removed. Any open tab for it will close.",
    noChatWorkspacesYet: 'no chat workspaces yet',
  },
  dev: {
    snapshots: 'Snapshots',
  },
  simulator: {
    title: 'Simulator',
  },
  market: {
    searchPlaceholder: 'Search assets…',
    browseSection: 'Browse',
    browseMarkets: 'Browse Markets',
    searchResults: 'Search Results',
    noMatches: 'No matches',
    watchlist: 'Watchlist',
    emptyWatchlistHint: 'Pin assets here from a detail page.',
    removeFromWatchlist: 'Remove {{symbol}}',
    sectorRotation: 'Sector Rotation',
    rotationSubtitle: 'Where capital is rotating across the 11 GICS sectors.',
    asOf: 'as of',
    rotationMethodology: 'Methodology',
    quadRotatingIn: 'Rotating in',
    quadImproving: 'Improving',
    quadWeakening: 'Weakening',
    quadRotatingOut: 'Rotating out',
    axisRelStrength: 'Rel. strength vs SPY (1M)',
    axisVolumeShare: 'Volume share Δ',
    colSector: 'Sector',
    colScore: 'Score',
    colVsBench: 'vs {{sym}}',
    colRvol: 'RVOL',
    colVolShareDelta: 'Vol share Δ',
  },
  portfolio: {
    overview: 'Overview',
    allAccounts: 'All Accounts',
    accounts: 'Accounts',
    noAccountsYet: 'No accounts yet. Add one in Settings → Trading.',
  },
  automation: {
    runs: 'Runs',
    flow: 'Flow',
    heartbeat: 'Heartbeat',
    cronJobs: 'Cron Jobs',
    webhook: 'Webhook',
  },
  news: {
    allNews: 'All News',
    lookback1h: '1 hour',
    lookback12h: '12 hours',
    lookback24h: '24 hours',
    lookback7d: '7 days',
    allSources: 'All sources',
    articleCount_one: '{{count}} article',
    articleCount_other: '{{count}} articles',
    noArticles: 'No articles',
    noArticlesDescription: 'No news articles found for this time range.',
    openOriginal: 'Open original',
  },
  tracked: {
    nothingTrackedYet: 'Nothing tracked yet.',
    backlinksTooltip: '{{count}} notes link here',
    pageDescription: '{{count}} tracked · assets & topics',
    selectFromSidebar: 'Select an entity from the sidebar.',
    referencedIn_one: 'Referenced in {{count}} note',
    referencedIn_other: 'Referenced in {{count}} notes',
  },
  inbox: {
    noMessages: 'No inbox messages.',
    emptyHint: 'Workspaces will push status updates here.',
    dateToday: 'Today',
    dateYesterday: 'Yesterday',
    dateThisWeek: 'This week',
    dateOlder: 'Older',
    pageDescription: '{{count}} total · workspace status updates',
    selectFromSidebar: 'Select an entry from the sidebar.',
    commentsSection: 'Comments',
    workspaceNotExists: 'Workspace no longer exists',
    replyInWorkspace: 'Reply in {{label}}…',
    cannotReplyWorkspaceGone: 'Workspace no longer exists — nowhere to reply.',
    deleteEntryTitle: 'Delete this entry (Delete / Backspace)',
    deleteEntryAriaLabel: 'Delete this inbox entry',
  },
  auth: {
    heading: 'Sign in to OpenAlice',
    instruction: 'Paste the admin token shown on first launch.',
    adminTokenLabel: 'Admin token',
    signingIn: 'Signing in…',
    signIn: 'Sign in',
    noTokenHeading: 'No admin token configured',
    loginFailed: 'Login failed',
  },
} as const

/** The `en` shape with every string leaf widened to `string` — the contract
 *  each translation catalog must satisfy. */
type Stringify<T> = { [K in keyof T]: T[K] extends string ? string : Stringify<T[K]> }
export type Resources = Stringify<typeof en>
