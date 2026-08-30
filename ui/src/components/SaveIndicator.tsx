import { Check, CircleAlert, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SaveStatus } from '../hooks/useAutoSave'

export function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry?: () => void }) {
  const { t } = useTranslation()
  if (status === 'idle') return null

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="inline-flex shrink-0 items-center gap-1.5 text-[11px]"
    >
      {status === 'saving' && (
        <>
          <LoaderCircle className="size-3 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
          <span className="text-muted-foreground">{t('common.saving')}</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <Check className="size-3 text-success" aria-hidden />
          <span className="text-muted-foreground">{t('common.saved')}</span>
        </>
      )}
      {status === 'error' && (
        <>
          <CircleAlert className="size-3 text-destructive" aria-hidden />
          <span className="text-destructive">{t('common.saveFailed')}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="oa-pressable ml-0.5 rounded-sm text-destructive underline underline-offset-2 hover:text-foreground"
            >
              {t('common.retry')}
            </button>
          )}
        </>
      )}
    </span>
  )
}
