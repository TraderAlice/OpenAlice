/**
 * Message reader — consumes incoming socket data and extracts framed messages.
 * Mirrors: ibapi/reader.py
 *
 * Node.js adaptation: Python uses a background thread + queue. Here we use
 * socket 'data' events → buffer accumulation → message extraction → callback.
 * No threads, no queue.
 */

import { readMsg } from './comm.js'
import type { Connection } from './connection.js'

export class EReader {
  private conn: Connection
  private buf: Buffer = Buffer.alloc(0)
  private onMessage: (msg: Buffer) => void

  constructor(conn: Connection, onMessage: (msg: Buffer) => void) {
    this.conn = conn
    this.onMessage = onMessage
  }

  /**
   * Start listening for incoming data.
   */
  start(): void {
    this.conn.on('data', () => {
      this.processData()
    })
  }

  /**
   * Process accumulated socket data, extracting complete messages.
   */
  private processData(): void {
    // Consume whatever has accumulated in the connection buffer
    const incoming = this.conn.consumeBuffer()
    if (incoming.length === 0) return

    this.buf = Buffer.concat([this.buf, incoming])

    // Extract as many complete messages as possible
    while (this.buf.length > 0) {
      const [size, msg, rest] = readMsg(this.buf)
      if (msg.length > 0) {
        this.buf = rest
        this.onMessage(msg)
      } else {
        // Incomplete message — wait for more data
        break
      }
    }
  }
}
