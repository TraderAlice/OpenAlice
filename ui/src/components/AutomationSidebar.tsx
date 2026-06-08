import { useTranslation } from 'react-i18next'
import { useWorkspace } from '../tabs/store'
import { getFocusedTab, type ViewSpec } from '../tabs/types'
import { SidebarRow } from './SidebarRow'

type AutomationSection = Extract<ViewSpec, { kind: 'automation' }>['params']['section']

interface SidebarItem {
  labelKey: string
  section: AutomationSection
}

const ITEMS = [
  { labelKey: 'automation.runs', section: 'runs' },
  { labelKey: 'automation.flow', section: 'flow' },
  { labelKey: 'automation.heartbeat', section: 'heartbeat' },
  { labelKey: 'automation.cronJobs', section: 'cron' },
  { labelKey: 'automation.webhook', section: 'webhook' },
] as const

/**
 * Automation sidebar — one row per sub-section. Replaces the old in-page
 * horizontal tab bar; clicking a row opens that section as its own tab.
 *
 * Active highlight tracks the focused tab's `section` param, so jumping
 * between automation tabs in the editor visibly updates the sidebar
 * without any extra wiring.
 */
export function AutomationSidebar() {
  const focused = useWorkspace((state) => getFocusedTab(state)?.spec)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const { t } = useTranslation()

  return (
    <div className="py-0.5">
      {ITEMS.map((item) => {
        const active =
          focused?.kind === 'automation' && focused.params.section === item.section
        return (
          <SidebarRow
            key={item.section}
            label={t(item.labelKey)}
            active={active}
            onClick={() =>
              openOrFocus({ kind: 'automation', params: { section: item.section } })
            }
          />
        )
      })}
    </div>
  )
}
