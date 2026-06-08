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
import { createEquityTools } from '../tool/equity.js'
import { createEconomyTools } from '../tool/economy.js'
import { createAnalysisTools } from '../tool/analysis.js'
import { createThinkingTools } from '../tool/thinking.js'
import { inboxPushFactory } from '../tool/inbox-push.js'
import { entityUpsertFactory } from '../tool/entity-upsert.js'
import { entitySearchFactory } from '../tool/entity-search.js'

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
  tc.register(createEquityTools(any), 'equity')
  tc.register(createNewsArchiveTools(any), 'news')
  tc.register(createAnalysisTools(any, any, any, any), 'analysis')
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

describe('CLI_EXPORTS — workspace export (scoped collaboration tools)', () => {
  const wtc = new WorkspaceToolCenter()
  wtc.register(inboxPushFactory)
  wtc.register(entityUpsertFactory)
  wtc.register(entitySearchFactory)
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

  it('keeps trading + cron OFF every export (boundary discipline; no uta export yet)', () => {
    expect(getExport('uta')).toBeNull()
    for (const exp of Object.values(CLI_EXPORTS)) {
      expect(exp.commands['trading']).toBeUndefined()
      expect(exp.commands['cron']).toBeUndefined()
    }
  })
})
