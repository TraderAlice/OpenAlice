import { describe, expect, it } from 'vitest'

import type { CliAdapter, SpawnContext } from '../cli-adapter.js'
import { agyAdapter } from './agy.js'
import { claudeAdapter } from './claude.js'
import { codexAdapter } from './codex.js'
import { cursorAdapter } from './cursor.js'
import { grokAdapter } from './grok.js'
import { ompAdapter } from './omp.js'
import { opencodeAdapter } from './opencode.js'
import { piAdapter } from './pi.js'

const ctx = (overrides: Partial<SpawnContext> = {}): SpawnContext => ({
  cwd: '/w',
  env: { AQ_WS_ID: 'ws-1' },
  resume: undefined,
  ...overrides,
})

const webAdapters: readonly CliAdapter[] = [piAdapter, ompAdapter, claudeAdapter, codexAdapter, cursorAdapter, grokAdapter, opencodeAdapter]

describe('Web surface command composition', () => {
  it.each([undefined, { sessionId: 'codex-existing' }] as const)(
    'keeps injected CLI PATH for fresh and resumed Codex on every surface (%j)', (resume) => {
      const context = ctx({ resume })
      const commands = [
        codexAdapter.composeCommand([], context),
        codexAdapter.composeHeadlessCommand!([], context, 'read only'),
        codexAdapter.composeWebCommand!([], context),
      ]
      for (const argv of commands) {
        const index = argv.indexOf('allow_login_shell=false')
        expect(index).toBeGreaterThan(0)
        expect(argv[index - 1]).toBe('-c')
        expect(argv.filter(arg => arg === 'allow_login_shell=false')).toHaveLength(1)
      }
    },
  )

  it('declares a wire for every adapter that composes a Web command, and vice versa', () => {
    for (const adapter of webAdapters) {
      expect(adapter.capabilities.web, adapter.id).toBeDefined()
      expect(typeof adapter.composeWebCommand, adapter.id).toBe('function')
    }
    expect(agyAdapter.capabilities.web).toBeUndefined()
    expect(agyAdapter.composeWebCommand).toBeUndefined()
  })

  it('never resumes "last": the surface must reopen the exact recorded Session', () => {
    for (const adapter of webAdapters) {
      expect(() => adapter.composeWebCommand!(['x'], ctx({ resume: 'last' })), adapter.id).toThrow()
    }
  })

  it('composes omp RPC with auto-approve and by-id resume', () => {
    expect(ompAdapter.composeWebCommand!([], ctx({ resume: { sessionId: 'omp-1' } })))
      .toEqual(['omp', '--mode', 'rpc', '--auto-approve', '--resume', 'omp-1'])
    expect(ompAdapter.composeWebCommand!([], ctx())).toEqual(['omp', '--mode', 'rpc', '--auto-approve'])
  })

  it('composes Claude bidirectional stream-json with stdio permission prompts', () => {
    const resumed = claudeAdapter.composeWebCommand!(['claude'], ctx({ resume: { sessionId: 'c-1' } }))
    expect(resumed).toEqual([
      'claude', '--settings', '{"enableAllProjectMcpServers":true,"sandbox":{"enabled":false}}', '--dangerously-skip-permissions', '--resume', 'c-1',
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--permission-prompt-tool', 'stdio',
    ])
    const fresh = claudeAdapter.composeWebCommand!(['claude'], ctx())
    expect(fresh).toContain('--session-id')
    expect(fresh[fresh.indexOf('--session-id') + 1]).toMatch(/^[0-9a-f-]{36}$/)
    expect(fresh).not.toContain('--allowedTools')
  })

  it('composes Codex app-server over stdio with MCP registration but no TUI permission flags', () => {
    const argv = codexAdapter.composeWebCommand!([], ctx({ env: { AQ_WS_ID: 'ws-1', OPENALICE_MCP_URL: 'http://127.0.0.1:1/mcp' } }))
    expect(argv.slice(-3)).toEqual(['app-server', '--listen', 'stdio://'])
    expect(argv).toContain('mcp_servers.openalice.url="http://127.0.0.1:1/mcp"')
    expect(argv).not.toContain('sandbox_workspace_write.network_access=true')
    expect(argv).not.toContain('--ask-for-approval')
    expect(argv).not.toContain('--sandbox')
  })

  it('composes the three native ACP agents', () => {
    expect(cursorAdapter.composeWebCommand!([], ctx({ approveProject: true }))).toEqual(['cursor-agent', '--trust', '--force', '--sandbox', 'disabled',  'acp'])
    expect(grokAdapter.composeWebCommand!([], ctx())).toEqual(['grok', '--sandbox', 'off', 'agent', '--no-leader', '--always-approve', 'stdio'])
    expect(opencodeAdapter.composeWebCommand!([], ctx())).toEqual(['opencode', 'acp'])
  })
})
