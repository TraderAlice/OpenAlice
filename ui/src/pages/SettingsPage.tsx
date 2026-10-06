import { Select } from '@/components/ui/select'
import { Fragment, useState, useEffect, useCallback, useId, useMemo } from 'react'
import { ChevronDown, ChevronRight, Moon, RotateCcw, Search, Sun } from 'lucide-react'
import { api } from '../api'
import type { ToolInfo } from '../api/tools'
import { SegmentedControl } from '../components/SegmentedControl'
import { CountBadge } from '../components/CountBadge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible'
import { ContextHelp } from '../components/ContextHelp'
import { Toggle } from '../components/Toggle'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, SettingsScrollArea, inputClass } from '../components/form'
import { useAutoSave } from '../hooks/useAutoSave'
import { PageHeader } from '../components/PageHeader'
import { PageLoading, EmptyState } from '../components/StateViews'
import { useTranslation } from 'react-i18next'
import { useLocale, useSetLocale, LOCALE_LABELS } from '../i18n/useLocale'
import { preferencesApi, type WorkspaceShellStatus } from '../api/preferences'
import {
  DEFAULT_DAY_PALETTE,
  DEFAULT_NIGHT_PALETTE,
  THEME_PALETTES,
  type ThemePaletteDefinition,
  type ThemePaletteId,
  type ThemePreferenceSlot,
} from '../theme/palettes'
import { useThemeStore, type AppTheme } from '../theme/store'
import {
  UI_STYLE_PROFILES,
  type UiStyleProfileDefinition,
  type UiStyleProfileId,
} from '../theme/styleProfiles'
import { useEffectivePreferenceSlot } from '../theme/useEffectiveTheme'
import { VersionOverviewSection } from '../components/settings/VersionOverviewSection'
import { UpdateLifecycleSection } from '../components/settings/UpdateLifecycleSection'
import { AliceLocationSection } from '../components/settings/AliceLocationSection'
import { SelectionCheckIcon } from '../components/ui/selection-check-icon'
import { Button } from '../components/ui/button'
import { getBackendConnection } from '../auth/backendConnection'
import { useRelayConnection } from '../hooks/useRelayConnection'

// ==================== Appearance ====================

type PaletteLibraryFilter = 'recommended' | 'all'

function paletteDefinition(id: ThemePaletteId): ThemePaletteDefinition {
  return THEME_PALETTES.find((palette) => palette.id === id)!
}

