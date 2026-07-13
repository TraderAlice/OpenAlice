import { useTranslation } from 'react-i18next'
import { SlidersHorizontal, Bot, ShieldCheck, CandlestickChart, ListChecks, Plug, LineChart, Newspaper } from 'lucide-react'
import { useWorkspace } from '../tabs/store'
import { getFocusedTab } from '../tabs/types'
import { SidebarRow } from './SidebarRow'

const CATEGORIES = [
  { labelKey: 'settings.category.general',     category: 'general',        Icon: SlidersHorizontal },
  { labelKey: 'settings.category.aiProvider',  category: 'ai-provider',    Icon: Bot },
  { labelKey: 'settings.category.agentPermissions', category: 'agent-permissions', Icon: ShieldCheck },
  { labelKey: 'settings.category.trading',     category: 'trading',        Icon: CandlestickChart },
  { labelKey: 'settings.category.issues',      category: 'issues',         Icon: ListChecks },
  // Connectors moved to its own ActivityBar Legacy entry — see
  // ConnectorsLegacySidebar.
  { labelKey: 'settings.category.mcpServer',   category: 'mcp',            Icon: Plug },
  { labelKey: 'settings.category.marketData',  category: 'market-data',    Icon: LineChart },
  { labelKey: 'settings.category.newsSources', category: 'news-collector', Icon: Newspaper },
] as const

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
    <div className="py-1">
      {CATEGORIES.map((item) => {
        const active =
          focused?.kind === 'settings' && focused.params.category === item.category
        return (
          <SidebarRow
            key={item.category}
            label={t(item.labelKey)}
            active={active}
            icon={<item.Icon size={14} strokeWidth={1.75} className="text-text-muted/70" aria-hidden />}
            onClick={() => openOrFocus({ kind: 'settings', params: { category: item.category } })}
          />
        )
      })}
    </div>
  )
}
