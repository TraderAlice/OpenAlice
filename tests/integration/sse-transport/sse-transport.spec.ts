/**
 * SSE transport integration test.
 *
 * Stands up a real Hono HTTP server with the same SSE pattern as chat.ts,
 * then uses a raw HTTP client to verify events arrive in real-time.
 *
 * This tests the gap that unit tests don't cover: the actual HTTP transport
 * from server-side writeSSE() through @hono/node-server to the client.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serve } from '@hono/node-server'
import http from 'node:http'

// ==================== Helpers ====================

interface TestServer {
  port: number
  close: () => void
}

function startServer(app: Hono): Promise<TestServer> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      resolve({ port: info.port, close: () => server.close() })
    })
  })
}

/** Minimal SSE client using raw http.get — no external dependencies. */
function createSSEClient(url: string): {
  events: string[]
  connected: Promise<void>
  waitForEvents: (count: number, timeoutMs?: number) => Promise<string[]>
  close: () => void
} {
  const events: string[] = []
  let req: http.ClientRequest | null = null
  let resolveConnected: () => void
  let rejectConnected: (err: Error) => void
  const connected = new Promise<void>((res, rej) => {
    resolveConnected = res
    rejectConnected = rej
  })

  // Waiters for specific event counts
  let eventWaiter: { count: number; resolve: (events: string[]) => void; reject: (err: Error) => void } | null = null

  req = http.get(url, (res) => {
    if (res.statusCode !== 200) {
      rejectConnected(new Error(`SSE status ${res.statusCode}`))
      return
    }
    resolveConnected()

    let buffer = ''
    res.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()

      // Parse SSE format: lines separated by \n\n
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)

        // Extract data lines (skip event:, id:, etc.)
        const dataLines = block.split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())

        if (dataLines.length > 0) {
          const data = dataLines.join('\n')
          if (data) {
            events.push(data)
            if (eventWaiter && events.length >= eventWaiter.count) {
              eventWaiter.resolve([...events])
              eventWaiter = null
            }
          }
        }
      }
    })
  })

  req.on('error', (err) => rejectConnected(err))

  return {
    events,
    connected,
    waitForEvents(count: number, timeoutMs = 5000): Promise<string[]> {
      if (events.length >= count) return Promise.resolve([...events])
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          eventWaiter = null
          reject(new Error(`SSE timeout: got ${events.length}/${count} events`))
        }, timeoutMs)
        eventWaiter = {
          count,
          resolve: (evts) => { clearTimeout(timer); resolve(evts) },
          reject: (err) => { clearTimeout(timer); reject(err) },
        }
      })
    },
    close() {
      req?.destroy()
    },
  }
}

// ==================== Tests ====================

