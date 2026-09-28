import { describe, expect, it } from 'vitest'
import { selectPersistentTabs } from './persistent-tabs'
import type { Tab, ViewKind } from './types'

function tab(id: string, kind: ViewKind, source: 'chat' | 'auto-quant' = 'auto-quant'): Tab {
  if (kind === 'workspace') {
    return { id, spec: { kind, params: { wsId: 'ws', sessionId: id, source } } }
  }
  if (kind === 'portfolio') {
    return { id, spec: { kind, params: {} } }
  }
  return { id, spec: { kind: 'quick-start', params: {} } }
}

const lifecycleOf = (kind: ViewKind) => (
  kind === 'workspace' ? 'keep-mounted' : 'active-only'
) as 'active-only' | 'keep-mounted'

describe('selectPersistentTabs', () => {
  it('returns nothing on mobile', () => {
    const workspace = tab('ws-1', 'workspace')
    expect(selectPersistentTabs({
      isDesktop: false,
      tabIds: [workspace.id],
      tabs: { [workspace.id]: workspace },
      activeTabId: workspace.id,
      lastWorkspaceTabId: workspace.id,
      lifecycleOf,
    })).toEqual([])
  })

  it('keeps the active workspace mounted', () => {
    const workspace = tab('ws-1', 'workspace')
    expect(selectPersistentTabs({
      isDesktop: true,
      tabIds: [workspace.id],
      tabs: { [workspace.id]: workspace },
      activeTabId: workspace.id,
      lastWorkspaceTabId: workspace.id,
      lifecycleOf,
    }).map((entry) => entry.id)).toEqual(['ws-1'])
  })

  it('warms only the last focused workspace while Trading is active', () => {
    const older = tab('ws-old', 'workspace')
    const recent = tab('ws-recent', 'workspace')
    const portfolio = tab('portfolio', 'portfolio')
    expect(selectPersistentTabs({
      isDesktop: true,
      tabIds: [older.id, recent.id, portfolio.id],
      tabs: {
        [older.id]: older,
        [recent.id]: recent,
        [portfolio.id]: portfolio,
      },
      activeTabId: portfolio.id,
      lastWorkspaceTabId: recent.id,
      lifecycleOf,
    }).map((entry) => entry.id)).toEqual(['ws-recent'])
  })

  it('drops other workspace tabs when a different workspace is focused', () => {
    const older = tab('ws-old', 'workspace')
    const recent = tab('ws-recent', 'workspace')
    expect(selectPersistentTabs({
      isDesktop: true,
      tabIds: [older.id, recent.id],
      tabs: { [older.id]: older, [recent.id]: recent },
      activeTabId: recent.id,
      lastWorkspaceTabId: older.id,
      lifecycleOf,
    }).map((entry) => entry.id)).toEqual(['ws-recent'])
  })
})
