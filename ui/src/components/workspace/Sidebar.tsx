import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Cpu, LayoutGrid, Library, Sparkles, Terminal, type LucideIcon } from 'lucide-react';

import {
  deleteWorkspace,
  type AgentInfo,
  type SessionRecord,
  type TemplateInfo,
  type Workspace,
} from './api';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';

export interface Selection {
  readonly wsId: string;
  readonly sessionId: string | null;
}

export interface SpawnOpts {
  readonly resume?: 'last' | string;
  readonly agent?: string;
}

export interface SidebarProps {
  readonly workspaces: readonly Workspace[];
  readonly templates: readonly TemplateInfo[];
  readonly agents: readonly AgentInfo[];
  readonly listError: string | null;
  readonly selection: Selection | null;
  readonly onSelectWorkspace: (wsId: string) => void;
  readonly onSelectSession: (wsId: string, sessionId: string) => void;
  readonly onSpawn: (wsId: string, opts?: SpawnOpts) => void;
  readonly onPauseSession: (wsId: string, sessionId: string) => void;
  readonly onResumeSession: (wsId: string, sessionId: string) => void;
  readonly onDeleteSession: (wsId: string, sessionId: string) => void;
  readonly onChanged: () => void;
  /** Optional: open the per-workspace AI-provider config modal. */
  readonly onConfigureWorkspace?: (wsId: string) => void;
  /** Open the Workspaces Overview dashboard tab (card view of all workspaces). */
  readonly onOpenOverview?: () => void;
  /** True when the Workspaces Overview tab is currently focused — highlights the pinned row. */
  readonly overviewActive?: boolean;
  /** Open the Templates catalog tab (one card per workspace template). */
  readonly onOpenTemplates?: () => void;
  /** True when a Templates tab (catalog or detail) is currently focused. */
  readonly templatesActive?: boolean;
}

