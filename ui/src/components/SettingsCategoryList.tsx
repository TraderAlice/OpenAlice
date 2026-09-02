import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  Camera,
  Cpu,
  CandlestickChart,
  ChevronRight,
  Code2,
  Compass,
  FlaskConical,
  Layers3,
  LineChart,
  ListChecks,
  Newspaper,
  Palette,
  PanelLeft,
  PanelsTopLeft,
  Plug,
  ScrollText,
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

const DEVELOPER_DISCLOSURE_SESSION_KEY = 'openalice.settings.developer-expanded'
const DEVELOPER_GROUP_ID = 'settings-developer-pages'

const DEVELOPER_ITEMS = [
  { labelKey: 'dev.frontend', tab: 'frontend', Icon: PanelsTopLeft },
  { labelKey: 'common.tools', tab: 'tools', Icon: Wrench },
  { labelKey: 'dev.onboarding', tab: 'onboarding', Icon: Compass },
  { labelKey: 'dev.snapshots', tab: 'snapshots', Icon: Camera },
  { labelKey: 'common.logs', tab: 'logs', Icon: ScrollText },
  { labelKey: 'simulator.title', tab: 'simulator', Icon: FlaskConical },
] as const

function readDeveloperDisclosure(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(DEVELOPER_DISCLOSURE_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

function writeDeveloperDisclosure(expanded: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(DEVELOPER_DISCLOSURE_SESSION_KEY, expanded ? '1' : '0')
  } catch {
    // Navigation still works when session storage is unavailable.
  }
}

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
  const developerActive = focused?.kind === 'dev'
  const [developerExpanded, setDeveloperExpanded] = useState(
    () => developerActive || readDeveloperDisclosure(),
  )
  const groups = CATEGORY_GROUPS
    .map((group) => ({
      ...group,
      items: isNanoProduct(project?.product)
        ? group.items.filter((item) => !isNanoHiddenSettingsCategory(item.category))
        : group.items,
    }))
    .filter((group) => group.items.length > 0)

  useEffect(() => {
    if (!developerActive) return
    setDeveloperExpanded(true)
    writeDeveloperDisclosure(true)
  }, [developerActive])

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
      <div className="mt-2">
        <SidebarRow
          label={t('settings.group.developer')}
          active={developerActive && !developerExpanded}
          icon={<Code2 size={14} strokeWidth={1.75} className="text-muted-foreground/70" aria-hidden />}
          trail={(
            <ChevronRight
              size={14}
              strokeWidth={1.75}
              aria-hidden
              className={`text-muted-foreground transition-transform motion-reduce:transition-none ${developerExpanded ? 'rotate-90' : ''}`}
            />
          )}
          ariaExpanded={developerExpanded}
          ariaControls={DEVELOPER_GROUP_ID}
          onClick={() => {
            setDeveloperExpanded((current) => {
              const next = !current
              writeDeveloperDisclosure(next)
              return next
            })
          }}
        />
        {developerExpanded && (
          <div
            id={DEVELOPER_GROUP_ID}
            role="group"
            aria-label={t('settings.group.developer')}
            className="ml-5 border-l border-border/70 pl-1"
          >
            {DEVELOPER_ITEMS.map((item) => {
              const active = focused?.kind === 'dev' && focused.params.tab === item.tab
              return (
                <SidebarRow
                  key={item.tab}
                  label={t(item.labelKey)}
                  active={active}
                  icon={<item.Icon size={14} strokeWidth={1.75} className="text-muted-foreground/70" aria-hidden />}
                  onClick={() => {
                    openOrFocus({ kind: 'dev', params: { tab: item.tab } })
                    onSelect?.()
                  }}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
