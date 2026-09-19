import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'

export function ModelCatalogStatus({ catalog }: {
  catalog?: { enabled: boolean; loading: boolean; error: string | null; models: readonly unknown[] | null; refresh(): void }
}) {
  const { t } = useTranslation()
  if (!catalog?.enabled) return null
  return (
    <div className="flex items-start gap-2 px-2 py-1.5 text-xs text-muted-foreground">
      <p role="status" className="min-w-0 flex-1 break-words">
        {catalog.loading ? t('modelCatalog.loading') : catalog.error ? t('modelCatalog.failed')
          : catalog.models?.length === 0 ? t('modelCatalog.empty') : t('modelCatalog.loaded', { count: catalog.models?.length ?? 0 })}
      </p>
      <Button type="button" variant="ghost" size="xs" disabled={catalog.loading} onClick={catalog.refresh}>
        {catalog.error ? t('common.retry') : t('modelCatalog.refresh')}
      </Button>
    </div>
  )
}
