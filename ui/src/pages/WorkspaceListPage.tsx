/**
 * Workspaces Overview dashboard.
 *
 * Card-based at-a-glance view of every workspace, grouped by template
 * type into sections. Section order is driven by each template's
 * `groupOrder` declared in its `template.json` — adding a new template
 * type just needs the JSON entry, no frontend code change. Workspaces
 * with an unknown / missing template land in a trailing "Other" bucket.
 *
 * Within each section, cards sort by most-recent-activity. Card body
 * opens the workspace tab; session rows drill into that session; the
 * ⚙ override row opens the AI-provider modal.
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useWorkspaces } from '../contexts/WorkspacesContext'
import { useWorkspace } from '../tabs/store'
import { OverviewCard } from '../components/workspace/OverviewCard'
import {
  getGitLog,
  type GitLogEntry,
  type TemplateInfo,
  type Workspace,
} from '../components/workspace/api'

function lastActivityMs(w: Workspace): number {
  const sessionTs = w.sessions
    .map((s) => new Date(s.lastActiveAt).getTime())
    .filter((n) => Number.isFinite(n))
  if (sessionTs.length === 0) return new Date(w.createdAt).getTime()
  return Math.max(...sessionTs)
}

/** Best-effort humanization for templates that don't declare a `displayName`. */
function humanize(name: string): string {
  return (
    name
      .split(/[-_]/)
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ') || name
  )
}

interface Section {
  readonly key: string
  readonly title: string
  readonly workspaces: readonly Workspace[]
}

const UNKNOWN_KEY = '__unknown__'

function buildSections(
  workspaces: readonly Workspace[],
  templates: readonly TemplateInfo[],
): Section[] {
  // Bucket workspaces by template name; unknown / missing → "Other".
  const knownTemplateNames = new Set(templates.map((t) => t.name))
  const buckets = new Map<string, Workspace[]>()
  for (const w of workspaces) {
    const key = w.template && knownTemplateNames.has(w.template) ? w.template : UNKNOWN_KEY
    const bucket = buckets.get(key)
    if (bucket) bucket.push(w)
    else buckets.set(key, [w])
  }

  // Section order = templates sorted by groupOrder (declared in each
  // template.json), then alphabetical for ties / undeclared. Templates
  // without a workspace in them are skipped.
  const orderedTemplates = [...templates].sort((a, b) => {
    const ao = a.groupOrder ?? Number.POSITIVE_INFINITY
    const bo = b.groupOrder ?? Number.POSITIVE_INFINITY
    if (ao !== bo) return ao - bo
    return a.name.localeCompare(b.name)
  })

  const sections: Section[] = []
  for (const t of orderedTemplates) {
    const ws = buckets.get(t.name)
    if (!ws || ws.length === 0) continue
    const sorted = [...ws].sort((a, b) => lastActivityMs(b) - lastActivityMs(a))
    sections.push({
      key: t.name,
      title: t.displayName ?? humanize(t.name),
      workspaces: sorted,
    })
  }
  const others = buckets.get(UNKNOWN_KEY)
  if (others && others.length > 0) {
    const sorted = [...others].sort((a, b) => lastActivityMs(b) - lastActivityMs(a))
    sections.push({ key: UNKNOWN_KEY, title: 'Other', workspaces: sorted })
  }
  return sections
}

export function WorkspaceListPage() {
  const { t } = useTranslation()
  const { workspaces, templates, openAgentConfig } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)

  // Latest commit per workspace. Fetched in parallel on mount + whenever
  // the set of workspace IDs changes. Polled separately from the regular
  // workspaces refresh because git log is expensive — we don't want it
  // running every 3s on the list poll.
  const [commits, setCommits] = useState<Record<string, GitLogEntry | null>>({})
  const idsKey = useMemo(() => workspaces.map((w) => w.id).join(','), [workspaces])
  useEffect(() => {
    if (workspaces.length === 0) return
    let cancelled = false
    void Promise.all(
      workspaces.map(async (w) => {
        try {
          const entries = await getGitLog(w.id, 1)
          return [w.id, entries[0] ?? null] as const
        } catch {
          return [w.id, null] as const
        }
      }),
    ).then((pairs) => {
      if (cancelled) return
      setCommits(Object.fromEntries(pairs))
    })
    return () => {
      cancelled = true
    }
  }, [idsKey, workspaces])

  const sections = useMemo(
    () => buildSections(workspaces, templates),
    [workspaces, templates],
  )

  if (workspaces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted px-6">
        <h2 className="text-lg font-medium text-text mb-2">{t('workspaces.title')}</h2>
        <p className="text-sm max-w-md text-center">
          {t('workspaces.noWorkspaces', 'No workspaces yet. Create one from the sidebar — each is an isolated git directory with a persistent terminal session attached, wired to OpenAlice over MCP.')}
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2 className="text-[18px] font-semibold text-text">{t('workspaces.overview', 'Workspaces Overview')}</h2>
          <span className="text-[12px] text-text-muted">
            {t('workspaces.workspaceCount', '{{count}} workspace', { count: workspaces.length })}
          </span>
        </div>

        <div className="space-y-7">
          {sections.map((sec) => (
            <section key={sec.key}>
              <div className="mb-3 flex items-baseline gap-2">
                <h3 className="text-[12px] font-semibold text-text/85 uppercase tracking-wider">
                  {sec.key === UNKNOWN_KEY ? t('workspaces.other', 'Other') : sec.title}
                </h3>
                <span className="text-[11px] text-text-muted">· {sec.workspaces.length}</span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {sec.workspaces.map((w) => (
                  <OverviewCard
                    key={w.id}
                    workspace={w}
                    lastCommit={commits[w.id] ?? null}
                    onOpen={() =>
                      openOrFocus({ kind: 'workspace', params: { wsId: w.id } })
                    }
                    onOpenSession={(sid) =>
                      openOrFocus({
                        kind: 'workspace',
                        params: { wsId: w.id, sessionId: sid },
                      })
                    }
                    onConfigure={() => openAgentConfig(w.id)}
                    onOpenTemplate={(name) =>
                      openOrFocus({ kind: 'template-detail', params: { name } })
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
