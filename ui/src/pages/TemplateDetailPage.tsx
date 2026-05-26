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
import { useTranslation } from 'react-i18next'

import { MarkdownContent } from '../components/MarkdownContent'
import { useWorkspaces } from '../contexts/WorkspacesContext'
import { useWorkspace } from '../tabs/store'
import {
  createWorkspace,
  fetchTemplateReadme,
} from '../components/workspace/api'

const TAG_HINT = 'a-z, 0-9, "-", "_", up to 33 chars'
const TAG_RE = /^[a-z0-9][a-z0-9_-]{0,32}$/

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
  const { t } = useTranslation()
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

  // Spawn form state — same shape as the sidebar's inline form, but laid
  // out as a panel rather than a compact column.
  const [tag, setTag] = useState('')
  const [pickedAgents, setPickedAgents] = useState<Set<string> | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Reset form state when the user navigates to a different template tab.
  useEffect(() => {
    setTag('')
    setPickedAgents(null)
    setCreateError(null)
  }, [templateName])

  const checkedAgents: ReadonlySet<string> = useMemo(() => {
    if (pickedAgents) return pickedAgents
    return new Set(template?.defaultAgents ?? ['claude'])
  }, [pickedAgents, template])

  const toggleAgent = (id: string): void => {
    setPickedAgents((prev) => {
      const base = prev ?? new Set(template?.defaultAgents ?? ['claude'])
      const next = new Set(base)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const submit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!template) return
    const t = tag.trim()
    if (!TAG_RE.test(t)) {
      setCreateError(`invalid tag (${TAG_HINT})`)
      return
    }
    if (checkedAgents.size === 0) {
      setCreateError('pick at least one agent')
      return
    }
    setCreating(true)
    setCreateError(null)
    const result = await createWorkspace(t, template.name, Array.from(checkedAgents))
    setCreating(false)
    if (result.ok) {
      refresh()
      openOrFocus({ kind: 'workspace', params: { wsId: result.workspace.id } })
    } else {
      const msg = result.error.message ?? result.error.error ?? `HTTP ${result.status}`
      setCreateError(msg)
    }
  }

  if (!template) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted px-6">
        <h2 className="text-lg font-medium text-text mb-2">{t('templates.notFound', 'Template not found')}</h2>
        <p className="text-sm">{t('templates.noTemplateNamed', 'No template named')} <code className="font-mono">{templateName}</code>.</p>
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
            <p className="text-[12px] text-text-muted italic">{t('templates.loadingReadme', 'Loading README\u2026')}</p>
          )}
          {readmeError && (
            <p className="text-[12px] text-text-muted italic">{readmeError}</p>
          )}
          {readme && <MarkdownContent text={readme} />}
        </div>

        {/* Spawn form */}
        <form onSubmit={submit} className="rounded-lg border border-border bg-bg-secondary px-6 py-5 space-y-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[14px] font-semibold text-text">{t('templates.spawnWorkspace', 'Spawn a workspace')}</h3>
            <span className="text-[11px] text-text-muted">
              {t('templates.from', 'from')} {template.name} v{template.version}
            </span>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="tpl-detail-tag" className="block text-[11px] uppercase tracking-wider text-text-muted/70">
              {t('templates.tag', 'Tag')}
            </label>
            <input
              id="tpl-detail-tag"
              ref={inputRef}
              type="text"
              placeholder="e.g. may1"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              disabled={creating}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="w-full px-3 py-2 text-[13px] bg-bg border border-border rounded font-mono text-text placeholder:text-text-muted/50 focus:outline-none focus:border-accent"
            />
            <p className="text-[11px] text-text-muted/70">{TAG_HINT}</p>
          </div>

          {agents.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-wider text-text-muted/70">{t('templates.agents', 'Agents')}</div>
              <div className="flex items-center gap-3 flex-wrap">
                {agents.map((a) => (
                  <label key={a.id} className="flex items-center gap-1.5 text-[12px] text-text" title={a.displayName}>
                    <input
                      type="checkbox"
                      checked={checkedAgents.has(a.id)}
                      onChange={() => toggleAgent(a.id)}
                      disabled={creating}
                    />
                    <span>{a.id}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {createError && (
            <div className="text-[12px] text-red">{createError}</div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={creating || tag.length === 0}
              className="btn-primary"
            >
              {creating ? t('templates.creating', 'Creating\u2026') : t('templates.createWorkspace', 'Create workspace')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
