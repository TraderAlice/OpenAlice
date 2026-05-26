import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { SearchBox } from '../components/market/SearchBox'

export function MarketPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t('market.title')} description={t('market.description', 'Search assets and view price history.')} />
      <div className="flex-1 flex flex-col gap-6 px-4 md:px-8 py-4 min-h-0">
        <SearchBox />
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
          <div className="text-[14px] text-text-muted">{t('market.pickAssetToBegin', 'Pick an asset to begin.')}</div>
          <div className="text-[12px] text-text-muted/60 max-w-md">
            {t('market.searchHint', 'Search by ticker or name. Equities show profile, quote, candles, key metrics, and financial statements. Other asset classes show price history only for now.')}
          </div>
        </div>
      </div>
    </div>
  )
}
