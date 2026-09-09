import type { Logger } from '../logger.js'
import { isJsonObject, type JsonObject } from './model.js'
import { PendingRequests, REQUEST_TIMEOUT_MS, type JsonlChannel } from './transport.js'

export interface JsonRpcError extends Error {
  readonly code: number
  readonly data?: unknown
}

export interface JsonRpcPeerHandlers {
  readonly onNotification: (method: string, params: unknown) => void
  /** Server-initiated request; the returned value becomes the JSON-RPC result. */
  readonly onRequest: (method: string, params: unknown, id: string | number) => Promise<unknown>
}

/**
 * Minimal bidirectional JSON-RPC 2.0 over a JSONL channel. ACP and Codex
 * app-server both use it; Codex omits the `jsonrpc` header on the wire, so the
 * header is optional on input and configurable on output.
 */
export class JsonRpcPeer {
  private readonly pending = new PendingRequests<unknown>('web-rpc')

  constructor(
    private readonly channel: JsonlChannel,
    private readonly logger: Logger,
    private readonly handlers: JsonRpcPeerHandlers,
    private readonly options: { readonly header: boolean } = { header: true },
  ) {
    channel.onMessage((message) => this.handle(message))
  }

  request(method: string, params: unknown = {}, timeoutMs: number | null = REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (this.channel.closed) return Promise.reject(new Error(`${method}: process exited`))
    const id = this.pending.nextId()
    const wait = this.pending.wait(id, method, timeoutMs)
    void this.channel.send(this.frame({ id, method, params })).catch((error: Error) => this.pending.reject(id, error))
    return wait
  }

  notify(method: string, params: unknown = {}): Promise<void> {
    if (this.channel.closed) return Promise.resolve()
    return this.channel.send(this.frame({ method, params })).catch((error: Error) => {
      this.logger.warn('web_session.notify_failed', { method, error })
    })
  }

  respond(id: string | number, result: unknown): Promise<void> {
    return this.channel.send(this.frame({ id, result })).catch((error: Error) => {
      this.logger.warn('web_session.respond_failed', { id, error })
    })
  }

  respondError(id: string | number, code: number, message: string): Promise<void> {
    return this.channel.send(this.frame({ id, error: { code, message } })).catch((error: Error) => {
      this.logger.warn('web_session.respond_failed', { id, error })
    })
  }

  dispose(error: Error): void {
    this.pending.rejectAll(error)
  }

  private frame(body: JsonObject): JsonObject {
    return this.options.header ? { jsonrpc: '2.0', ...body } : body
  }

  private handle(message: JsonObject): void {
    const id = message['id']
    const hasId = typeof id === 'string' || typeof id === 'number'
    if (typeof message['method'] === 'string') {
      if (hasId) {
        void this.handlers.onRequest(message['method'], message['params'], id)
          .then((result) => this.respond(id, result ?? {}))
          .catch((error: unknown) => {
            const rpc = error as Partial<JsonRpcError>
            return this.respondError(id, typeof rpc.code === 'number' ? rpc.code : -32603, rpc.message ?? String(error))
          })
      } else {
        this.handlers.onNotification(message['method'], message['params'])
      }
      return
    }
    if (!hasId) return
    const key = String(id)
    if ('error' in message && message['error'] !== null && message['error'] !== undefined) {
      const error = message['error']
      const detail = isJsonObject(error) ? error : { message: String(error) }
      const failure = new Error(
        `${this.pending.label(key) ?? 'request'} failed: ${String(detail['message'] ?? 'unknown error')}`,
      ) as JsonRpcError & { code: number; data?: unknown }
      failure.code = typeof detail['code'] === 'number' ? detail['code'] : -32000
      failure.data = detail['data']
      this.pending.reject(key, failure)
      return
    }
    this.pending.resolve(key, message['result'])
  }
}
