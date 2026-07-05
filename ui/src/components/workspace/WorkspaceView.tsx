import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { MessageSquare } from 'lucide-react';

import type { SessionRecord } from './api';
import { FilesPanel } from './FilesPanel';
import { ResumeCta, prefixOf } from './ResumeCta';
import { formatRelativeTime } from '../../lib/intl';
import { TerminalView, type KeyMap } from './Terminal';
import { useIsDesktop } from '../../live/use-is-desktop';
import { useWorkspaceSidePanels } from '../../live/workspace-side-panels';

export interface WorkspaceViewProps {
  readonly wsId: string;
  /** Pinned record id, or null = no session pinned (empty pane). */
  readonly sessionId: string | null;
  /** Resolved record matching `sessionId`. null if `sessionId` is null OR the record was just deleted. */
  readonly activeRecord: SessionRecord | null;
  /**
   * All session records for this workspace (running + paused). When a
   * session is pinned (`sessionId !== null`), this drives the running
   * terminal slots; when no session is pinned, the empty state lists
   * these as resume/continue cards so the user can pick up an existing
   * conversation instead of being pushed toward a fresh spawn.
   */
  readonly sessions: readonly SessionRecord[];
  readonly label?: string;
  readonly keyMap?: KeyMap;
  readonly onSpawnFresh: () => void;
  readonly onResume: (sessionId: string) => void;
  /** Navigate to an already-running session without re-spawning it. The
   *  empty-state cards call this for running entries; resume-spawn for
   *  paused entries goes through `onResume`. */
  readonly onSelectSession: (sessionId: string) => void;
  readonly onSessionLost: () => void;
}

export function WorkspaceView(props: WorkspaceViewProps): ReactElement {
  // Mount ONLY this tab's own pinned session. Each session is its own tab with
  // its own WorkspaceView, and TabHost keeps every tab mounted (display:none
  // when inactive) — so a session's terminal already persists across tab
  // switches without a WS reconnect. Mounting *every* running session here (the
  // old single-shared-view design) duplicates each session's <TerminalView>
  // into every open tab: a session open in N tabs then gets N WebSockets
  // fighting over its single-attach PTY → kick/reconnect war that wedges the
  // session (ANG-120 — e.g. claude froze whenever an opencode tab was also open).
  //
  // activeRecord is null when sessionId is null (empty-state landing) or during
  // the brief post-spawn race before the record lands in the list — both
  // correctly render no slot (the CTA / paused-CTA path covers them).
  const runningSlots = useMemo<readonly SessionRecord[]>(
    () =>
      props.activeRecord !== null && props.activeRecord.state === 'running'
        ? [props.activeRecord]
        : [],
    [props.activeRecord],
  );

  // Right-pane state machine:
  //  - no selection.sessionId → CTA ("start a new session")
  //  - sessionId but record missing or running-but-still-loading → CTA (the
  //    slot will appear once optimistic / poll lands)
  //  - sessionId + record.state === 'paused' → ResumeCta
  //  - sessionId + record.state === 'running' → active slot among slots
  const showPausedCta =
    props.sessionId !== null &&
    props.activeRecord !== null &&
    props.activeRecord.state === 'paused';
  const showEmptyCta = props.sessionId === null;

  // Files panel visibility. User-level pref; mobile gets a separate
  // kill-switch so the 360px right column doesn't eat half a phone screen.
  const isDesktop = useIsDesktop();
  const sidePrefs = useWorkspaceSidePanels();
  const mobileSuppresses = !isDesktop && sidePrefs.autoHideMobile;
  const showFiles = sidePrefs.files && !mobileSuppresses;
  const showAside = showFiles;
  const viewClass = `workspace-view${showAside ? '' : ' has-no-side'}`;

  return (
    <div className={viewClass}>
      <div className="workspace-terminal">
        {showEmptyCta && (
          <EmptyState
            sessions={props.sessions}
            onResume={props.onResume}
            onSelectSession={props.onSelectSession}
            onSpawn={props.onSpawnFresh}
          />
        )}
        {showPausedCta && props.activeRecord && (
          <ResumeCta
            record={props.activeRecord}
            onResume={() => props.onResume(props.activeRecord!.id)}
          />
        )}
        {!showPausedCta &&
          runningSlots.map((s) => {
            const isActive = s.id === props.sessionId;
            return (
              <div
                key={s.id}
                className={`workspace-terminal-slot ${isActive ? 'is-active' : 'is-hidden'}`}
              >
                <TerminalView
                  wsId={props.wsId}
                  sessionId={s.id}
                  {...(props.label !== undefined ? { label: `${props.label} · ${s.name}` } : {})}
                  {...(props.keyMap !== undefined ? { keyMap: props.keyMap } : {})}
                  onSessionLost={props.onSessionLost}
                />
              </div>
            );
          })}
      </div>
      {showAside && (
        <aside className="workspace-side">
          {showFiles && <FilesPanel wsId={props.wsId} />}
        </aside>
      )}
    </div>
  );
}

