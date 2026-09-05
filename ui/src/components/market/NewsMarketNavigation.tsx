import { useEffect, useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SidebarRow } from '../SidebarRow.js'
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
    <nav aria-label={t('news.categoriesLabel')} className="ml-[18px] border-l border-border/50">
      <SidebarRow label={t('news.allNews')} active={active && !selectedCategory} onClick={() => onSelect(null)} />
      {NEWS_CATEGORY_GROUPS.map((group) => (
        <CategoryGroup key={group.labelKey} group={group} category={selectedCategory} onSelect={onSelect} active={active} />
      ))}
    </nav>
  )
}

function CategoryGroup({ group, category, onSelect, active }: NavigationProps & {
  group: typeof NEWS_CATEGORY_GROUPS[number]
}) {
  const { t } = useTranslation()
  const id = useId()
  const [expanded, setExpanded] = useState(() => group.categories.some((item) => item === category))
  useEffect(() => {
    if (active && group.categories.some((item) => item === category)) setExpanded(true)
  }, [active, category, group])
  return (
    <div>
      <SidebarRow label={t(group.labelKey)} ariaExpanded={expanded} ariaControls={id}
        icon={<ChevronRight className={`size-3.5 ${expanded ? 'rotate-90' : ''}`} aria-hidden />}
        onClick={() => setExpanded(!expanded)} />
      <div id={id} hidden={!expanded} className="ml-3 border-l border-border/50">
        {group.categories.map((categoryId) => {
          const item = NEWS_CATEGORIES.find((candidate) => candidate.id === categoryId)!
          const isBoard = categoryId === 'chinext' || categoryId === 'star' || categoryId === 'bse'
          return (
            <div key={categoryId} className={isBoard ? 'ml-3' : undefined}>
              <SidebarRow label={t(item.labelKey)} active={active && category === categoryId} onClick={() => onSelect(categoryId)} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
