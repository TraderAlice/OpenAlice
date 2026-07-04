import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as Xterm } from '@xterm/xterm';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

import {
  parseServerControl,
  type ClientControlMessage,
} from './protocol';
import { attachWebglRenderer } from './renderer';
import {
  describeTerminalInput,
  keySignature,
  TERMINAL_FONT_FAMILY,
  type KeyMap,
} from './terminalInput';
import {
  useResolvedTerminalTheme,
  useTerminalThemeStore,
  type TerminalThemePreference,
} from './terminalTheme';
// Lazy-import so the demo subtree (transcripts, fixtures, handlers) is
// dynamic-imported only when demo mode is actually on. With a static import,
// Rollup is conservative about module side-effects (the transcript file
// builds its frames at top level) and the transcript strings leak into the
// production bundle even though the call site is dead-code.
const DemoTerminalReplay = lazy(() =>
  import('../../demo/DemoTerminalReplay').then((m) => ({ default: m.DemoTerminalReplay })),
);

export type { KeyMap } from './terminalInput';

type Status = 'connecting' | 'reconnecting' | 'connected' | 'closed' | 'error' | 'kicked' | 'locked';

interface SocketMessageEventLike {
  readonly data: unknown;
}

interface SocketCloseEventLike {
  readonly code: number;
}

interface SocketLike {
  readonly OPEN: number;
  readyState: number;
  binaryType?: BinaryType;
  send(data: string | Uint8Array): void;
  close(): void;
  addEventListener(type: 'open', cb: () => void): void;
  addEventListener(type: 'message', cb: (ev: SocketMessageEventLike) => void): void;
  addEventListener(type: 'close', cb: (ev: SocketCloseEventLike) => void): void;
  addEventListener(type: 'error', cb: () => void): void;
}

class ElectronPtySocket implements SocketLike {
  readonly OPEN = 1;
  readonly CLOSED = 3;
  readyState = 0;

  private readonly connectionId: string;
  private readonly bridge: NonNullable<Window['openAlice']>['pty'];
  private readonly listeners = {
    open: new Set<() => void>(),
    message: new Set<(ev: SocketMessageEventLike) => void>(),
    close: new Set<(ev: SocketCloseEventLike) => void>(),
    error: new Set<() => void>(),
  };
  private readonly unsubscribers: Array<() => void> = [];
  private opened = false;

  constructor(input: { sessionId: string; cols: number; rows: number; controllerId: string; takeover?: boolean }) {
    const bridge = window.openAlice?.pty;
    if (!bridge) throw new Error('Electron PTY bridge is unavailable');
    this.bridge = bridge;
    this.connectionId = bridge.connect(input);
    this.unsubscribers.push(
      bridge.onMessage(this.connectionId, (msg) => {
        if (msg.type === 'control') {
          const text = typeof msg.data === 'string' ? msg.data : String(msg.data ?? '');
          const control = parseServerControl(text);
          if (control?.type === 'attached') this.emitOpen();
          this.emitMessage(text);
        } else {
          this.emitMessage(toArrayBuffer(msg.data));
        }
      }),
      bridge.onClose(this.connectionId, (msg) => {
        this.readyState = this.CLOSED;
        for (const cb of this.listeners.close) cb({ code: msg.code });
        this.cleanup();
      }),
    );
  }

  send(data: string | Uint8Array): void {
    if (this.readyState !== this.OPEN) return;
    if (typeof data === 'string') {
      const parsed = parseResizeControl(data);
      if (parsed) this.bridge.resize(this.connectionId, parsed.cols, parsed.rows);
      return;
    }
    this.bridge.send(this.connectionId, data);
  }

  close(): void {
    if (this.readyState === this.CLOSED) return;
    this.readyState = this.CLOSED;
    this.bridge.close(this.connectionId);
    this.cleanup();
  }

