// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  backendRecoveryGeneration: 0,
  sockets: [] as Array<{
    url: string
    emitOpen: () => void
    emitClose: (code: number) => void
  }>,
}))

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ backendRecoveryGeneration: mocks.backendRecoveryGeneration }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {},
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    element = document.createElement('div')
    options: Record<string, unknown>
    parser = {
      registerCsiHandler: () => ({ dispose() {} }),
    }

    constructor(options: Record<string, unknown>) {
      this.options = options
    }

    loadAddon() {}
    open(container: HTMLElement) { container.appendChild(this.element) }
    attachCustomKeyEventHandler() {}
    hasSelection() { return false }
    focus() {}
    reset() {}
    write(_data: unknown, callback?: () => void) { callback?.() }
    onData() { return { dispose() {} } }
    onBinary() { return { dispose() {} } }
    dispose() {}
  },
}))

vi.mock('./renderer', () => ({
  attachWebglRenderer: () => null,
}))

vi.mock('./terminal-keyboard-controller', () => ({
  installTerminalKeyboardController: () => ({
    handle: () => true,
    dispose() {},
  }),
}))

vi.mock('./terminal-kitty-keyboard-mode-tracker', () => ({
  TerminalKittyKeyboardModeTracker: class {
    flags = 0
    reset() { this.flags = 0 }
    scan() {}
  },
}))

vi.mock('./terminalAppearance', () => ({
  colorSchemeUpdateSequence: () => '',
  terminalThemesEqual: () => true,
  useTerminalAppearance: () => ({
    mode: 'dark',
    theme: {},
    viewAttributes: {
      foreground: [255, 255, 255],
      background: [0, 0, 0],
      cursor: [255, 255, 255],
      ansi: [],
      colorSchemeMode: 'dark',
      cursorStyle: 'block',
      cursorBlink: true,
    },
  }),
}))

import { TerminalView } from './Terminal'

type SocketListener = (() => void) | ((event: { code: number } | { data: unknown }) => void)

class FakeWebSocket {
  readonly OPEN = 1
  readyState = 0
  binaryType: BinaryType = 'blob'
  readonly url: string
  private readonly listeners = new Map<string, SocketListener[]>()

  constructor(url: string | URL) {
    this.url = String(url)
    mocks.sockets.push({
      url: this.url,
      emitOpen: () => this.emitOpen(),
      emitClose: (code) => this.emit('close', { code }),
    })
  }

  send() {}
  close() { this.readyState = 3 }

  addEventListener(type: string, listener: SocketListener) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  private emitOpen() {
    this.readyState = this.OPEN
    for (const listener of this.listeners.get('open') ?? []) {
      ;(listener as () => void)()
    }
  }

  private emit(type: string, event: { code: number } | { data: unknown }) {
    this.readyState = 3
    for (const listener of this.listeners.get(type) ?? []) {
      ;(listener as (value: typeof event) => void)(event)
    }
  }
}

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

const reconnectDelays = [500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000]

async function startTerminal() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(mocks.sockets).toHaveLength(1)
}

async function exhaustReconnectBudget(options: { openBeforeClose?: boolean } = {}) {
  for (const delay of reconnectDelays) {
    act(() => {
      if (options.openBeforeClose) mocks.sockets.at(-1)!.emitOpen()
      mocks.sockets.at(-1)!.emitClose(1006)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(delay)
    })
  }
  act(() => {
    if (options.openBeforeClose) mocks.sockets.at(-1)!.emitOpen()
    mocks.sockets.at(-1)!.emitClose(1006)
  })
  expect(screen.getByRole('button', { name: 'retry this terminal connection' })).toBeTruthy()
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.backendRecoveryGeneration = 0
  mocks.sockets.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 500 })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('TerminalView backend recovery', () => {
  it('exhausts the retry budget when sockets open but close before attached', async () => {
    render(<TerminalView wsId="research" sessionId="session-1" wsUrl="ws://127.0.0.1:40123/pty" />)
    await startTerminal()

    await exhaustReconnectBudget({ openBeforeClose: true })

    expect(mocks.sockets).toHaveLength(13)
  })

  it('re-attaches the same Session when backend health recovers after the retry budget expires', async () => {
    const view = render(<TerminalView wsId="research" sessionId="session-1" wsUrl="ws://127.0.0.1:40123/pty" />)
    await startTerminal()
    await exhaustReconnectBudget()
    expect(mocks.sockets).toHaveLength(13)

    mocks.backendRecoveryGeneration = 1
    view.rerender(<TerminalView wsId="research" sessionId="session-1" wsUrl="ws://127.0.0.1:40123/pty" />)

    expect(mocks.sockets).toHaveLength(14)
    const recovered = new URL(mocks.sockets.at(-1)!.url)
    expect(recovered.searchParams.get('session')).toBe('session-1')
    expect(recovered.searchParams.get('takeover')).toBeNull()
  })

  it('offers an explicit retry after automatic reconnect stops', async () => {
    render(<TerminalView wsId="research" sessionId="session-1" wsUrl="ws://127.0.0.1:40123/pty" />)
    await startTerminal()
    await exhaustReconnectBudget()

    fireEvent.click(screen.getByRole('button', { name: 'retry this terminal connection' }))

    expect(mocks.sockets).toHaveLength(14)
    expect(new URL(mocks.sockets.at(-1)!.url).searchParams.get('takeover')).toBeNull()
  })

  it.each([
    ['auth', 4401],
    ['forbidden', 4403],
    ['another controller', 4001],
    ['locked ownership', 4409],
    ['missing Session', 4404],
  ] as const)('does not turn a fatal %s close into automatic recovery', async (_reason, code) => {
    const onSessionLost = vi.fn()
    const view = render(
      <TerminalView
        wsId="research"
        sessionId="session-1"
        wsUrl="ws://127.0.0.1:40123/pty"
        onSessionLost={onSessionLost}
      />,
    )
    await startTerminal()

    act(() => mocks.sockets[0]!.emitClose(code))
    expect(screen.queryByRole('button', { name: 'retry this terminal connection' })).toBeNull()

    mocks.backendRecoveryGeneration = 1
    view.rerender(
      <TerminalView
        wsId="research"
        sessionId="session-1"
        wsUrl="ws://127.0.0.1:40123/pty"
        onSessionLost={onSessionLost}
      />,
    )

    expect(mocks.sockets).toHaveLength(1)
    expect(onSessionLost).toHaveBeenCalledTimes(code === 4404 ? 1 : 0)
  })
})
