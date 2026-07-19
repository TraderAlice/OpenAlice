import './xterm-node-polyfill.js'

import { SerializeAddon } from '@xterm/addon-serialize'
import HeadlessXterm from '@xterm/headless'
import type { Terminal as XtermHeadlessTerminal } from '@xterm/headless'

import {
  installTerminalViewAttributeResponder,
  type TerminalViewAttributeResponder,
} from './terminal-view-attribute-responder.js'
import type { TerminalViewAttributes } from './terminal-view-attributes.js'

// This beta is published as CommonJS even though its declaration file exposes
// named exports. Native Node ESM therefore sees the package as one default
// namespace object; normalize that shape here instead of relying on bundler
// interop so source-backed, packaged, and ELECTRON_RUN_AS_NODE paths agree.
const { Terminal } = HeadlessXterm

type TerminalWithSynchronousWrite = XtermHeadlessTerminal & {
  _core?: {
    writeSync?: (data: string | Uint8Array) => void
    coreService?: {
      kittyKeyboard?: { flags?: number }
    }
  }
}

export interface HeadlessTerminalSnapshotOptions {
  readonly cols: number
  readonly rows: number
  readonly scrollbackRows?: number
  readonly onQueryReply?: (reply: string) => void
}

export interface HeadlessTerminalWriteOptions {
  /** Forward xterm-generated query replies for this exact write only. */
  readonly forwardQueryReplies?: boolean
}

const DEFAULT_SCROLLBACK_ROWS = 10_000

/**
 * Server-side xterm mirror used to turn a raw PTY byte stream into a compact,
 * authoritative ANSI snapshot for a fresh renderer.
 *
 * Adapted from stablyai/orca's HeadlessEmulator. OpenAlice deliberately keeps
 * its raw ReplayBuffer beside this mirror: raw bytes remain the persistence
 * and hot-attach contract, while cold attaches can restore the current screen
 * without replaying every historical TUI redraw.
 */
export class HeadlessTerminalSnapshot {
  private readonly terminal: XtermHeadlessTerminal
  private readonly serializer: SerializeAddon
  private readonly onQueryReply: ((reply: string) => void) | null
  private terminalViewAttributes: TerminalViewAttributes | null = null
  private readonly viewAttributeResponder: TerminalViewAttributeResponder
  private colorSchemeUpdatesSubscribed = false
  private queryReplyForwardingDepth = 0
  private pendingAsyncWrites = 0
  private disposed = false

  constructor(options: HeadlessTerminalSnapshotOptions) {
    this.terminal = new Terminal({
      cols: options.cols,
      rows: options.rows,
      scrollback: options.scrollbackRows ?? DEFAULT_SCROLLBACK_ROWS,
      allowProposedApi: true,
      logLevel: 'off',
      vtExtensions: { kittyKeyboard: true },
    })
    this.serializer = new SerializeAddon()
    this.terminal.loadAddon(this.serializer)
    this.onQueryReply = options.onQueryReply ?? null
    if (this.onQueryReply) {
      this.terminal.onData((reply) => {
        if (this.queryReplyForwardingDepth <= 0) return
        // xterm can emit an unsolicited native 997 push while parsing mode
        // 2031. Renderer truth owns that notification; forwarding the
        // headless default would race the explicit mode update.
        const filtered = reply.replace(/\x1b\[\?997;[12]n/g, '')
        if (filtered) this.onQueryReply?.(filtered)
      })
    }
    this.viewAttributeResponder = installTerminalViewAttributeResponder({
      parser: this.terminal.parser,
      getBaseAttributes: () => this.terminalViewAttributes,
      emitReply: (reply) => {
        if (this.queryReplyForwardingDepth > 0) this.onQueryReply?.(reply)
      },
    })
    this.installColorSchemeUpdateTracking()
  }

  write(data: string | Uint8Array, options: HeadlessTerminalWriteOptions = {}): void {
    if (this.disposed) return
    const forwardQueryReplies = options.forwardQueryReplies === true
    const core = (this.terminal as TerminalWithSynchronousWrite)._core
    if (typeof core?.writeSync === 'function') {
      if (forwardQueryReplies) this.queryReplyForwardingDepth += 1
      try {
        core.writeSync(data)
      } finally {
        if (forwardQueryReplies) this.queryReplyForwardingDepth -= 1
      }
      return
    }

    // Keep the reply window aligned with this exact queued write. The empty
    // sentinel opens it only after all earlier writes have parsed.
    this.pendingAsyncWrites += 1
    if (forwardQueryReplies) {
      this.terminal.write('', () => {
        this.queryReplyForwardingDepth += 1
      })
    }
    this.terminal.write(data, () => {
      if (forwardQueryReplies) this.queryReplyForwardingDepth -= 1
      this.pendingAsyncWrites -= 1
    })
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) return
    this.terminal.resize(cols, rows)
  }

  /**
   * Return null when queued writes have not parsed yet so callers can safely
   * fall back to the raw replay buffer instead of serializing partial state.
   */
  snapshot(): string | null {
    if (this.disposed || this.pendingAsyncWrites > 0) return null
    return this.serializer.serialize({ scrollback: DEFAULT_SCROLLBACK_ROWS })
  }

  /** SerializeAddon omits Kitty flags, so attach metadata carries them beside the snapshot. */
  getKittyKeyboardFlags(): number {
    const flags = (this.terminal as TerminalWithSynchronousWrite)._core?.coreService
      ?.kittyKeyboard?.flags
    return typeof flags === 'number' ? flags : 0
  }

  /** Apply the renderer's actual palette to the hidden-query authority. */
  setTerminalViewAttributes(attributes: TerminalViewAttributes): void {
    if (this.disposed) return
    this.terminalViewAttributes = attributes
    this.terminal.options.cursorStyle = attributes.cursorStyle
    this.terminal.options.cursorBlink = attributes.cursorBlink
    // A visible xterm theme assignment also replaces OSC color mutations.
    this.viewAttributeResponder.clearColorOverrides()
  }

  /** Contour/Kitty DEC mode 2031 subscription state tracked from live PTY output. */
  getColorSchemeUpdatesSubscribed(): boolean {
    return this.colorSchemeUpdatesSubscribed
  }

  private installColorSchemeUpdateTracking(): void {
    const contains2031 = (params: (number | number[])[]): boolean =>
      params.some((value) => Array.isArray(value) ? value.includes(2031) : value === 2031)
    this.terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
      if (contains2031(params)) this.colorSchemeUpdatesSubscribed = true
      return false
    })
    this.terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
      if (contains2031(params)) this.colorSchemeUpdatesSubscribed = false
      return false
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.terminal.dispose()
  }
}
