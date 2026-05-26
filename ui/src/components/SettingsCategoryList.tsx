import { useTranslation } from 'react-i18next'
import { useWorkspace } from '../tabs/store'
import { getFocusedTab, type ViewSpec } from '../tabs/types'
import { SidebarRow } from './SidebarRow'

type SettingsCategory = Extract<ViewSpec, { kind: 'settings' }>['params']['category']

interface CategoryItem {
  labelKey: string
  category: SettingsCategory
  /**
   * Other view kinds that count as "active" for this row. Used by
   * Trading Accounts: when a uta-detail tab is focused, Trading
   * Accounts should still light up.
   */
  alsoActiveFor?: ViewSpec['kind'][]
}

const CATEGORIES: CategoryItem[] = [
  { labelKey: 'settings.general', category: 'general' },
  { labelKey: 'settings.aiProvider', category: 'ai-provider' },
  // Trading Accounts moved to its own ActivityBar Beta entry — see
  // TradingAccountsBetaSidebar. The `settings/trading` ViewSpec is
  // still the underlying tab.
  // Connectors moved to its own ActivityBar Legacy entry — see
  // ConnectorsLegacySidebar.
  { labelKey: 'settings.mcpServer', category: 'mcp' },
  { labelKey: 'settings.marketData', category: 'market-data' },
  { labelKey: 'settings.newsSources', category: 'news-collector' },
]

/**
 * Settings sidebar — flat list of config categories. Click opens (or
 * focuses) the corresponding tab. Active highlight is driven by the
 * currently-focused tab's spec, not by sidebar selection.
 */
export function SettingsCategoryList() {
  const { t } = useTranslation()
  const focused = useWorkspace((state) => getFocusedTab(state)?.spec)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)

  return (
    <div className="py-0.5">
      {CATEGORIES.map((item) => {
        const active =
          (focused?.kind === 'settings' && focused.params.category === item.category) ||
          (item.alsoActiveFor != null && focused != null && item.alsoActiveFor.includes(focused.kind))
        return (
          <SidebarRow
            key={item.category}
            label={t(item.labelKey)}
            active={active}
            onClick={() => openOrFocus({ kind: 'settings', params: { category: item.category } })}
          />
        )
      })}
    </div>
  )
}
