import { Gauge, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'
import { useWorkspace } from '../tabs/store'

interface TradingModeGateProps {
  title: string
  description: string
}

export function TradingModeGate({ title, description }: TradingModeGateProps) {
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const { t } = useTranslation()

  return (
    <div className="flex min-h-[420px] items-center justify-center px-0 py-8 sm:px-4 sm:py-10">
      <div className="w-full max-w-[560px] rounded-lg border border-border bg-secondary px-4 py-5 sm:px-5">
        <div className="flex flex-col items-start gap-3 sm:flex-row">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Gauge size={18} strokeWidth={1.8} aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-medium leading-4 text-muted-foreground">
              {t('tradingModeGate.liteMode')}
            </div>
            <h2 className="mt-1 text-[17px] font-semibold text-foreground">{title}</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => openOrFocus({ kind: 'settings', params: { category: 'agent-permissions' } })}
          className="mt-4"
        >
          <Settings size={14} strokeWidth={1.8} aria-hidden />
          {t('tradingModeGate.openPermissions')}
        </Button>
      </div>
    </div>
  )
}
