import { useTranslation } from 'react-i18next'

import { Button } from '../ui/button'
import { AgentRuntimeIcon } from '../../lib/agentRuntimeIcon'
import type { AgentInfo, TemplateInfo } from './api'

/**
 * Catalog card for a workspace template. Mirrors the visual idiom of
 * OverviewCard (border + rounded-lg + bg-secondary + hover) so the
 * Workspaces activity feels like one design system. Click → opens the
 * detail tab where the README and spawn form live.
 */

function AgentGlyph({ agent }: { agent: string }) {
  return <AgentRuntimeIcon agentId={agent} className="size-3.5 shrink-0" />
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
  /** All registered agents; eligibility is installation-wide. */
  agents: readonly AgentInfo[]
  onOpen: () => void
}

export function TemplateCard({ template: t, agents, onOpen }: Props) {
  const { t: tr } = useTranslation()
  const title = t.displayName ?? humanize(t.name)
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onOpen}
      className="group h-auto min-h-0 w-full cursor-pointer items-stretch justify-start gap-3 rounded-lg bg-secondary/45 p-4 text-left whitespace-normal"
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="text-[14px] font-semibold text-foreground truncate" title={t.name}>
              {title}
            </h3>
            <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
              v{t.version}
            </span>
            {t.community && (
              <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {tr('templates.communityBadge')}
              </span>
            )}
          </div>
          {t.description && (
            <p className="text-[12px] text-muted-foreground line-clamp-3 mt-1">
              {t.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <div className="text-[11px] font-medium text-muted-foreground/70">
          {tr('templates.agentsLabel')}
        </div>
        <div className="flex items-center gap-2 text-muted-foreground flex-wrap">
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
    </Button>
  )
}
