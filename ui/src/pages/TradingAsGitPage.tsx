import { PageHeader } from '../components/PageHeader'
import { PushApprovalPanel } from '../components/PushApprovalPanel'
import { TradingModeGate } from '../components/TradingModeGate'
import { CenteredLoading } from '../components/StateViews'
import { ensureTradingModePolling, useTradingMode } from '../live/trading-mode'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export function TradingAsGitPage() {
  const mode = useTradingMode((s) => s.status.mode)
  const modeLoading = useTradingMode((s) => s.loading)
  const { t } = useTranslation()
  useEffect(() => { ensureTradingModePolling() }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('nav.item.tradingAsGit')}
        description={t('tradingReview.description')}
      />
      <div className="flex-1 min-h-0 min-w-0 px-4 md:px-6 py-5">
        {modeLoading ? (
          <CenteredLoading />
        ) : mode === 'lite' ? (
          <TradingModeGate
            title={t('tradingReview.liteTitle')}
            description={t('tradingReview.liteDescription')}
          />
        ) : (
          <PushApprovalPanel />
        )}
      </div>
    </div>
  )
}
