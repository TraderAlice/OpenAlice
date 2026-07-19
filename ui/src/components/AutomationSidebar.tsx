import { useTranslation } from 'react-i18next'
import { Activity, Code2 } from 'lucide-react'

import { useWorkspace } from '../tabs/store'
import { getFocusedTab, type ViewSpec } from '../tabs/types'
import { SidebarRow } from './SidebarRow'

type AutomationSection = Extract<ViewSpec, { kind: 'automation' }>['params']['section']

const ITEMS = [
  { labelKey: 'automation.runs', section: 'runs', Icon: Activity },
  { labelKey: 'automation.api', section: 'api', Icon: Code2 },
] as const

type AutomationItem = (typeof ITEMS)[number]

/**
 * Automation sidebar — one row per supported automation surface. Task
 * declaration and scheduling live on Workspace issues; Runs and API expose the
 * execution side of that contract.
 */
export function AutomationSidebar() {
  const focused = useWorkspace((state) => getFocusedTab(state)?.spec)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const { t } = useTranslation()

  const activeSection: AutomationSection | null =
    focused?.kind === 'automation' ? focused.params.section : null
  const row = (item: AutomationItem) => (
    <SidebarRow
      key={item.section}
      label={t(item.labelKey)}
      active={activeSection === item.section}
      icon={<item.Icon size={14} strokeWidth={2} className="text-muted-foreground/70" aria-hidden />}
      onClick={() => openOrFocus({ kind: 'automation', params: { section: item.section } })}
    />
  )

  return (
    <div className="flex flex-col py-1">
      {ITEMS.map(row)}
    </div>
  )
}
