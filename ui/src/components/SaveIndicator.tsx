import { StatusIndicator } from './motion/StatusIndicator'
import { useTranslation } from 'react-i18next'
import type { SaveStatus } from '../hooks/useAutoSave'
import { Button } from './ui/button'

export function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry?: () => void }) {
  const { t } = useTranslation()

  return (
    <span
      role={status === 'idle' ? undefined : 'status'}
      aria-live="polite"
      aria-atomic="true"
      className="inline-flex min-h-5 min-w-24 shrink-0 items-center justify-end gap-1.5 text-sm"
    >
      {status !== 'idle' && <>
        <StatusIndicator state={status === 'saving' ? 'loading' : status === 'saved' ? 'done' : 'error'} size={16} />
        <span className={status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
          {t(status === 'saving' ? 'common.saving' : status === 'saved' ? 'common.saved' : 'common.saveFailed')}
        </span>
        {status === 'error' && onRetry && (
          <Button type="button" onClick={onRetry} variant="link" size="xs" className="ml-0.5 h-auto px-0 py-0 text-destructive">
            {t('common.retry')}
          </Button>
        )}
      </>}
    </span>
  )
}
