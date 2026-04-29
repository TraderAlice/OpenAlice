import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { toModelMessages, toTextHistory, toChatHistory, SessionStore, MemorySessionStore, type SessionEntry, type ContentBlock } from './session.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ==================== Helpers ====================

function makeEntry(overrides: Partial<SessionEntry> & Pick<SessionEntry, 'type' | 'message'>): SessionEntry {
  return {
    uuid: 'u1',
    parentUuid: null,
    sessionId: 's1',
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function userText(content: string): SessionEntry {
  return makeEntry({ type: 'user', message: { role: 'user', content } })
}

function assistantText(content: string): SessionEntry {
  return makeEntry({ type: 'assistant', message: { role: 'assistant', content } })
}

function assistantBlocks(blocks: ContentBlock[]): SessionEntry {
  return makeEntry({ type: 'assistant', message: { role: 'assistant', content: blocks } })
}

function userBlocks(blocks: ContentBlock[]): SessionEntry {
  return makeEntry({ type: 'user', message: { role: 'user', content: blocks } })
}

function compactBoundary(): SessionEntry {
  return makeEntry({
    type: 'system',
    subtype: 'compact_boundary',
    message: { role: 'system', content: 'Conversation compacted' },
  })
}

// ==================== toModelMessages ====================

describe('toModelMessages', () => {
  it('should return empty for empty input', () => {
    expect(toModelMessages([])).toEqual([])
  })

  it('should convert user text to SDK user message', () => {
    const msgs = toModelMessages([userText('hello')])
    expect(msgs).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('should convert assistant text to SDK assistant message', () => {
    const msgs = toModelMessages([assistantText('hi there')])
    expect(msgs).toEqual([{ role: 'assistant', content: 'hi there' }])
  })

  it('should skip compact_boundary entries', () => {
    const msgs = toModelMessages([
      userText('before'),
      compactBoundary(),
      assistantText('after'),
    ])
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toEqual({ role: 'user', content: 'before' })
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'after' })
  })

  it('should convert assistant content blocks with tool_use', () => {
    const msgs = toModelMessages([
      assistantBlocks([
        { type: 'text', text: 'thinking...' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/tmp' } },
      ]),
      userBlocks([
        { type: 'tool_result', tool_use_id: 't1', content: 'file contents' },
      ]),
    ])
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('assistant')
    const content = (msgs[0] as { content: unknown[] }).content
    expect(content).toHaveLength(2)
    expect(content[0]).toEqual({ type: 'text', text: 'thinking...' })
    expect(content[1]).toEqual({
      type: 'tool-call',
      toolCallId: 't1',
      toolName: 'Read',
      input: { path: '/tmp' },
    })
  })

  it('should convert user content blocks with tool_result to SDK tool message', () => {
    const msgs = toModelMessages([
      userBlocks([
        { type: 'tool_result', tool_use_id: 't1', content: 'file contents' },
      ]),
    ])
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('tool')
    const content = (msgs[0] as { content: unknown[] }).content
    expect(content[0]).toMatchObject({
      type: 'tool-result',
      toolCallId: 't1',
      toolName: 'unknown',
    })
  })

  it('should convert user content blocks with only text to user message', () => {
    const msgs = toModelMessages([
      userBlocks([
        { type: 'text', text: 'line 1' },
        { type: 'text', text: 'line 2' },
      ]),
    ])
    expect(msgs).toEqual([{ role: 'user', content: 'line 1\nline 2' }])
  })

  it('should skip user blocks with only empty text', () => {
    const msgs = toModelMessages([
      userBlocks([{ type: 'text', text: '' }]),
    ])
    expect(msgs).toEqual([])
  })

  it('should skip empty assistant block arrays', () => {
    const msgs = toModelMessages([assistantBlocks([])])
    expect(msgs).toEqual([])
  })

  it('should handle a full conversation round-trip', () => {
    const msgs = toModelMessages([
      userText('What is the weather?'),
      assistantBlocks([
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 'w1', name: 'WeatherLookup', input: { city: 'NYC' } },
      ]),
      userBlocks([
        { type: 'tool_result', tool_use_id: 'w1', content: '72°F sunny' },
      ]),
      assistantText('It is 72°F and sunny in NYC.'),
    ])
    expect(msgs).toHaveLength(4)
    expect(msgs[0].role).toBe('user')
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[2].role).toBe('tool')
    expect(msgs[3].role).toBe('assistant')
  })

  it('should strip orphaned tool-call entries that have no matching tool-result', () => {
    const msgs = toModelMessages([
      userText('do two things'),
      // Assistant calls two tools, but only one result exists
      assistantBlocks([
        { type: 'tool_use', id: 't1', name: 'ToolA', input: {} },
        { type: 'tool_use', id: 't2', name: 'ToolB', input: {} },
      ]),
      // Only t1 has a result — t2 is orphaned (e.g. session interrupted)
      userBlocks([
        { type: 'tool_result', tool_use_id: 't1', content: 'result A' },
      ]),
      assistantText('done'),
    ])
    // Assistant message should only contain the tool-call for t1
    expect(msgs).toHaveLength(4)
    const assistantContent = (msgs[1] as { content: unknown[] }).content
    expect(assistantContent).toHaveLength(1)
    expect((assistantContent[0] as { toolCallId: string }).toolCallId).toBe('t1')
  })

  it('should drop assistant message entirely if all tool-calls are orphaned', () => {
    const msgs = toModelMessages([
      userText('hi'),
      // Assistant only has tool_use, no results exist at all
      assistantBlocks([
        { type: 'tool_use', id: 'orphan1', name: 'Missing', input: {} },
      ]),
      assistantText('recovered'),
    ])
    // The orphaned assistant message should be dropped
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toEqual({ role: 'user', content: 'hi' })
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'recovered' })
  })
})

