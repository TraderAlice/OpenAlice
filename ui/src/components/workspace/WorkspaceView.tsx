import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare } from 'lucide-react';

import type { SessionRecord } from './api';
import { FilesPanel } from './FilesPanel';
import { GitPanel } from './GitPanel';
import { ResumeCta, prefixOf, relativeTime } from './ResumeCta';
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
  // Only running records get a mounted terminal slot. Same persist-across-
  // tab-switch trick from V2.S3 (commit 0f21914): keep them in the DOM,
  // toggle visibility via CSS so switching sessions is a CSS toggle, not a
  // WS reconnect + replay.
  //
  // When no session is pinned (empty state landing — e.g. coming from an
  // Inbox jump), short-circuit to []: the empty state renders inline
  // cards for the user to pick a session, and we shouldn't mount
  // terminals for every running session in the workspace just to keep
  // them warm (defeats the one-session-per-tab WS optimisation).
  const runningSlots = useMemo<readonly SessionRecord[]>(() => {
    if (props.sessionId === null) return [];
    const running = props.sessions.filter((s) => s.state === 'running');
    // Brief race after a fresh spawn: selection.sessionId is set but the
    // optimistic update may have completed *after* render, or the user pinned
    // a session that the next poll hasn't surfaced yet. If the pinned record
    // is running but not in our list, virtually-append so its slot mounts
    // immediately. React reconciles by `key` when the real entry lands.
    if (
      props.activeRecord !== null &&
      props.activeRecord.state === 'running' &&
      !running.some((s) => s.id === props.sessionId)
    ) {
      return [...running, props.activeRecord];
    }
    return running;
  }, [props.sessions, props.sessionId, props.activeRecord]);

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

  // Side panel visibility. User-level prefs control which of git/files
  // render; mobile gets a separate kill-switch so the 360px right column
  // doesn't eat half a phone screen.
  const isDesktop = useIsDesktop();
  const sidePrefs = useWorkspaceSidePanels();
  const mobileSuppresses = !isDesktop && sidePrefs.autoHideMobile;
  const showGit = sidePrefs.git && !mobileSuppresses;
  const showFiles = sidePrefs.files && !mobileSuppresses;
  const showAside = showGit || showFiles;
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
          {showGit && <GitPanel wsId={props.wsId} />}
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
  const { t } = useTranslation();
  const r = props.record;
  const isPaused = r.state === 'paused';
  return (
    <li className="workspace-empty-card">
      <span className={`sidebar-agent-badge is-${r.agent}`}>
        {prefixOf(r.agent)}
      </span>
      <div className="workspace-empty-card-meta">
        <span className="workspace-empty-card-name">{r.name}</span>
        <span className="workspace-empty-card-state">
          {isPaused ? `${t('workspace.paused', 'paused')} · ` : `${t('workspace.active', 'active')} · `}
          {relativeTime(t, r.lastActiveAt)}
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
