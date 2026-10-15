import { createMarketBarsTools } from '../../../src/tool/market-bars.js'
import { describe, it, expect } from 'vitest'
import { ToolCenter } from '../../../src/core/tool-center.js'
import { WorkspaceToolCenter } from '../../../src/core/workspace-tool-center.js'
import {
  CLI_EXPORTS,
  exportKeyForBinary,
  getExport,
  mappedToolNames,
  mappedToolNamesForScope,
} from '../../../src/server/cli-commands.js'
import { createNewsArchiveTools } from '../../../src/tool/news.js'
import { createMarketSearchTools } from '../../../src/tool/market.js'
import { createVendorTools } from '../../../src/tool/market-vendors.js'
import { createEquityTools } from '../../../src/tool/equity.js'
import { createEconomyTools } from '../../../src/tool/economy.js'
import { createQuantTools } from '../../../src/tool/quant.js'
import { createSnapshotTools } from '../../../src/tool/snapshot.js'
import { createSimulateTools } from '../../../src/tool/simulate.js'
import { createThinkingTools } from '../../../src/tool/thinking.js'
import { inboxPushFactory } from '../../../src/tool/inbox-push.js'
import { inboxReadFactory } from '../../../src/tool/inbox-read.js'
import { workspacePathFactory } from '../../../src/tool/workspace-path.js'
import { workspaceSessionsFactory } from '../../../src/tool/workspace-sessions.js'
import { workspaceListFactory } from '../../../src/tool/workspace-list.js'
import { workspaceTemplateUpgradeFactory, aliceHarnessUpgradeFactory } from '../../../src/tool/workspace-template-upgrade.js'
import { entityUpsertFactory } from '../../../src/tool/entity-upsert.js'
import { entitySearchFactory } from '../../../src/tool/entity-search.js'
import { issueToolFactories } from '../../../src/tool/issue-tools.js'
import { sessionSignatureFactory } from '../../../src/tool/session-signature.js'
import { sessionRenameFactory } from '../../../src/tool/session-rename.js'
import { provenanceShowFactory } from '../../../src/tool/provenance-show.js'
import { conversationToolFactories } from '../../../src/tool/conversation.js'
import { artifactConversationToolFactories } from '../../../src/tool/conversation-artifacts.js'
import { createTradingTools } from '../../../src/tool/trading.js'

/**
 * Anti-rot: each export's alias map is hand-authored, so guard it against drift —
 * a verb pointing at a renamed/deleted tool would silently vanish from the CLI.
 * Factories build tool *definitions* without touching their clients/stores
 * (those are only used inside execute), so `{} as never` deps are fine here.
 */
const any = {} as never

describe('CLI_EXPORTS — data export (global tools)', () => {
  const tc = new ToolCenter()
  tc.register(createThinkingTools(), 'thinking')
  tc.register(createMarketSearchTools(any), 'market-search')
  tc.register(createVendorTools(any), 'market-vendors')
  tc.register(createEquityTools(any), 'equity')
  tc.register(createNewsArchiveTools(any), 'rss')
  tc.register(createMarketBarsTools(any), 'market-bars')
  tc.register(createQuantTools(any), 'quant')
  tc.register(createSnapshotTools(any), 'snapshot')
  tc.register(createSimulateTools(any), 'simulate')
  tc.register(createEconomyTools(any, any), 'economy')

  it('every mapped verb resolves to a registered global tool', () => {
    for (const name of mappedToolNames('data')) {
      if (mappedToolNames('workspace').has(name)) continue
      expect(tc.get(name), `data CLI maps to missing tool: ${name}`).not.toBeNull()
    }
  })

  it('does not export generic calculation or fixed trade simulation', () => {
    expect(mappedToolNames('data')).not.toContain('calculate')
    expect(mappedToolNames('data')).not.toContain('simulate')
    expect(getExport('data')?.groupDescriptions).not.toHaveProperty('think')
  })

  it('includes every collaboration group at the top level without changing its map', () => {
    for (const [group, verbs] of Object.entries(CLI_EXPORTS.workspace.commands)) {
      expect(CLI_EXPORTS.data.commands[group]).toEqual(verbs)
    }
    expect(CLI_EXPORTS.data.commands).not.toHaveProperty('workspace')
  })

  it('combines registry scopes', () => {
    expect(getExport('data')?.scope).toBe('mixed')
  })
})