  addEventListener(type: 'open', cb: () => void): void;
  addEventListener(type: 'message', cb: (ev: SocketMessageEventLike) => void): void;
  addEventListener(type: 'close', cb: (ev: SocketCloseEventLike) => void): void;
  addEventListener(type: 'error', cb: () => void): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    cb: (() => void) | ((ev: SocketMessageEventLike | SocketCloseEventLike) => void),
  ): void {
    if (type === 'open') {
      this.listeners.open.add(cb as () => void);
      if (this.readyState === this.OPEN) queueMicrotask(cb as () => void);
    } else if (type === 'message') this.listeners.message.add(cb as (ev: SocketMessageEventLike) => void);
    else if (type === 'close') this.listeners.close.add(cb as (ev: SocketCloseEventLike) => void);
    else this.listeners.error.add(cb as () => void);
  }

  private emitMessage(data: unknown): void {
    for (const cb of this.listeners.message) cb({ data });
  }

  private emitOpen(): void {
    if (this.opened || this.readyState === this.CLOSED) return;
    this.opened = true;
    this.readyState = this.OPEN;
    for (const cb of this.listeners.open) cb();
  }

  private cleanup(): void {
    for (const unsub of this.unsubscribers.splice(0)) unsub();
  }
}

interface ExitInfo {
  readonly code: number;
  readonly signal: number | null;
}

/**
 * Map from a key signature (e.g. `"shift+enter"`) to the byte string sent to
 * the PTY when that key combination is pressed. Mirrors the role of
 * VSCode's `workbench.action.terminal.sendSequence` keybindings.
 *
 * Signature format: lowercase modifiers in the order `ctrl+alt+shift+meta`
 * followed by the key name (also lowercase), joined with `+`. The key name is
 * `event.key.toLowerCase()` — e.g. `"enter"`, `"tab"`, `"arrowup"`, `"f1"`,
 * `" "` (space), or printable chars like `"a"`.
 *
 * Examples:
 *   { "shift+enter": "\x1b\r" }        // Claude Code multiline (iTerm2-style)
 *   { "alt+enter":   "\x1b\r" }        // same, but bound to Alt+Enter
 *   { "ctrl+l":      "\x0c" }          // bypass xterm's own Ctrl+L
 *
 * Keys not in the map fall through to xterm.js's default handling.
 */
export interface TerminalViewProps {
  /** Workspace id — used only for the header label / logging context. */
  readonly wsId: string;
  /** Stable session record id. Required; emits `?session=<id>` on the WS. */
  readonly sessionId: string;
  /** Human-facing label shown in the terminal header. Falls back to wsId. */
  readonly label?: string;
  /** WebSocket URL base. Defaults to `${ws/wss}://${location.host}/pty`. */
  readonly wsUrl?: string;
  /**
   * Pre-xterm keydown interceptor. See `KeyMap`. Changing this prop does NOT
   * tear down the WebSocket — updates apply on the next keystroke.
   */
  readonly keyMap?: KeyMap;
  /**
   * Fires once per WS lifetime when the server's `attached` message lands.
   */
  readonly onAttached?: (sessionId: string) => void;
  /**
   * Fires when the WS closes with 4404 — server doesn't recognize the
   * sessionId (record paused-since-poll-lag, server restarted, …). The
   * caller drops the pin; right pane lands on ResumeCta or empty CTA.
   */
  readonly onSessionLost?: () => void;
}

