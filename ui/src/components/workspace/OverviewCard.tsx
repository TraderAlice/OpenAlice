import { useMemo } from 'react'
import { formatRelativeTime } from '../../lib/intl'
import { ArrowUpCircle, Bot, ChevronRight, Code, Cpu, GitBranch, ScrollText, Settings, Sparkles, Terminal, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GitLogEntry, Workspace } from './api'
import { workspaceDisplayName, workspaceDisplayTitle } from './display'

/**
 * Single-workspace card for the Workspaces Overview dashboard. Variant B
 * from the design discussion — header (status dot + tag), template +
 * relative-activity subtitle, sessions list (each clickable), provider
 * override + latest commit footer (rendered only when present).
 *
 * A full-card button opens the workspace tab. It is a sibling of the
 * interactive session, upgrade, and provider controls so the whole card stays
 * mouse-friendly without nesting buttons or excluding keyboard users.
 */

const AGENT_ICONS: Record<string, LucideIcon> = {
  claude: Sparkles,
  codex: Cpu,
  opencode: Code,
  pi: Bot,
  shell: Terminal,
}

const SESSION_PREVIEW_LIMIT = 5
const MOBILE_SESSION_PREVIEW_LIMIT = 2

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
  /** Open the reviewed Template Upgrade preview. */
  onUpgrade?: () => void
}

