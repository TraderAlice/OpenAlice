import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspace } from '../store'
import { specEquals, getFocusedGroup, getFocusedTab, isDevTab, type ViewSpec } from '../types'

// Reset zustand state + localStorage before each test so cases stay isolated.
function resetStore() {
  localStorage.clear()
  // Phase 2 initial state: empty group, no sidebar selected. Tests build up
  // tabs explicitly via openOrFocus.
  useWorkspace.setState({
    tabs: {},
    tree: { kind: 'leaf', group: { id: 'g1', tabIds: [], activeTabId: null } },
    focusedGroupId: 'g1',
    selectedSidebar: null,
  })
}

beforeEach(resetStore)

describe('Dev URL tabs', () => {
  it('keeps product surfaces out of the internal Dev Panel', () => {
    expect(isDevTab('connectors')).toBe(false)
    expect(isDevTab('connector')).toBe(false)
    expect(isDevTab('tools')).toBe(true)
  })
})

// A sample ViewSpec whose params vary by a single string, used to drive
// tab-store mechanics (open/focus/close/dedup). market-detail fits: its
// `symbol` param distinguishes otherwise-identical specs, exactly what
// these tests need. (Was `chat`/channelId before the legacy-chat surface
// was removed; the store semantics under test are kind-agnostic.)
function tab(symbol: string): ViewSpec {
  return { kind: 'market-detail', params: { assetClass: 'equity', symbol } }
}

// ==================== specEquals ====================

describe('specEquals', () => {
  it('matches identical specs', () => {
    expect(specEquals(tab('a'), tab('a'))).toBe(true)
  })

  it('different params are not equal', () => {
    expect(specEquals(tab('a'), tab('b'))).toBe(false)
  })

  it('different kinds are not equal even with overlapping params shape', () => {
    expect(specEquals(
      { kind: 'news', params: {} },
      { kind: 'portfolio', params: {} },
    )).toBe(false)
  })

  it('matches market-detail by both assetClass and symbol', () => {
    expect(specEquals(
      { kind: 'market-detail', params: { assetClass: 'equity', symbol: 'AAPL' } },
      { kind: 'market-detail', params: { assetClass: 'equity', symbol: 'AAPL' } },
    )).toBe(true)
    expect(specEquals(
      { kind: 'market-detail', params: { assetClass: 'equity', symbol: 'AAPL' } },
      { kind: 'market-detail', params: { assetClass: 'crypto', symbol: 'AAPL' } },
    )).toBe(false)
  })
})

// ==================== openOrFocus ====================

describe('openOrFocus', () => {
  it('appends and focuses a new tab when none exist', () => {
    useWorkspace.getState().openOrFocus(tab('default'))
    const group = getFocusedGroup(useWorkspace.getState())!
    expect(group.tabIds).toHaveLength(1)
    expect(getFocusedTab(useWorkspace.getState())?.spec.kind).toBe('market-detail')
  })

  it('focuses an existing tab when same spec is opened twice', () => {
    const s = useWorkspace.getState()
    s.openOrFocus(tab('default'))
    s.openOrFocus({ kind: 'news', params: {} })

    // News is focused. Re-open default tab — should switch focus, not create a new tab.
    s.openOrFocus(tab('default'))

    const group = getFocusedGroup(useWorkspace.getState())!
    expect(group.tabIds).toHaveLength(2)
    expect(getFocusedTab(useWorkspace.getState())?.spec.kind).toBe('market-detail')
  })

  it('appends and focuses a new tab when spec is novel', () => {
    const s = useWorkspace.getState()
    s.openOrFocus(tab('default'))
    s.openOrFocus({ kind: 'portfolio', params: {} })

    const group = getFocusedGroup(useWorkspace.getState())!
    expect(group.tabIds).toHaveLength(2)
    const focused = getFocusedTab(useWorkspace.getState())
    expect(focused?.spec).toEqual({ kind: 'portfolio', params: {} })
    expect(group.activeTabId).toBe(group.tabIds[1])
  })
})

