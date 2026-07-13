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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArchiveRestore, Trash2 } from 'lucide-react'

import { useWorkspaces } from '../contexts/workspaces-context'
import { useWorkspace } from '../tabs/store'
import { OverviewCard } from '../components/workspace/OverviewCard'
import {
  getGitLog,
  listDepartedWorkspaces,
  purgeDepartedWorkspace,
  restoreWorkspace,
  type DepartedWorkspace,
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
  otherTitle: string,
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
    sections.push({ key: UNKNOWN_KEY, title: otherTitle, workspaces: sorted })
  }
  return sections
}

export function WorkspaceListPage() {
  const { t } = useTranslation()
  const { workspaces, templates, openAgentConfig, refresh } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const [departed, setDeparted] = useState<DepartedWorkspace[]>([])
  const [departedError, setDepartedError] = useState<string | null>(null)
  const [lifecycleBusy, setLifecycleBusy] = useState<string | null>(null)
  const idsKey = useMemo(() => workspaces.map((w) => w.id).join(','), [workspaces])

  const refreshDeparted = useCallback(async () => {
    try {
      setDeparted(await listDepartedWorkspaces())
      setDepartedError(null)
    } catch (err) {
      setDepartedError((err as Error).message)
    }
  }, [])

  // Active and departed inventories are two views of one lifecycle. Refresh
  // the archive whenever the active ID set changes so an offboarding action
  // taken from either sidebar appears here without a page reload.
  useEffect(() => { void refreshDeparted() }, [refreshDeparted, idsKey])

  // Latest commit per workspace. Fetched in parallel on mount + whenever
  // the set of workspace IDs changes. Polled separately from the regular
  // workspaces refresh because git log is expensive — we don't want it
  // running every 3s on the list poll.
  const [commits, setCommits] = useState<Record<string, GitLogEntry | null>>({})
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
    () => buildSections(workspaces, templates, t('workspace.other')),
    [workspaces, templates, t],
  )

  if (workspaces.length === 0 && departed.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted px-6">
        <h2 className="text-lg font-medium text-text mb-2">{t('workspace.emptyTitle')}</h2>
        <p className="text-sm max-w-md text-center">
          {t('workspace.emptyBody')}
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="mb-6 flex items-baseline justify-between gap-4">
          <h2 className="text-[18px] font-semibold text-text">{t('workspace.overviewTitle')}</h2>
          <span className="text-[12px] text-text-muted">
            {t(workspaces.length === 1 ? 'workspace.workspaceSingular' : 'workspace.workspacePlural', {
              count: workspaces.length,
            })}
          </span>
        </div>

        <div className="space-y-7">
          {sections.map((sec) => (
            <section key={sec.key}>
              <div className="mb-3 flex items-baseline gap-2">
                <h3 className="text-[12px] font-semibold text-text/85 uppercase tracking-wider">
                  {sec.title}
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

          {(departed.length > 0 || departedError) && (
            <section className="border-t border-border pt-6">
              <div className="mb-3 flex items-baseline gap-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-text/85">
                  Departed Workspaces
                </h3>
                <span className="text-[11px] text-text-muted">· {departed.length}</span>
              </div>
              <p className="mb-3 max-w-2xl text-[12px] leading-relaxed text-text-muted">
                Offboarded desks are outside the active Workspace directory. Restore returns the exact checkout and Session signatures; purge removes files but keeps the historical tombstone.
              </p>
              {departedError && (
                <div className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
                  {departedError}
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {departed.map((workspace) => {
                  const purged = workspace.lifecycle === 'purged' || workspace.lifecycle === 'purging'
                  return (
                    <article key={workspace.id} className="rounded-lg border border-border bg-bg-secondary/35 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-medium text-text">{workspace.tag}</div>
                          <div className="mt-0.5 font-mono text-[10px] text-text-muted">{workspace.id}</div>
                        </div>
                        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-muted">
                          {workspace.lifecycle}
                        </span>
                      </div>
                      <p className="mt-3 line-clamp-2 text-[12px] leading-relaxed text-text-muted">
                        {workspace.reason ?? 'No departure reason recorded.'}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
                        <span>{workspace.handoff?.resumeIds.length ?? 0} Sessions</span>
                        <span>{workspace.handoff?.openIssueIds.length ?? 0} open Issues</span>
                        {workspace.legacyImported && <span>legacy import</span>}
                      </div>
                      <div className="mt-4 flex justify-end gap-2">
                        {!purged && workspace.lifecycle === 'departed' && (
                          <button
                            type="button"
                            className="btn-secondary inline-flex items-center gap-1.5"
                            disabled={lifecycleBusy !== null}
                            onClick={() => {
                              setLifecycleBusy(workspace.id)
                              void restoreWorkspace(workspace.id)
                                .then(async () => { refresh(); await refreshDeparted() })
                                .catch((err) => setDepartedError((err as Error).message))
                                .finally(() => setLifecycleBusy(null))
                            }}
                          >
                            <ArchiveRestore size={13} /> Restore
                          </button>
                        )}
                        {!purged && workspace.lifecycle === 'departed' && (
                          <button
                            type="button"
                            className="btn-danger inline-flex items-center gap-1.5"
                            disabled={lifecycleBusy !== null}
                            onClick={() => {
                              if (!window.confirm(`Permanently purge files for ${workspace.tag}? The catalog tombstone remains, but the desk cannot be restored.`)) return
                              setLifecycleBusy(workspace.id)
                              void purgeDepartedWorkspace(workspace.id)
                                .then(refreshDeparted)
                                .catch((err) => setDepartedError((err as Error).message))
                                .finally(() => setLifecycleBusy(null))
                            }}
                          >
                            <Trash2 size={13} /> Purge files
                          </button>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
