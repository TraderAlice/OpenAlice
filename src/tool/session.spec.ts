import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ConnectorCenter, type Connector } from '../core/connector-center.js'
import { createSessionTools } from './session.js'

// ==================== Helpers ====================

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    channel: 'test',
    to: 'default',
    capabilities: { push: true, media: false },
    send: async () => ({ delivered: true }),
    ...overrides,
  }
}

function makeEntry(role: 'user' | 'assistant', text: string, ts?: string) {
  return JSON.stringify({
    type: role,
    message: { role, content: text },
    uuid: randomUUID(),
    parentUuid: null,
    sessionId: 'test',
    timestamp: ts ?? new Date().toISOString(),
  })
}

function makeToolEntry(toolName: string, input: unknown, result: string) {
  const toolUseId = randomUUID()
  const assistant = JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: toolUseId, name: toolName, input },
      ],
    },
    uuid: randomUUID(),
    parentUuid: null,
    sessionId: 'test',
    timestamp: new Date().toISOString(),
  })
  const user = JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: result }],
    },
    uuid: randomUUID(),
    parentUuid: null,
    sessionId: 'test',
    timestamp: new Date().toISOString(),
  })
  return [assistant, user]
}

// ==================== Tests ====================

describe('session tools', () => {
  let tmpDir: string
  let cc: ConnectorCenter

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'session-tools-'))
    cc = new ConnectorCenter()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // -------------------- listConnectors --------------------

  describe('listConnectors', () => {
    it('returns empty when no connectors registered', async () => {
      const tools = createSessionTools(cc, tmpDir)
      const result = await (tools.listConnectors.execute as Function)({})
      expect(result.connectors).toEqual([])
      expect(result.lastInteraction).toBeNull()
    })

    it('returns registered connectors with capabilities', async () => {
      cc.register(makeConnector({ channel: 'web', to: 'default', capabilities: { push: true, media: true } }))
      cc.register(makeConnector({ channel: 'telegram', to: '12345', capabilities: { push: true, media: false } }))

      const tools = createSessionTools(cc, tmpDir)
      const result = await (tools.listConnectors.execute as Function)({})

      expect(result.connectors).toHaveLength(2)
      expect(result.connectors.map((c: any) => c.channel).sort()).toEqual(['telegram', 'web'])
      expect(result.connectors.find((c: any) => c.channel === 'telegram').to).toBe('12345')
    })
  })

  // -------------------- listSessions --------------------

  describe('listSessions', () => {
    it('returns empty when sessions dir does not exist', async () => {
      const tools = createSessionTools(cc, join(tmpDir, 'nonexistent'))
      const result = await (tools.listSessions.execute as Function)({})
      expect(result.sessions).toEqual([])
    })

    it('discovers flat session files', async () => {
      await writeFile(join(tmpDir, 'heartbeat.jsonl'), makeEntry('user', 'hi'))

      const tools = createSessionTools(cc, tmpDir)
      const result = await (tools.listSessions.execute as Function)({})

      expect(result.sessions).toHaveLength(1)
      expect(result.sessions[0].id).toBe('heartbeat')
      expect(result.sessions[0].sizeBytes).toBeGreaterThan(0)
      expect(result.sessions[0].lastModified).toBeTruthy()
    })

    it('discovers nested session files (web/, telegram/, cron/)', async () => {
      await mkdir(join(tmpDir, 'web'), { recursive: true })
      await mkdir(join(tmpDir, 'telegram'), { recursive: true })
      await mkdir(join(tmpDir, 'cron'), { recursive: true })

      await writeFile(join(tmpDir, 'web', 'default.jsonl'), makeEntry('user', 'hello'))
      await writeFile(join(tmpDir, 'web', 'research.jsonl'), makeEntry('user', 'test'))
      await writeFile(join(tmpDir, 'telegram', '99.jsonl'), makeEntry('user', 'yo'))
      await writeFile(join(tmpDir, 'cron', 'default.jsonl'), makeEntry('user', 'cron'))
      await writeFile(join(tmpDir, 'heartbeat.jsonl'), makeEntry('user', 'beat'))

      const tools = createSessionTools(cc, tmpDir)
      const result = await (tools.listSessions.execute as Function)({})

      const ids = result.sessions.map((s: any) => s.id).sort()
      expect(ids).toEqual([
        'cron/default',
        'heartbeat',
        'telegram/99',
        'web/default',
        'web/research',
      ])
    })

    it('ignores non-jsonl files', async () => {
      await writeFile(join(tmpDir, 'heartbeat.jsonl'), makeEntry('user', 'hi'))
      await writeFile(join(tmpDir, 'notes.txt'), 'not a session')

      const tools = createSessionTools(cc, tmpDir)
      const result = await (tools.listSessions.execute as Function)({})
      expect(result.sessions).toHaveLength(1)
    })
  })

  // -------------------- readSession --------------------

  describe('readSession', () => {
    it('returns error for nonexistent session', async () => {
      const tools = createSessionTools(cc, tmpDir)
      const result = await (tools.readSession.execute as Function)({ sessionId: 'nope' })
      expect(result.error).toBe('Session not found')
      expect(result.sessionId).toBe('nope')
    })

    it('reads plain text messages', async () => {
      const lines = [
        makeEntry('user', 'What is BTC price?', '2026-01-01T10:00:00Z'),
        makeEntry('assistant', 'BTC is at $95,000.', '2026-01-01T10:00:01Z'),
        makeEntry('user', 'Thanks!', '2026-01-01T10:00:02Z'),
      ].join('\n') + '\n'
      await writeFile(join(tmpDir, 'test.jsonl'), lines)

      const tools = createSessionTools(cc, tmpDir)
      const result = await (tools.readSession.execute as Function)({ sessionId: 'test' })

      expect(result.total).toBe(3)
      expect(result.messages).toHaveLength(3)
      expect(result.messages[0].role).toBe('user')
      expect(result.messages[0].text).toBe('What is BTC price?')
      expect(result.messages[1].role).toBe('assistant')
      expect(result.messages[1].text).toBe('BTC is at $95,000.')
      expect(result.messages[2].role).toBe('user')
      expect(result.messages[2].text).toBe('Thanks!')
    })

    it('reads nested session (web/default)', async () => {
      await mkdir(join(tmpDir, 'web'), { recursive: true })
      const lines = [
        makeEntry('user', 'hello from web'),
        makeEntry('assistant', 'hello!'),
      ].join('\n') + '\n'
      await writeFile(join(tmpDir, 'web', 'default.jsonl'), lines)

      const tools = createSessionTools(cc, tmpDir)
      const result = await (tools.readSession.execute as Function)({ sessionId: 'web/default' })

      expect(result.total).toBe(2)
      expect(result.messages[0].text).toBe('hello from web')
    })

    it('summarizes tool calls into one-line text', async () => {
      const [assistantLine, userLine] = makeToolEntry('getPrice', { symbol: 'BTC' }, '95000')
      const lines = [assistantLine, userLine].join('\n') + '\n'
      await writeFile(join(tmpDir, 'tools.jsonl'), lines)

      const tools = createSessionTools(cc, tmpDir)
      const result = await (tools.readSession.execute as Function)({ sessionId: 'tools' })

      // toTextHistory merges tool calls into text: "Let me check.\n[Tool: getPrice ...]"
      const assistantMsg = result.messages.find((m: any) => m.role === 'assistant')
      expect(assistantMsg).toBeTruthy()
      expect(assistantMsg.text).toContain('Let me check.')
      expect(assistantMsg.text).toContain('[Tool: getPrice')
    })

    it('respects limit parameter', async () => {
      const lines = Array.from({ length: 10 }, (_, i) =>
        makeEntry('user', `msg ${i}`),
      ).join('\n') + '\n'
      await writeFile(join(tmpDir, 'many.jsonl'), lines)

      const tools = createSessionTools(cc, tmpDir)
      const result = await (tools.readSession.execute as Function)({ sessionId: 'many', limit: 3 })

      expect(result.total).toBe(10)
      expect(result.messages).toHaveLength(3)
      // Should return the last 3
      expect(result.messages[0].text).toBe('msg 7')
      expect(result.messages[2].text).toBe('msg 9')
    })

    it('respects offset parameter for pagination', async () => {
      const lines = Array.from({ length: 10 }, (_, i) =>
        makeEntry('user', `msg ${i}`),
      ).join('\n') + '\n'
      await writeFile(join(tmpDir, 'many.jsonl'), lines)

      const tools = createSessionTools(cc, tmpDir)
      const result = await (tools.readSession.execute as Function)({ sessionId: 'many', limit: 3, offset: 2 })

      expect(result.messages).toHaveLength(3)
      // offset=2 means skip last 2, then take last 3 → msg 5, 6, 7
      expect(result.messages[0].text).toBe('msg 5')
      expect(result.messages[2].text).toBe('msg 7')
    })

    it('rejects path traversal attempts', async () => {
      const tools = createSessionTools(cc, tmpDir)
      const result = await (tools.readSession.execute as Function)({ sessionId: '../../etc/passwd' })
      expect(result.error).toBe('Invalid session ID')
    })

    it('skips malformed JSON lines gracefully', async () => {
      const lines = [
        makeEntry('user', 'good line'),
        'NOT VALID JSON{{{',
        makeEntry('assistant', 'also good'),
      ].join('\n') + '\n'
      await writeFile(join(tmpDir, 'messy.jsonl'), lines)

      const tools = createSessionTools(cc, tmpDir)
      const result = await (tools.readSession.execute as Function)({ sessionId: 'messy' })

      expect(result.total).toBe(2)
      expect(result.messages[0].text).toBe('good line')
      expect(result.messages[1].text).toBe('also good')
    })
  })
})