export function AppearanceSection({ standalone = false }: { standalone?: boolean } = {}) {
  const { t } = useTranslation()
  const theme = useThemeStore((s) => s.theme)
  const dayPalette = useThemeStore((s) => s.dayPalette)
  const nightPalette = useThemeStore((s) => s.nightPalette)
  const uiStyle = useThemeStore((s) => s.uiStyle)
  const stylePaletteMode = useThemeStore((s) => s.stylePaletteMode)
  const setTheme = useThemeStore((s) => s.setTheme)
  const setDayPalette = useThemeStore((s) => s.setDayPalette)
  const setNightPalette = useThemeStore((s) => s.setNightPalette)
  const setUiStyle = useThemeStore((s) => s.setUiStyle)
  const setStylePaletteMode = useThemeStore((s) => s.setStylePaletteMode)
  const effectiveSlot = useEffectivePreferenceSlot()
  const [editingSlot, setEditingSlot] = useState<ThemePreferenceSlot>(effectiveSlot)
  const [choosingStyle, setChoosingStyle] = useState(false)
  const [paletteFilter, setPaletteFilter] = useState<PaletteLibraryFilter>('recommended')
  const [customizingPalettes, setCustomizingPalettes] = useState(false)
  const paletteEditorId = useId()
  const styleGroupName = useId()
  const modes: readonly AppTheme[] = ['auto', 'day', 'night']
  const activeStyleDefinition: UiStyleProfileDefinition = UI_STYLE_PROFILES.find(
    (profile) => profile.id === uiStyle,
  )!
  const recommendedPalettePair = activeStyleDefinition.recommendedPalettePair
  const recommendedPaletteApplied = recommendedPalettePair != null && stylePaletteMode === 'recommended'
  const effectivePalettePair = recommendedPaletteApplied ? recommendedPalettePair : undefined
  const activePalette = effectiveSlot === 'day'
    ? effectivePalettePair?.day ?? dayPalette
    : effectivePalettePair?.night ?? nightPalette
  const activePaletteDefinition = paletteDefinition(activePalette)
  const editingPalette = editingSlot === 'day' ? dayPalette : nightPalette
  const recommendedAppearance = editingSlot === 'day' ? 'light' : 'dark'
  const visiblePalettes = paletteFilter === 'recommended'
    ? THEME_PALETTES.filter((palette) => palette.appearance === recommendedAppearance)
    : THEME_PALETTES
  const isDefaultPair = dayPalette === DEFAULT_DAY_PALETTE && nightPalette === DEFAULT_NIGHT_PALETTE

  useEffect(() => {
    setEditingSlot(effectiveSlot)
  }, [effectiveSlot, theme])

  const chooseSlot = (slot: ThemePreferenceSlot) => {
    setEditingSlot(slot)
    setPaletteFilter('recommended')
  }

  const editSlot = (slot: ThemePreferenceSlot) => {
    chooseSlot(slot)
    setCustomizingPalettes(true)
  }

  const choosePalette = (palette: ThemePaletteId) => {
    if (recommendedPaletteApplied) setStylePaletteMode('saved')
    if (editingSlot === 'day') setDayPalette(palette)
    else setNightPalette(palette)
  }

  const resetPair = () => {
    if (recommendedPaletteApplied) setStylePaletteMode('saved')
    setDayPalette(DEFAULT_DAY_PALETTE)
    setNightPalette(DEFAULT_NIGHT_PALETTE)
    setPaletteFilter('recommended')
  }

  const applyRecommendedPalette = () => {
    if (!recommendedPalettePair) return
    setStylePaletteMode(recommendedPaletteApplied ? 'saved' : 'recommended')
  }

  const content = (
    <>
      <div className="border-b border-border/60 py-5">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-foreground">{t('settings.appearance.colorMode')}</span>
          <ContextHelp label={t('settings.appearance.colorMode')}>{t('settings.appearance.colorModeDescription')}</ContextHelp>
        </div>
        <SegmentedControl
          value={theme}
          options={modes.map((mode) => ({ value: mode, label: t(`theme.mode.${mode}`) }))}
          onChange={(mode) => {
            setTheme(mode)
            if (mode !== 'auto') chooseSlot(mode)
          }}
          ariaLabel={t('settings.appearance.colorMode')}
          className="mt-3"
        />
        <div
          data-palette-preview={activePalette}
          className="sr-only"
          aria-live="polite"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
          <span className="truncate">
            {t('settings.appearance.currentPalette', {
              slot: t(`theme.mode.${effectiveSlot}`),
              palette: t(activePaletteDefinition.labelKey),
            })}
          </span>
          {theme === 'auto' && (
            <span className="oa-palette-preview-muted ml-1 shrink-0">
              {t('settings.appearance.followsSystem')}
            </span>
          )}
        </div>
      </div>

      <Collapsible open={customizingPalettes} onOpenChange={setCustomizingPalettes} className="border-b border-border/60 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-foreground">{t('settings.appearance.themePair')}</span>
            <ContextHelp label={t('settings.appearance.themePair')}>{t('settings.appearance.themePairDescription')}</ContextHelp>
          </div>
          <CollapsibleTrigger aria-controls={paletteEditorId} render={<Button variant="outline" size="sm" className="min-h-10" />}>
            {t(customizingPalettes
              ? 'settings.appearance.hidePaletteEditor'
              : 'settings.appearance.customizePalettes')}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-[var(--motion-fast)] ${customizingPalettes ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </CollapsibleTrigger>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:gap-3">
          <PaletteSlotCard
            slot="day"
            palette={paletteDefinition(dayPalette)}
            active={effectiveSlot === 'day' && activePalette === dayPalette}
            editing={customizingPalettes && editingSlot === 'day'}
            onSelect={() => editSlot('day')}
          />
          <PaletteSlotCard
            slot="night"
            palette={paletteDefinition(nightPalette)}
            active={effectiveSlot === 'night' && activePalette === nightPalette}
            editing={customizingPalettes && editingSlot === 'night'}
            onSelect={() => editSlot('night')}
          />
        </div>

        <CollapsibleContent keepMounted id={paletteEditorId}>
          <div className="mt-4 border-t border-border/60 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {t('settings.appearance.choosePalette', { slot: t(`theme.mode.${editingSlot}`) })}
                </span>
                <ContextHelp label={t('settings.appearance.choosePalette', { slot: t(`theme.mode.${editingSlot}`) })}>{t('settings.appearance.paletteLibraryDescription')}</ContextHelp>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  onClick={resetPair}
                  disabled={isDefaultPair}
                  variant="outline"
                  size="sm"
                  className="min-h-10 text-muted-foreground sm:min-h-8"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  {t('settings.appearance.resetPair')}
                </Button>
                <SegmentedControl
                  value={paletteFilter}
                  options={(['recommended', 'all'] as const).map((filter) => ({
                    value: filter,
                    label: t(`settings.appearance.paletteFilterOption.${filter}`),
                  }))}
                  onChange={setPaletteFilter}
                  ariaLabel={t('settings.appearance.paletteFilter')}
                />
              </div>
            </div>

            <PalettePicker
              palettes={visiblePalettes}
              selected={editingPalette}
              dayPalette={dayPalette}
              nightPalette={nightPalette}
              onSelect={choosePalette}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={choosingStyle} onOpenChange={setChoosingStyle} className="py-5">
        <div className="flex items-center gap-2">
          <CollapsibleTrigger className="group/style flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]">
            <span className="flex-1 text-base font-semibold">{t('settings.appearance.interfaceStyle')}</span>{' '}
            <span className="text-sm text-muted-foreground">{t(activeStyleDefinition.labelKey)}</span>
            <ChevronDown aria-hidden className="size-4 transition-transform duration-[var(--motion-fast)] group-data-panel-open/style:rotate-180 motion-reduce:transition-none" />
          </CollapsibleTrigger>
          <ContextHelp label={t('settings.appearance.interfaceStyle')}>{t('settings.appearance.interfaceStyleDescription')}</ContextHelp>
        </div>
        <CollapsibleContent keepMounted>
          <div
            className="mt-3 grid gap-2.5 sm:grid-cols-3"
            role="radiogroup"
            aria-label={t('settings.appearance.interfaceStyle')}
          >
            {UI_STYLE_PROFILES.map((profile) => (
              <StyleProfileCard
                key={profile.id}
                profile={profile.id}
                groupName={styleGroupName}
                label={t(profile.labelKey)}
                description={t(profile.descriptionKey)}
                selected={uiStyle === profile.id}
                onSelect={setUiStyle}
              />
            ))}
          </div>
          {recommendedPalettePair && (
            <div
              data-palette-preview={recommendedPalettePair[effectiveSlot]}
              className="oa-palette-preview mt-3 flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center"
            >
              <span className="oa-palette-preview-shell flex h-11 w-full shrink-0 overflow-hidden rounded border sm:w-24" aria-hidden>
                <span className="oa-palette-preview-sidebar flex w-6 shrink-0 items-center justify-center border-r">
                  <span className="oa-palette-preview-sidebar-dot h-2 w-2 rounded-full" />
                </span>
                <span className="oa-palette-preview-canvas flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-2">
                  <span className="oa-palette-preview-primary-line h-1.5 w-3/5 rounded-full" />
                  <span className="oa-palette-preview-muted-line h-1 w-full rounded-full" />
                  <span className="oa-palette-preview-muted-line h-1 w-3/4 rounded-full" />
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">
                  {t('settings.appearance.recommendedPalette', {
                    style: t(activeStyleDefinition.labelKey),
                  })}
                </span>
                <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                  {t('settings.appearance.recommendedPaletteDescription', {
                    day: t(paletteDefinition(recommendedPalettePair.day).labelKey),
                    night: t(paletteDefinition(recommendedPalettePair.night).labelKey),
                  })}
                </p>
              </div>
              <Button
                type="button"
                onClick={applyRecommendedPalette}
                aria-pressed={recommendedPaletteApplied}
                variant={recommendedPaletteApplied ? 'default' : 'outline'}
                size="sm"
                className="min-h-10 shrink-0 sm:min-h-8"
              >
                {t(recommendedPaletteApplied
                  ? 'settings.appearance.useSavedPalettes'
                  : 'settings.appearance.applyRecommendedPalette')}
              </Button>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

    </>
  )

  if (standalone) return content

  return (
    <ConfigSection title={t('settings.appearance.title')} help={t('settings.appearance.description')}>
      {content}
    </ConfigSection>
  )
}

function StyleProfileCard({
  profile,
  groupName,
  label,
  description,
  selected,
  onSelect,
}: {
  profile: UiStyleProfileId
  groupName: string
  label: string
  description: string
  selected: boolean
  onSelect: (profile: UiStyleProfileId) => void
}) {
  return (
    <label
      title={description}
      data-selected={selected}
      className="oa-style-profile-card"
    >
      <input
        className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
        type="radio"
        name={groupName}
        value={profile}
        checked={selected}
        aria-label={label}
        aria-checked={selected}
        onChange={() => onSelect(profile)}
      />
      <span className="oa-style-profile-preview" data-ui-style-preview={profile} aria-hidden>
        <span className="oa-style-profile-rail"><i /><i /><i /><i /></span>
        <span className="oa-style-profile-canvas">
          <span className="oa-style-profile-toolbar"><i /><i /></span>
          <svg className="oa-style-profile-chart" viewBox="0 0 150 32" preserveAspectRatio="none">
            <path d="M8 25H142M8 16H142" fill="none" stroke="var(--border)" strokeWidth="0.6" />
            <path d="M8 24L30 20L46 23L65 13L88 16L105 9L125 12L142 6" fill="none" stroke="var(--foreground)" strokeWidth="1.5" />
          </svg>
          <span className="grid grid-cols-3 gap-1"><i className="oa-style-profile-row" /><i className="oa-style-profile-row" /><i className="oa-style-profile-row" /></span>
        </span>
        <span className="oa-style-profile-popup"><i /><i /><i /></span>
      </span>
      <span className="mt-2 flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
        {label}
        <span className="size-4 shrink-0">{selected && <SelectionCheckIcon />}</span>
      </span>
    </label>
  )
}

function PaletteSlotCard({
  slot,
  palette,
  active,
  editing,
  onSelect,
}: {
  slot: ThemePreferenceSlot
  palette: ThemePaletteDefinition
  active: boolean
  editing: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const Icon = slot === 'day' ? Sun : Moon
  return (
    <button
      type="button"
      title={t(palette.descriptionKey)}
      data-palette-preview={palette.id}
      data-selected={editing}
      aria-pressed={editing}
      aria-label={t('settings.appearance.editPaletteSlot', {
        slot: t(`theme.mode.${slot}`),
        palette: t(palette.labelKey),
      })}
      onClick={onSelect}
      className="oa-palette-preview oa-pressable min-w-0 rounded-2xl border p-4 text-left transition-[border-color,transform]"
    >
      <span className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm leading-5 font-medium">
            <Icon className="h-3.5 w-3.5" />
            {t(`theme.mode.${slot}`)}
          </span>
          <span className="mt-1 block break-words text-sm font-semibold">{t(palette.labelKey)}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {active && (
            <span className="inline-flex items-center gap-1 rounded-full bg-foreground/8 px-2 py-0.5 text-sm leading-5 font-medium">
              <SelectionCheckIcon />
              {t('settings.appearance.activeSlot')}
            </span>
          )}
        </span>
      </span>
      <span className="mt-2.5 flex items-center gap-1 sm:mt-3 sm:gap-1.5" aria-hidden>
        <span className="h-2 flex-1 rounded-sm bg-primary sm:h-2.5" />
        <span className="h-2 flex-1 rounded-sm bg-success sm:h-2.5" />
        <span className="h-2 flex-1 rounded-sm bg-warning sm:h-2.5" />
        <span className="h-2 flex-1 rounded-sm bg-destructive sm:h-2.5" />
        <span className="h-2 flex-1 rounded-sm bg-ai-action sm:h-2.5" />
      </span>
    </button>
  )
}

function PalettePicker({
  palettes,
  selected,
  dayPalette,
  nightPalette,
  onSelect,
}: {
  palettes: readonly ThemePaletteDefinition[]
  selected: ThemePaletteId
  dayPalette: ThemePaletteId
  nightPalette: ThemePaletteId
  onSelect: (palette: ThemePaletteId) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,11.5rem),1fr))] gap-2">
      {palettes.map((palette) => (
        <button
          key={palette.id}
          type="button"
          title={t(palette.descriptionKey)}
          data-palette-preview={palette.id}
          data-selected={selected === palette.id}
          onClick={() => onSelect(palette.id)}
          aria-pressed={selected === palette.id}
          aria-label={t('settings.appearance.choosePaletteOption', { palette: t(palette.labelKey) })}
          className="oa-palette-preview oa-pressable min-w-0 rounded-2xl border p-4 text-left transition-[border-color,transform]"
        >
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block break-words text-sm font-semibold">{t(palette.labelKey)}</span>
            </span>
            <span className="size-4 shrink-0">{selected === palette.id && <SelectionCheckIcon />}</span>
          </span>

          <span className="oa-palette-preview-shell mt-3 flex h-9 overflow-hidden rounded border" aria-hidden>
            <span className="oa-palette-preview-sidebar flex w-5 shrink-0 items-center justify-center border-r">
              <span className="oa-palette-preview-sidebar-dot h-1.5 w-1.5 rounded-full" />
            </span>
            <span className="oa-palette-preview-canvas flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-2">
              <span className="oa-palette-preview-primary-line h-1.5 w-1/2 rounded-full" />
              <span className="flex gap-1">
                <span className="oa-palette-preview-muted-line h-1 flex-1 rounded-full" />
                <span className="oa-palette-preview-muted-line h-1 w-1/4 rounded-full" />
              </span>
            </span>
          </span>

          <span className="mt-2 flex items-center gap-1.5" aria-hidden>
            <span className="h-3 flex-1 rounded-sm" style={{ background: 'var(--primary)' }} />
            <span className="h-3 flex-1 rounded-sm" style={{ background: 'var(--success)' }} />
            <span className="h-3 flex-1 rounded-sm" style={{ background: 'var(--warning)' }} />
            <span className="h-3 flex-1 rounded-sm" style={{ background: 'var(--destructive)' }} />
            <span className="h-3 flex-1 rounded-sm" style={{ background: 'var(--ai-action)' }} />
          </span>
          <span
            className="oa-palette-preview-terminal mt-2 flex h-5 items-center gap-1 rounded border px-1.5"
            aria-hidden
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--terminal-red)' }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--terminal-yellow)' }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--terminal-green)' }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--terminal-cyan)' }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--terminal-blue)' }} />
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--terminal-magenta)' }} />
            <span className="oa-palette-preview-terminal-line ml-1 h-px flex-1" />
          </span>
          {(palette.id === dayPalette || palette.id === nightPalette) && (
            <span className="oa-palette-preview-muted mt-2 block text-sm font-medium">
              {palette.id === dayPalette && palette.id === nightPalette
                ? t('settings.appearance.usedForBoth')
                : palette.id === dayPalette
                  ? t('settings.appearance.usedForDay')
                  : t('settings.appearance.usedForNight')}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ==================== Language ====================

export function LanguageSection() {
  const { t } = useTranslation()
  const locale = useLocale()
  const setLocale = useSetLocale()
  return (
    <SegmentedControl
      value={locale}
      options={(['en', 'zh', 'ja', 'zh-Hant'] as const).map((value) => ({ value, label: LOCALE_LABELS[value] }))}
      onChange={setLocale}
      ariaLabel={t('settings.language.title')}
    />
  )
}

// ==================== Data location ====================

export function DataHomeSection() {
  const { t } = useTranslation()
  const bridge = window.openAlice?.dataHome
  const backendConnection = getBackendConnection()
  const relay = useRelayConnection()
  const [status, setStatus] = useState<OpenAliceDataHomeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!bridge) return
    bridge.getStatus()
      .then(setStatus)
      .catch(() => setError(t('settings.dataHome.loadError')))
  }, [bridge, t])

  if (!bridge) {
    return (
      <ConfigSection
        title={t('settings.dataHome.title')}
        help={t('settings.dataHome.description')}
      >
        <div className="rounded-lg border border-border/60 bg-secondary/50 px-3 py-3">
          {relay.status?.target?.machine && relay.status.target.machine !== 'local' ? (
            <p className="text-sm leading-relaxed text-foreground">
              {t('settings.dataHome.remoteManaged')}
            </p>
          ) : (
            <>
              <p className="text-sm text-foreground">{t('settings.dataHome.browserOnly')}</p>
              <p className="mt-2 break-all font-mono text-sm leading-5 text-muted-foreground">
                openalice run --home &lt;path&gt;
              </p>
              <p className="mt-1 break-all font-mono text-sm leading-5 text-muted-foreground">
                pnpm dev -- --home &lt;path&gt;
              </p>
            </>
          )}
        </div>
      </ConfigSection>
    )
  }

  const lockDescription = status?.selectionLock === 'openalice-home-env'
    ? t('settings.dataHome.lockedByHome')
    : status?.selectionLock === 'workspace-root-env'
      ? t('settings.dataHome.lockedByWorkspace')
      : null

  return (
    <ConfigSection
      title={t('settings.dataHome.title')}
      help={t('settings.dataHome.description')}
    >
      <div className="rounded-lg border border-border/60 bg-secondary/50 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">
            {t('settings.dataHome.current')}
          </p>
          {status && (
            <span className="rounded-full border border-border px-2 py-0.5 text-sm leading-5 text-muted-foreground">
              {t(`settings.dataHome.source.${status.source}`)}
            </span>
          )}
        </div>
        <p data-testid="data-home-current" className="mt-1 break-all font-mono text-sm leading-5 text-foreground">
          {status?.currentHome ?? t('settings.dataHome.loading')}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t('settings.dataHome.switchNote')}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10 sm:min-h-8"
          disabled={!status}
          onClick={() => void bridge.openCurrent()
            .then((message) => { if (message) setError(t('settings.dataHome.openError')) })
            .catch(() => setError(t('settings.dataHome.openError')))}
        >
          {t('settings.dataHome.open')}
        </Button>
      </div>

      {lockDescription && (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm leading-relaxed text-warning">
          {lockDescription}
        </p>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    </ConfigSection>
  )
}

