import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'

export function ModelCatalogStatus({ catalog, selectedModel }: {
  selectedModel?: string | null
  catalog?: { enabled: boolean; discoverySupported?: boolean; loading: boolean; error: string | null; source?: 'bundled' | 'snapshot'; models: readonly { id: string }[] | null; refresh(): void }
}) {
  const { t } = useTranslation()
  if (!catalog?.enabled) return null
  const missing = catalog.source === 'snapshot' && selectedModel && !catalog.models?.some((model) => model.id === selectedModel)
  return (
    <div className="flex items-start gap-2 px-2 py-1.5 text-xs text-muted-foreground">
      <div className="min-w-0 flex-1 break-words">
        <p role="status">
          {catalog.loading ? t('modelCatalog.loading') : catalog.error ? t('modelCatalog.failed')
            : catalog.source === 'bundled' ? t('modelCatalog.bundled') : catalog.models?.length === 0 ? t('modelCatalog.empty') : t('modelCatalog.loaded', { count: catalog.models?.length ?? 0 })}
        </p>
        {missing && <p role="status" className="mt-1 text-warning">{t('modelCatalog.missing', { model: selectedModel })}</p>}
      </div>
      {catalog.discoverySupported !== false && <Button type="button" variant="ghost" size="xs" disabled={catalog.loading} onClick={catalog.refresh}>
        {catalog.error ? t('common.retry') : t('modelCatalog.refresh')}
      </Button>}
    </div>
  )
}