// ==================== toTextHistory ====================

describe('toTextHistory', () => {
  it('should return empty for empty input', () => {
    expect(toTextHistory([])).toEqual([])
  })

  it('should convert string content', () => {
    const history = toTextHistory([
      userText('hi'),
      assistantText('hello'),
    ])
    expect(history).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'hello' },
    ])
  })

  it('should skip system entries', () => {
    const history = toTextHistory([
      userText('hi'),
      compactBoundary(),
      assistantText('hello'),
    ])
    expect(history).toHaveLength(2)
  })

  it('should summarize tool_use blocks', () => {
    const history = toTextHistory([
      assistantBlocks([
        { type: 'text', text: 'checking' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/tmp/a.txt' } },
      ]),
    ])
    expect(history).toHaveLength(1)
    expect(history[0].text).toContain('checking')
    expect(history[0].text).toContain('[Tool: Read')
  })

  it('should summarize tool_result blocks', () => {
    const history = toTextHistory([
      userBlocks([
        { type: 'tool_result', tool_use_id: 't1', content: 'the file contents here' },
      ]),
    ])
    expect(history).toHaveLength(1)
    expect(history[0].text).toContain('[Result:')
  })

  it('should skip entries with only whitespace text', () => {
    const history = toTextHistory([
      userBlocks([{ type: 'text', text: '   ' }]),
    ])
    expect(history).toEqual([])
  })
})

// ==================== toChatHistory ====================