// ==================== closeTab ====================

describe('closeTab', () => {
  it('closing the active tab focuses the right neighbour', () => {
    const s = useWorkspace.getState()
    s.openOrFocus(tab('default'))                       // [md]
    s.openOrFocus({ kind: 'news', params: {} })         // [md, news]
    s.openOrFocus({ kind: 'portfolio', params: {} })    // [md, news, portfolio], focus = portfolio

    // Close news (middle, not active) — focus stays on portfolio.
    const ids = getFocusedGroup(useWorkspace.getState())!.tabIds
    const newsId = ids[1]
    s.closeTab(newsId)

    expect(getFocusedGroup(useWorkspace.getState())!.tabIds).toHaveLength(2)
    expect(getFocusedTab(useWorkspace.getState())?.spec.kind).toBe('portfolio')
  })

  it('closing the rightmost active tab focuses the left neighbour', () => {
    const s = useWorkspace.getState()
    s.openOrFocus({ kind: 'news', params: {} })
    s.openOrFocus({ kind: 'portfolio', params: {} })
    const portfolioId = getFocusedGroup(useWorkspace.getState())!.activeTabId!
    s.closeTab(portfolioId)
    expect(getFocusedTab(useWorkspace.getState())?.spec.kind).toBe('news')
  })

  it('closing the last tab leaves an empty group with null activeTabId', () => {
    const s = useWorkspace.getState()
    s.openOrFocus(tab('default'))
    const onlyId = getFocusedGroup(useWorkspace.getState())!.tabIds[0]
    s.closeTab(onlyId)

    const group = getFocusedGroup(useWorkspace.getState())!
    expect(group.tabIds).toHaveLength(0)
    expect(group.activeTabId).toBeNull()
  })

  it('closeTab is a no-op for unknown ids', () => {
    const s = useWorkspace.getState()
    s.openOrFocus(tab('default'))
    const before = useWorkspace.getState()
    s.closeTab('nonexistent-id')
    const after = useWorkspace.getState()
    expect(after.tabs).toEqual(before.tabs)
    expect(after.tree).toEqual(before.tree)
  })
})

// ==================== focusTab ====================

describe('focusTab', () => {
  it('switches focus to a known tab', () => {
    const s = useWorkspace.getState()
    s.openOrFocus(tab('default'))
    s.openOrFocus({ kind: 'news', params: {} })
    const ids = getFocusedGroup(useWorkspace.getState())!.tabIds
    s.focusTab(ids[0])
    expect(getFocusedTab(useWorkspace.getState())?.spec.kind).toBe('market-detail')
  })

  it('is a no-op for unknown ids', () => {
    const s = useWorkspace.getState()
    s.openOrFocus(tab('default'))
    const before = getFocusedTab(useWorkspace.getState())?.id
    s.focusTab('nonexistent')
    const after = getFocusedTab(useWorkspace.getState())?.id
    expect(after).toBe(before)
  })
})

// ==================== closeMatching ====================

describe('closeMatching', () => {
  it('closes every tab whose spec matches the predicate', () => {
    const s = useWorkspace.getState()
    s.openOrFocus(tab('default'))
    s.openOrFocus(tab('a'))
    s.openOrFocus(tab('b'))
    s.openOrFocus({ kind: 'news', params: {} })

    s.closeMatching((spec: ViewSpec) =>
      spec.kind === 'market-detail' && spec.params.symbol !== 'default',
    )

    const remaining = getFocusedGroup(useWorkspace.getState())!.tabIds
      .map((id) => useWorkspace.getState().tabs[id]?.spec.kind)
    expect(remaining).toEqual(['market-detail', 'news'])
  })

  it('closing all tabs via closeMatching leaves an empty group', () => {
    const s = useWorkspace.getState()
    s.openOrFocus(tab('default'))
    s.openOrFocus({ kind: 'news', params: {} })
    s.closeMatching(() => true)

    const group = getFocusedGroup(useWorkspace.getState())!
    expect(group.tabIds).toHaveLength(0)
    expect(group.activeTabId).toBeNull()
  })
})