export function Sidebar(props: SidebarProps): ReactElement {
  const [showCreate, setShowCreate] = useState(false);

  const onDelete = async (id: string): Promise<void> => {
    if (!window.confirm('Delete workspace? (registry only — files on disk are kept.)')) return;
    const ok = await deleteWorkspace(id);
    if (ok) {
      props.onChanged();
      if (props.selection?.wsId === id) props.onSelectWorkspace('');
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Workspaces</span>
        <button
          type="button"
          className="sidebar-new-btn"
          onClick={() => setShowCreate(true)}
          aria-label="New workspace"
        >
          +
        </button>
      </div>

      {showCreate && (
        <CreateWorkspaceDialog
          templates={props.templates}
          agents={props.agents}
          onCreated={(workspace) => {
            props.onChanged();
            props.onSelectWorkspace(workspace.id);
          }}
          onClose={() => setShowCreate(false)}
        />
      )}

      <ul className="sidebar-list">
        {props.onOpenOverview && (
          <li className="sidebar-overview-row">
            <button
              type="button"
              className={`sidebar-overview-btn${props.overviewActive ? ' is-active' : ''}`}
              onClick={props.onOpenOverview}
              title="Card-based dashboard of all workspaces"
            >
              <LayoutGrid size={13} strokeWidth={2.25} aria-hidden="true" />
              <span>Overview</span>
            </button>
          </li>
        )}
        {props.onOpenTemplates && (
          <li className="sidebar-overview-row">
            <button
              type="button"
              className={`sidebar-overview-btn${props.templatesActive ? ' is-active' : ''}`}
              onClick={props.onOpenTemplates}
              title="Browse workspace templates"
            >
              <Library size={13} strokeWidth={2.25} aria-hidden="true" />
              <span>Templates</span>
            </button>
          </li>
        )}
        {props.workspaces.length === 0 && !props.listError && (
          <li className="sidebar-empty">no workspaces yet</li>
        )}
        {props.listError && <li className="sidebar-error">{props.listError}</li>}
        {props.workspaces.map((w) => (
          <WorkspaceRow
            key={w.id}
            workspace={w}
            agents={props.agents}
            selection={props.selection}
            onSelectWorkspace={props.onSelectWorkspace}
            onSelectSession={props.onSelectSession}
            onSpawn={props.onSpawn}
            onPauseSession={props.onPauseSession}
            onResumeSession={props.onResumeSession}
            onDeleteSession={props.onDeleteSession}
            onDelete={onDelete}
            onConfigureWorkspace={props.onConfigureWorkspace}
          />
        ))}
      </ul>
    </aside>
  );
}

export interface WorkspaceRowProps {
  readonly workspace: Workspace;
  readonly agents: readonly AgentInfo[];
  readonly selection: Selection | null;
  readonly onSelectWorkspace: (wsId: string) => void;
  readonly onSelectSession: (wsId: string, sessionId: string) => void;
  readonly onSpawn: (wsId: string, opts?: SpawnOpts) => void;
  readonly onPauseSession: (wsId: string, sessionId: string) => void;
  readonly onResumeSession: (wsId: string, sessionId: string) => void;
  readonly onDeleteSession: (wsId: string, sessionId: string) => void;
  readonly onDelete: (id: string) => Promise<void>;
  readonly onConfigureWorkspace?: (wsId: string) => void;
}

function agentLabel(id: string, agents: readonly AgentInfo[]): string {
  const a = agents.find((x) => x.id === id);
  return a?.displayName ?? id;
}

function agentPrefix(id: string): string {
  if (id === 'claude') return 'c';
  if (id === 'codex') return 'x';
  if (id === 'shell') return 'sh';
  return id[0] ?? '?';
}

/**
 * Glyph for a given agent SDK. Icon-first so users don't have to learn the
 * `c1` / `x1` / `sh1` naming convention — at-a-glance they see which CLI
 * the session is running. Unknown adapter id falls back to its first
 * letter (text), keeping the badge non-empty even for future adapters
 * before they get an icon.
 */
const AGENT_ICONS: Record<string, LucideIcon> = {
  claude: Sparkles,
  codex: Cpu,
  shell: Terminal,
};

function AgentBadgeGlyph({ agentId }: { agentId: string }): ReactElement {
  const Icon = AGENT_ICONS[agentId];
  if (Icon) return <Icon size={11} strokeWidth={2.25} aria-hidden="true" />;
  return <span aria-hidden="true">{agentPrefix(agentId)}</span>;
}

export function WorkspaceRow(props: WorkspaceRowProps): ReactElement {
  const w = props.workspace;
  const isSelected = props.selection?.wsId === w.id && props.selection.sessionId === null;
  const hasRunning = w.sessions.some((s) => s.state === 'running');

  const [spawnMenuOpen, setSpawnMenuOpen] = useState(false);
  const plusBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!spawnMenuOpen) return;
    const onDocClick = (e: MouseEvent): void => {
      const t = e.target as Node | null;
      if (plusBtnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setSpawnMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSpawnMenuOpen(false);
    };
    const tid = setTimeout(() => document.addEventListener('click', onDocClick), 0);
    document.addEventListener('keydown', onEsc);
    return () => {
      clearTimeout(tid);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [spawnMenuOpen]);

  const onPlusClick = (): void => {
    if (w.agents.length <= 1) {
      props.onSpawn(w.id, { agent: w.agents[0] ?? 'claude' });
      return;
    }
    setSpawnMenuOpen((v) => !v);
  };

  const onMenuPick = (agentId: string): void => {
    setSpawnMenuOpen(false);
    props.onSpawn(w.id, { agent: agentId });
  };

  const plusTitle =
    w.agents.length === 1
      ? `spawn a new ${agentLabel(w.agents[0]!, props.agents)} session`
      : 'spawn a new session…';

  return (
    <li className="sidebar-tree-item">
      <div className={`sidebar-row ${isSelected ? 'is-selected' : ''}`}>
        <button
          type="button"
          className="sidebar-row-main"
          onClick={() => props.onSelectWorkspace(w.id)}
          title={w.tag}
        >
          <span
            className="sidebar-status-dot"
            style={{ background: hasRunning ? '#7ee787' : '#6e7681' }}
            title={hasRunning ? `${w.sessions.filter((s) => s.state === 'running').length} running` : 'idle'}
          />
          <span className="sidebar-tag">{w.tag}</span>
          <span className="sidebar-meta">{relativeTime(w.createdAt)}</span>
        </button>
        {w.agents.length > 0 && (
          <div className="sidebar-spawn-wrap">
            <button
              ref={plusBtnRef}
              type="button"
              className="sidebar-action sidebar-action-spawn"
              title={plusTitle}
              aria-haspopup={w.agents.length > 1}
              aria-expanded={spawnMenuOpen}
              onClick={onPlusClick}
            >
              +
            </button>
            {spawnMenuOpen && (
              <ul ref={menuRef} className="sidebar-spawn-menu" role="menu">
                {w.agents.map((agentId) => (
                  <li key={agentId}>
                    <button
                      type="button"
                      role="menuitem"
                      className="sidebar-spawn-menu-item"
                      onClick={() => onMenuPick(agentId)}
                    >
                      <span className="sidebar-spawn-menu-prefix">+</span>
                      <span className="sidebar-spawn-menu-name">{agentLabel(agentId, props.agents)}</span>
                      <span className="sidebar-spawn-menu-suffix">{agentPrefix(agentId)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {props.onConfigureWorkspace && (
          <button
            type="button"
            className="sidebar-action sidebar-action-config"
            title="configure AI provider for this workspace"
            onClick={() => props.onConfigureWorkspace?.(w.id)}
          >
            ⚙
          </button>
        )}
        <button
          type="button"
          className="sidebar-action sidebar-action-delete"
          title="delete workspace"
          onClick={() => void props.onDelete(w.id)}
        >
          ×
        </button>
      </div>

      {w.sessions.length > 0 && (
        <ul className="sidebar-children">
          {w.sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              isActive={props.selection?.wsId === w.id && props.selection.sessionId === s.id}
              onSelect={() => props.onSelectSession(w.id, s.id)}
              onPause={() => props.onPauseSession(w.id, s.id)}
              onResume={() => props.onResumeSession(w.id, s.id)}
              onDelete={() => props.onDeleteSession(w.id, s.id)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export interface SessionRowProps {
  session: SessionRecord;
  isActive: boolean;
  onSelect: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
}

export function SessionRow(props: SessionRowProps): ReactElement {
  const s = props.session;
  const isPaused = s.state === 'paused';
  const tidShort = s.agentSessionId ? s.agentSessionId.slice(0, 8) : null;
  const titleParts: string[] = [`agent ${s.agent}`];
  if (s.pid !== null) titleParts.push(`pid ${s.pid}`);
  if (tidShort) titleParts.push(tidShort);
  if (isPaused) titleParts.push('paused');
  const title = titleParts.join(' · ');

  return (
    <li
      className={`sidebar-session ${props.isActive ? 'is-active' : ''} ${isPaused ? 'is-paused' : ''}`}
    >
      <button type="button" className="sidebar-session-main" onClick={props.onSelect} title={title}>
        <span className={`sidebar-agent-badge is-${s.agent} ${isPaused ? 'is-paused' : ''}`}>
          <AgentBadgeGlyph agentId={s.agent} />
        </span>
        <span className="sidebar-session-name">{s.name}</span>
        {tidShort && <span className="sidebar-session-tid">{tidShort}</span>}
        {isPaused && <span className="sidebar-session-state">paused</span>}
      </button>
      {isPaused ? (
        <button
          type="button"
          className="sidebar-session-action sidebar-session-resume"
          title="resume this session"
          onClick={(e) => {
            e.stopPropagation();
            props.onResume();
          }}
        >
          ▸
        </button>
      ) : (
        <button
          type="button"
          className="sidebar-session-action sidebar-session-pause"
          title="pause this session"
          onClick={(e) => {
            e.stopPropagation();
            props.onPause();
          }}
        >
          ■
        </button>
      )}
      <button
        type="button"
        className="sidebar-session-action sidebar-session-delete"
        title="delete this session"
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete();
        }}
      >
        ×
      </button>
    </li>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const dMs = Date.now() - t;
  if (dMs < 60_000) return 'just now';
  if (dMs < 3_600_000) return `${Math.floor(dMs / 60_000)}m`;
  if (dMs < 86_400_000) return `${Math.floor(dMs / 3_600_000)}h`;
  return `${Math.floor(dMs / 86_400_000)}d`;
}
