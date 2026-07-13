import { Gauge, Settings } from 'lucide-react'
import { useWorkspace } from '../tabs/store'

interface TradingModeGateProps {
  title: string
  description: string
}

export function TradingModeGate({ title, description }: TradingModeGateProps) {
  const openOrFocus = useWorkspace((s) => s.openOrFocus)

  return (
    <div className="flex min-h-[420px] items-center justify-center px-0 py-8 sm:px-4 sm:py-10">
      <div className="w-full max-w-[560px] rounded-lg border border-border bg-bg-secondary px-4 py-5 sm:px-5">
        <div className="flex flex-col items-start gap-3 sm:flex-row">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-bg-tertiary text-text-muted">
            <Gauge size={18} strokeWidth={1.8} aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Lite mode</div>
            <h2 className="mt-1 text-[17px] font-semibold text-text">{title}</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-text-muted">{description}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => openOrFocus({ kind: 'settings', params: { category: 'agent-permissions' } })}
          className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-bg px-3 py-2 text-[12px] font-medium text-text transition-colors hover:border-accent/50 hover:bg-bg-tertiary"
        >
          <Settings size={14} strokeWidth={1.8} aria-hidden />
          Open Agent Permissions
        </button>
      </div>
    </div>
  )
}
