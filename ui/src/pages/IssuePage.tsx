import { Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PageHeader } from '../components/PageHeader'
import { IssuesBoard } from '../components/IssuesBoard'
import { Button } from '../components/ui/button'
import { useWorkspace } from '../tabs/store'

/**
 * Issues — the global, Linear-style board aggregating every workspace's issues
 * (`.alice/issues/<id>.md`). Read-only in Phase 1: scheduled issues (those with
 * a `when`) still fire headless runs via the scanner; unscheduled ones are
 * tracked work items. Creation/edit is a coding task inside the workspace, not
 * a route here.
 */
export function IssuePage() {
  const { t } = useTranslation()
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('nav.item.issue')}
        right={
          <Button
            type="button"
            onClick={() => openOrFocus({ kind: 'settings', params: { category: 'issues' } })}
            title={t('issues.settings')}
            aria-label={t('issues.settings')}
            variant="outline"
            size="icon"
          >
            <Settings size={15} aria-hidden />
          </Button>
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4 sm:px-4 md:px-6 md:py-5">
        <IssuesBoard />
      </div>
    </div>
  )
}
