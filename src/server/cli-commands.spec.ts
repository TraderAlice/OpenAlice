import { describe, it, expect } from 'vitest'
import { ToolCenter } from '../core/tool-center.js'
import { WorkspaceToolCenter } from '../core/workspace-tool-center.js'
import {
  CLI_EXPORTS,
  exportKeyForBinary,
  getExport,
  mappedToolNames,
} from './cli-commands.js'
import { createNewsArchiveTools } from '../tool/news.js'
import { createMarketSearchTools } from '../tool/market.js'
import { createVendorTools } from '../tool/market-vendors.js'
import { createEquityTools } from '../tool/equity.js'
import { createEconomyTools } from '../tool/economy.js'
import { createQuantTools } from '../tool/quant.js'
import { createSnapshotTools } from '../tool/snapshot.js'
import { createSimulateTools } from '../tool/simulate.js'
import { createThinkingTools } from '../tool/thinking.js'
import { inboxPushFactory } from '../tool/inbox-push.js'
import { inboxReadFactory } from '../tool/inbox-read.js'
import { workspacePathFactory } from '../tool/workspace-path.js'
import { entityUpsertFactory } from '../tool/entity-upsert.js'
import { entitySearchFactory } from '../tool/entity-search.js'
import { issueToolFactories } from '../tool/issue-tools.js'
import { conversationToolFactories } from '../tool/conversation.js'
import { createTradingTools } from '../tool/trading.js'

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
  tc.register(createQuantTools(any), 'quant')
  tc.register(createSnapshotTools(any), 'snapshot')
  tc.register(createSimulateTools(any), 'simulate')
  tc.register(createEconomyTools(any, any), 'economy')

  it('every mapped verb resolves to a registered global tool', () => {
    for (const name of mappedToolNames('data')) {
      expect(tc.get(name), `data CLI maps to missing tool: ${name}`).not.toBeNull()
    }
  })

  it('is scope: global', () => {
    expect(getExport('data')?.scope).toBe('global')
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
  wtc.register(entityUpsertFactory)
  wtc.register(entitySearchFactory)
  for (const f of issueToolFactories) wtc.register(f)
  for (const f of conversationToolFactories) wtc.register(f)
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
  it('no export maps the same tool from two verbs', () => {
    for (const [key, exp] of Object.entries(CLI_EXPORTS)) {
      const seen = new Set<string>()
      for (const verbs of Object.values(exp.commands)) {
        for (const toolName of Object.values(verbs)) {
          expect(seen.has(toolName), `${key}: duplicate mapping target: ${toolName}`).toBe(false)
          seen.add(toolName)
        }
      }
    }
  })

  it('maps a binary name to its export key (alice -> data, alice-<x> -> <x>)', () => {
    expect(exportKeyForBinary('alice')).toBe('data')
    expect(exportKeyForBinary('alice-workspace')).toBe('workspace')
    expect(exportKeyForBinary('alice-uta')).toBe('uta')
    // round-trips: each export's declared binary resolves back to its key
    for (const [key, exp] of Object.entries(CLI_EXPORTS)) {
      expect(exportKeyForBinary(exp.binary)).toBe(key)
    }
  })

  it('keeps cron OFF every export (trading shipped via alice-uta, 2026-06-11)', () => {
    expect(getExport('uta')).not.toBeNull()
    for (const exp of Object.values(CLI_EXPORTS)) {
      expect(exp.commands['cron']).toBeUndefined()
    }
  })
})
