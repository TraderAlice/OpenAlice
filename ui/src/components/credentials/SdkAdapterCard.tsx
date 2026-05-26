import { useTranslation } from 'react-i18next'
import type { SdkAdapterInfo } from '../../api/types'

export interface SdkAdapterCardProps {
  adapter: SdkAdapterInfo
  /**
   * Map of presetId → credential slug for presets the user has at least
   * one credential configured for. Used to render solid (configured) vs
   * hollow (not yet configured) dots.
   */
  configuredPresetMap: Record<string, string>
  /** Whether this card is the active selection on the SDKs side. */
  selected: boolean
  /** Whether a credential is selected on the other side and this adapter
   *  is NOT in its compatible set. Renders with reduced opacity. */
  dimmed: boolean
  onSelect: () => void
  onConfigurePreset: (presetId: string) => void
}

export function SdkAdapterCard({
  adapter,
  configuredPresetMap,
  selected,
  dimmed,
  onSelect,
  onConfigurePreset,
}: SdkAdapterCardProps) {
  const { t } = useTranslation()
  const isTestDefault = adapter.presets.some(p => p.isTestDefault)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect() }}
      className={`p-4 rounded-xl border bg-bg cursor-pointer transition-all ${
        selected ? 'border-accent ring-2 ring-accent/30' : 'border-border'
      } ${dimmed ? 'opacity-30' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="text-[13px] font-semibold text-text">{adapter.label}</h3>
        {isTestDefault && (
          <span
            className="text-[10px] text-yellow shrink-0"
            title={t('credentials.testDefaultHint', 'Default for the Test button on at least one preset')}
          >★ {t('credentials.testDefault', 'test default')}</span>
        )}
      </div>
      <p className="text-[11px] text-text-muted mb-3 leading-snug">{adapter.description}</p>

      {adapter.presets.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-text-muted">{t('credentials.compatibleCredentials', 'Compatible credentials')}</div>
          {adapter.presets.map((preset) => {
            const isConfigured = preset.presetId in configuredPresetMap
            return (
              <div key={preset.presetId} className="flex items-center gap-2 text-[11px]">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isConfigured ? 'bg-accent' : 'bg-transparent border border-text-muted/40'
                  }`}
                  aria-hidden
                />
                <span className={`flex-1 truncate ${isConfigured ? 'text-text' : 'text-text-muted'}`}>
                  {preset.presetLabel}
                  {preset.isTestDefault && <span className="text-yellow ml-1" title={t('credentials.testDefault', 'Test default')}>★</span>}
                </span>
                {!isConfigured && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onConfigurePreset(preset.presetId) }}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted hover:text-accent hover:border-accent transition-colors"
                  >
                    {t('credentials.configure', 'Configure →')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
