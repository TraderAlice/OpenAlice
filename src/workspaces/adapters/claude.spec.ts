import { describe, it, expect } from 'vitest'
import { claudeAdapter } from './claude.js'

import type { SpawnContext } from '../cli-adapter.js'

// Every spawn carries this flag so project-scoped `.mcp.json` servers are
// auto-trusted instead of parking at "⏸ Pending approval". See adapter comment.
const SETTINGS = ['--settings', JSON.stringify({ enableAllProjectMcpServers: true })]

describe('claudeAdapter.composeCommand', () => {
  const ctx = (resume: SpawnContext['resume']): SpawnContext => ({
    cwd: '/tmp/ws',
    env: {},
    resume,
  })

  it('injects --settings (mcp auto-trust) for fresh (no resume)', () => {
    expect(claudeAdapter.composeCommand(['claude'], ctx(undefined))).toEqual(['claude', ...SETTINGS])
  })

  it('injects --settings then --resume <id> for resume-by-id', () => {
    expect(claudeAdapter.composeCommand(['claude'], ctx({ sessionId: 'abc-123' }))).toEqual([
      'claude',
      ...SETTINGS,
      '--resume',
      'abc-123',
    ])
  })

  it('emits a parseable settings JSON enabling enableAllProjectMcpServers', () => {
    const cmd = claudeAdapter.composeCommand(['claude'], ctx(undefined))
    const i = cmd.indexOf('--settings')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(JSON.parse(cmd[i + 1]!)).toEqual({ enableAllProjectMcpServers: true })
  })

  it('throws for resume="last"', () => {
    // resume="last" is unsupported; see adapter comment.
    expect(() => claudeAdapter.composeCommand(['claude'], ctx('last' as never))).toThrow()
  })
})
