import { useTranslation } from 'react-i18next'
import type { AssetClass } from '../../api/market'
import { NewsMarketContext } from './NewsMarketContext'

const namespaces: Record<string, AssetClass> = { EQUITY: 'equity', NASDAQ: 'equity', NYSE: 'equity', AMEX: 'equity', CRYPTO: 'crypto', CURRENCY: 'currency', COMMODITY: 'commodity' }

export function NewsRelatedAssets({ symbols }: { symbols: string[] }) {
  const { t } = useTranslation()
  const assets = new Map<string, { assetClass: AssetClass; symbol: string }>()
  const unsupported = new Set<string>()
  for (const code of symbols) {
    const [namespace, symbol, extra] = code.split(':')
    const assetClass = Object.hasOwn(namespaces, namespace) ? namespaces[namespace] : undefined
    if (!assetClass || !symbol || !/^[A-Z0-9.^_-]+$/.test(symbol) || extra !== undefined) { unsupported.add(code); continue }
    assets.set(`${assetClass}:${symbol}`, { assetClass, symbol })
  }
  return <div className="mb-4 space-y-2">
    {assets.size ? <><NewsMarketContext watchlist={[...assets.values()].slice(0, 3)} title={t('news.widgets.assets')} /><p className="text-xs text-muted-foreground">{t('news.widgets.assetContext')}</p></>
      : <><h4 className="text-xs text-muted-foreground">{t('news.widgets.assets')}</h4><p className="text-xs text-muted-foreground">{t('news.widgets.assetsEmpty')}</p></>}
    {[...unsupported].map(code => <p key={code} className="text-xs text-muted-foreground"><span>{code}</span> · <span>{t('news.widgets.assetUnsupported')}</span></p>)}
    {assets.size > 3 && <p className="text-xs text-muted-foreground">{t('news.widgets.assetsLimit')}</p>}
  </div>
}
