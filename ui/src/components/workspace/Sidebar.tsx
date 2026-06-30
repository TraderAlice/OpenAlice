import { useEffect, useMemo, useRef, useState } from 'react';
import { formatRelativeTime } from '../../lib/intl';
import type { ReactElement } from 'react';
import { Bot, ChevronDown, ChevronRight, Code2, Cpu, LayoutGrid, Library, Pencil, Play, Plus, Settings as SettingsIcon, Sparkles, Square, Terminal, X, type LucideIcon } from 'lucide-react';

import { headlessApi, type HeadlessTaskRecord } from '../../api/headless';
import {
  deleteWorkspace,
  type AgentInfo,
  type SessionRecord,
  type TemplateInfo,
  type Workspace,
} from './api';
import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { Skeleton } from '../StateViews';
import { workspaceDisplayName, workspaceDisplayTitle } from './display';

/**
 * Workspace launcher sidebar.
 *
 * Originally ported wholesale from the standalone auto-quant launcher with
 * its own hand-written `.sidebar-*` CSS (a GitHub-dark island). Migrated to
 * OpenAlice's Tailwind + semantic-token idiom so it reads as a native
 * secondary sidebar — same row/active-bar/header conventions as Inbox.
 * Behaviour is unchanged: select workspace/session, spawn (with multi-agent
 * menu), configure, delete, pause/resume (state-as-action), and the
 * collapsed headless-runs group. The shared `SessionRow` is also used by the
 * "Ask Alice" chat sidebar.
 */

const HEADLESS_POLL_MS = 5000;

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
  readonly defaultAgent: string | null;
  readonly listError: string | null;
  /** True once the first workspaces-list fetch has resolved — gates the empty
   *  state vs. a cold-load skeleton. */
  readonly hasLoaded: boolean;
  readonly selection: Selection | null;
  readonly onSelectWorkspace: (wsId: string) => void;
  readonly onSelectSession: (wsId: string, sessionId: string) => void;
  readonly onSpawn: (wsId: string, opts?: SpawnOpts) => void;
  readonly onSetDefaultAgent: (agent: string | null) => void;
  readonly onPauseSession: (wsId: string, sessionId: string) => void;
  readonly onResumeSession: (wsId: string, sessionId: string) => void;
  readonly onDeleteSession: (wsId: string, sessionId: string) => void;
  readonly onChanged: () => void;
  readonly onRenameWorkspace?: (wsId: string, displayName: string) => void;
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

  // Headless runs, polled once for the whole tree (not per-workspace) and
  // grouped client-side. Low-frequency passive surface → plain polling.
  const [headlessTasks, setHeadlessTasks] = useState<readonly HeadlessTaskRecord[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const tasks = await headlessApi.list({ limit: 200 });
        if (!cancelled) setHeadlessTasks(tasks);
      } catch {
        /* sidebar group just stays as-is; the Automation panel surfaces errors */
      }
    };
    void load();
    const id = setInterval(() => void load(), HEADLESS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  const headlessByWs = useMemo(() => {
    const map = new Map<string, HeadlessTaskRecord[]>();
    for (const t of headlessTasks) {
      const list = map.get(t.wsId);
      if (list) list.push(t);
      else map.set(t.wsId, [t]);
    }
    return map;
  }, [headlessTasks]);

  const onDelete = async (id: string): Promise<void> => {
    if (!window.confirm('Delete workspace? (registry only — files on disk are kept.)')) return;
    const ok = await deleteWorkspace(id);
    if (ok) {
      props.onChanged();
      if (props.selection?.wsId === id) props.onSelectWorkspace('');
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto py-1">
      {/* New workspace — top action (the shared wrapper supplies the panel
          title, so there's no in-list header; mirrors the chat sidebar's
          "New chat" affordance). */}
      <div className="px-2 pb-1.5">
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border/60 bg-bg-tertiary/30 text-[13px] font-medium text-text-muted transition-colors hover:text-text hover:border-accent/50 hover:bg-bg-tertiary/60"
        >
          <Plus size={15} strokeWidth={2.25} className="shrink-0" />
          <span className="truncate">New workspace</span>
        </button>
      </div>

      {showCreate && (
        <CreateWorkspaceDialog
          templates={props.templates}
          onCreated={(workspace) => {
            props.onChanged();
            props.onSelectWorkspace(workspace.id);
          }}
          onClose={() => setShowCreate(false)}
        />
      )}

      {props.onOpenOverview && (
        <NavRow
          icon={LayoutGrid}
          label="Overview"
          active={!!props.overviewActive}
          onClick={props.onOpenOverview}
          title="Card-based dashboard of all workspaces"
        />
      )}
      {props.onOpenTemplates && (
        <NavRow
          icon={Library}
          label="Templates"
          active={!!props.templatesActive}
          onClick={props.onOpenTemplates}
          title="Browse workspace templates"
        />
      )}

      {!props.hasLoaded && !props.listError && (
        <div className="flex flex-col mt-0.5" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className={`h-3 ${i % 2 === 0 ? 'w-32' : 'w-24'}`} />
            </div>
          ))}
        </div>
      )}
      {props.hasLoaded && props.workspaces.length === 0 && !props.listError && (
        <div className="px-3 py-2 text-[12px] text-text-muted/60">No workspaces yet</div>
      )}
      {props.listError && <div className="px-3 py-2 text-[12px] text-red">{props.listError}</div>}

      <div className="flex flex-col mt-0.5">
        {props.workspaces.map((w) => (
          <WorkspaceRow
            key={w.id}
            workspace={w}
            agents={props.agents}
            defaultAgent={props.defaultAgent}
            selection={props.selection}
            headlessTasks={headlessByWs.get(w.id) ?? []}
            onSelectWorkspace={props.onSelectWorkspace}
            onSelectSession={props.onSelectSession}
            onSpawn={props.onSpawn}
            onSetDefaultAgent={props.onSetDefaultAgent}
            onPauseSession={props.onPauseSession}
            onResumeSession={props.onResumeSession}
            onDeleteSession={props.onDeleteSession}
            onDelete={onDelete}
            onRenameWorkspace={props.onRenameWorkspace}
            onConfigureWorkspace={props.onConfigureWorkspace}
          />
        ))}
      </div>
    </div>
  );
}

