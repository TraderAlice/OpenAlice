import { PageHeader } from '../components/PageHeader'
import type { ViewSpec } from '../tabs/types'
import { AutomationApiSection } from './AutomationApiSection'
import { AutomationFlowSection } from './AutomationFlowSection'
import { AutomationRunsSection } from './AutomationRunsSection'
import { AutomationWebhookSection } from './AutomationWebhookSection'

type AutomationSection = Extract<ViewSpec, { kind: 'automation' }>['params']['section']

const SECTION_TITLE: Record<AutomationSection, string> = {
  runs: 'Runs',
  api: 'API',
  flow: 'Flow',
  webhook: 'Webhook',
}

const SECTION_DESCRIPTION: Record<AutomationSection, string> = {
  runs: 'Headless agent runs across workspaces — what the workers are doing.',
  api: 'Trigger workspace automation from outside, and the schedule-file format.',
  flow: 'Producer-listener graph for the event bus.',
  webhook: 'External HTTP triggers routed into the engine.',
}

interface AutomationPageProps {
  spec: Extract<ViewSpec, { kind: 'automation' }>
}

/**
 * Automation page is sub-section-driven — `spec.params.section` picks which
 * surface renders. The Automation sidebar holds one row per section so each
 * section is its own tab in the editor area. Flow + Webhook are the old
 * event-bus surfaces, demoted under the sidebar's collapsed "Legacy" group.
 * (Schedules were absorbed into the Issue board — scheduled issues live there.)
 */
export function AutomationPage({ spec }: AutomationPageProps) {
  const section = spec.params.section

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={SECTION_TITLE[section]} description={SECTION_DESCRIPTION[section]} />
      <div className="flex-1 flex flex-col min-h-0 px-4 md:px-6 py-5">
        <div className="flex-1 min-h-0">
          {section === 'api' ? (
            <AutomationApiSection />
          ) : section === 'flow' ? (
            <AutomationFlowSection />
          ) : section === 'webhook' ? (
            <AutomationWebhookSection />
          ) : (
            <AutomationRunsSection />
          )}
        </div>
      </div>
    </div>
  )
}
