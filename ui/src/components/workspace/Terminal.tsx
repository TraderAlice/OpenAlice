import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as Xterm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import {
  parseServerControl,
  type ClientControlMessage,
} from './protocol';
import { darkTheme } from './theme';
import { DemoTerminalReplay } from '../../demo/DemoTerminalReplay';

type Status = 'connecting' | 'connected' | 'closed' | 'error' | 'kicked';

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
export type KeyMap = Readonly<Record<string, string>>;

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
  if (import.meta.env.VITE_DEMO_MODE) return <DemoTerminalReplay label={props.label ?? props.wsId} wsId={props.wsId} sessionId={props.sessionId} />;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [pid, setPid] = useState<number | null>(null);
  const [scrollbackTruncated, setScrollbackTruncated] = useState(false);
  const [exitInfo, setExitInfo] = useState<ExitInfo | null>(null);
  const [childExited, setChildExited] = useState(false);

  const wsId = props.wsId;
  const wsUrl = props.wsUrl;
  const sessionId = props.sessionId;

  const keyMapRef = useRef<KeyMap | undefined>(props.keyMap);
  keyMapRef.current = props.keyMap;
  const onAttachedRef = useRef<TerminalViewProps['onAttached']>(props.onAttached);
  onAttachedRef.current = props.onAttached;
  const onSessionLostRef = useRef<TerminalViewProps['onSessionLost']>(props.onSessionLost);
  onSessionLostRef.current = props.onSessionLost;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    setStatus('connecting');
    setPid(null);
    setScrollbackTruncated(false);
    setExitInfo(null);
    setChildExited(false);

    const term = new Xterm({
      theme: darkTheme,
      fontFamily:
        'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Mono", "DejaVu Sans Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      macOptionIsMeta: true,
      convertEol: false,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl?.dispose());
      term.loadAddon(webgl);
    } catch {
      webgl = null;
    }

    safeFit(fit);
    let lastCols = term.cols;
    let lastRows = term.rows;

    // Always cold attach: each TerminalView mount creates a fresh xterm
    // instance with no in-memory history, so the server must replay the full
    // buffer every time. (An earlier `since=<lastSeq>` localStorage scheme
    // was wrong: it would correctly skip bytes the xterm already had, but
    // since the xterm was newly mounted there were none to skip — the user
    // ended up with a blank pane after switching workspaces.)
    const params = new URLSearchParams({
      session: sessionId,
      cols: String(lastCols),
      rows: String(lastRows),
    });
    const url = `${wsUrl ?? defaultWsUrl()}?${params.toString()}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    const sendControl = (msg: ClientControlMessage): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    const encoder = new TextEncoder();
    const sendStdin = (data: string): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(data));
    };

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const map = keyMapRef.current;
      if (map === undefined) return true;
      const bytes = map[keySignature(event)];
      if (bytes === undefined) return true;
      sendStdin(bytes);
      return false;
    });

    const handleResize = (): void => {
      safeFit(fit);
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols;
        lastRows = term.rows;
        sendControl({ type: 'resize', cols: lastCols, rows: lastRows });
      }
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(container);
    window.addEventListener('resize', handleResize);

    ws.addEventListener('open', () => {
      setStatus('connected');
      term.focus();
      handleResize();
    });

    ws.addEventListener('message', (ev) => {
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
        term.write(new Uint8Array(data));
      }
    });

    ws.addEventListener('close', (ev) => {
      // Server-side kick uses close code 4001 — separate from generic disconnect.
      // 4404 = server doesn't know this session id (record paused or removed).
      if (ev.code === 4001) {
        setStatus('kicked');
      } else if (ev.code === 4404) {
        onSessionLostRef.current?.();
        setStatus('closed');
      } else {
        setStatus('closed');
      }
    });
    ws.addEventListener('error', () => setStatus('error'));

    const stdinSub = term.onData(sendStdin);
    const binarySub = term.onBinary((d) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const bytes = new Uint8Array(d.length);
      for (let i = 0; i < d.length; i++) bytes[i] = d.charCodeAt(i) & 0xff;
      ws.send(bytes);
    });

    return () => {
      stdinSub.dispose();
      binarySub.dispose();
      ro.disconnect();
      window.removeEventListener('resize', handleResize);
      try {
        ws.close();
      } catch {
        // ignore
      }
      webgl?.dispose();
      term.dispose();
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
      </header>
      <div ref={containerRef} className="terminal-host" />
    </div>
  );
}

function StatusDot({ status }: { status: Status }): ReactElement {
  const colors: Record<Status, string> = {
    connecting: '#d29922',
    connected: '#7ee787',
    closed: '#6e7681',
    error: '#ff7b72',
    kicked: '#d2a8ff',
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

function defaultWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/workspaces/pty`;
}

function safeFit(fit: FitAddon): void {
  try {
    fit.fit();
  } catch {
    // Container may have zero size during initial layout; ignore.
  }
}

function keySignature(ev: KeyboardEvent): string {
  const parts: string[] = [];
  if (ev.ctrlKey) parts.push('ctrl');
  if (ev.altKey) parts.push('alt');
  if (ev.shiftKey) parts.push('shift');
  if (ev.metaKey) parts.push('meta');
  parts.push(ev.key.toLowerCase());
  return parts.join('+');
}

