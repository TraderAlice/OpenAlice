import { Bot, Code, Cpu, Sparkles, Terminal, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { AgentInfo, TemplateInfo } from './api'

/**
 * Catalog card for a workspace template. Mirrors the visual idiom of
 * OverviewCard (border + rounded-lg + bg-bg-secondary + hover) so the
 * Workspaces activity feels like one design system. Click → opens the
 * detail tab where the README and spawn form live.
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

function humanize(name: string): string {
  return (
    name
      .split(/[-_]/)
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ') || name
  )
}

interface Props {
  template: TemplateInfo
  /** All registered agents — every workspace enables all of them, so the card
   *  shows the full set (not a per-template subset). */
  agents: readonly AgentInfo[]
  onOpen: () => void
}

export function TemplateCard({ template: t, agents, onOpen }: Props) {
  const { t: tr } = useTranslation()
  const title = t.displayName ?? humanize(t.name)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group rounded-lg border border-border bg-bg-secondary hover:bg-bg-tertiary/40 hover:border-border/80 transition-colors cursor-pointer p-4 flex flex-col gap-3 text-left"
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="text-[14px] font-semibold text-text truncate" title={t.name}>
              {title}
            </h3>
            <span className="text-[11px] font-mono text-text-muted tabular-nums">
              v{t.version}
            </span>
            {t.community && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-text-muted">
                {tr('templates.communityBadge')}
              </span>
            )}
          </div>
          {t.description && (
            <p className="text-[12px] text-text-muted line-clamp-3 mt-1">
              {t.description}
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-border pt-3 flex items-center gap-3 flex-wrap">
        <div className="text-[10px] uppercase tracking-wider text-text-muted/70">
          {tr('templates.agentsLabel')}
        </div>
        <div className="flex items-center gap-2 text-text-muted flex-wrap">
          {agents.map((a) => {
            // Backend PATH-probes each runtime; dim the ones not installed on
            // this host so the catalog hints at what needs setting up.
            const missing = a.installed === false
            return (
              <span
                key={a.id}
                className={`flex items-center gap-1 text-[11px] ${missing ? 'opacity-40' : ''}`}
                title={missing ? `${a.id} — ${tr('templates.agentNotInstalled')}` : a.id}
              >
                <AgentGlyph agent={a.id} />
                <span className={missing ? 'line-through' : ''}>{a.id}</span>
              </span>
            )
          })}
        </div>
      </div>
    </button>
  )
}