describe('SSE transport (real HTTP)', () => {
  const servers: TestServer[] = []
  const clients: ReturnType<typeof createSSEClient>[] = []

  afterEach(() => {
    clients.forEach(c => c.close())
    clients.length = 0
    servers.forEach(s => s.close())
    servers.length = 0
  })

  it('writeSSE delivers events to client in real-time', async () => {
    // Shared state between SSE and POST routes (same pattern as chat.ts)
    type SSEClient = { id: string; send: (data: string) => void }
    const sseClients = new Map<string, SSEClient>()

    const app = new Hono()

    app.get('/events', (c) => {
      return streamSSE(c, async (stream) => {
        sseClients.set('test', {
          id: 'test',
          send: (data) => { stream.writeSSE({ data }).catch(() => {}) },
        })
        stream.onAbort(() => { sseClients.delete('test') })
        await new Promise<void>(() => {}) // keep alive
      })
    })

    app.post('/send', async (c) => {
      const { events } = await c.req.json() as { events: Array<{ type: string; [k: string]: unknown }> }
      for (const event of events) {
        const data = JSON.stringify({ type: 'stream', event })
        for (const client of sseClients.values()) {
          try { client.send(data) } catch { /* disconnected */ }
        }
      }
      return c.json({ ok: true })
    })

    const server = await startServer(app)
    servers.push(server)

    // Connect SSE client
    const sse = createSSEClient(`http://localhost:${server.port}/events`)
    clients.push(sse)
    await sse.connected

    // Small delay for client registration
    await new Promise(r => setTimeout(r, 50))

    // Send events via POST (simulating chat.ts handler)
    const testEvents = [
      { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/tmp' } },
      { type: 'tool_result', tool_use_id: 't1', content: 'file contents' },
      { type: 'text', text: 'Here is the file' },
    ]

    const waitPromise = sse.waitForEvents(3)
    await fetch(`http://localhost:${server.port}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: testEvents }),
    })

    const received = await waitPromise
    expect(received).toHaveLength(3)

    const parsed = received.map(e => JSON.parse(e))
    expect(parsed[0]).toEqual({ type: 'stream', event: testEvents[0] })
    expect(parsed[1]).toEqual({ type: 'stream', event: testEvents[1] })
    expect(parsed[2]).toEqual({ type: 'stream', event: testEvents[2] })
  })

  it('fire-and-forget writeSSE still delivers events (race condition test)', async () => {
    type SSEClient = { id: string; send: (data: string) => void }
    const sseClients = new Map<string, SSEClient>()

    const app = new Hono()

    app.get('/events', (c) => {
      return streamSSE(c, async (stream) => {
        sseClients.set('test', {
          id: 'test',
          send: (data) => { stream.writeSSE({ data }).catch(() => {}) },
        })
        stream.onAbort(() => { sseClients.delete('test') })
        await new Promise<void>(() => {})
      })
    })

    app.post('/send', async (c) => {
      // Simulate chat.ts: fire-and-forget SSE writes, then return JSON
      const events = [
        { type: 'tool_use', id: 't1', name: 'Test', input: {} },
        { type: 'tool_result', tool_use_id: 't1', content: 'result' },
        { type: 'text', text: 'done' },
      ]
      for (const event of events) {
        const data = JSON.stringify({ type: 'stream', event })
        for (const client of sseClients.values()) {
          try { client.send(data) } catch {}
        }
      }
      return c.json({ text: 'done' })
    })

    const server = await startServer(app)
    servers.push(server)

    const sse = createSSEClient(`http://localhost:${server.port}/events`)
    clients.push(sse)
    await sse.connected
    await new Promise(r => setTimeout(r, 50))

    const waitPromise = sse.waitForEvents(3)

    // POST and wait for response
    const resp = await fetch(`http://localhost:${server.port}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const postResult = await resp.json()
    expect(postResult).toEqual({ text: 'done' })

    // SSE events should still arrive even though POST already returned
    const received = await waitPromise
    expect(received).toHaveLength(3)

    const types = received.map(e => JSON.parse(e).event.type)
    expect(types).toEqual(['tool_use', 'tool_result', 'text'])
  })

  it('async events (simulating Claude Code CLI timing) arrive in order', async () => {
    type SSEClient = { id: string; send: (data: string) => void }
    const sseClients = new Map<string, SSEClient>()

    const app = new Hono()

    app.get('/events', (c) => {
      return streamSSE(c, async (stream) => {
        sseClients.set('test', {
          id: 'test',
          send: (data) => { stream.writeSSE({ data }).catch(() => {}) },
        })
        stream.onAbort(() => { sseClients.delete('test') })
        await new Promise<void>(() => {})
      })
    })

    app.post('/send', async (c) => {
      // Simulate Claude Code CLI: events arrive with async delays
      const events = [
        { type: 'text', text: 'Let me check...' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/tmp' } },
        { type: 'tool_result', tool_use_id: 't1', content: 'contents' },
        { type: 'text', text: 'Here are the contents' },
      ]

      for (const event of events) {
        await new Promise(r => setTimeout(r, 10))
        const data = JSON.stringify({ type: 'stream', event })
        for (const client of sseClients.values()) {
          try { client.send(data) } catch {}
        }
      }

      return c.json({ text: 'Here are the contents' })
    })

    const server = await startServer(app)
    servers.push(server)

    const sse = createSSEClient(`http://localhost:${server.port}/events`)
    clients.push(sse)
    await sse.connected
    await new Promise(r => setTimeout(r, 50))

    const waitPromise = sse.waitForEvents(4)

    await fetch(`http://localhost:${server.port}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const received = await waitPromise
    expect(received).toHaveLength(4)

    const types = received.map(e => JSON.parse(e).event.type)
    expect(types).toEqual(['text', 'tool_use', 'tool_result', 'text'])
  })

  // ==================== Streaming POST tests (new architecture) ====================

  it('POST returns SSE stream with events and done (streaming POST pattern)', async () => {
    const app = new Hono()

    app.post('/chat', (c) => {
      return streamSSE(c, async (sseStream) => {
        const events = [
          { type: 'tool_use', id: 't1', name: 'getQuote', input: { symbol: 'AAPL' } },
          { type: 'tool_result', tool_use_id: 't1', content: '{"price": 185}' },
          { type: 'text', text: 'AAPL is at $185' },
        ]
        for (const event of events) {
          await sseStream.writeSSE({ data: JSON.stringify({ type: 'stream', event }) })
        }
        await sseStream.writeSSE({
          data: JSON.stringify({ type: 'done', text: 'AAPL is at $185', media: [] }),
        })
      })
    })

    const server = await startServer(app)
    servers.push(server)

    // Read SSE from POST response body (same as frontend sendStreaming)
    const res = await fetch(`http://localhost:${server.port}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'check AAPL' }),
    })

    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const text = await res.text()
    const events = text
      .split('\n\n')
      .filter(block => block.trim())
      .map(block => {
        const dataLine = block.split('\n').find(l => l.startsWith('data:'))
        return dataLine ? JSON.parse(dataLine.slice(5).trim()) : null
      })
      .filter(Boolean)

    expect(events).toHaveLength(4)
    expect(events[0]).toEqual({ type: 'stream', event: { type: 'tool_use', id: 't1', name: 'getQuote', input: { symbol: 'AAPL' } } })
    expect(events[1]).toEqual({ type: 'stream', event: { type: 'tool_result', tool_use_id: 't1', content: '{"price": 185}' } })
    expect(events[2]).toEqual({ type: 'stream', event: { type: 'text', text: 'AAPL is at $185' } })
    expect(events[3]).toEqual({ type: 'done', text: 'AAPL is at $185', media: [] })
  })

  it('POST SSE stream delivers events incrementally (not buffered)', async () => {
    const app = new Hono()

    app.post('/chat', (c) => {
      return streamSSE(c, async (sseStream) => {
        await sseStream.writeSSE({ data: JSON.stringify({ type: 'stream', event: { type: 'text', text: 'thinking...' } }) })
        await new Promise(r => setTimeout(r, 50))
        await sseStream.writeSSE({ data: JSON.stringify({ type: 'stream', event: { type: 'tool_use', id: 't1', name: 'Read', input: {} } }) })
        await new Promise(r => setTimeout(r, 50))
        await sseStream.writeSSE({ data: JSON.stringify({ type: 'stream', event: { type: 'tool_result', tool_use_id: 't1', content: 'data' } }) })
        await new Promise(r => setTimeout(r, 50))
        await sseStream.writeSSE({ data: JSON.stringify({ type: 'done', text: 'done', media: [] }) })
      })
    })

    const server = await startServer(app)
    servers.push(server)

    const res = await fetch(`http://localhost:${server.port}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test' }),
    })

    // Parse SSE incrementally using ReadableStream (same as frontend sendStreaming)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const parsed: unknown[] = []
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const dataLines = block.split('\n')
          .filter(l => l.startsWith('data:'))
          .map(l => l.slice(5).trim())
        if (dataLines.length > 0) {
          try { parsed.push(JSON.parse(dataLines.join('\n'))) } catch {}
        }
      }
    }

    expect(parsed).toHaveLength(4)
    const types = parsed.map((e: any) => e.type === 'stream' ? e.event.type : e.type)
    expect(types).toEqual(['text', 'tool_use', 'tool_result', 'done'])
  })

  it('POST SSE stream + separate SSE clients both receive events (multi-tab)', async () => {
    type Client = { id: string; send: (data: string) => void }
    const sseClients = new Map<string, Client>()

    const app = new Hono()

    // Separate SSE endpoint (for other tabs)
    app.get('/events', (c) => {
      return streamSSE(c, async (stream) => {
        sseClients.set('tab2', {
          id: 'tab2',
          send: (data) => { stream.writeSSE({ data }).catch(() => {}) },
        })
        stream.onAbort(() => { sseClients.delete('tab2') })
        await new Promise<void>(() => {})
      })
    })

    // POST returns SSE stream (for requesting tab) + pushes to other clients
    app.post('/chat', (c) => {
      return streamSSE(c, async (sseStream) => {
        const events = [
          { type: 'tool_use', id: 't1', name: 'Test', input: {} },
          { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
          { type: 'text', text: 'result' },
        ]
        for (const event of events) {
          const data = JSON.stringify({ type: 'stream', event })
          await sseStream.writeSSE({ data })
          // Push to other SSE clients (multi-tab)
          for (const client of sseClients.values()) {
            try { client.send(data) } catch {}
          }
        }
        await sseStream.writeSSE({
          data: JSON.stringify({ type: 'done', text: 'result', media: [] }),
        })
      })
    })

    const server = await startServer(app)
    servers.push(server)

    // Tab 2: connect via SSE
    const tab2 = createSSEClient(`http://localhost:${server.port}/events`)
    clients.push(tab2)
    await tab2.connected
    await new Promise(r => setTimeout(r, 50))

    // Tab 1: POST (gets SSE stream back)
    const tab2Wait = tab2.waitForEvents(3)
    const res = await fetch(`http://localhost:${server.port}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test' }),
    })

    // Tab 1: verify POST SSE stream
    const postText = await res.text()
    const postEvents = postText
      .split('\n\n')
      .filter(b => b.trim())
      .map(b => {
        const d = b.split('\n').find(l => l.startsWith('data:'))
        return d ? JSON.parse(d.slice(5).trim()) : null
      })
      .filter(Boolean)

    expect(postEvents).toHaveLength(4) // 3 stream + 1 done
    expect(postEvents[3]).toEqual({ type: 'done', text: 'result', media: [] })

    // Tab 2: verify SSE events arrived
    const tab2Events = await tab2Wait
    expect(tab2Events).toHaveLength(3)
    const tab2Types = tab2Events.map(e => JSON.parse(e).event.type)
    expect(tab2Types).toEqual(['tool_use', 'tool_result', 'text'])
  })
})
