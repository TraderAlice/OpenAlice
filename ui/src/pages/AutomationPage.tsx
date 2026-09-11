import { useTranslation } from 'react-i18next'

import { PageHeader } from '../components/PageHeader'
import type { ViewSpec } from '../tabs/types'
import { AutomationApiSection } from './AutomationApiSection'
import { AutomationRunsSection } from './AutomationRunsSection'

interface AutomationPageProps {
  spec: Extract<ViewSpec, { kind: 'automation' }>
}

/**
 * Automation page is sub-section-driven — `spec.params.section` picks which
 * surface renders. Both entries live under Settings → Developer, without a
 * separate Automation navigator. Occupancy lives on Office.
 * Schedules live on self-described Workspace issues; the retired event-bus
 * surfaces are intentionally absent.
 */
export function AutomationPage({ spec }: AutomationPageProps) {
  const { t } = useTranslation()
  const section = spec.params.section

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t(section === 'runs' ? 'automation.runs' : 'automation.api')}
      />
      <div
        data-testid="automation-scroll-region"
        className="flex-1 flex flex-col min-h-0 overflow-y-auto px-4 md:px-6 py-5"
      >
        <div className="flex-1 min-h-0">
          {section === 'api' ? <AutomationApiSection /> : <AutomationRunsSection />}
        </div>
      </div>
    </div>
  )
}
