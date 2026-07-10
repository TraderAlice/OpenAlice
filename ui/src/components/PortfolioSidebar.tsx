import { useTranslation } from 'react-i18next'
import { useTradingConfig } from '../hooks/useTradingConfig'
import { useWorkspace } from '../tabs/store'
import { getFocusedTab } from '../tabs/types'
import { SidebarRow } from './SidebarRow'
import { SidebarSectionHeader } from './SidebarSectionHeader'
import { SidebarRowsSkeleton } from './StateViews'
import { ensureTradingModePolling, useTradingMode } from '../live/trading-mode'
import { useEffect } from 'react'

/**
 * Portfolio sidebar — Overview + per-UTA accounts.
 *
 * - "All Accounts" opens the aggregate portfolio tab (`kind: 'portfolio'`).
 * - Each UTA row opens that account's detail tab (`kind: 'uta-detail'`).
 *
 * Active highlight is derived from the focused tab's spec, not from the
 * sidebar selection itself — focus and sidebar are independent.
 */
export function PortfolioSidebar() {
  const { t } = useTranslation()
  const { utas, loading } = useTradingConfig()
  const tradingMode = useTradingMode((s) => s.status.mode)
  const tradingModeLoading = useTradingMode((s) => s.loading)
  const focused = useWorkspace((state) => getFocusedTab(state)?.spec)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)

  useEffect(() => { ensureTradingModePolling() }, [])

  const overviewActive = focused?.kind === 'portfolio'
  const focusedUtaId =
    focused?.kind === 'uta-detail' ? focused.params.id : null
  const lite = !tradingModeLoading && tradingMode === 'lite'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto min-h-0 py-1">
        <SidebarSectionHeader>{t('portfolio.overview')}</SidebarSectionHeader>
        <SidebarRow
          label={t('portfolio.allAccounts')}
          active={overviewActive}
          onClick={() => openOrFocus({ kind: 'portfolio', params: {} })}
        />

        <SidebarSectionHeader>
          {t('portfolio.accounts')}{!lite && !loading && utas.length > 0 ? ` (${utas.length})` : ''}
        </SidebarSectionHeader>

        {lite ? (
          <p className="px-3 py-2 text-[12px] leading-relaxed text-text-muted">
            Account drill-down is unavailable in Lite mode.
          </p>
        ) : loading ? (
          <SidebarRowsSkeleton rows={3} />
        ) : utas.length === 0 ? (
          <p className="px-3 py-2 text-[12px] leading-relaxed text-text-muted">
            {t('portfolio.noAccountsYet')}
          </p>
        ) : (
          utas.map((uta) => {
            const active = focusedUtaId === uta.id
            const display = uta.label?.trim() || uta.id
            return (
              <SidebarRow
                key={uta.id}
                label={display}
                active={active}
                dim={!uta.enabled}
                onClick={() =>
                  openOrFocus({ kind: 'uta-detail', params: { id: uta.id } })
                }
                trail={
                  !uta.enabled ? (
                    <span className="text-[10px] uppercase tracking-wide text-text-muted">{t('common.off')}</span>
                  ) : undefined
                }
              />
            )
          })
        )}
      </div>
    </div>
  )
}
