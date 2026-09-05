/**
 * Message reader — consumes incoming socket data and extracts framed messages.
 * Mirrors: ibapi/reader.py
 *
 * Node.js adaptation: Python uses a background thread + queue. Here we use
 * socket 'data' events → buffer accumulation → frame extraction → bounded
 * drain → callback. Dispatch is batched so a large inbound burst cannot
 * monopolise the event loop and starve other layers' timers.
 */

import { readMsg } from './comm.js'
import type { Connection } from './connection.js'

/** Messages dispatched per macrotask before yielding back to the event loop. */
export const MAX_MESSAGES_PER_TURN = 200

export class EReader {
  private conn: Connection
  private buf: Buffer = Buffer.alloc(0)
  private queue: Buffer[] = []
  private draining = false
  private stopped = false
  private dataListener: (() => void) | null = null
  private onMessage: (msg: Buffer) => void
  private onError?: (error: unknown) => void

  constructor(
    conn: Connection,
    onMessage: (msg: Buffer) => void,
    onError?: (error: unknown) => void,
  ) {
    this.conn = conn
    this.onMessage = onMessage
    this.onError = onError
  }

  /**
   * Start listening for incoming data.
   */
  start(): void {
    if (this.stopped || this.dataListener) return
    this.dataListener = (): void => {
      this.processData()
    }
    this.conn.on('data', this.dataListener)
  }

  /**
   * Detaches from the socket and discards everything still queued. Idempotent
   * and terminal: `start()` will not re-arm a stopped reader.
   */
  stop(): void {
    this.stopped = true
    this.draining = false
    this.queue.length = 0
    this.buf = Buffer.alloc(0)
    if (this.dataListener) {
      this.conn.off('data', this.dataListener)
      this.dataListener = null
    }
  }

  /**
   * Process accumulated socket data, extracting complete messages.
   */
  private processData(): void {
    if (this.stopped) return

    // Consume whatever has accumulated in the connection buffer
    const incoming = this.conn.consumeBuffer()
    if (incoming.length === 0) return

    this.buf = Buffer.concat([this.buf, incoming])

    // Framing must stay ordered and synchronous; only dispatch is deferred.
    while (this.buf.length > 0) {
      const [, msg, rest] = readMsg(this.buf)
      // Incomplete message: wait for more data
      if (msg.length === 0) break
      this.buf = rest
      this.queue.push(msg)
    }

    if (!this.draining) {
      this.draining = true
      this.drain()
    }
  }

  /**
   * Dispatch queued frames in order, at most MAX_MESSAGES_PER_TURN per
   * macrotask. Yielding with setImmediate lets pending timers fire between
   * batches instead of after the whole burst.
   */
  private drain(): void {
    let dispatched = 0

    while (this.queue.length > 0) {
      if (dispatched >= MAX_MESSAGES_PER_TURN) {
        setImmediate(() => {
          if (this.stopped) {
            this.draining = false
            return
          }
          this.drain()
        })
        return
      }

      const msg = this.queue.shift()!
      dispatched++
      try {
        this.onMessage(msg)
      } catch (error) {
        // Field alignment is no longer trustworthy, so drop every buffered
        // successor and let the client replace this connection.
        this.stop()
        if (!this.onError) throw error
        this.onError(error)
        return
      }
    }

    this.draining = false
  }
}
