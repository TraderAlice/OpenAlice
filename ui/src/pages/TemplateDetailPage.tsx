/**
 * Workspace template detail.
 *
 * Renders the template's README (via MarkdownContent) alongside a spawn
 * form. This is the in-flow staffing surface — read what shape of
 * coworker this Harness produces, fill the parameters, hire one.
 *
 * The instance the agent starts modifying from here will diverge over
 * time; this page describes the **starting shape**. The README on disk
 * inside the spawned workspace is the agent's territory thereafter.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import { MarkdownContent } from '../components/MarkdownContent'
import { useWorkspaces } from '../contexts/WorkspacesContext'
import { useWorkspace } from '../tabs/store'
import { fetchTemplateReadme } from '../components/workspace/api'
import { TAG_HINT, useCreateWorkspace } from '../hooks/useCreateWorkspace'

interface Props {
  spec: { kind: 'template-detail'; params: { name: string } }
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

export function TemplateDetailPage({ spec }: Props) {
  const { templates, agents, refresh } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)

  const templateName = spec.params.name
  const template = useMemo(
    () => templates.find((t) => t.name === templateName),
    [templates, templateName],
  )

  // README — fetched lazily once per template (no cache across mounts; the
  // catalog is small enough that re-fetch on tab open is fine).
  const [readme, setReadme] = useState<string | null>(null)
  const [readmeError, setReadmeError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setReadme(null)
    setReadmeError(null)
    void fetchTemplateReadme(templateName)
      .then((md) => {
        if (cancelled) return
        if (md === null) setReadmeError('This template doesn\'t ship a README yet.')
        else setReadme(md)
      })
      .catch((err) => {
        if (cancelled) return
        setReadmeError((err as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [templateName])

  const inputRef = useRef<HTMLInputElement | null>(null)

  // Spawn form state — same shape as the sidebar's inline form, but laid
  // out as a panel rather than a compact column.
  const create = useCreateWorkspace({
    template: template?.name ?? '',
    templateDefaultAgents: template?.defaultAgents,
    availableAgents: agents,
    onCreated: (workspace) => {
      refresh()
      openOrFocus({ kind: 'workspace', params: { wsId: workspace.id } })
    },
  })

  // Reset when the user navigates to a different template tab.
  useEffect(() => {
    create.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateName])

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!template) return
    await create.submit()
  }

  if (!template) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted px-6">
        <h2 className="text-lg font-medium text-text mb-2">Template not found</h2>
        <p className="text-sm">No template named <code className="font-mono">{templateName}</code>.</p>
      </div>
    )
  }

  const title = template.displayName ?? humanize(template.name)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="mb-6 flex items-baseline gap-3">
          <h2 className="text-[20px] font-semibold text-text">{title}</h2>
          <span className="text-[12px] font-mono text-text-muted tabular-nums">
            v{template.version}
          </span>
        </div>

        {/* README body */}
        <div className="rounded-lg border border-border bg-bg-secondary px-6 py-5 mb-6">
          {readme === null && readmeError === null && (
            <p className="text-[12px] text-text-muted italic">Loading README…</p>
          )}
          {readmeError && (
            <p className="text-[12px] text-text-muted italic">{readmeError}</p>
          )}
          {readme && <MarkdownContent text={readme} />}
        </div>

        {/* Spawn form */}
        <form onSubmit={submit} className="rounded-lg border border-border bg-bg-secondary px-6 py-5 space-y-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[14px] font-semibold text-text">Spawn a workspace</h3>
            <span className="text-[11px] text-text-muted">
              from {template.name} v{template.version}
            </span>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tpl-detail-tag" className="block text-[11px] uppercase tracking-wider text-text-muted/70">
              Tag
            </label>
            <input
              id="tpl-detail-tag"
              ref={inputRef}
              type="text"
              placeholder="e.g. may1"
              value={create.tag}
              onChange={(e) => create.setTag(e.target.value)}
              disabled={create.creating}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="w-full px-3 py-2 text-[13px] bg-bg border border-border rounded font-mono text-text placeholder:text-text-muted/50 focus:outline-none focus:border-accent"
            />
            <p className="text-[11px] text-text-muted/70">{TAG_HINT}</p>
          </div>

          {create.error && (
            <div className="text-[12px] text-red">{create.error}</div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={create.creating || create.tag.length === 0}
              className="btn-primary"
            >
              {create.creating ? 'Creating…' : 'Create workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
