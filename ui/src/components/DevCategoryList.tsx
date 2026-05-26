import { useTranslation } from 'react-i18next'
import { useWorkspace } from '../tabs/store'
import { getFocusedTab, type ViewSpec } from '../tabs/types'
import { SidebarRow } from './SidebarRow'

type DevTab = Extract<ViewSpec, { kind: 'dev' }>['params']['tab']

interface CategoryItem {
  labelKey: string
  tab: DevTab
}

const CATEGORIES: CategoryItem[] = [
  { labelKey: 'dev.connectors', tab: 'connectors' },
  { labelKey: 'dev.tools', tab: 'tools' },
  { labelKey: 'dev.sessions', tab: 'sessions' },
  { labelKey: 'dev.snapshots', tab: 'snapshots' },
  { labelKey: 'dev.logs', tab: 'logs' },
  { labelKey: 'dev.simulator', tab: 'simulator' },
]

/**
 * Dev sidebar — five sub-pages, click opens (or focuses) the
 * corresponding dev tab. Active highlight is driven by the focused tab's
 * spec.
 */
export function DevCategoryList() {
  const { t } = useTranslation()
  const focused = useWorkspace((state) => getFocusedTab(state)?.spec)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)

  return (
    <div className="py-0.5">
      {CATEGORIES.map((item) => {
        const active = focused?.kind === 'dev' && focused.params.tab === item.tab
        return (
          <SidebarRow
            key={item.tab}
            label={t(item.labelKey)}
            active={active}
            onClick={() => openOrFocus({ kind: 'dev', params: { tab: item.tab } })}
          />
        )
      })}
    </div>
  )
}