describe('toChatHistory', () => {
  it('should return empty for empty input', () => {
    expect(toChatHistory([])).toEqual([])
  })

  it('should convert simple text messages', () => {
    const items = toChatHistory([
      userText('hi'),
      assistantText('hello'),
    ])
    expect(items).toEqual([
      { kind: 'text', role: 'user', text: 'hi', timestamp: '2026-01-01T00:00:00Z', metadata: undefined, cursor: 'u1' },
      { kind: 'text', role: 'assistant', text: 'hello', timestamp: '2026-01-01T00:00:00Z', metadata: undefined, cursor: 'u1' },
    ])
  })

  it('should skip system entries', () => {
    const items = toChatHistory([
      userText('hi'),
      compactBoundary(),
      assistantText('hello'),
    ])
    expect(items).toHaveLength(2)
  })

  it('should pair tool_use with tool_result from next entry', () => {
    const items = toChatHistory([
      assistantBlocks([
        { type: 'tool_use', id: 't1', name: 'mcp__open-alice__Read', input: { path: '/tmp' } },
      ]),
      userBlocks([
        { type: 'tool_result', tool_use_id: 't1', content: 'file contents here' },
      ]),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('tool_calls')
    if (items[0].kind === 'tool_calls') {
      expect(items[0].calls).toHaveLength(1)
      expect(items[0].calls[0].name).toBe('Read') // MCP prefix stripped
      expect(items[0].calls[0].result).toContain('file contents')
    }
  })

  it('should not duplicate consumed tool_result entries', () => {
    const items = toChatHistory([
      assistantBlocks([
        { type: 'tool_use', id: 't1', name: 'Read', input: {} },
      ]),
      userBlocks([
        { type: 'tool_result', tool_use_id: 't1', content: 'result' },
      ]),
      assistantText('done'),
    ])
    // tool_calls + text = 2 items (tool_result consumed, not separate)
    expect(items).toHaveLength(2)
    expect(items[0].kind).toBe('tool_calls')
    expect(items[1].kind).toBe('text')
  })

  it('should emit text blocks alongside tool_use in same entry', () => {
    const items = toChatHistory([
      assistantBlocks([
        { type: 'text', text: 'Let me check' },
        { type: 'tool_use', id: 't1', name: 'Search', input: { q: 'test' } },
      ]),
    ])
    // Should produce text before tool_calls (边想边做)
    expect(items).toHaveLength(2)
    expect(items[0].kind).toBe('text')
    expect(items[1].kind).toBe('tool_calls')
    if (items[0].kind === 'text') {
      expect(items[0].text).toBe('Let me check')
    }
  })

  it('should skip standalone tool_result entries (orphaned)', () => {
    const items = toChatHistory([
      userBlocks([
        { type: 'tool_result', tool_use_id: 't1', content: 'orphaned' },
      ]),
    ])
    expect(items).toEqual([])
  })

  it('should handle image blocks', () => {
    const items = toChatHistory([
      assistantBlocks([
        { type: 'text', text: 'here is the image' },
        { type: 'image', url: 'http://example.com/img.png' },
      ]),
    ])
    expect(items).toHaveLength(1)
    if (items[0].kind === 'text') {
      expect(items[0].media).toEqual([{ type: 'image', url: 'http://example.com/img.png' }])
    }
  })

  it('should skip entries with only whitespace text', () => {
    const items = toChatHistory([
      makeEntry({ type: 'user', message: { role: 'user', content: '   ' } }),
    ])
    expect(items).toEqual([])
  })
})

// ==================== MemorySessionStore ====================

describe('MemorySessionStore', () => {
  it('should start empty: exists() returns false', async () => {
    const store = new MemorySessionStore('m1')
    expect(await store.exists()).toBe(false)
  })

  it('should return true from exists() after an append', async () => {
    const store = new MemorySessionStore('m1')
    await store.appendUser('hello')
    expect(await store.exists()).toBe(true)
  })

  it('should persist user message and read it back', async () => {
    const store = new MemorySessionStore('m1')
    await store.appendUser('user says hi')
    const all = await store.readAll()
    expect(all).toHaveLength(1)
    expect(all[0].type).toBe('user')
    expect(all[0].message.content).toBe('user says hi')
  })

  it('should persist assistant message and read it back', async () => {
    const store = new MemorySessionStore('m1')
    await store.appendAssistant('assistant reply')
    const all = await store.readAll()
    expect(all).toHaveLength(1)
    expect(all[0].type).toBe('assistant')
    expect(all[0].provider).toBe('vercel-ai')
  })

  it('should chain UUIDs correctly across multiple appends', async () => {
    const store = new MemorySessionStore('m1')
    const e1 = await store.appendUser('first')
    const e2 = await store.appendAssistant('second')
    const e3 = await store.appendUser('third')
    expect(e1.parentUuid).toBeNull()
    expect(e2.parentUuid).toBe(e1.uuid)
    expect(e3.parentUuid).toBe(e2.uuid)
  })

  it('should include correct sessionId on all entries', async () => {
    const store = new MemorySessionStore('session-abc')
    await store.appendUser('msg')
    const all = await store.readAll()
    expect(all[0].sessionId).toBe('session-abc')
  })

  it('readActive() should return only entries after last compact_boundary', async () => {
    const store = new MemorySessionStore('m2')
    await store.appendUser('before boundary')
    const boundary: SessionEntry = {
      type: 'system',
      subtype: 'compact_boundary',
      message: { role: 'system', content: 'compacted' },
      uuid: 'b1',
      parentUuid: null,
      sessionId: 'm2',
      timestamp: new Date().toISOString(),
    }
    await store.appendRaw(boundary)
    await store.appendUser('after boundary')
    const active = await store.readActive()
    // getActiveEntries returns from the boundary onward (inclusive)
    expect(active.some(e => e.subtype === 'compact_boundary')).toBe(true)
    expect(active.some(e => e.message.content === 'after boundary')).toBe(true)
    expect(active.some(e => e.message.content === 'before boundary')).toBe(false)
  })

  it('restore() should set lastUuid so next append chains correctly', async () => {
    const store = new MemorySessionStore('m3')
    const e1 = await store.appendUser('existing')
    // Create a new store instance simulating a fresh load from same data
    const store2 = new MemorySessionStore('m3')
    await store2.appendRaw(e1)
    await store2.restore()
    const e2 = await store2.appendUser('new')
    expect(e2.parentUuid).toBe(e1.uuid)
  })

  it('appendAssistant() should attach custom metadata when provided', async () => {
    const store = new MemorySessionStore('m4')
    await store.appendAssistant('reply', 'claude-code', { kind: 'heartbeat' })
    const all = await store.readAll()
    expect(all[0].metadata).toEqual({ kind: 'heartbeat' })
  })
})

// ==================== SessionStore (filesystem) ====================

describe('SessionStore', () => {
  let tmpDir: string

  // HACK: SessionStore uses SESSIONS_DIR = join(process.cwd(), 'data', 'sessions') which is
  // a module-level constant, so we can't redirect it. We test using the default path
  // by cleaning up after ourselves instead.
  // To keep tests isolated we use a custom sessionId that won't clash.

  const testId = `test-session-${Date.now()}`

  afterEach(async () => {
    // Clean up session file written during test
    const { join: pathJoin } = await import('node:path')
    const { rm: fsRm } = await import('node:fs/promises')
    try {
      await fsRm(pathJoin(process.cwd(), 'data', 'sessions', `${testId}.jsonl`), { force: true })
    } catch { /* ignore */ }
  })

  it('exists() returns false for a new session', async () => {
    const store = new SessionStore(testId)
    expect(await store.exists()).toBe(false)
  })

  it('appendUser() creates file and can be read back', async () => {
    const store = new SessionStore(testId)
    await store.appendUser('hello from disk')
    expect(await store.exists()).toBe(true)
    const all = await store.readAll()
    expect(all).toHaveLength(1)
    expect(all[0].message.content).toBe('hello from disk')
    expect(all[0].sessionId).toBe(testId)
  })

  it('multiple appends chain UUIDs correctly', async () => {
    const store = new SessionStore(testId)
    const e1 = await store.appendUser('first')
    const e2 = await store.appendAssistant('second')
    expect(e1.parentUuid).toBeNull()
    expect(e2.parentUuid).toBe(e1.uuid)
  })

  it('restore() reads lastUuid from file so next append chains correctly', async () => {
    const store = new SessionStore(testId)
    const e1 = await store.appendUser('original')
    // New store instance (simulates process restart)
    const store2 = new SessionStore(testId)
    await store2.restore()
    const e2 = await store2.appendUser('after restore')
    expect(e2.parentUuid).toBe(e1.uuid)
  })

  it('readAll() returns [] for non-existent session (ENOENT)', async () => {
    const store = new SessionStore('definitely-does-not-exist-' + Date.now())
    expect(await store.readAll()).toEqual([])
  })
})
