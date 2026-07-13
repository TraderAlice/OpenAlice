import { useTranslation } from 'react-i18next'
import { Wrench, Camera, ScrollText, FlaskConical, Compass } from 'lucide-react'
import { useWorkspace } from '../tabs/store'
import { getFocusedTab } from '../tabs/types'
import { SidebarRow } from './SidebarRow'

const CATEGORIES = [
  { labelKey: 'common.tools', tab: 'tools', Icon: Wrench },
  { label: 'Onboarding', tab: 'onboarding', Icon: Compass },
  { labelKey: 'dev.snapshots', tab: 'snapshots', Icon: Camera },
  { labelKey: 'common.logs', tab: 'logs', Icon: ScrollText },
  { labelKey: 'simulator.title', tab: 'simulator', Icon: FlaskConical },
] as const

/**
 * Dev sidebar — click opens (or focuses) the corresponding dev tab. Active
 * highlight is driven by the focused tab's spec.
 */
export function DevCategoryList() {
  const focused = useWorkspace((state) => getFocusedTab(state)?.spec)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const { t } = useTranslation()

  return (
    <div className="py-1">
      {CATEGORIES.map((item) => {
        const active = focused?.kind === 'dev' && focused.params.tab === item.tab
        return (
          <SidebarRow
            key={item.tab}
            label={'label' in item ? item.label : t(item.labelKey)}
            active={active}
            icon={<item.Icon size={14} strokeWidth={1.75} className="text-text-muted/70" aria-hidden />}
            onClick={() => openOrFocus({ kind: 'dev', params: { tab: item.tab } })}
          />
        )
      })}
    </div>
  )
}
