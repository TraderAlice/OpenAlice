import { useMemo } from 'react'
import { formatRelativeTime } from '../../lib/intl'
import { ArrowUpCircle, Bot, ChevronRight, Code, Cpu, GitBranch, ScrollText, Settings, Sparkles, Terminal, type LucideIcon } from 'lucide-react'
import type { GitLogEntry, Workspace } from './api'
import { workspaceDisplayName, workspaceDisplayTitle } from './display'

/**
 * Single-workspace card for the Workspaces Overview dashboard. Variant B
 * from the design discussion — header (status dot + tag), template +
 * relative-activity subtitle, sessions list (each clickable), provider
 * override + latest commit footer (rendered only when present).
 *
 * The card body is clickable (opens the workspace tab). Inner regions —
 * session rows, the ⚙ override row — stopPropagation and route to their
 * own handler so the user can drill in without going through the main
 * workspace landing.
 */

const AGENT_ICONS: Record<string, LucideIcon> = {
  claude: Sparkles,
  codex: Cpu,
  opencode: Code,
  pi: Bot,
  shell: Terminal,
}

function AgentGlyph({ agent }: { agent: string }) {
  const Icon = AGENT_ICONS[agent]
  if (Icon) return <Icon size={12} strokeWidth={2.25} aria-hidden="true" />
  return <span aria-hidden="true" className="text-[11px] font-mono">·</span>
}


interface Props {
  workspace: Workspace
  lastCommit: GitLogEntry | null
  onOpen: () => void
  onOpenSession: (sessionId: string) => void
  onConfigure?: () => void
  /**
   * Open the template's detail page — used by the upgrade badge so the
   * user (or the agent reading the page) can see what's new before
   * deciding to self-upgrade. Optional; when absent the badge still
   * displays but isn't clickable.
   */
  onOpenTemplate?: (templateName: string) => void
}

export function OverviewCard({
  workspace,
  lastCommit,
  onOpen,
  onOpenSession,
  onConfigure,
  onOpenTemplate,
}: Props) {
  const w = workspace
  const label = workspaceDisplayName(w)
  const hasRunning = w.sessions.some((s) => s.state === 'running')

  const lastActivityMs = useMemo(() => {
    const sessionTs = w.sessions
      .map((s) => new Date(s.lastActiveAt).getTime())
      .filter((n) => Number.isFinite(n))
    if (sessionTs.length === 0) return new Date(w.createdAt).getTime()
    return Math.max(...sessionTs)
  }, [w.sessions, w.createdAt])

  const dotClass = hasRunning
    ? 'bg-green'
    : w.sessions.length > 0
      ? 'bg-text-muted/40'
      : 'border border-border'

  const overrideAgents: string[] = []
  if (w.agentOverride?.claude) overrideAgents.push('claude')
  if (w.agentOverride?.codex) overrideAgents.push('codex')
  if (w.agentOverride?.opencode) overrideAgents.push('opencode')
  if (w.agentOverride?.pi) overrideAgents.push('pi')

  return (
    <div
      onClick={onOpen}
      className="group rounded-lg border border-border bg-bg-secondary hover:bg-bg-tertiary/40 hover:border-border/80 transition-colors cursor-pointer p-4 flex flex-col gap-3"
    >
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <span
          className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotClass}`}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-text truncate" title={workspaceDisplayTitle(w)}>
            {label}
          </h3>
          <p className="text-[11px] text-text-muted truncate" title={w.description}>
            {w.description?.trim() || `Active ${formatRelativeTime(lastActivityMs)}`}
          </p>
        </div>
        {w.upgradeAvailable && w.template && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenTemplate?.(w.template!)
            }}
            disabled={!onOpenTemplate}
            title={`Template moved from v${w.upgradeAvailable.from} → v${w.upgradeAvailable.to}. The agent can self-upgrade by reading the new README and updating this workspace.`}
            className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-accent border border-accent/40 hover:border-accent/80 hover:bg-accent/10 transition-colors disabled:cursor-default disabled:hover:border-accent/40 disabled:hover:bg-transparent"
          >
            <ArrowUpCircle size={10} strokeWidth={2.25} />
            <span>v{w.upgradeAvailable.to}</span>
          </button>
        )}
      </div>

      {/* Sessions */}
      <div className="border-t border-border pt-3">
        <div className="text-[10px] uppercase tracking-wider text-text-muted/70 mb-1.5">
          Sessions
        </div>
        {w.sessions.length === 0 ? (
          <p className="text-[12px] text-text-muted/80 italic">no sessions yet</p>
        ) : (
          <ul className="space-y-0.5 -mx-2">
            {w.sessions.map((s) => (
              <li
                key={s.id}
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenSession(s.id)
                }}
                className="flex items-center gap-2 text-[12px] text-text hover:bg-bg-tertiary/40 px-2 py-1 rounded transition-colors cursor-pointer"
              >
                <span className="w-3 flex justify-center text-text-muted">
                  <AgentGlyph agent={s.agent} />
                </span>
                <span className="font-mono text-[11px] tabular-nums">{s.name}</span>
                <span
                  className={`text-[11px] ${
                    s.state === 'running' ? 'text-green' : 'text-text-muted'
                  }`}
                >
                  {s.state}
                </span>
                <ChevronRight
                  size={10}
                  className="ml-auto text-text-muted opacity-0 group-hover:opacity-60 transition-opacity"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer — only rendered when there's something to show */}
      {(overrideAgents.length > 0 || lastCommit || (w.template && w.spawnedFromVersion)) && (
        <div className="border-t border-border pt-3 space-y-1.5">
          {w.template && w.spawnedFromVersion && (
            <div className="flex items-center gap-2 text-[11px] text-text-muted">
              <GitBranch size={11} strokeWidth={2.25} className="shrink-0" />
              <span className="truncate">
                from {w.template} v{w.spawnedFromVersion}
              </span>
            </div>
          )}
          {overrideAgents.length > 0 && onConfigure && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onConfigure()
              }}
              className="flex items-center gap-2 text-[11px] text-text-muted hover:text-text transition-colors w-full text-left"
            >
              <Settings size={11} strokeWidth={2.25} className="shrink-0" />
              <span>Workspace override · {overrideAgents.join(', ')}</span>
            </button>
          )}
          {overrideAgents.length > 0 && !onConfigure && (
            <div className="flex items-center gap-2 text-[11px] text-text-muted">
              <Settings size={11} strokeWidth={2.25} className="shrink-0" />
              <span>Workspace override · {overrideAgents.join(', ')}</span>
            </div>
          )}
          {lastCommit && (
            <div className="flex items-center gap-2 text-[11px] text-text-muted">
              <ScrollText size={11} strokeWidth={2.25} className="shrink-0" />
              <span className="truncate" title={lastCommit.subject}>
                {lastCommit.subject}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