/** Pinned nav row (Overview / Templates) — same active-accent-bar idiom as
 *  the rest of the app's sidebars. */
function NavRow({
  icon: Icon, label, active, onClick, title,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`relative flex items-center gap-2.5 w-full px-3 py-1.5 text-[13px] text-left transition-colors ${
        active ? 'bg-bg-tertiary text-text' : 'text-text hover:bg-bg-tertiary/50'
      }`}
    >
      {active && <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent" />}
      <Icon size={14} strokeWidth={2} className="shrink-0 text-text-muted/70" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export interface WorkspaceRowProps {
  readonly workspace: Workspace;
  readonly agents: readonly AgentInfo[];
  readonly defaultAgent: string | null;
  readonly selection: Selection | null;
  /** This workspace's headless (automation) runs, newest-first. */
  readonly headlessTasks?: readonly HeadlessTaskRecord[];
  readonly onSelectWorkspace: (wsId: string) => void;
  readonly onSelectSession: (wsId: string, sessionId: string) => void;
  readonly onSpawn: (wsId: string, opts?: SpawnOpts) => void;
  readonly onSetDefaultAgent: (agent: string | null) => void;
  readonly onPauseSession: (wsId: string, sessionId: string) => void;
  readonly onResumeSession: (wsId: string, sessionId: string) => void;
  readonly onDeleteSession: (wsId: string, sessionId: string) => void;
  readonly onDelete: (id: string) => Promise<void>;
  readonly onRenameWorkspace?: (wsId: string, displayName: string) => void;
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
  opencode: Code2,
  pi: Bot,
  shell: Terminal,
};

function AgentBadgeGlyph({ agentId }: { agentId: string }): ReactElement {
  const Icon = AGENT_ICONS[agentId];
  if (Icon) return <Icon size={11} strokeWidth={2.25} aria-hidden="true" />;
  return <span className="text-[10px] font-mono" aria-hidden="true">{agentPrefix(agentId)}</span>;
}

/** Hover-revealed square action button used for the per-row controls. */
function rowAction(danger = false): string {
  return `shrink-0 w-5 h-5 rounded flex items-center justify-center text-text-muted/70 transition-colors ${
    danger ? 'hover:text-red hover:bg-red/10' : 'hover:text-text hover:bg-bg-secondary'
  }`;
}

export function WorkspaceRow(props: WorkspaceRowProps): ReactElement {
  const w = props.workspace;
  const label = workspaceDisplayName(w);
  const isSelected = props.selection?.wsId === w.id && props.selection.sessionId === null;
  const hasRunning = w.sessions.some((s) => s.state === 'running');
  const runningCount = w.sessions.filter((s) => s.state === 'running').length;

  const [spawnMenuOpen, setSpawnMenuOpen] = useState(false);
  const plusBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const enabledAgents = w.agents
    .map((id) => props.agents.find((a) => a.id === id))
    .filter((a): a is AgentInfo => !!a);
  const runtimeAgents = enabledAgents.filter((a) => a.kind !== 'utility');
  const utilityAgents = enabledAgents.filter((a) => a.kind === 'utility');
  const defaultAgentEnabled =
    props.defaultAgent !== null &&
    runtimeAgents.some((a) => a.id === props.defaultAgent);

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
    if (defaultAgentEnabled && props.defaultAgent) {
      props.onSpawn(w.id, { agent: props.defaultAgent });
      return;
    }
    setSpawnMenuOpen((v) => !v);
  };

  const onMenuPick = (agentId: string): void => {
    setSpawnMenuOpen(false);
    const agent = props.agents.find((a) => a.id === agentId);
    if (agent && agent.kind !== 'utility') props.onSetDefaultAgent(agentId);
    props.onSpawn(w.id, { agent: agentId });
  };

  const plusTitle =
    defaultAgentEnabled && props.defaultAgent
      ? `spawn a new ${agentLabel(props.defaultAgent, props.agents)} session`
      : 'spawn a new session…';

  const statusClass = hasRunning
    ? 'bg-green'
    : w.sessions.length > 0
      ? 'bg-text-muted/40'
      : 'border border-border';

  return (
    <div>
      <div
        className={`group relative flex items-center gap-1 pl-3 pr-2 py-1.5 text-[12px] transition-colors ${
          isSelected ? 'bg-bg-tertiary text-text' : 'text-text hover:bg-bg-tertiary/50'
        }`}
      >
        {isSelected && <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent" />}
        <button
          type="button"
          onClick={() => props.onSelectWorkspace(w.id)}
          title={workspaceDisplayTitle(w)}
          className="flex-1 min-w-0 flex items-center gap-2 text-left"
        >
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusClass}`}
            title={hasRunning ? `${runningCount} running` : 'idle'}
          />
          <span className="truncate font-medium">{label}</span>
          <span className="text-[10px] text-text-muted/50 tabular-nums shrink-0">{formatRelativeTime(w.createdAt)}</span>
        </button>
        {props.onRenameWorkspace && (
          <button
            type="button"
            className={`${rowAction()} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
            title="rename workspace"
            onClick={() => {
              const next = window.prompt('Workspace display name', label);
              if (next === null) return;
              const trimmed = next.trim();
              if (trimmed.length === 0 || trimmed === label) return;
              props.onRenameWorkspace?.(w.id, trimmed);
            }}
          >
            <Pencil size={12} strokeWidth={2} />
          </button>
        )}
        {enabledAgents.length > 0 && (
          <div className="relative shrink-0">
            <button
              ref={plusBtnRef}
              type="button"
              className={rowAction()}
              title={plusTitle}
              aria-haspopup="menu"
              aria-expanded={spawnMenuOpen}
              onClick={onPlusClick}
            >
              <Plus size={13} strokeWidth={2.25} />
            </button>
            {spawnMenuOpen && (
              <ul
                ref={menuRef}
                role="menu"
                className="absolute right-0 top-full mt-1 min-w-[170px] py-1 bg-bg-secondary border border-border/70 rounded-lg shadow-lg z-10"
              >
                {runtimeAgents.map((agent) => (
                  <li key={agent.id}>
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left text-text transition-colors hover:bg-bg-tertiary"
                      onClick={() => onMenuPick(agent.id)}
                    >
                      <Plus size={12} strokeWidth={2.25} className="shrink-0 text-text-muted" />
                      <span className="flex-1 truncate">{agent.displayName}</span>
                      <span className="text-[10px] font-mono text-text-muted/60">{agentPrefix(agent.id)}</span>
                    </button>
                  </li>
                ))}
                {runtimeAgents.length > 0 && utilityAgents.length > 0 && (
                  <li aria-hidden="true" className="my-1 border-t border-border/70" />
                )}
                {utilityAgents.map((agent) => (
                  <li key={agent.id}>
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text"
                      onClick={() => onMenuPick(agent.id)}
                    >
                      <Terminal size={12} strokeWidth={2.25} className="shrink-0 text-text-muted" />
                      <span className="flex-1 truncate">{agent.displayName}</span>
                      <span className="text-[10px] font-mono text-text-muted/60">{agentPrefix(agent.id)}</span>
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
            className={`${rowAction()} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
            title="configure AI provider for this workspace"
            onClick={() => props.onConfigureWorkspace?.(w.id)}
          >
            <SettingsIcon size={12} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          className={`${rowAction(true)} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
          title="delete workspace"
          onClick={() => void props.onDelete(w.id)}
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>

      {w.sessions.length > 0 && (
        <div className="ml-[18px] border-l border-border/50">
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
        </div>
      )}

      {(props.headlessTasks?.length ?? 0) > 0 && (
        <HeadlessGroup
          tasks={props.headlessTasks!}
          onOpenAsSession={(t) => props.onSpawn(w.id, { resume: t.agentSessionId!, agent: t.agent })}
        />
      )}
    </div>
  );
}

// ── headless runs (the collapsed second tier under a workspace) ─────────────

/** status → token-driven dot colour. */
const HEADLESS_DOT_CLASS: Record<HeadlessTaskRecord['status'], string> = {
  running: 'bg-accent',
  done: 'bg-text-muted/40',
  failed: 'bg-red',
  interrupted: 'bg-yellow',
};

/**
 * The boss/employee visual hierarchy: interactive sessions are the first-class
 * rows; headless (automation) runs live in this one collapsed group beneath
 * them — out of the way until the user actually wants to check on a worker.
 * Expanding shows each run; a finished run with a captured agent session id
 * gets the ▸ "open as session" action, which resumes the run's conversation
 * in a normal interactive session (terminal tab) for inspection/takeover.
 * Runs still in flight are view-only (concurrent resume is undefined) — the
 * Automation panel has the live output log.
 */
function HeadlessGroup(props: {
  readonly tasks: readonly HeadlessTaskRecord[];
  readonly onOpenAsSession: (t: HeadlessTaskRecord) => void;
}): ReactElement {
  const [open, setOpen] = useState(false); // collapsed by default, by design
  const runningCount = props.tasks.filter((t) => t.status === 'running').length;

  return (
    <div className="ml-[18px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={
          runningCount > 0
            ? `headless runs — ${runningCount} running`
            : 'headless runs (automation)'
        }
        className="group flex items-center gap-1 w-full pl-3 pr-2 py-1 text-[10px] font-medium uppercase tracking-wider text-text-muted/60 hover:text-text-muted transition-colors select-none"
      >
        {open ? <ChevronDown size={11} strokeWidth={2.25} aria-hidden="true" /> : <ChevronRight size={11} strokeWidth={2.25} aria-hidden="true" />}
        <span>headless</span>
        <span className="text-text-muted/45 tabular-nums">{props.tasks.length}</span>
        {runningCount > 0 && <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-accent" />}
      </button>
      {open && (
        <div className="ml-[7px] border-l border-border/50">
          {props.tasks.map((t) => (
            <HeadlessTaskRow key={t.taskId} task={t} onOpenAsSession={props.onOpenAsSession} />
          ))}
        </div>
      )}
    </div>
  );
}

function HeadlessTaskRow(props: {
  readonly task: HeadlessTaskRecord;
  readonly onOpenAsSession: (t: HeadlessTaskRecord) => void;
}): ReactElement {
  const t = props.task;
  const openable = t.status !== 'running' && !!t.agentSessionId;
  const titleParts = [`${t.agent} · ${t.status}`, formatRelativeTime(t.startedAt)];
  if (t.error) titleParts.push(t.error);
  titleParts.push(t.prompt);

  return (
    <div className="group flex items-center gap-1.5 pl-3 pr-2 py-1 text-[11px]" title={titleParts.join('\n')}>
      <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${HEADLESS_DOT_CLASS[t.status]}`} aria-label={t.status} />
      <span className="shrink-0 flex items-center justify-center w-3.5 text-text-muted/50">
        <AgentBadgeGlyph agentId={t.agent} />
      </span>
      <span className="flex-1 truncate text-text-muted">{t.prompt}</span>
      {openable && (
        <button
          type="button"
          className={`${rowAction()} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
          title="open this run as an interactive session"
          onClick={(e) => {
            e.stopPropagation();
            props.onOpenAsSession(t);
          }}
        >
          <ChevronRight size={12} strokeWidth={2.25} />
        </button>
      )}
    </div>
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
  // Title: the captured first message (seeded sessions), else the sticky name.
  const display = s.title?.trim() || s.name;
  const tidShort = s.agentSessionId ? s.agentSessionId.slice(0, 8) : null;
  const metaParts: string[] = [`agent ${s.agent}`];
  if (s.pid !== null) metaParts.push(`pid ${s.pid}`);
  if (tidShort) metaParts.push(tidShort);
  if (isPaused) metaParts.push('paused');
  const meta = metaParts.join(' · ');
  // Full message on hover when it's been truncated, then the technical meta.
  const tooltip = s.title?.trim() ? `${s.title.trim()}\n${meta}` : meta;

  return (
    <div
      className={`group relative flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-[12px] transition-colors ${
        props.isActive ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary/50'
      }`}
    >
      {props.isActive && <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent" />}
      <button
        type="button"
        className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
        onClick={props.onSelect}
        title={tooltip}
      >
        <span className={`shrink-0 flex items-center justify-center w-3.5 ${isPaused ? 'text-text-muted/40' : 'text-text-muted/70'}`}>
          <AgentBadgeGlyph agentId={s.agent} />
        </span>
        <span className={`truncate ${isPaused ? 'text-text-muted' : 'text-text'}`}>{display}</span>
      </button>
      {/* Right-aligned, always-visible state-as-action: a running session shows
          STOP (■, click to pause it); a paused one shows PLAY (▶, click to
          resume). The glyph is the at-a-glance state AND the action. */}
      {isPaused ? (
        <button
          type="button"
          className={rowAction()}
          title="resume this session"
          aria-label="resume this session"
          onClick={(e) => {
            e.stopPropagation();
            props.onResume();
          }}
        >
          <Play size={11} strokeWidth={0} fill="currentColor" />
        </button>
      ) : (
        <button
          type="button"
          className={rowAction()}
          title="stop this session"
          aria-label="stop this session"
          onClick={(e) => {
            e.stopPropagation();
            props.onPause();
          }}
        >
          <Square size={10} strokeWidth={0} fill="currentColor" />
        </button>
      )}
      <button
        type="button"
        className={`${rowAction(true)} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
        title="delete this session"
        aria-label="delete this session"
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete();
        }}
      >
        <X size={12} strokeWidth={2.5} />
      </button>
    </div>
  );
}
