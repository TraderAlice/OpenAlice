import { useTranslation } from 'react-i18next'
import { useTradingConfig } from '../hooks/useTradingConfig'
import { useWorkspace } from '../tabs/store'
import { getFocusedTab } from '../tabs/types'
import { SidebarRow } from './SidebarRow'

export function PortfolioSidebar() {
  const { t } = useTranslation()
  const { utas, loading } = useTradingConfig()
  const focused = useWorkspace((state) => getFocusedTab(state)?.spec)
  const openOrFocus = useWorkspace((state) => state.openOrFocus)

  const overviewActive = focused?.kind === 'portfolio'
  const focusedUtaId =
    focused?.kind === 'uta-detail' ? focused.params.id : null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto min-h-0 py-0.5">
        <SidebarSectionHeader>{t('portfolio.overview')}</SidebarSectionHeader>
        <SidebarRow
          label={t('portfolio.allAccounts')}
          active={overviewActive}
          onClick={() => openOrFocus({ kind: 'portfolio', params: {} })}
        />

        <SidebarSectionHeader>
          {t('portfolio.accounts')}{!loading && utas.length > 0 ? ` (${utas.length})` : ''}
        </SidebarSectionHeader>

        {loading ? (
          <p className="px-3 py-1 text-[12px] text-text-muted/60">{t('common.loading')}</p>
        ) : utas.length === 0 ? (
          <p className="px-3 py-1 text-[12px] text-text-muted/60 leading-snug">
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
                    <span className="text-[9px] uppercase tracking-wide text-text-muted/60">{t('portfolio.off')}</span>
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

function SidebarSectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-3 mt-3 mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted/60 select-none">
      {children}
    </h3>
  )
}
