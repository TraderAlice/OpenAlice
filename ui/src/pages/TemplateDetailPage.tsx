/**
 * Workspace template detail.
 *
 * Renders the template's README (via MarkdownContent). This is the
 * in-flow staffing surface — read what shape of coworker this Harness
 * produces, then hire one via the top-right "Create workspace" button,
 * which opens the same CreateWorkspaceDialog every other create entry
 * point uses (sidebar +, Chat +). Keeping a single create presentation
 * means the README stays a pure reading surface instead of burying a
 * form below the fold.
 *
 * The instance the agent starts modifying from here will diverge over
 * time; this page describes the **starting shape**. The README on disk
 * inside the spawned workspace is the agent's territory thereafter.
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MarkdownContent } from '../components/MarkdownContent'
import { useWorkspaces } from '../contexts/workspaces-context'
import { useWorkspace } from '../tabs/store'
import { fetchTemplateReadme } from '../components/workspace/api'
import { CreateWorkspaceDialog } from '../components/workspace/CreateWorkspaceDialog'

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
  const [showCreate, setShowCreate] = useState(false)

  const templateName = spec.params.name
  const template = useMemo(
    () => templates.find((t) => t.name === templateName),
    [templates, templateName],
  )

  // README — fetched lazily once per template (no cache across mounts; the
  // catalog is small enough that re-fetch on tab open is fine).
  const [readme, setReadme] = useState<string | null>(null)
  const [readmeMissing, setReadmeMissing] = useState(false)
  const [readmeError, setReadmeError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setReadme(null)
    setReadmeMissing(false)
    setReadmeError(null)
    void fetchTemplateReadme(templateName)
      .then((md) => {
        if (cancelled) return
        if (md === null) setReadmeMissing(true)
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

  if (!template) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted px-6">
        <h2 className="text-lg font-medium text-text mb-2">{t('templates.notFoundTitle')}</h2>
        <p className="text-sm">{t('templates.notFoundBody', { name: templateName })}</p>
      </div>
    )
  }

  const title = template.displayName ?? humanize(template.name)

  // The page header already shows the title — drop the README's own leading
  // H1 so it doesn't render twice. Conservative: only when the very first
  // content line is an ATX h1.
  const readmeBody = readme === null ? null : readme.replace(/^\s*#[^\n#].*\r?\n+/, '')

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Header — identity + metadata band */}
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <h2 className="text-[20px] font-semibold text-text truncate">{title}</h2>
              <span className="text-[12px] font-mono text-text-muted tabular-nums shrink-0">
                v{template.version}
              </span>
              {template.community && (
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-text-muted shrink-0">
                  {t('templates.communityBadge')}
                </span>
              )}
            </div>
            {template.description && (
              <p className="text-[12px] text-text-muted mt-1.5 max-w-2xl leading-relaxed">
                {template.description}
              </p>
            )}
            <div className="flex items-center gap-3 mt-2.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-text-muted/70">
                {t('templates.agentsLabel')}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {agents.map((a) => (
                  <span
                    key={a.id}
                    className="text-[11px] font-mono text-text-muted px-1.5 py-0.5 rounded bg-bg-tertiary"
                  >
                    {a.id}
                  </span>
                ))}
              </div>
              <span className="text-[11px] font-mono text-text-muted/60">
                {template.name}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="btn-primary shrink-0"
          >
            {t('createWorkspace.create')}
          </button>
        </div>

        {/* README body — the template's starting-shape doc */}
        <div className="text-[10px] uppercase tracking-wider text-text-muted/70 mb-2">
          {t('templates.readmeLabel')}
        </div>
        <div className="rounded-lg border border-border bg-bg-secondary px-6 py-5">
          {readme === null && !readmeMissing && readmeError === null && (
            <p className="text-[12px] text-text-muted italic">{t('templates.loadingReadme')}</p>
          )}
          {readmeMissing && (
            <p className="text-[12px] text-text-muted italic">{t('templates.noReadme')}</p>
          )}
          {readmeError && (
            <p className="text-[12px] text-text-muted italic">{readmeError}</p>
          )}
          {readmeBody && (
            <MarkdownContent text={readmeBody} className="text-[13px] leading-relaxed" />
          )}
        </div>
      </div>

      {showCreate && (
        <CreateWorkspaceDialog
          templates={templates}
          presetTemplate={template.name}
          onClose={() => setShowCreate(false)}
          onCreated={(workspace) => {
            refresh()
            openOrFocus({ kind: 'workspace', params: { wsId: workspace.id } })
          }}
        />
      )}
    </div>
  )
}
