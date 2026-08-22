import { useTranslation } from 'react-i18next'
import {
  Bot,
  Cpu,
  CandlestickChart,
  FlaskConical,
  Layers3,
  LineChart,
  ListChecks,
  Newspaper,
  Palette,
  PanelLeft,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react'
import { useAliceProject } from '../hooks/useAliceProject'
import { isNanoHiddenSettingsCategory, isNanoProduct } from '../lib/product-surfaces'
import { useWorkspace } from '../tabs/store'
import { getFocusedTab } from '../tabs/types'
import { SidebarRow } from './SidebarRow'

const CATEGORIES = [
  { labelKey: 'settings.category.general',     category: 'general',        Icon: SlidersHorizontal },
  { labelKey: 'settings.category.appearance',  category: 'appearance',     Icon: Palette },
  { labelKey: 'settings.category.activityBar', category: 'activity-bar',   Icon: PanelLeft },
  { labelKey: 'settings.category.aiProvider',  category: 'ai-provider',    Icon: Bot },
  { labelKey: 'settings.category.agentRuntimes', category: 'agent-runtimes', Icon: Cpu },
  { labelKey: 'settings.category.agentPermissions', category: 'agent-permissions', Icon: ShieldCheck },
  { labelKey: 'settings.category.tools',       category: 'tools',          Icon: Wrench },
  { labelKey: 'settings.category.trading',     category: 'trading',        Icon: CandlestickChart },
  { labelKey: 'settings.category.issues',      category: 'issues',         Icon: ListChecks },
  { labelKey: 'settings.category.harness',     category: 'harness',        Icon: Layers3 },
  { labelKey: 'settings.category.connectors',  category: 'connectors',     Icon: Plug },
  { labelKey: 'settings.category.mcpServer',   category: 'mcp',            Icon: Plug },
  { labelKey: 'settings.category.marketData',  category: 'market-data',    Icon: LineChart },
  { labelKey: 'settings.category.newsSources', category: 'news-collector', Icon: Newspaper },
  { labelKey: 'settings.category.beta',        category: 'beta',           Icon: FlaskConical },
] as const

/**
 * Settings sidebar — flat list of config categories. Click opens (or
 * focuses) the corresponding tab. Active highlight is driven by the
 * currently-focused tab's spec, not by sidebar selection.
 */
export function SettingsCategoryList({ onSelect }: { onSelect?: () => void }) {
  const { t } = useTranslation()
  const { project } = useAliceProject()
  const focused = useWorkspace((state) => getFocusedTab(state)?.spec)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const categories = isNanoProduct(project?.product)
    ? CATEGORIES.filter((item) => !isNanoHiddenSettingsCategory(item.category))
    : CATEGORIES

  return (
    <div className="py-1">
      {categories.map((item) => {
        const active =
          focused?.kind === 'settings' && focused.params.category === item.category
        return (
          <SidebarRow
            key={item.category}
            label={t(item.labelKey)}
            active={active}
            icon={<item.Icon size={14} strokeWidth={1.75} className="text-muted-foreground/70" aria-hidden />}
            onClick={() => {
              openOrFocus({ kind: 'settings', params: { category: item.category } })
              onSelect?.()
            }}
          />
        )
      })}
    </div>
  )
}