export function TerminalView(props: TerminalViewProps): ReactElement {
  if (import.meta.env.VITE_DEMO_MODE) {
    return (
      <Suspense fallback={null}>
        <DemoTerminalReplay label={props.label ?? props.wsId} wsId={props.wsId} sessionId={props.sessionId} />
      </Suspense>
    );
  }
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [pid, setPid] = useState<number | null>(null);
  const [scrollbackTruncated, setScrollbackTruncated] = useState(false);
  const [exitInfo, setExitInfo] = useState<ExitInfo | null>(null);
  const [childExited, setChildExited] = useState(false);
  const takeoverNextAttachRef = useRef(false);
  const connectRef = useRef<(() => void) | null>(null);

  const wsId = props.wsId;
  const wsUrl = props.wsUrl;
  const sessionId = props.sessionId;
  const controllerIdRef = useRef<string>('');
  if (!controllerIdRef.current) controllerIdRef.current = getTerminalControllerId();

  const keyMapRef = useRef<KeyMap | undefined>(props.keyMap);
  keyMapRef.current = props.keyMap;
  const onAttachedRef = useRef<TerminalViewProps['onAttached']>(props.onAttached);
  onAttachedRef.current = props.onAttached;
  const onSessionLostRef = useRef<TerminalViewProps['onSessionLost']>(props.onSessionLost);
  onSessionLostRef.current = props.onSessionLost;

  // Terminal palette is its own preference, not just the app chrome theme. Read
  // the current value through a ref so the connect effect doesn't recreate the
  // terminal on a theme flip — a separate effect re-skins the live instance.
  const { profile: terminalThemeProfile } = useResolvedTerminalTheme();
  const themeRef = useRef(terminalThemeProfile.xtermTheme);
  themeRef.current = terminalThemeProfile.xtermTheme;
  const appliedThemeVariantRef = useRef(terminalThemeProfile.variant);
  const termRef = useRef<Xterm | null>(null);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = terminalThemeProfile.xtermTheme;

    if (appliedThemeVariantRef.current === terminalThemeProfile.variant) return;
    appliedThemeVariantRef.current = terminalThemeProfile.variant;
    // Muxy-style terminal theming treats the raw PTY stream as the source of
    // truth and the active theme as renderer config. Reattach so the server
    // replays raw scrollback through the current xterm theme/profile, without
    // mutating the output bytes themselves.
    connectRef.current?.();
  }, [terminalThemeProfile]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    setStatus('connecting');
    setPid(null);
    setScrollbackTruncated(false);
    setExitInfo(null);
    setChildExited(false);

    const term = new Xterm({
      theme: themeRef.current,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      macOptionIsMeta: true,
      convertEol: false,
    });
    termRef.current = term;

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    // WebGL is attached after the first real layout pass. xterm can briefly
    // expose a viewport before its render dimensions exist; fitting or writing
    // in that window trips Viewport.syncScrollArea's dimensions getter.
    let webgl: ReturnType<typeof attachWebglRenderer> = null;
    let lastCols = term.cols;
    let lastRows = term.rows;

    // Always cold attach: each TerminalView mount creates a fresh xterm
    // instance with no in-memory history, so the server must replay the full
    // buffer every time. (An earlier `since=<lastSeq>` localStorage scheme
    // was wrong: it would correctly skip bytes the xterm already had, but
    // since the xterm was newly mounted there were none to skip — the user
    // ended up with a blank pane after switching workspaces.)
    const currentUrl = (): string => {
      const params = new URLSearchParams({
        session: sessionId,
        cols: String(lastCols),
        rows: String(lastRows),
        client: controllerIdRef.current,
        kind: 'web',
      });
      if (takeoverNextAttachRef.current) params.set('takeover', '1');
      return `${wsUrl ?? defaultWsUrl()}?${params.toString()}`;
    };

    // The live socket is swapped out on every (re)connect; senders read it at
    // call time so xterm's stdin/binary subs survive a reconnect untouched.
    let activeWs: SocketLike | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let hasConnectedOnce = false;
    let teardown = false;
    let resizeObserver: ResizeObserver | null = null;
    let initTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingWriteFrame: ReturnType<typeof requestAnimationFrame> | undefined;

    const sendControl = (msg: ClientControlMessage): void => {
      const ws = activeWs;
      if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };

    const encoder = new TextEncoder();
    const debugInput = (): boolean => {
      try {
        return localStorage.getItem('openalice.terminal.debugInput') === '1';
      } catch {
        return false;
      }
    };

    const logInput = (source: string, data: string): void => {
      if (!debugInput()) return;
      console.debug('[openalice:terminal-input]', source, describeTerminalInput(data));
    };

    const sendStdin = (data: string): void => {
      logInput('stdin', data);
      const ws = activeWs;
      if (ws && ws.readyState === ws.OPEN) ws.send(encoder.encode(data));
    };

    const safeFocus = (): void => {
      try {
        term.focus();
      } catch {
        // xterm may still be completing renderer setup; focus can wait.
      }
    };

    const writeToTerm = (data: Uint8Array): void => {
      try {
        term.write(data);
      } catch (err) {
        if (teardown || pendingWriteFrame !== undefined) return;
        pendingWriteFrame = requestAnimationFrame(() => {
          pendingWriteFrame = undefined;
          if (teardown) return;
          try {
            term.write(data);
          } catch (retryErr) {
            console.warn('[openalice:terminal] dropped terminal frame after xterm write failure', retryErr ?? err);
          }
        });
      }
    };

    let suppressNextKeypress = false;
    let suppressNextKeypressTimer: ReturnType<typeof setTimeout> | undefined;

    const armSuppressNextKeypress = (): void => {
      suppressNextKeypress = true;
      if (suppressNextKeypressTimer) clearTimeout(suppressNextKeypressTimer);
      suppressNextKeypressTimer = setTimeout(() => {
        suppressNextKeypress = false;
        suppressNextKeypressTimer = undefined;
      }, 50);
    };

    const clearSuppressNextKeypress = (): void => {
      suppressNextKeypress = false;
      if (suppressNextKeypressTimer) clearTimeout(suppressNextKeypressTimer);
      suppressNextKeypressTimer = undefined;
    };

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const signature = keySignature(event);
      const map = keyMapRef.current;
      if (map === undefined) return true;
      const bytes = map[signature];
      if (bytes === undefined) return true;
      armSuppressNextKeypress();
      event.preventDefault();
      event.stopPropagation();
      logInput(`key:${signature}`, bytes);
      sendStdin(bytes);
      return false;
    });

    const suppressMappedKeypress = (event: KeyboardEvent): void => {
      if (!suppressNextKeypress) return;
      clearSuppressNextKeypress();
      event.preventDefault();
      event.stopPropagation();
    };

    container.addEventListener('keypress', suppressMappedKeypress, true);

    const handleResize = (): void => {
      safeFit(fit);
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols;
        lastRows = term.rows;
        sendControl({ type: 'resize', cols: lastCols, rows: lastRows });
      }
    };

    // Backoff schedule for transient drops (vite ws-proxy ECONNRESET, server
    // restart, sleep/wake). Cap the delay and the attempt count so a genuinely
    // dead backend stops the loop instead of retrying forever.
    const RECONNECT_BASE_MS = 500;
    const RECONNECT_MAX_MS = 10_000;
    const RECONNECT_MAX_ATTEMPTS = 12;

    const scheduleReconnect = (): void => {
      if (teardown) return;
      if (attempts >= RECONNECT_MAX_ATTEMPTS) {
        setStatus('closed');
        return;
      }
      attempts += 1;
      setStatus('reconnecting');
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** (attempts - 1), RECONNECT_MAX_MS);
      reconnectTimer = setTimeout(connect, delay);
    };

    function connect(): void {
      if (teardown) return;
      const previousWs = activeWs;
      activeWs = null;
      try {
        previousWs?.close();
      } catch {
        // Best-effort detach before a deliberate reattach/replay.
      }
      // Electron app mode has a preload PTY bridge, so it can bypass the
      // renderer -> localhost WebSocket hop. Browser/dev/Docker keep the
      // WebSocket path with the exact same xterm lifecycle.
      const ws: SocketLike = window.openAlice?.pty
        ? new ElectronPtySocket({
            sessionId,
            cols: lastCols,
            rows: lastRows,
            controllerId: controllerIdRef.current,
            takeover: takeoverNextAttachRef.current,
          })
        : new WebSocket(currentUrl());
      ws.binaryType = 'arraybuffer';
      activeWs = ws;
      setStatus(hasConnectedOnce ? 'reconnecting' : 'connecting');

      ws.addEventListener('open', () => {
        attempts = 0;
        takeoverNextAttachRef.current = false;
        // A reconnect re-attaches to a live xterm that already shows the
        // pre-drop screen, but the server cold-replays its full ring buffer on
        // every attach. Reset first so the replay repaints cleanly instead of
        // duplicating scrollback. (First connect: xterm is already blank.)
        if (hasConnectedOnce) term.reset();
        hasConnectedOnce = true;
        setStatus('connected');
        safeFocus();
        handleResize();
      });

      ws.addEventListener('message', (ev) => {
        if (teardown) return;
        const data: unknown = ev.data;
        if (typeof data === 'string') {
          const msg = parseServerControl(data);
          if (!msg) return;
          switch (msg.type) {
            case 'attached':
              setPid(msg.pid);
              setScrollbackTruncated(msg.scrollbackTruncated);
              onAttachedRef.current?.(msg.sessionId);
              break;
            case 'cursor':
              // No-op for now — see comment above on the URL `since` removal.
              break;
            case 'lifecycle':
              if (msg.kind === 'child-exit') {
                setChildExited(true);
              } else if (msg.kind === 'child-respawn') {
                setChildExited(false);
              }
              break;
            case 'exit':
              setExitInfo({ code: msg.code, signal: msg.signal });
              break;
          }
          return;
        }
        if (data instanceof ArrayBuffer) {
          writeToTerm(new Uint8Array(data));
        }
      });

      ws.addEventListener('close', (ev) => {
        if (activeWs !== ws) return; // superseded by a newer socket
        activeWs = null;
        // Server-side kick uses close code 4001 — separate from generic
        // disconnect. 4404 = server doesn't know this session id (record paused
        // or removed). Neither should reconnect: 4001 means another client owns
        // the session, 4404 means it's gone.
        if (ev.code === 4001) {
          setStatus('kicked');
          return;
        }
        if (ev.code === 4409) {
          setStatus('locked');
          return;
        }
        if (ev.code === 4404) {
          onSessionLostRef.current?.();
          setStatus('closed');
          return;
        }
        if (teardown) return;
        // Transient drop (ECONNRESET, abnormal 1006, …) — try to self-heal.
        scheduleReconnect();
      });
      // 'error' is always followed by 'close'; let the close handler drive the
      // reconnect so we don't double-schedule.
      ws.addEventListener('error', () => {});
    }
    connectRef.current = connect;

    const stdinSub = term.onData(sendStdin);
    const binarySub = term.onBinary((d) => {
      const ws = activeWs;
      if (!ws || ws.readyState !== ws.OPEN) return;
      logInput('binary', d);
      const bytes = new Uint8Array(d.length);
      for (let i = 0; i < d.length; i++) bytes[i] = d.charCodeAt(i) & 0xff;
      ws.send(bytes);
    });

    let initTries = 0;
    const init = (): void => {
      if (teardown) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if ((width < 50 || height < 30) && initTries < 40) {
        initTries += 1;
        initTimer = setTimeout(init, 25);
        return;
      }

      // WebGL by default; degrades to the DOM renderer on addon failure /
      // context loss, or when the `openalice.terminal.renderer` escape hatch
      // forces 'dom' (GPU-pipeline corruption can't be auto-detected — see
      // renderer.ts).
      webgl = attachWebglRenderer(term);
      handleResize();
      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(container);
      window.addEventListener('resize', handleResize);
      connect();
    };
    initTimer = setTimeout(init, 0);

    return () => {
      teardown = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (initTimer) clearTimeout(initTimer);
      if (pendingWriteFrame !== undefined) cancelAnimationFrame(pendingWriteFrame);
      stdinSub.dispose();
      binarySub.dispose();
      clearSuppressNextKeypress();
      resizeObserver?.disconnect();
      container.removeEventListener('keypress', suppressMappedKeypress, true);
      window.removeEventListener('resize', handleResize);
      try {
        activeWs?.close();
      } catch {
        // ignore
      }
      if (connectRef.current === connect) connectRef.current = null;
      webgl?.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [wsId, sessionId, wsUrl]);

  return (
    <div className="terminal-shell">
      <header className="terminal-header">
        <StatusDot status={status} />
        <span className="terminal-title">{props.label ?? wsId}</span>
        <span className="terminal-meta">
          {pid !== null ? `pid ${pid}` : ''}
          {childExited ? ' · child exited' : ''}
          {scrollbackTruncated ? ' · scrollback truncated' : ''}
          {exitInfo
            ? ` · session ended code=${exitInfo.code}${
                exitInfo.signal !== null ? ` signal=${exitInfo.signal}` : ''
              }`
            : ''}
        </span>
        {status === 'locked' && (
          <button
            type="button"
            className="terminal-header-action"
            onClick={() => {
              takeoverNextAttachRef.current = true;
              setStatus('connecting');
              connectRef.current?.();
            }}
            title="take over this session"
          >
            take over
          </button>
        )}
        <TerminalThemeControl />
      </header>
      <div ref={containerRef} className="terminal-host" />
    </div>
  );
}