export function OverviewCard({
  workspace,
  lastCommit,
  onOpen,
  onOpenSession,
  onConfigure,
  onUpgrade,
}: Props) {
  const { t } = useTranslation()
  const w = workspace
  const label = workspaceDisplayName(w)
  const hasRunning = w.sessions.some((s) => s.state === 'running')
  const previewSessions = w.sessions.slice(0, SESSION_PREVIEW_LIMIT)
  const hiddenSessionCount = w.sessions.length - previewSessions.length
  const mobileHiddenSessionCount = Math.max(0, w.sessions.length - MOBILE_SESSION_PREVIEW_LIMIT)

  const lastActivityMs = useMemo(() => {
    const sessionTs = w.sessions
      .map((s) => new Date(s.lastActiveAt).getTime())
      .filter((n) => Number.isFinite(n))
    if (sessionTs.length === 0) return new Date(w.createdAt).getTime()
    return Math.max(...sessionTs)
  }, [w.sessions, w.createdAt])

  const dotClass = hasRunning
    ? 'bg-success'
    : w.sessions.length > 0
      ? 'bg-muted-foreground/40'
      : 'border border-border'

  const overrideAgents: string[] = []
  if (w.agentOverride?.claude) overrideAgents.push('claude')
  if (w.agentOverride?.codex) overrideAgents.push('codex')
  if (w.agentOverride?.opencode) overrideAgents.push('opencode')
  if (w.agentOverride?.pi) overrideAgents.push('pi')

  return (
    <article
      className="group relative rounded-lg border border-border bg-secondary p-3 transition-colors hover:border-border/80 hover:bg-muted/40 sm:p-4"
    >
      <button
        type="button"
        aria-label={label}
        onClick={onOpen}
        className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />

      <div className="pointer-events-none relative z-10 flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-start gap-2.5">
          <span
            className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dotClass}`}
            aria-hidden="true"
          />
          <div className="flex-1 min-w-0">
            <h3 className="text-[14px] font-semibold text-foreground truncate" title={workspaceDisplayTitle(w)}>
              {label}
            </h3>
            <p className="text-[11px] text-muted-foreground truncate" title={w.description}>
              {w.description?.trim() || t('workspace.activeAgo', { time: formatRelativeTime(lastActivityMs) })}
            </p>
          </div>
          {w.upgradeAvailable && w.template && (
            <button
              type="button"
              onClick={() => onUpgrade?.()}
              disabled={!onUpgrade}
              title={t('workspace.templateUpgrade', {
                from: w.upgradeAvailable.from,
                to: w.upgradeAvailable.to,
              })}
              className="oa-pressable pointer-events-auto flex min-h-10 shrink-0 items-center gap-1 rounded border border-primary/40 px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:border-primary/80 hover:bg-primary/10 disabled:cursor-default disabled:hover:border-primary/40 disabled:hover:bg-transparent sm:min-h-0"
            >
              <ArrowUpCircle size={10} strokeWidth={2.25} />
              <span>v{w.upgradeAvailable.to}</span>
            </button>
          )}
        </div>

        {/* Sessions */}
        <div className="border-t border-border pt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">
            <span>{t('workspace.sessions')}</span>
            <span className="tabular-nums text-muted-foreground/45">{w.sessions.length}</span>
          </div>
          {w.sessions.length === 0 ? (
            <p className="text-[12px] text-muted-foreground/80 italic">{t('workspace.noSessions')}</p>
          ) : (
            <ul className="space-y-0.5 -mx-2">
              {previewSessions.map((s, index) => (
                <li
                  key={s.id}
                  className={index >= MOBILE_SESSION_PREVIEW_LIMIT ? 'hidden sm:list-item' : undefined}
                >
                  <button
                    type="button"
                    aria-label={`${s.name} ${t(s.state === 'running' ? 'workspace.running' : 'workspace.paused')}`}
                    onClick={() => onOpenSession(s.id)}
                    className="oa-nav-row pointer-events-auto flex min-h-10 w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:min-h-0"
                  >
                    <span className="w-3 flex justify-center text-muted-foreground">
                      <AgentGlyph agent={s.agent} />
                    </span>
                    <span className="font-mono text-[11px] tabular-nums">{s.name}</span>
                    <span
                      className={`text-[11px] ${
                        s.state === 'running' ? 'text-success' : 'text-muted-foreground'
                      }`}
                    >
                      {t(s.state === 'running' ? 'workspace.running' : 'workspace.paused')}
                    </span>
                    <ChevronRight
                      size={10}
                      className="ml-auto text-muted-foreground opacity-60 transition-opacity sm:opacity-0 sm:group-hover:opacity-60"
                    />
                  </button>
                </li>
              ))}
              {mobileHiddenSessionCount > 0 && (
                <li className={`mt-1 border-t border-border/60 pt-1 ${hiddenSessionCount === 0 ? 'sm:hidden' : ''}`}>
                  <button
                    type="button"
                    onClick={onOpen}
                    aria-label={t('workspace.viewAllSessions', { count: w.sessions.length })}
                    className="oa-nav-row pointer-events-auto flex min-h-10 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] font-medium text-primary hover:bg-primary/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:min-h-0"
                  >
                    <span>{t('workspace.viewAllSessions', { count: w.sessions.length })}</span>
                    <span className="ml-auto tabular-nums text-muted-foreground/55 sm:hidden">
                      +{mobileHiddenSessionCount}
                    </span>
                    <span className="ml-auto hidden tabular-nums text-muted-foreground/55 sm:inline">
                      +{hiddenSessionCount}
                    </span>
                    <ChevronRight size={11} className="text-primary/65" aria-hidden />
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Footer — only rendered when there's something to show */}
        {(overrideAgents.length > 0 || lastCommit || w.harnessSource || (w.template && w.spawnedFromVersion)) && (
          <div className="border-t border-border pt-3 space-y-1.5">
            {w.harnessSource && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <GitBranch size={11} strokeWidth={2.25} className="shrink-0" />
                <span
                  className="truncate"
                  title={`${w.harnessSource.version} · ${w.harnessSource.commit}`}
                >
                  {t('workspace.fromHarnessSource', {
                    version: w.harnessSource.version,
                    commit: w.harnessSource.commit.slice(0, 12),
                  })}
                </span>
              </div>
            )}
            {w.template && w.spawnedFromVersion && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <GitBranch size={11} strokeWidth={2.25} className="shrink-0" />
                <span className="truncate">
                  {t('workspace.fromTemplate', {
                    template: w.template,
                    version: w.spawnedFromVersion,
                  })}
                </span>
              </div>
            )}
            {overrideAgents.length > 0 && onConfigure && (
              <button
                type="button"
                onClick={onConfigure}
                className="pointer-events-auto flex min-h-10 w-full items-center gap-2 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground sm:min-h-0"
              >
                <Settings size={11} strokeWidth={2.25} className="shrink-0" />
                <span>{t('workspace.override', { agents: overrideAgents.join(', ') })}</span>
              </button>
            )}
            {overrideAgents.length > 0 && !onConfigure && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Settings size={11} strokeWidth={2.25} className="shrink-0" />
                <span>{t('workspace.override', { agents: overrideAgents.join(', ') })}</span>
              </div>
            )}
            {lastCommit && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <ScrollText size={11} strokeWidth={2.25} className="shrink-0" />
                <span className="truncate" title={lastCommit.subject}>
                  {lastCommit.subject}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