// ==================== bulk closers ====================

describe('closeOthers / closeToRight / closeToLeft / closeAll', () => {
  function setupFour() {
    const s = useWorkspace.getState()
    s.openOrFocus(tab('default'))  // [0]
    s.openOrFocus(tab('a'))        // [1]
    s.openOrFocus(tab('b'))        // [2]
    s.openOrFocus(tab('c'))        // [3], focus
    return getFocusedGroup(useWorkspace.getState())!.tabIds
  }

  it('closeOthers keeps only the named tab and focuses it', () => {
    const ids = setupFour()
    useWorkspace.getState().closeOthers(ids[1]) // keep 'a'
    const group = getFocusedGroup(useWorkspace.getState())!
    expect(group.tabIds).toEqual([ids[1]])
    expect(group.activeTabId).toBe(ids[1])
  })

  it('closeToRight drops every tab to the right of the named one', () => {
    const ids = setupFour()
    useWorkspace.getState().closeToRight(ids[1]) // close c, b
    const group = getFocusedGroup(useWorkspace.getState())!
    expect(group.tabIds).toEqual([ids[0], ids[1]])
    // c was focused → focus shifts; falls back to 'a' (the named tab) since
    // it's the rightmost remaining after the slice closes.
    expect(group.activeTabId).toBe(ids[1])
  })

  it('closeToLeft drops every tab to the left of the named one', () => {
    const ids = setupFour()
    useWorkspace.getState().closeToLeft(ids[2]) // close default, a
    const group = getFocusedGroup(useWorkspace.getState())!
    expect(group.tabIds).toEqual([ids[2], ids[3]])
  })

  it('closeAll empties the focused group entirely', () => {
    setupFour()
    useWorkspace.getState().closeAll()
    const group = getFocusedGroup(useWorkspace.getState())!
    expect(group.tabIds).toHaveLength(0)
    expect(group.activeTabId).toBeNull()
  })

  it('closeOthers / closeToRight / closeToLeft are no-ops for unknown ids', () => {
    setupFour()
    const before = getFocusedGroup(useWorkspace.getState())!.tabIds
    useWorkspace.getState().closeToRight('nonexistent')
    useWorkspace.getState().closeToLeft('nonexistent')
    const after = getFocusedGroup(useWorkspace.getState())!.tabIds
    expect(after).toEqual(before)
  })
})

// ==================== sidebar selection ====================

describe('setSidebar / toggleSidebar', () => {
  it('setSidebar replaces the current selection', () => {
    const s = useWorkspace.getState()
    s.setSidebar('chat')
    expect(useWorkspace.getState().selectedSidebar).toBe('chat')
    s.setSidebar('settings')
    expect(useWorkspace.getState().selectedSidebar).toBe('settings')
    s.setSidebar(null)
    expect(useWorkspace.getState().selectedSidebar).toBeNull()
  })

  it('toggleSidebar opens, then collapses on second click of same section', () => {
    const s = useWorkspace.getState()
    expect(useWorkspace.getState().selectedSidebar).toBeNull()
    s.toggleSidebar('settings')
    expect(useWorkspace.getState().selectedSidebar).toBe('settings')
    s.toggleSidebar('settings')
    expect(useWorkspace.getState().selectedSidebar).toBeNull()
  })

  it('toggleSidebar to a different section switches without collapsing first', () => {
    const s = useWorkspace.getState()
    s.toggleSidebar('settings')
    s.toggleSidebar('dev')
    expect(useWorkspace.getState().selectedSidebar).toBe('dev')
  })

  it('sidebar selection is independent of focused tab', () => {
    const s = useWorkspace.getState()
    s.openOrFocus(tab('default'))
    s.setSidebar('settings')
    // Focused tab is market-detail; sidebar is settings — they don't have to match.
    expect(useWorkspace.getState().selectedSidebar).toBe('settings')
    expect(getFocusedTab(useWorkspace.getState())?.spec.kind).toBe('market-detail')
  })
})