function TerminalThemeControl(): ReactElement {
  const { preference, appTheme } = useResolvedTerminalTheme();
  const setPreference = useTerminalThemeStore((s) => s.setPreference);
  const options: Array<{
    preference: TerminalThemePreference;
    label: string;
    icon: LucideIcon;
  }> = [
    { preference: 'follow', label: `Follow app (${appTheme})`, icon: Monitor },
    { preference: 'dark', label: 'Dark terminal', icon: Moon },
    { preference: 'light', label: 'Light terminal', icon: Sun },
  ];
  return (
    <div className="terminal-theme-switch" role="group" aria-label="Terminal theme">
      {options.map(({ preference: value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          className={`terminal-theme-option ${preference === value ? 'active' : ''}`}
          aria-label={label}
          aria-pressed={preference === value}
          title={label}
          onClick={() => setPreference(value)}
        >
          <Icon size={12} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function StatusDot({ status }: { status: Status }): ReactElement {
  const colors: Record<Status, string> = {
    connecting: '#d29922',
    reconnecting: '#d29922',
    connected: '#7ee787',
    closed: '#6e7681',
    error: '#ff7b72',
    kicked: '#d2a8ff',
    locked: '#d2a8ff',
  };
  return (
    <span
      className="status-dot"
      style={{ background: colors[status] }}
      title={status}
      aria-label={status}
    />
  );
}

function getTerminalControllerId(): string {
  return `web:${randomId()}`;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function defaultWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Dev: connect straight to the backend port, bypassing the Vite proxy whose
  // WS forwarding chokes on the terminal byte stream (read ECONNRESET) and adds
  // a buffer+copy hop per frame. The backend's loopback auth passthrough admits
  // the direct 127.0.0.1 connection, and the page's :5173 Origin is already in
  // the backend allowlist (Guardian-injected) — see workspaces-ws.ts. Stripped
  // from production builds (import.meta.env.DEV === false), so packaged /
  // same-origin runs keep using location.host.
  if (
    import.meta.env.DEV &&
    typeof __OPENALICE_DEV_BACKEND_PORT__ === 'number' &&
    __OPENALICE_DEV_BACKEND_PORT__ > 0
  ) {
    return `${proto}//${window.location.hostname}:${__OPENALICE_DEV_BACKEND_PORT__}/api/workspaces/pty`;
  }
  return `${proto}//${window.location.host}/api/workspaces/pty`;
}

function safeFit(fit: FitAddon): void {
  try {
    fit.fit();
  } catch {
    // Container may have zero size during initial layout; ignore.
  }
}

function parseResizeControl(data: string): { cols: number; rows: number } | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const msg = value as Record<string, unknown>;
  if (msg['type'] !== 'resize') return null;
  const cols = typeof msg['cols'] === 'number' ? msg['cols'] : Number.NaN;
  const rows = typeof msg['rows'] === 'number' ? msg['rows'] : Number.NaN;
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return null;
  return { cols: Math.floor(cols), rows: Math.floor(rows) };
}

function toArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  if (data instanceof Uint8Array) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  if (Array.isArray(data)) return new Uint8Array(data).buffer;
  return new Uint8Array().buffer;
}
