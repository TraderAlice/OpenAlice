import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { Credential, Profile, Preset, SdkAdapterId } from '../../api/types'

export type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; error?: string }

export interface CredentialCardProfile {
  slug: string
  profile: Profile
  isActive: boolean
  testState: TestState
}

export interface CredentialCardProps {
  slug: string
  credential: Credential
  profiles: CredentialCardProfile[]
  presets: Preset[]
  /** Adapter ids this credential's preset can drive, with star on test default. */
  availableAdapters: Array<{ id: SdkAdapterId; isTestDefault: boolean }>
  /** Whether this card is the active selection on the credentials side. */
  selected: boolean
  /** Whether an SDK is selected on the other side and this credential
   *  is NOT in its compatible set. Renders with reduced opacity. */
  dimmed: boolean
  onSelect: () => void
  onSetActive: (profileSlug: string) => void
  onTest: (profileSlug: string, profile: Profile) => void
  onEditProfile: (profileSlug: string) => void
  onModelChange: (profileSlug: string, model: string) => Promise<void>
}

function getVendorLabel(t: TFunction, vendor: string): string {
  const map: Record<string, string> = {
    anthropic: t('credentials.vendorAnthropic', 'Anthropic'),
    openai: t('credentials.vendorOpenai', 'OpenAI'),
    google: t('credentials.vendorGoogle', 'Google'),
    minimax: t('credentials.vendorMinimax', 'MiniMax'),
    glm: t('credentials.vendorGlm', 'GLM (Zhipu)'),
    kimi: t('credentials.vendorKimi', 'Kimi (Moonshot)'),
    deepseek: t('credentials.vendorDeepseek', 'DeepSeek'),
    custom: t('credentials.vendorCustom', 'Custom'),
  }
  return map[vendor] ?? vendor
}

function getAuthLabel(t: TFunction, authType: string): string {
  const map: Record<string, string> = {
    'api-key': t('credentials.authApiKey', 'API key'),
    'subscription': t('credentials.authSubscription', 'subscription'),
  }
  return map[authType] ?? authType
}

function getModelOptions(profile: Profile, presets: Preset[]): Array<{ id: string; label: string }> {
  const preset = presets.find(p => p.id === profile.preset)
  if (!preset) return []
  const props = preset.schema?.properties as Record<string, { oneOf?: Array<{ const: string; title: string }> }> | undefined
  const oneOf = props?.model?.oneOf
  if (!oneOf) return []
  return oneOf.map(o => ({ id: o.const, label: o.title }))
}

export function CredentialCard({
  slug,
  credential,
  profiles,
  presets,
  availableAdapters,
  selected,
  dimmed,
  onSelect,
  onSetActive,
  onTest,
  onEditProfile,
  onModelChange,
}: CredentialCardProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(profiles.length > 0)

  const vendorLabel = getVendorLabel(t, credential.vendor)
  const authLabel = getAuthLabel(t, credential.authType)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect() }}
      className={`rounded-xl border bg-bg transition-all overflow-hidden ${
        selected ? 'border-accent ring-2 ring-accent/30' : 'border-border'
      } ${dimmed ? 'opacity-30' : ''}`}
    >
      <div className="p-4 cursor-pointer">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-text">
            {vendorLabel} <span className="text-text-muted font-normal">({authLabel})</span>
          </h3>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
            className="text-text-muted hover:text-text transition-colors text-[11px] shrink-0"
            aria-expanded={expanded}
          >
            {expanded ? '▾' : '▸'} {t('credentials.profileCount', '{{count}} profile(s)', { count: profiles.length })}
          </button>
        </div>

        {availableAdapters.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {availableAdapters.map(a => (
              <span
                key={a.id}
                className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted border border-border/50"
                title={a.isTestDefault ? t('credentials.testDefault', 'Test default') : ''}
              >
                {a.id}{a.isTestDefault && <span className="text-yellow ml-0.5">★</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      {expanded && profiles.length > 0 && (
        <div className="border-t border-border/50 bg-bg-tertiary/30 px-4 py-2 space-y-2">
          <div className="text-[10px] uppercase tracking-wide text-text-muted">{t('credentials.profiles', 'Profiles')}</div>
          {profiles.map(({ slug: pSlug, profile, isActive, testState }) => {
            const modelOptions = getModelOptions(profile, presets)
            const canSwitchModel = modelOptions.length > 1 && modelOptions.some(o => o.id === profile.model)
            const ts = testState
            const testLabel = ts.status === 'testing' ? t('credentials.testing', 'Testing…') : ts.status === 'ok' ? t('credentials.ok', 'OK') : ts.status === 'fail' ? t('credentials.failed', 'Failed') : t('credentials.test', 'Test')
            const testColor =
              ts.status === 'ok' ? 'text-green border-green/40'
              : ts.status === 'fail' ? 'text-red border-red/40'
              : 'text-text-muted border-border hover:text-text hover:bg-bg-tertiary'
            return (
              <div key={pSlug} className="flex items-center gap-2 py-1" onClick={(e) => e.stopPropagation()}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-text truncate">{pSlug}</span>
                    {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-medium shrink-0">{t('credentials.active', 'Active')}</span>}
                  </div>
                  {canSwitchModel ? (
                    <select
                      value={profile.model}
                      onChange={(e) => { void onModelChange(pSlug, e.target.value) }}
                      className="appearance-none text-[11px] text-text-muted bg-transparent border-0 cursor-pointer hover:text-accent focus:text-accent focus:outline-none -ml-1 pl-1 pr-1 py-0.5 rounded hover:bg-bg-tertiary transition-colors"
                    >
                      {modelOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  ) : (
                    <p className="text-[11px] text-text-muted truncate">{profile.model || 'Auto'}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => onTest(pSlug, profile)}
                    disabled={ts.status === 'testing'}
                    title={ts.status === 'fail' ? ts.error : t('credentials.testDefaultHint', 'Send "Hi" to verify connectivity')}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${testColor}`}
                  >
                    {testLabel}
                  </button>
                  {!isActive && (
                    <button
                      onClick={() => onSetActive(pSlug)}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted hover:text-accent hover:border-accent transition-colors"
                    >
                      {t('credentials.activate', 'Activate')}
                    </button>
                  )}
                  <button
                    onClick={() => onEditProfile(pSlug)}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-muted hover:text-text hover:bg-bg-tertiary transition-colors"
                  >
                    {t('credentials.edit', 'Edit')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="text-[10px] text-text-muted/50 px-4 pb-2">
        slug: <code>{slug}</code>
      </div>
    </div>
  )
}
