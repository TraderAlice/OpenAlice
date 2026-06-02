import { describe, it, expect } from 'vitest'
import { ToolCenter } from '../core/tool-center.js'
import { CLI_COMMANDS, mappedToolNames } from './cli-commands.js'
import { createNewsArchiveTools } from '../tool/news.js'
import { createMarketSearchTools } from '../tool/market.js'
import { createEquityTools } from '../tool/equity.js'
import { createEconomyTools } from '../tool/economy.js'
import { createAnalysisTools } from '../tool/analysis.js'
import { createThinkingTools } from '../tool/thinking.js'

/**
 * Anti-rot: the alias map is hand-authored, so guard it against drift — a verb
 * pointing at a renamed/deleted tool would silently vanish from the CLI. The
 * factories build tool *definitions* without touching their clients (clients
 * are only used inside execute), so `{} as any` deps are fine here.
 */
describe('CLI_COMMANDS', () => {
  const tc = new ToolCenter()
  const any = {} as never
  tc.register(createThinkingTools(), 'thinking')
  tc.register(createMarketSearchTools(any), 'market-search')
  tc.register(createEquityTools(any), 'equity')
  tc.register(createNewsArchiveTools(any), 'news')
  tc.register(createAnalysisTools(any, any, any, any), 'analysis')
  tc.register(createEconomyTools(any, any), 'economy')

  it('every mapped verb resolves to a registered tool', () => {
    for (const name of mappedToolNames()) {
      expect(tc.get(name), `CLI maps to missing tool: ${name}`).not.toBeNull()
    }
  })

  it('does not map the same tool from two verbs', () => {
    const seen = new Set<string>()
    for (const verbs of Object.values(CLI_COMMANDS)) {
      for (const toolName of Object.values(verbs)) {
        expect(seen.has(toolName), `duplicate mapping target: ${toolName}`).toBe(false)
        seen.add(toolName)
      }
    }
  })

  it('keeps trading + cron OFF the CLI surface (boundary discipline)', () => {
    expect(CLI_COMMANDS['trading']).toBeUndefined()
    expect(CLI_COMMANDS['cron']).toBeUndefined()
  })
})