describe('CLI_EXPORTS — uta export (global trading tools)', () => {
  const tc = new ToolCenter()
  tc.register(createTradingTools(any), 'trading')

  it('every mapped verb resolves to a registered trading tool', () => {
    for (const name of mappedToolNames('uta')) {
      expect(tc.get(name), `uta CLI maps to missing tool: ${name}`).not.toBeNull()
    }
  })

  it('cron tools are NOT reachable from any export', () => {
    for (const key of Object.keys(CLI_EXPORTS)) {
      for (const name of mappedToolNames(key)) {
        expect(name.toLowerCase().includes('cron'), `${key} exposes cron tool ${name}`).toBe(false)
      }
    }
  })

  it('binary alice-uta resolves to the uta export', () => {
    expect(exportKeyForBinary('alice-uta')).toBe('uta')
    expect(getExport('uta')?.scope).toBe('global')
  })
})

describe('CLI_EXPORTS — workspace export (scoped collaboration tools)', () => {
  const wtc = new WorkspaceToolCenter()
  wtc.register(inboxPushFactory)
  wtc.register(inboxReadFactory)
  wtc.register(workspacePathFactory)
  wtc.register(workspaceSessionsFactory)
  wtc.register(workspaceListFactory)
  wtc.register(workspaceTemplateUpgradeFactory)
  wtc.register(aliceHarnessUpgradeFactory)
  wtc.register(entityUpsertFactory)
  wtc.register(entitySearchFactory)
  for (const f of issueToolFactories) wtc.register(f)
  wtc.register(sessionSignatureFactory)
  wtc.register(sessionRenameFactory)
  wtc.register(provenanceShowFactory)
  for (const f of conversationToolFactories) wtc.register(f)
  for (const f of artifactConversationToolFactories) wtc.register(f)
  const built = wtc.build({
    workspaceId: 'ws-test',
    workspaceLabel: 'test',
    inboxStore: any,
    entityStore: any,
  })

  it('every mapped verb resolves to a registered scoped tool', () => {
    for (const name of mappedToolNames('workspace')) {
      expect(built[name], `workspace CLI maps to missing scoped tool: ${name}`).toBeTruthy()
    }
  })

  it('is scope: scoped', () => {
    expect(getExport('workspace')?.scope).toBe('scoped')
  })
})

describe('CLI_EXPORTS — structure', () => {
  it('describes every group exactly once for live intent-first help', () => {
    for (const [key, exp] of Object.entries(CLI_EXPORTS)) {
      expect(Object.keys(exp.groupDescriptions), `${key}: group help drift`).toEqual(
        Object.keys(exp.commands),
      )
      for (const [group, description] of Object.entries(exp.groupDescriptions)) {
        expect(description.trim().length, `${key} ${group}: empty group description`).toBeGreaterThan(0)
      }
    }
  })

  it('keeps mapping targets unique except the shipped analysis search-bars alias', () => {
    for (const [key, exp] of Object.entries(CLI_EXPORTS)) {
      const seen = new Set<string>()
      for (const verbs of Object.values(exp.commands)) {
        for (const toolName of Object.values(verbs)) {
          if (!(key === 'data' && toolName === 'searchBars')) {
            expect(seen.has(toolName), `${key}: duplicate mapping target: ${toolName}`).toBe(false)
          }
          seen.add(toolName)
        }
      }
    }
  })

  it('keeps the old bar discovery command as an exact alias', () => {
    expect(CLI_EXPORTS.data.commands.market['search-bars']).toBe('searchBars')
    expect(CLI_EXPORTS.data.commands.analysis['search-bars']).toBe('searchBars')
  })

  it('unions sibling exports without crossing registry scopes', () => {
    const global = mappedToolNamesForScope('global')
    const scoped = mappedToolNamesForScope('scoped')
    expect(global).toEqual(new Set([
      ...[...mappedToolNames('data')].filter(n => !scoped.has(n)),
      ...mappedToolNames('traderhub'),
      ...mappedToolNames('uta'),
    ]))
    expect(scoped).toEqual(mappedToolNames('workspace'))
    for (const name of scoped) expect(global.has(name)).toBe(false)
  })

  it('maps a binary name to its export key (alice -> data, alice-<x> -> <x>)', () => {
    expect(exportKeyForBinary('alice')).toBe('data')
    expect(exportKeyForBinary('alice-workspace')).toBe('data')
    expect(exportKeyForBinary('alice-uta')).toBe('uta')
    // round-trips: each export's declared binary resolves back to its key
    for (const [key, exp] of Object.entries(CLI_EXPORTS)) {
      expect(exportKeyForBinary(exp.binary)).toBe(key === 'workspace' ? 'data' : key)
    }
  })

  it('keeps cron OFF every export (trading shipped via alice-uta, 2026-06-11)', () => {
    expect(getExport('uta')).not.toBeNull()
    for (const exp of Object.values(CLI_EXPORTS)) {
      expect(exp.commands['cron']).toBeUndefined()
    }
  })
})
