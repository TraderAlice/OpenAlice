import { useId, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowUpRight, MessageSquarePlus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SessionRecord } from './api';
import { FilesPanel } from './FilesPanel';
import { ResumeCta, prefixOf } from './ResumeCta';
import { formatRelativeTime } from '../../lib/intl';
import { TerminalView } from './Terminal';
import { WebPiView } from './WebPiView';
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
   * terminal slots; when no session is pinned, the Session library searches
   * and filters this complete collection.
   */
  readonly sessions: readonly SessionRecord[];
  readonly label?: string;
  readonly onSpawnFresh: () => void;
  readonly onResume: (sessionId: string) => void;
  readonly onOpenWebPi: (sessionId: string) => void;
  /** Navigate to an already-running session without re-spawning it. Library
   *  rows call this for running entries; paused entries go through `onResume`. */
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
          <SessionLibrary
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
            onOpenWebPi={() => props.onOpenWebPi(props.activeRecord!.id)}
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
                {(s.surface ?? 'terminal') === 'webpi' && s.agent === 'pi' ? (
                  <WebPiView
                    wsId={props.wsId}
                    sessionId={s.id}
                    {...(props.label !== undefined ? { label: `${props.label} · ${s.name}` } : {})}
                    onSessionLost={props.onSessionLost}
                  />
                ) : (
                  <TerminalView
                    wsId={props.wsId}
                    sessionId={s.id}
                    renderer={s.agent === 'opencode' ? 'dom' : 'auto'}
                    {...(props.label !== undefined ? { label: `${props.label} · ${s.name}` } : {})}
                    onSessionLost={props.onSessionLost}
                  />
                )}
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
 * Workspace-level Session directory shown when no Session is pinned.
 *
 * A Workspace is a durable context container and can accumulate dozens of
 * Sessions. This surface therefore behaves like a compact library: search,
 * lifecycle filters, newest-first ordering, and one full-row action per
 * Session. Starting a new Session remains prominent without turning every
 * historical entry into a large CTA card.
 */
type SessionFilter = 'all' | SessionRecord['state'];

function SessionLibrary(props: {
  sessions: readonly SessionRecord[];
  onResume: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onSpawn: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SessionFilter>('all');

  const ordered = useMemo(() => [...props.sessions].sort((a, b) => {
    const at = new Date(a.lastActiveAt).getTime();
    const bt = new Date(b.lastActiveAt).getTime();
    return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
  }), [props.sessions]);
  const runningCount = props.sessions.filter((session) => session.state === 'running').length;
  const pausedCount = props.sessions.length - runningCount;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSessions = ordered.filter((session) => {
    if (filter !== 'all' && session.state !== filter) return false;
    if (!normalizedQuery) return true;
    return [session.title, session.name, session.agent]
      .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
  });

  const filters: readonly { value: SessionFilter; label: string; count: number }[] = [
    { value: 'all', label: t('workspace.filterAll'), count: props.sessions.length },
    { value: 'running', label: t('workspace.filterRunning'), count: runningCount },
    { value: 'paused', label: t('workspace.filterPaused'), count: pausedCount },
  ];

  return (
    <section className="workspace-session-library" aria-labelledby={titleId}>
      <header className="workspace-session-library-header">
        <div className="workspace-session-library-copy">
          <div className="workspace-session-library-title-line">
            <h2 id={titleId}>{t('workspace.sessions')}</h2>
            <span className="workspace-session-library-count">{props.sessions.length}</span>
          </div>
          <p>{t('workspace.sessionLibraryDescription')}</p>
        </div>
        <button type="button" className="workspace-session-new oa-pressable" onClick={props.onSpawn}>
          <MessageSquarePlus size={15} strokeWidth={2.1} aria-hidden="true" />
          <span>{t('workspace.startNewSession')}</span>
        </button>
      </header>

      {props.sessions.length === 0 ? (
        <div className="workspace-session-zero">
          <MessageSquarePlus size={24} strokeWidth={1.7} aria-hidden="true" />
          <p>{t('workspace.emptyNoSession')}</p>
          <span>{t('workspace.shortcutHint')}</span>
        </div>
      ) : (
        <>
          <div className="workspace-session-toolbar">
            <label className="workspace-session-search">
              <Search size={14} strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">{t('workspace.searchSessions')}</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('workspace.searchSessions')}
              />
            </label>
            <div className="workspace-session-filters" role="group" aria-label={t('workspace.filterSessions')}>
              {filters.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="oa-pressable"
                  aria-pressed={filter === option.value}
                  aria-label={t('workspace.filterOptionLabel', {
                    label: option.label,
                    count: option.count,
                  })}
                  onClick={() => setFilter(option.value)}
                >
                  <span>{option.label}</span>
                  <span className="workspace-session-filter-count">{option.count}</span>
                </button>
              ))}
            </div>
          </div>

          <span className="sr-only" role="status" aria-live="polite">
            {t('workspace.sessionResultCount', { count: visibleSessions.length })}
          </span>
          <div className="workspace-session-results">
            {visibleSessions.length > 0 ? (
              <ul className="workspace-session-list">
                {visibleSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    record={session}
                    onClick={() => {
                      if (session.state === 'paused') props.onResume(session.id);
                      else props.onSelectSession(session.id);
                    }}
                  />
                ))}
              </ul>
            ) : (
              <div className="workspace-session-no-results">
                <p>{t('workspace.noMatchingSessions')}</p>
                <span>{t('workspace.noMatchingSessionsHint')}</span>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function SessionRow(props: {
  record: SessionRecord;
  onClick: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const record = props.record;
  const isPaused = record.state === 'paused';
  const title = record.title?.trim() || record.name;
  const showInternalName = title !== record.name;
  return (
    <li>
      <button
        type="button"
        className="workspace-session-row oa-nav-row"
        onClick={props.onClick}
        aria-label={isPaused
          ? t('workspace.resumeNamed', { name: title })
          : t('workspace.openNamed', { name: title })}
      >
        <span className="workspace-session-agent" aria-hidden="true">
          {prefixOf(record.agent)}
        </span>
        <span className="workspace-session-row-copy">
          <span className="workspace-session-row-title" title={title}>{title}</span>
          <span className="workspace-session-row-meta">
            {showInternalName && <span className="font-mono">{record.name}</span>}
            <span>{record.agent}</span>
            <span>{formatRelativeTime(record.lastActiveAt)}</span>
          </span>
        </span>
        <span className={`workspace-session-state is-${record.state}`}>
          <span aria-hidden="true" />
          {isPaused ? t('workspace.paused') : t('workspace.filterRunning')}
        </span>
        <ArrowUpRight className="workspace-session-open-icon" size={15} strokeWidth={2} aria-hidden="true" />
      </button>
    </li>
  );
}
