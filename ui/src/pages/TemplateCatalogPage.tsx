/**
 * Workspace template catalog.
 *
 * Grid of TemplateCards — one per discovered template — answering "what
 * kinds of coworkers can OpenAlice hire for you?". Click a card to drill
 * into its README and spawn form (TemplateDetailPage).
 *
 * This page is the discovery surface for the Workspace ecosystem. Official
 * templates render first; community-tier templates (`community: true` in
 * template.json — third-party ecosystems bundled for convenience) render in
 * their own section below, so the official/community priority split stays
 * legible. v1: no filters, no search — at 3-10 templates that
 * infrastructure is premature.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useWorkspaces } from '../contexts/workspaces-context'
import { useWorkspace } from '../tabs/store'
import { TemplateCard } from '../components/workspace/TemplateCard'
import type { TemplateInfo } from '../components/workspace/api'

function byGroupOrder(a: TemplateInfo, b: TemplateInfo): number {
  const ao = a.groupOrder ?? Number.POSITIVE_INFINITY
  const bo = b.groupOrder ?? Number.POSITIVE_INFINITY
  if (ao !== bo) return ao - bo
  return a.name.localeCompare(b.name)
}

export function TemplateCatalogPage() {
  const { t } = useTranslation()
  const { templates, agents } = useWorkspaces()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)

  // Sort by groupOrder (ascending), then name — same idiom as the Overview
  // section ordering — then split official vs community.
  const { official, community } = useMemo(() => {
    const sorted = [...templates].sort(byGroupOrder)
    return {
      official: sorted.filter((t) => !t.community),
      community: sorted.filter((t) => t.community),
    }
  }, [templates])

  if (official.length + community.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-6">
        <h2 className="text-lg font-medium text-foreground mb-2">{t('templates.emptyTitle')}</h2>
        <p className="text-sm max-w-md text-center">
          {t('templates.emptyBody')}
        </p>
      </div>
    )
  }

  const renderGrid = (items: readonly TemplateInfo[]) => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {items.map((tpl) => (
        <TemplateCard
          key={tpl.name}
          template={tpl}
          agents={agents}
          onOpen={() =>
            openOrFocus({ kind: 'template-detail', params: { name: tpl.name } })
          }
        />
      ))}
    </div>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h2 className="text-[18px] font-semibold text-foreground">{t('templates.catalogTitle')}</h2>
          <p className="text-[12px] text-muted-foreground mt-1 max-w-2xl">
            {t('templates.catalogDescription')}
          </p>
        </div>

        {renderGrid(official)}

        {community.length > 0 && (
          <div className="mt-8">
            <div className="mb-4">
              <h3 className="text-[14px] font-semibold text-foreground">{t('templates.communityTitle')}</h3>
              <p className="text-[12px] text-muted-foreground mt-1 max-w-2xl">
                {t('templates.communityDescription')}
              </p>
            </div>
            {renderGrid(community)}
          </div>
        )}
      </div>
    </div>
  )
}