/**
 * Empty-state when no session is pinned.
 *
 * Two shapes:
 *
 *  1. Workspace has 0 sessions → fall back to the original single-CTA
 *     spawn UI. Same copy as before to avoid regressing users who use
 *     the keyboard.
 *
 *  2. Workspace has 1+ sessions → render them as inline resume/continue
 *     cards (sorted by `lastActiveAt` desc), with "Start a new session"
 *     demoted to a secondary affordance below. This is the path users
 *     hit when jumping from the Inbox reply bar — the notification was
 *     authored by a specific existing session, and the cards make it
 *     easy to pick the right one instead of being pushed toward a
 *     fresh spawn.
 *
 * We deliberately don't try to detect or highlight "the session that
 * sent the inbox entry" — would require threading session identity
 * through the inbox_push MCP path, and Claude Code / Codex don't
 * surface their own session id to tools they call. Chronological list
 * is enough; users read the timestamps.
 */
function EmptyState(props: {
  sessions: readonly SessionRecord[];
  onResume: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onSpawn: () => void;
}): ReactElement {
  if (props.sessions.length === 0) {
    return (
      <div className="workspace-cta">
        <p className="workspace-cta-text">
          No session yet — start one to begin a conversation in this workspace.
        </p>
        <button type="button" className="workspace-cta-btn" onClick={props.onSpawn}>
          Start a new session
        </button>
        <p className="workspace-cta-hint">
          <kbd>⌘T</kbd> works too.
        </p>
      </div>
    );
  }

  // Sort newest-first by lastActiveAt; defensive against ISO parse failures.
  const ordered = [...props.sessions].sort((a, b) => {
    const at = new Date(a.lastActiveAt).getTime();
    const bt = new Date(b.lastActiveAt).getTime();
    return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
  });

  return (
    <div className="workspace-empty-state">
      <h2 className="workspace-empty-heading">Pick up where you left off</h2>
      <ul className="workspace-empty-list">
        {ordered.map((s) => (
          <SessionCard
            key={s.id}
            record={s}
            onClick={() => {
              if (s.state === 'paused') props.onResume(s.id);
              else props.onSelectSession(s.id);
            }}
          />
        ))}
      </ul>
      <div className="workspace-empty-divider">
        <span>or</span>
      </div>
      <button
        type="button"
        className="workspace-empty-secondary-btn"
        onClick={props.onSpawn}
      >
        + Start a new session
      </button>
      <p className="workspace-cta-hint">
        <kbd>⌘T</kbd> works too.
      </p>
    </div>
  );
}

function SessionCard(props: {
  record: SessionRecord;
  onClick: () => void;
}): ReactElement {
  const r = props.record;
  const isPaused = r.state === 'paused';
  return (
    <li className="workspace-empty-card">
      <span className="inline-flex items-center justify-center shrink-0 min-w-[18px] h-4 px-1 rounded text-[10px] font-mono text-text-muted bg-bg-tertiary">
        {prefixOf(r.agent)}
      </span>
      <div className="workspace-empty-card-meta">
        <span className="workspace-empty-card-name">{r.name}</span>
        <span className="workspace-empty-card-state">
          {isPaused ? 'paused · ' : 'active · '}
          {formatRelativeTime(r.lastActiveAt)}
        </span>
      </div>
      <button
        type="button"
        className="workspace-empty-card-btn"
        onClick={props.onClick}
        aria-label={isPaused ? `Resume ${r.name}` : `Open ${r.name}`}
      >
        <MessageSquare size={13} strokeWidth={2.25} aria-hidden="true" />
        <span>Continue</span>
      </button>
    </li>
  );
}
