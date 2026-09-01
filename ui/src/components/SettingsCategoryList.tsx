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
import { SidebarSectionHeader } from './SidebarSectionHeader'

const CATEGORY_GROUPS = [
  {
    labelKey: 'settings.group.workspace',
    items: [
      { labelKey: 'settings.category.general', category: 'general', Icon: SlidersHorizontal },
      { labelKey: 'settings.category.appearance', category: 'appearance', Icon: Palette },
      { labelKey: 'settings.category.activityBar', category: 'activity-bar', Icon: PanelLeft },
    ],
  },
  {
    labelKey: 'settings.group.agents',
    items: [
      { labelKey: 'settings.category.aiProvider', category: 'ai-provider', Icon: Bot },
      { labelKey: 'settings.category.agentRuntimes', category: 'agent-runtimes', Icon: Cpu },
      { labelKey: 'settings.category.agentPermissions', category: 'agent-permissions', Icon: ShieldCheck },
      { labelKey: 'settings.category.tools', category: 'tools', Icon: Wrench },
    ],
  },
  {
    labelKey: 'settings.group.operations',
    items: [
      { labelKey: 'settings.category.trading', category: 'trading', Icon: CandlestickChart },
      { labelKey: 'settings.category.issues', category: 'issues', Icon: ListChecks },
      { labelKey: 'settings.category.harness', category: 'harness', Icon: Layers3 },
      { labelKey: 'settings.category.beta', category: 'beta', Icon: FlaskConical },
    ],
  },
  {
    labelKey: 'settings.group.connections',
    items: [
      { labelKey: 'settings.category.connectors', category: 'connectors', Icon: Plug },
      { labelKey: 'settings.category.mcpServer', category: 'mcp', Icon: Plug },
      { labelKey: 'settings.category.marketData', category: 'market-data', Icon: LineChart },
      { labelKey: 'settings.category.newsSources', category: 'news-collector', Icon: Newspaper },
    ],
  },
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
  const groups = CATEGORY_GROUPS
    .map((group) => ({
      ...group,
      items: isNanoProduct(project?.product)
        ? group.items.filter((item) => !isNanoHiddenSettingsCategory(item.category))
        : group.items,
    }))
    .filter((group) => group.items.length > 0)

  return (
    <div className="pb-2">
      {groups.map((group) => (
        <div key={group.labelKey}>
          <SidebarSectionHeader>{t(group.labelKey)}</SidebarSectionHeader>
          {group.items.map((item) => {
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
      ))}
    </div>
  )
}
