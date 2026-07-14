import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  createConnectorIOEvent,
  type ConnectorIOEvent,
  type ConnectorIOEventInput,
  type ConnectorIORecorder,
} from './io-events.js'

export interface ConnectorIOJournalOptions {
  path: string
  maxBytes?: number
  warn?: (message: string) => void
}

/**
 * Best-effort, bounded JSONL journal for deterministic connector replay.
 * Writes are serialized, rotate at a fixed size, and never fail delivery.
 */
export class ConnectorIOJournal implements ConnectorIORecorder {
  private chain = Promise.resolve()
  private initialized = false

  constructor(private readonly options: ConnectorIOJournalOptions) {}

  record(input: ConnectorIOEventInput): Promise<void> {
    const event = createConnectorIOEvent(input)
    this.chain = this.chain.then(() => this.write(event)).catch((error) => {
      this.options.warn?.(`Connector I/O journal unavailable: ${message(error)}`)
    })
    return this.chain
  }

  async flush(): Promise<void> {
    await this.chain
  }

  private async write(event: ConnectorIOEvent): Promise<void> {
    if (!this.initialized) {
      await mkdir(dirname(this.options.path), { recursive: true, mode: 0o700 })
      this.initialized = true
    }
    const line = `${JSON.stringify(event)}\n`
    await this.rotateIfNeeded(Buffer.byteLength(line))
    await appendFile(this.options.path, line, { encoding: 'utf8', mode: 0o600 })
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    const maxBytes = this.options.maxBytes ?? 5 * 1024 * 1024
    const currentBytes = await stat(this.options.path).then((value) => value.size).catch(() => 0)
    if (currentBytes === 0 || currentBytes + incomingBytes <= maxBytes) return
    const rotated = `${this.options.path}.1`
    await rm(rotated, { force: true })
    await rename(this.options.path, rotated)
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
