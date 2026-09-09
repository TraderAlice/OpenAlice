import { useTranslation } from 'react-i18next'
import { useProjectWorkspaceSetup } from '../hooks/useProjectWorkspaceSetup'
import { useWorkspaces } from '../contexts/workspaces-context'
import { Button } from './ui/button'

const labels: Record<string, string> = { chat: 'Chat', 'auto-quant': 'Auto Quant', 'auto-prediction': 'Auto Prediction' }
export function ProjectWorkspaceSetupNotice({ onPrepared }: { onPrepared: () => void }) {
  const { t } = useTranslation()
  const { setup, error, busy, retry } = useProjectWorkspaceSetup()
  const { refresh } = useWorkspaces()
  if (!error && !setup?.pending.length) return null
  return (
    <section className="mx-4 mt-3 rounded-lg border bg-muted/30 p-4 text-sm" aria-live="polite">
      <p className="font-medium">{t('projectSetup.title')}</p>
      <p className="mt-1 text-muted-foreground">{t('projectSetup.description')}</p>
      {setup?.pending.map(kind => <p className="mt-2 break-words" key={kind}>
        {labels[kind] ?? kind}: {setup.errors?.[kind] ?? t('projectSetup.pending')}
      </p>)}
      {error && <p className="mt-2 break-words text-destructive">{error}</p>}
      <Button className="mt-3" variant="outline" size="sm" disabled={busy} onClick={async () => {
        await retry()
        await refresh()
        onPrepared()
      }}>{busy ? t('projectSetup.preparing') : t('common.retry')}</Button>
    </section>
  )
}
