import { StatusIndicator } from './motion/StatusIndicator'
import { useTranslation } from 'react-i18next'
import type { SaveStatus } from '../hooks/useAutoSave'
import { Button } from './ui/button'

export function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry?: () => void }) {
  const { t } = useTranslation()
  const labels = [t('common.saving'), t('common.saved'), t('common.saveFailed')]

  return (
    <span className="inline-grid min-w-24 shrink-0 text-sm">
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap">
        <span className="size-4 shrink-0" />
        <span className="grid">
          {labels.map((label, index) => <span key={index} data-label={label} className="col-start-1 row-start-1 before:content-[attr(data-label)]" />)}
        </span>
        {onRetry && <span data-label={t('common.retry')} className="ml-0.5 inline-flex h-8 items-center border border-transparent font-medium leading-5 before:content-[attr(data-label)] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11" />}
      </span>
      <span
        role={status === 'idle' ? undefined : 'status'}
        aria-live="polite"
        aria-atomic="true"
        className="col-start-1 row-start-1 inline-flex min-h-8 items-center justify-end gap-1.5 whitespace-nowrap"
      >
        {status !== 'idle' && <>
          <StatusIndicator state={status === 'saving' ? 'loading' : status === 'saved' ? 'done' : 'error'} size={16} />
          <span className={status === 'error' ? 'text-destructive' : 'text-muted-foreground'}>
            {t(status === 'saving' ? 'common.saving' : status === 'saved' ? 'common.saved' : 'common.saveFailed')}
          </span>
          {status === 'error' && onRetry && (
            <Button type="button" onClick={onRetry} variant="link" size="sm" className="ml-0.5 px-0 py-0 text-destructive">
              {t('common.retry')}
            </Button>
          )}
        </>}
      </span>
    </span>
  )
}
