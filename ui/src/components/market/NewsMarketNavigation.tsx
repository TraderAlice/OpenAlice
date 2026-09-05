import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SidebarRow } from '../SidebarRow.js'
import { SidebarSectionHeader } from '../SidebarSectionHeader.js'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible.js'
import { NEWS_CATEGORIES, NEWS_CATEGORY_GROUPS, type NewsCategoryId } from './news-categories.js'

type NavigationProps = {
  active?: boolean
  category: string | null
  onSelect: (category: NewsCategoryId | null) => void
}

export function NewsMarketNavigation({ category, onSelect, active = true }: NavigationProps) {
  const { t } = useTranslation()
  const selectedCategory = NEWS_CATEGORIES.find((item) => item.id === category)?.id ?? null
  return (
    <section role="group" aria-label={t('nav.item.news')}>
      <SidebarSectionHeader>{t('nav.item.news')}</SidebarSectionHeader>
      <nav aria-label={t('news.categoriesLabel')}>
        <SidebarRow label={t('news.allNews')} active={active && !selectedCategory} onClick={() => onSelect(null)} />
        {NEWS_CATEGORY_GROUPS.map((group) => (
          <CategoryGroup key={group.labelKey} group={group} category={selectedCategory} active={active} onSelect={onSelect} />
        ))}
      </nav>
    </section>
  )
}

function CategoryGroup({ group, category, active, onSelect }: NavigationProps & {
  group: typeof NEWS_CATEGORY_GROUPS[number]
}) {
  const { t } = useTranslation()
  const selected = active ? NEWS_CATEGORIES.find((item) => item.id === category && group.categories.some((id) => id === item.id)) : undefined
  const [open, setOpen] = useState(Boolean(selected))
  useEffect(() => {
    if (selected) setOpen(true)
  }, [selected])
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger aria-label={t(group.labelKey)} className="group mx-2 flex min-h-10 w-[calc(100%-1rem)] items-center gap-2 rounded-md px-2 text-left text-[12px] text-muted-foreground transition-colors motion-reduce:transition-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-ring md:min-h-8">
        <span className="min-w-0 truncate">{t(group.labelKey)}</span>
        {!open && selected && <span className="ml-auto min-w-0 max-w-[45%] truncate text-[11px] text-sidebar-foreground" title={t(selected.labelKey)}>{t(selected.labelKey)}</span>}
        <ChevronDown className="ml-auto size-3.5 shrink-0 transition-transform duration-[180ms] group-aria-[expanded=false]:-rotate-90 motion-reduce:transition-none" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent aria-hidden={!open} inert={!open}>
        <div className="ml-4 mb-1 border-l border-border/50 pl-1">
          {group.categories.map((categoryId) => {
            const item = NEWS_CATEGORIES.find((candidate) => candidate.id === categoryId)!
            return <SidebarRow key={categoryId} label={t(item.labelKey)}
              active={active && category === categoryId} onClick={() => onSelect(categoryId)} />
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
