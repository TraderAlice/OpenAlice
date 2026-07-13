import { PageHeader } from '../components/PageHeader'
import { PushApprovalPanel } from '../components/PushApprovalPanel'
import { TradingModeGate } from '../components/TradingModeGate'
import { CenteredLoading } from '../components/StateViews'
import { ensureTradingModePolling, useTradingMode } from '../live/trading-mode'
import { useEffect } from 'react'

export function TradingAsGitPage() {
  const mode = useTradingMode((s) => s.status.mode)
  const modeLoading = useTradingMode((s) => s.loading)
  useEffect(() => { ensureTradingModePolling() }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title="Trading as Git"
        description="Review broker writes staged by agents before they are pushed to the venue."
      />
      <div className="flex-1 min-h-0 min-w-0 px-4 md:px-6 py-5">
        {modeLoading ? (
          <CenteredLoading />
        ) : mode === 'lite' ? (
          <TradingModeGate
            title="Trading as Git is unavailable in Lite mode."
            description="Lite mode keeps UTA disconnected, so Alice cannot review broker write proposals. Change the trading mode in Agent Permissions to connect UTA."
          />
        ) : (
          <PushApprovalPanel />
        )}
      </div>
    </div>
  )
}