// ==================== Windows workspace shell ====================

function WorkspaceShellSection() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<WorkspaceShellStatus | null>(null)
  const [mode, setMode] = useState<'auto' | 'custom'>('auto')
  const [customPath, setCustomPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    preferencesApi.getWorkspaceShell()
      .then((next) => {
        setStatus(next)
        if (next.supported) {
          setMode(next.mode)
          setCustomPath(next.customPath ?? '')
        }
      })
      .catch(() => setStatus({ supported: false }))
  }, [])

  if (!status?.supported) return null

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await preferencesApi.saveWorkspaceShell({
        mode,
        ...(mode === 'custom' ? { customPath } : { customPath: null }),
      })
      setStatus(next)
      if (next.supported) {
        setMode(next.mode)
        setCustomPath(next.customPath ?? '')
      }
    } catch {
      setError(t('settings.workspaceShell.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConfigSection
      title={t('settings.workspaceShell.title')}
      help={t('settings.workspaceShell.description')}
    >
      <Field label={t('settings.workspaceShell.mode')}>
        <Select
          aria-label={t('settings.workspaceShell.mode')}
          value={mode}
          onValueChange={(selectedValue) => setMode(selectedValue as 'auto' | 'custom')}
          options={[
            { value: 'auto', label: t('settings.workspaceShell.auto') },
            { value: 'custom', label: t('settings.workspaceShell.custom') },
          ]}
        />
      </Field>
      {mode === 'custom' && (
        <Field
          label={t('settings.workspaceShell.path')}
          description={t('settings.workspaceShell.pathDescription')}
        >
          <input
            data-testid="workspace-shell-path"
            className={`${inputClass} font-mono`}
            value={customPath}
            placeholder="C:\\Program Files\\Git\\bin\\bash.exe"
            onChange={(event) => setCustomPath(event.target.value)}
          />
        </Field>
      )}
      <div className="rounded-lg border border-border/60 bg-secondary/50 px-3 py-2.5 mb-3">
        <p className="text-sm font-medium text-muted-foreground">
          {t('settings.workspaceShell.resolved')}
        </p>
        <p className="mt-1 break-all font-mono text-sm leading-5 text-foreground">
          {status.resolvedPath ?? t('settings.workspaceShell.notFound')}
        </p>
        <p className={`mt-1 text-sm ${status.valid ? 'text-success' : 'text-destructive'}`}>
          {status.valid
            ? t('settings.workspaceShell.source', { source: status.source })
            : status.message ?? t('settings.workspaceShell.notFound')}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="min-h-10 sm:min-h-8"
          disabled={saving || (mode === 'custom' && customPath.trim().length === 0)}
          onClick={() => void save()}
        >
          {saving ? t('settings.workspaceShell.saving') : t('settings.workspaceShell.save')}
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </ConfigSection>
  )
}

// ==================== Settings Section ====================

function SettingsSection() {
  const { t } = useTranslation()
  return (
    <div className="w-full max-w-[1100px] [&>*+*]:mt-6">
      <section className="flex flex-wrap items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold">{t('settings.language.title')}</h3>
          <ContextHelp label={t('settings.language.title')}>{t('settings.language.description')}</ContextHelp>
        </div>
        <LanguageSection />
      </section>
      <AliceLocationSection />

      {/* Installation and update ownership */}
      <VersionOverviewSection />
      <UpdateLifecycleSection />

      {/* Complete OpenAlice home + runtime lock boundary */}
      <DataHomeSection />

      {/* Windows-only workspace shell */}
      <WorkspaceShellSection />
    </div>
  )
}

// ==================== Tools Section ====================

interface ToolGroup {
  key: string
  tools: ToolInfo[]
}

export function ToolsSection() {
  const { t } = useTranslation()
  const groupLabel = (key: string): string => {
    switch (key) {
      case 'thinking': return t('settings.tools.group.thinking')
      case 'cron': return t('settings.tools.group.cron')
      case 'equity': return t('settings.tools.group.equity')
      case 'crypto-data': return t('settings.tools.group.cryptoData')
      case 'currency-data': return t('settings.tools.group.currencyData')
      case 'news': return t('settings.tools.group.news')
      case 'news-archive': return t('settings.tools.group.newsArchive')
      case 'analysis': return t('settings.tools.group.analysis')
      case 'crypto-trading': return t('settings.tools.group.cryptoTrading')
      case 'securities-trading': return t('settings.tools.group.securitiesTrading')
      default: return key
    }
  }
  const [query, setQuery] = useState('')
  const [inventory, setInventory] = useState<ToolInfo[]>([])
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const loadTools = useCallback(async () => {
    setLoaded(false)
    setLoadError(false)
    try {
      const res = await api.tools.load()
      setInventory(res.inventory)
      setDisabled(new Set(res.disabled))
      setLoaded(true)
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void loadTools()
  }, [loadTools])

  const groups = useMemo<ToolGroup[]>(() => {
    const map = new Map<string, ToolInfo[]>()
    for (const tool of inventory) {
      if (!map.has(tool.group)) map.set(tool.group, [])
      map.get(tool.group)!.push(tool)
    }
    return Array.from(map.entries()).map(([key, tools]) => ({
      key,
      tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
    }))
  }, [inventory])

  const configData = useMemo(
    () => ({ disabled: [...disabled].sort() }),
    [disabled],
  )

  const save = useCallback(async (d: { disabled: string[] }) => {
    await api.tools.update(d.disabled)
  }, [])

  const { status, retry } = useAutoSave({ data: configData, save, enabled: loaded })

  const toggleTool = useCallback((name: string) => {
    setDisabled((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const toggleGroup = useCallback((tools: ToolInfo[], enable: boolean) => {
    setDisabled((prev) => {
      const next = new Set(prev)
      for (const t of tools) {
        if (enable) next.delete(t.name)
        else next.add(t.name)
      }
      return next
    })
  }, [])

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const search = query.trim().toLocaleLowerCase()
  const matchingGroups = groups.map((group) => ({
    ...group,
    tools: search ? group.tools.filter((tool) => `${groupLabel(group.key)} ${tool.name} ${tool.description ?? ''}`.toLocaleLowerCase().includes(search)) : group.tools,
  })).filter((group) => group.tools.length > 0)
  const matchingCount = matchingGroups.reduce((count, group) => count + group.tools.length, 0)

  return (
    <div className="w-full max-w-[1100px]">
      {!loaded ? (
        loadError ? (
          <div role="alert" className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm font-medium text-foreground">{t('settings.tools.loadError')}</p>
            <Button type="button" variant="outline" size="sm" className="mt-4 min-h-10 sm:min-h-8" onClick={() => void loadTools()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <PageLoading />
        )
      ) : groups.length === 0 ? (
        <EmptyState title={t('settings.tools.emptyTitle')} description={t('settings.tools.emptyDescription')} />
      ) : (
        <div>
          <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1 sm:mb-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <label className="flex h-(--oa-control-height) min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:[box-shadow:var(--oa-focus-shadow)]">
              <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <input type="search" value={query} onChange={(event) => {
                setQuery(event.target.value)
                if (event.target.value.trim()) setExpanded(new Set(groups.map((group) => group.key)))
              }}
                aria-label={t('settings.tools.search')} placeholder={t('settings.tools.search')}
                className="min-w-0 flex-1 bg-transparent text-sm [@media(pointer:coarse)]:text-base outline-none" />
            </label>
            <CountBadge count={matchingCount} label={t('settings.tools.count', { count: matchingCount })} />
            <ContextHelp label={t('settings.category.tools')}>{t('settings.tools.summary', { tools: inventory.length, groups: groups.length })}</ContextHelp>
            <div className="col-span-3 flex min-h-5 justify-end sm:col-span-1">
              <SaveIndicator status={status} onRetry={retry} />
            </div>
          </div>
          <div className="space-y-2">
            {matchingGroups.length === 0 && <EmptyState title={t('settings.tools.noMatches')} />}
            {matchingGroups.map((g) => (
              <ToolGroupCard
                key={g.key}
                group={g}
                label={groupLabel(g.key)}
                disabled={disabled}
                expanded={expanded.has(g.key)}
                onToggleExpanded={() => toggleExpanded(g.key)}
                onToggleTool={toggleTool}
                onToggleGroup={toggleGroup}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ==================== ToolGroupCard ====================

interface ToolGroupCardProps {
  group: ToolGroup
  label: string
  disabled: Set<string>
  expanded: boolean
  onToggleExpanded: () => void
  onToggleTool: (name: string) => void
  onToggleGroup: (tools: ToolInfo[], enable: boolean) => void
}

function ToolGroupCard({
  group,
  label,
  disabled,
  expanded,
  onToggleExpanded,
  onToggleTool,
  onToggleGroup,
}: ToolGroupCardProps) {
  const { t } = useTranslation()
  const enabledCount = group.tools.filter((t) => !disabled.has(t.name)).length
  const noneEnabled = enabledCount === 0
  const toolListId = useId()

  return (
    <Collapsible open={expanded} onOpenChange={onToggleExpanded} className="group/tool-group overflow-hidden rounded-2xl border border-border/60 bg-secondary">
      <div className="flex items-center gap-3 px-4 py-1">
        <CollapsibleTrigger
          type="button"
          className="group/tool-trigger flex min-h-(--oa-control-height) min-w-0 flex-1 items-center gap-3 rounded-md py-2 text-left focus-visible:outline-none focus-visible:[box-shadow:var(--oa-focus-shadow)]"
          aria-expanded={expanded}
          aria-controls={toolListId}
        >
          <ChevronRight aria-hidden className={`size-4 shrink-0 text-muted-foreground group-hover/tool-trigger:text-foreground transition-transform duration-[var(--motion-standard)] group-data-[instant]/tool-group:transition-none motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`} />
          <span className="min-w-0 text-sm font-medium text-foreground [overflow-wrap:anywhere]">{label}</span>
          <CountBadge count={enabledCount} label={t('settings.tools.enabledCount', { count: enabledCount, total: group.tools.length })} />
        </CollapsibleTrigger>
        <Toggle
          ariaLabel={`${label} tools`}
          size="sm"
          checked={!noneEnabled}
          onChange={(v) => onToggleGroup(group.tools, v)}
        />
      </div>

      <CollapsibleContent keepMounted
        id={toolListId}
        aria-hidden={!expanded}
        inert={!expanded ? true : undefined}
      >
        <div className="mx-4 divide-y divide-border/60 border-t border-border/60 pb-1">
          {group.tools.map((t) => {
            const enabled = !disabled.has(t.name)
            return (
              <div
                key={t.name}
                className="flex min-h-11 items-center gap-3 py-1.5"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2 pl-7">
                  <span className="min-w-0 font-mono text-sm leading-5 text-foreground [overflow-wrap:anywhere]">
                    {t.name.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[_.:/-])/u).map((part, index) => (
                      <Fragment key={index}>{index > 0 && <wbr />}{part}</Fragment>
                    ))}
                  </span>
                  {t.description && (
                    <ContextHelp label={t.name}>{t.description}</ContextHelp>
                  )}
                </div>
                <Toggle
                  ariaLabel={t.name}
                  size="sm"
                  checked={enabled}
                  onChange={() => onToggleTool(t.name)}
                />
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t('settings.category.general')} />
      <SettingsScrollArea>
        <SettingsSection />
      </SettingsScrollArea>
    </div>
  )
}

export function AppearanceSettingsPage() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t('settings.appearance.title')} />
      <SettingsScrollArea>
        <div className="w-full max-w-[1100px]">
          <AppearanceSection standalone />
        </div>
      </SettingsScrollArea>
    </div>
  )
}

export function ToolsSettingsPage() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t('settings.category.tools')} />
      <SettingsScrollArea>
        <ToolsSection />
      </SettingsScrollArea>
    </div>
  )
}
