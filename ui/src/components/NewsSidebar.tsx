import { useTranslation } from 'react-i18next'
import { useWorkspace } from '../tabs/store'
import { getFocusedTab } from '../tabs/types'
import { SidebarRow } from './SidebarRow'

export function NewsSidebar() {
  const { t } = useTranslation()
  const focusedKind = useWorkspace((state) => getFocusedTab(state)?.spec.kind ?? null)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)

  return (
    <div className="py-0.5">
      <SidebarRow
        label={t('news.allNews')}
        active={focusedKind === 'news'}
        onClick={() => openOrFocus({ kind: 'news', params: {} })}
      />
    </div>
  )
}
