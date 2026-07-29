import { useTranslation } from 'react-i18next'

import { PageHeader } from '../components/PageHeader'
import type { ViewSpec } from '../tabs/types'
import { AutomationApiSection } from './AutomationApiSection'
import { AutomationRunsSection } from './AutomationRunsSection'

type AutomationSection = Extract<ViewSpec, { kind: 'automation' }>['params']['section']

const SECTION_DESCRIPTION_KEY: Record<
  AutomationSection,
  'automation.runsDescription' | 'automation.apiDescription'
> = {
  runs: 'automation.runsDescription',
  api: 'automation.apiDescription',
}

interface AutomationPageProps {
  spec: Extract<ViewSpec, { kind: 'automation' }>
}

/**
 * Automation page is sub-section-driven — `spec.params.section` picks which
 * surface renders. The Automation sidebar holds one row per section so each
 * section is its own tab in the editor area. Schedules live on self-described
 * Workspace issues; the retired event-bus surfaces are intentionally absent.
 */
export function AutomationPage({ spec }: AutomationPageProps) {
  const { t } = useTranslation()
  const section = spec.params.section

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t(section === 'runs' ? 'automation.runs' : 'automation.api')}
        description={t(SECTION_DESCRIPTION_KEY[section])}
      />
      <div
        data-testid="automation-scroll-region"
        className="flex-1 flex flex-col min-h-0 overflow-y-auto px-4 md:px-6 py-5"
      >
        <div className="flex-1 min-h-0">
          {section === 'api' ? (
            <AutomationApiSection />
          ) : (
            <AutomationRunsSection />
          )}
        </div>
      </div>
    </div>
  )
}
