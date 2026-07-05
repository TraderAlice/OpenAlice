import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, ChevronDown, ChevronRight, Code2, Webhook, Workflow } from 'lucide-react'

import { useWorkspace } from '../tabs/store'
import { getFocusedTab, type ViewSpec } from '../tabs/types'
import { SidebarRow } from './SidebarRow'

type AutomationSection = Extract<ViewSpec, { kind: 'automation' }>['params']['section']

const PRIMARY = [
  { labelKey: 'automation.runs', section: 'runs', Icon: Activity },
  { labelKey: 'automation.api', section: 'api', Icon: Code2 },
] as const

// The old event-bus surfaces — demoted under a collapsed "Legacy" group so they
// stay reachable without crowding the primary automation rows.
const LEGACY = [
  { labelKey: 'automation.flow', section: 'flow', Icon: Workflow },
  { labelKey: 'automation.webhook', section: 'webhook', Icon: Webhook },
] as const

type AutomationItem = (typeof PRIMARY)[number] | (typeof LEGACY)[number]

/**
 * Automation sidebar — one row per sub-section. Primary rows (runs / api) up
 * top; the legacy event-bus rows (flow / webhook) live in a group
 * that is collapsed by default and only auto-expands when a legacy section is
 * the active tab. Clicking a row opens that section as its own tab.
 */
export function AutomationSidebar() {
  const focused = useWorkspace((state) => getFocusedTab(state)?.spec)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const { t } = useTranslation()

  const activeSection: AutomationSection | null =
    focused?.kind === 'automation' ? focused.params.section : null
  const [legacyOpen, setLegacyOpen] = useState(
    () => activeSection === 'flow' || activeSection === 'webhook',
  )

  const row = (item: AutomationItem) => (
    <SidebarRow
      key={item.section}
      label={t(item.labelKey)}
      active={activeSection === item.section}
      icon={<item.Icon size={14} strokeWidth={2} className="text-text-muted/70" aria-hidden />}
      onClick={() => openOrFocus({ kind: 'automation', params: { section: item.section } })}
    />
  )

  return (
    <div className="flex flex-col py-1">
      {PRIMARY.map(row)}

      {/* Legacy — a real collapsible section header (aria-expanded), not a
          nav row wearing a chevron; its children indent on the kinship rail. */}
      <button
        type="button"
        aria-expanded={legacyOpen}
        onClick={() => setLegacyOpen((v) => !v)}
        className="group flex items-center gap-1 w-full px-3 mt-2 mb-1 text-[10px] font-medium uppercase tracking-wider text-text-muted/60 hover:text-text-muted transition-colors select-none"
      >
        {legacyOpen ? <ChevronDown size={11} strokeWidth={2.25} aria-hidden /> : <ChevronRight size={11} strokeWidth={2.25} aria-hidden />}
        <span>{t('automation.legacy')}</span>
      </button>
      {legacyOpen && (
        <div className="ml-[18px] border-l border-border/50">
          {LEGACY.map(row)}
        </div>
      )}
    </div>
  )
}
