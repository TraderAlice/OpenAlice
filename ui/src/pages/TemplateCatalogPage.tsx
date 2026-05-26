/**
 * Workspace template catalog.
 *
 * Grid of TemplateCards — one per discovered template — answering "what
 * kinds of coworkers can OpenAlice hire for you?". Click a card to drill
 * into its README and spawn form (TemplateDetailPage).
 *
 * This page is the discovery surface for the Workspace ecosystem. As more
 * first-party templates land (and eventually third-party ones), this is
 * where they show up. v1: just the grid. No categories, no filters, no
 * search — at 3-10 templates that infrastructure is premature.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useWorkspaces } from '../contexts/WorkspacesContext'
import { useWorkspace } from '../tabs/store'
import { TemplateCard } from '../components/workspace/TemplateCard'

export function TemplateCatalogPage() {
  const { t } = useTranslation()
  const { templates } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)

  // Sort by groupOrder (ascending), then name. Same idiom as the Overview
  // section ordering so users see the same shape twice over.
  const sorted = useMemo(() => {
    return [...templates].sort((a, b) => {
      const ao = a.groupOrder ?? Number.POSITIVE_INFINITY
      const bo = b.groupOrder ?? Number.POSITIVE_INFINITY
      if (ao !== bo) return ao - bo
      return a.name.localeCompare(b.name)
    })
  }, [templates])

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted px-6">
        <h2 className="text-lg font-medium text-text mb-2">{t('templates.title', 'Templates')}</h2>
        <p className="text-sm max-w-md text-center">
          {t('templates.noTemplates', 'No templates discovered. Check the launcher\'s templates directory.')}
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h2 className="text-[18px] font-semibold text-text">{t('templates.workspaceTemplates', 'Workspace templates')}</h2>
          <p className="text-[12px] text-text-muted mt-1 max-w-2xl">
            {t('templates.workspaceTemplatesDescription', 'Each template spawns a workspace with a specific shape — what tools the agent has, what files start in the folder, what kind of work it\'s set up for. Pick one to see what it does, then create an instance.')}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sorted.map((t) => (
            <TemplateCard
              key={t.name}
              template={t}
              onOpen={() =>
                openOrFocus({ kind: 'template-detail', params: { name: t.name } })
              }
            />
          ))}
        </div>
      </div>
    </div>
  )
}
