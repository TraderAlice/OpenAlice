import { useTranslation } from 'react-i18next'
import type { SessionRecord } from './api'
import { Button } from '../ui/button'
import { useSessionActivation } from '../../hooks/useSessionActivation'

/** A pending operation or actionable failure, never a separate paused-session page. */
export function SessionActivation(props: {
  record: SessionRecord
  workspaceId?: string
  enabled?: boolean
  automatic?: boolean
  onResume(): Promise<void>
  onOpenWeb?(): Promise<void>
}) {
  const { t } = useTranslation()
  const { opening, error, activate } = useSessionActivation({
    record: props.record, workspaceId: props.workspaceId,
    enabled: props.enabled !== false, automatic: props.automatic !== false,
    open: () => props.record.surface === 'webpi' && props.onOpenWeb ? props.onOpenWeb() : props.onResume(),
    busyMessage: t('chat.headlessBusyDescription'),
  })
  return <div className="flex min-h-0 flex-1 items-center justify-center p-6">
    <div className="max-w-lg space-y-3 text-sm">
      <p role={error ? 'alert' : 'status'} className={error ? 'text-destructive' : 'text-muted-foreground'}>
        {error ?? (opening ? t('workspace.sessionOpening') : t('workspace.sessionDisconnected'))}
      </p>
      {!opening && <Button variant="outline" onClick={() => void activate()}>{t('common.retry')}</Button>}
    </div>
  </div>
}
