import { useState, useEffect, useCallback, useMemo } from 'react'
import { Moon, RotateCcw, Sun } from 'lucide-react'
import { api, type AppConfig } from '../api'
import type { ToolInfo } from '../api/tools'
import { Toggle } from '../components/Toggle'
import { SaveIndicator } from '../components/SaveIndicator'
import { ConfigSection, Field, SettingsScrollArea, inputClass } from '../components/form'
import { useAutoSave } from '../hooks/useAutoSave'
import { PageHeader } from '../components/PageHeader'
import { PageLoading, EmptyState } from '../components/StateViews'
import { useTranslation } from 'react-i18next'
import { useLocale, useSetLocale, LOCALE_LABELS } from '../i18n/useLocale'
import { useEditorTabsPref } from '../live/editor-tabs-pref'
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
import { useEffectivePreferenceSlot } from '../theme/useEffectiveTheme'

// ==================== Appearance ====================

type PaletteLibraryFilter = 'recommended' | 'all'

function paletteDefinition(id: ThemePaletteId): ThemePaletteDefinition {
  return THEME_PALETTES.find((palette) => palette.id === id)!
}

export function AppearanceSection() {
  const { t } = useTranslation()
  const showEditorTabs = useEditorTabsPref((s) => s.showEditorTabs)
  const setShowEditorTabs = useEditorTabsPref((s) => s.setShowEditorTabs)
  const theme = useThemeStore((s) => s.theme)
  const dayPalette = useThemeStore((s) => s.dayPalette)
  const nightPalette = useThemeStore((s) => s.nightPalette)
  const setTheme = useThemeStore((s) => s.setTheme)
  const setDayPalette = useThemeStore((s) => s.setDayPalette)
  const setNightPalette = useThemeStore((s) => s.setNightPalette)
  const effectiveSlot = useEffectivePreferenceSlot()
  const [editingSlot, setEditingSlot] = useState<ThemePreferenceSlot>(effectiveSlot)
  const [paletteFilter, setPaletteFilter] = useState<PaletteLibraryFilter>('recommended')
  const modes: readonly AppTheme[] = ['auto', 'day', 'night']
  const activePalette = effectiveSlot === 'day' ? dayPalette : nightPalette
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

  const choosePalette = (palette: ThemePaletteId) => {
    if (editingSlot === 'day') setDayPalette(palette)
    else setNightPalette(palette)
  }

  const resetPair = () => {
    setDayPalette(DEFAULT_DAY_PALETTE)
    setNightPalette(DEFAULT_NIGHT_PALETTE)
    setPaletteFilter('recommended')
  }

  return (
    <ConfigSection title={t('settings.appearance.title')} description={t('settings.appearance.description')}>
      <div className="border-b border-border/60 pb-5">
        <div>
          <span className="text-sm font-medium text-foreground">
            {t('settings.appearance.colorMode')}
          </span>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            {t('settings.appearance.colorModeDescription')}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t('settings.appearance.colorMode')}>
          {modes.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setTheme(mode)
                if (mode !== 'auto') chooseSlot(mode)
              }}
              aria-pressed={theme === mode}
              className={`oa-pressable rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                theme === mode
                  ? 'border-primary bg-primary-muted text-primary'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(`theme.mode.${mode}`)}
            </button>
          ))}
        </div>
        <div
          data-palette-preview={activePalette}
          className="mt-3 inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px]"
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
            <span className="oa-palette-preview-muted shrink-0">
              · {t('settings.appearance.followsSystem')}
            </span>
          )}
        </div>
      </div>

      <div className="border-b border-border/60 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="text-sm font-medium text-foreground">
              {t('settings.appearance.themePair')}
            </span>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
              {t('settings.appearance.themePairDescription')}
            </p>
          </div>
          <button
            type="button"
            onClick={resetPair}
            disabled={isDefaultPair}
            className="oa-pressable inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-45"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('settings.appearance.resetPair')}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,17rem),1fr))] gap-3">
          <PaletteSlotCard
            slot="day"
            palette={paletteDefinition(dayPalette)}
            active={effectiveSlot === 'day'}
            editing={editingSlot === 'day'}
            onSelect={() => chooseSlot('day')}
          />
          <PaletteSlotCard
            slot="night"
            palette={paletteDefinition(nightPalette)}
            active={effectiveSlot === 'night'}
            editing={editingSlot === 'night'}
            onSelect={() => chooseSlot('night')}
          />
        </div>

        <div className="mt-4 rounded-xl border border-border/70 bg-secondary/35 p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="text-sm font-medium text-foreground">
                {t('settings.appearance.choosePalette', { slot: t(`theme.mode.${editingSlot}`) })}
              </span>
              <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
                {t('settings.appearance.paletteLibraryDescription')}
              </p>
            </div>
            <div
              className="inline-flex rounded-md border border-border bg-background p-0.5"
              role="group"
              aria-label={t('settings.appearance.paletteFilter')}
            >
              {(['recommended', 'all'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setPaletteFilter(filter)}
                  aria-pressed={paletteFilter === filter}
                  className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    paletteFilter === filter
                      ? 'bg-primary-muted text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t(`settings.appearance.paletteFilterOption.${filter}`)}
                </button>
              ))}
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
      </div>

      <div className="flex items-center justify-between gap-4 py-1">
        <div className="flex-1">
          <span className="text-sm font-medium text-foreground">
            {t('settings.appearance.showEditorTabs')}
          </span>
          <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
            {showEditorTabs
              ? t('settings.appearance.showEditorTabsOn')
              : t('settings.appearance.showEditorTabsOff')}
          </p>
        </div>
        <Toggle checked={showEditorTabs} onChange={setShowEditorTabs} />
      </div>
    </ConfigSection>
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
      data-palette-preview={palette.id}
      data-selected={editing}
      aria-pressed={editing}
      aria-label={t('settings.appearance.editPaletteSlot', {
        slot: t(`theme.mode.${slot}`),
        palette: t(palette.labelKey),
      })}
      onClick={onSelect}
      className="oa-palette-preview oa-pressable min-w-0 rounded-xl border p-3 text-left shadow-sm transition-[border-color,box-shadow,transform]"
    >
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[11px] font-medium">
            <Icon className="h-3.5 w-3.5" />
            {t(`theme.mode.${slot}`)}
          </span>
          <span className="mt-1 block truncate text-[14px] font-semibold">{t(palette.labelKey)}</span>
          <span className="oa-palette-preview-muted mt-0.5 block text-[10.5px] leading-snug">
            {t(palette.descriptionKey)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {active && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[9px] font-semibold text-primary-foreground">
              {t('settings.appearance.activeSlot')}
            </span>
          )}
          {editing && (
            <span className="rounded-full border border-primary/35 bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary">
              {t('settings.appearance.editingSlot')}
            </span>
          )}
        </span>
      </span>
      <span className="mt-3 flex items-center gap-1.5" aria-hidden>
        <span className="h-2.5 flex-1 rounded-sm bg-primary" />
        <span className="h-2.5 flex-1 rounded-sm bg-success" />
        <span className="h-2.5 flex-1 rounded-sm bg-warning" />
        <span className="h-2.5 flex-1 rounded-sm bg-destructive" />
        <span className="h-2.5 flex-1 rounded-sm bg-ai-action" />
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
          data-palette-preview={palette.id}
          data-selected={selected === palette.id}
          onClick={() => onSelect(palette.id)}
          aria-pressed={selected === palette.id}
          aria-label={t('settings.appearance.choosePaletteOption', { palette: t(palette.labelKey) })}
          className="oa-palette-preview oa-pressable min-w-0 rounded-lg border p-3 text-left shadow-sm transition-[border-color,box-shadow,transform]"
        >
          <span className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block break-words text-[12px] font-semibold">{t(palette.labelKey)}</span>
              <span className="oa-palette-preview-muted mt-0.5 block text-[10px] leading-snug">
                {t(palette.descriptionKey)}
              </span>
            </span>
            <span className="oa-palette-preview-indicator mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full border" aria-hidden />
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
            <span className="oa-palette-preview-muted mt-2 block text-[9.5px] font-medium">
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

function LanguageSection() {
  const { t } = useTranslation()
  const locale = useLocale()
  const setLocale = useSetLocale()
  return (
    <ConfigSection title={t('settings.language.title')} description={t('settings.language.description')}>
      <div className="flex flex-wrap gap-2 py-1">
        {(['en', 'zh', 'ja', 'zh-Hant'] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            className={`px-3 py-1.5 text-sm rounded border transition-colors ${
              locale === l
                ? 'border-primary text-primary bg-primary/10'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {LOCALE_LABELS[l]}
          </button>
        ))}
      </div>
    </ConfigSection>
  )
}

// ==================== Data location ====================

export function DataHomeSection() {
  const { t } = useTranslation()
  const bridge = window.openAlice?.dataHome
  const [status, setStatus] = useState<OpenAliceDataHomeStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [restarting, setRestarting] = useState(false)
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
        description={t('settings.dataHome.description')}
      >
        <div className="rounded-lg border border-border/60 bg-secondary/50 px-3 py-3">
          <p className="text-[13px] text-foreground">{t('settings.dataHome.browserOnly')}</p>
          <p className="mt-2 break-all font-mono text-[12px] text-muted-foreground">
            openalice start --home &lt;path&gt;
          </p>
          <p className="mt-1 break-all font-mono text-[12px] text-muted-foreground">
            pnpm dev -- --home &lt;path&gt;
          </p>
        </div>
      </ConfigSection>
    )
  }

  const runAction = async (action: () => Promise<OpenAliceDataHomeActionResult>) => {
    setBusy(true)
    setError(null)
    try {
      const result = await action()
      setStatus(result.status)
      if (result.outcome === 'restarting') setRestarting(true)
    } catch {
      setError(t('settings.dataHome.actionError'))
    } finally {
      setBusy(false)
    }
  }

  const updateAskOnStartup = async (enabled: boolean) => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await bridge.setAskOnStartup(enabled))
    } catch {
      setError(t('settings.dataHome.actionError'))
    } finally {
      setBusy(false)
    }
  }

  const lockDescription = status?.selectionLock === 'openalice-home-env'
    ? t('settings.dataHome.lockedByHome')
    : status?.selectionLock === 'workspace-root-env'
      ? t('settings.dataHome.lockedByWorkspace')
      : null
  const recentHomes = status?.recentHomes.filter((path) => path !== status.currentHome) ?? []

  return (
    <ConfigSection
      title={t('settings.dataHome.title')}
      description={t('settings.dataHome.description')}
    >
      <div className="rounded-lg border border-border/60 bg-secondary/50 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t('settings.dataHome.current')}
          </p>
          {status && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
              {t(`settings.dataHome.source.${status.source}`)}
            </span>
          )}
        </div>
        <p data-testid="data-home-current" className="mt-1 break-all font-mono text-[12px] text-foreground">
          {status?.currentHome ?? t('settings.dataHome.loading')}
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {t('settings.dataHome.switchNote')}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary-sm"
          disabled={!status || busy}
          onClick={() => void bridge.openCurrent()
            .then((message) => { if (message) setError(t('settings.dataHome.openError')) })
            .catch(() => setError(t('settings.dataHome.openError')))}
        >
          {t('settings.dataHome.open')}
        </button>
        <button
          data-testid="data-home-choose"
          type="button"
          className="btn-primary-sm"
          disabled={!status || busy || restarting || status.selectionLocked}
          onClick={() => void runAction(() => bridge.chooseAndRestart())}
        >
          {restarting ? t('settings.dataHome.restarting') : t('settings.dataHome.chooseAndRestart')}
        </button>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-border/60 px-3 py-2.5">
        <div className="flex-1">
          <p className="text-[13px] font-medium text-foreground">{t('settings.dataHome.askOnStartup')}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {t('settings.dataHome.askOnStartupDescription')}
          </p>
        </div>
        <Toggle
          checked={status?.askOnStartup ?? false}
          disabled={!status || busy || status.selectionLocked}
          ariaLabel={t('settings.dataHome.askOnStartup')}
          onChange={(enabled) => void updateAskOnStartup(enabled)}
        />
      </div>

      {recentHomes.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            {t('settings.dataHome.recent')}
          </p>
          <div className="space-y-2">
            {recentHomes.map((path) => (
              <div key={path} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground" title={path}>
                  {path}
                </span>
                <button
                  type="button"
                  className="btn-secondary-sm shrink-0"
                  disabled={busy || restarting || status?.selectionLocked}
                  onClick={() => void runAction(() => bridge.useRecentAndRestart(path))}
                >
                  {t('settings.dataHome.useAndRestart')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {lockDescription && (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] leading-relaxed text-warning">
          {lockDescription}
        </p>
      )}
      {error && <p className="mt-3 text-[11px] text-destructive">{error}</p>}
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
      description={t('settings.workspaceShell.description')}
    >
      <Field label={t('settings.workspaceShell.mode')}>
        <select
          className={inputClass}
          value={mode}
          onChange={(event) => setMode(event.target.value as 'auto' | 'custom')}
        >
          <option value="auto">{t('settings.workspaceShell.auto')}</option>
          <option value="custom">{t('settings.workspaceShell.custom')}</option>
        </select>
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
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {t('settings.workspaceShell.resolved')}
        </p>
        <p className="mt-1 break-all font-mono text-[12px] text-foreground">
          {status.resolvedPath ?? t('settings.workspaceShell.notFound')}
        </p>
        <p className={`mt-1 text-[11px] ${status.valid ? 'text-success' : 'text-destructive'}`}>
          {status.valid
            ? t('settings.workspaceShell.source', { source: status.source })
            : status.message ?? t('settings.workspaceShell.notFound')}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-primary-sm"
          disabled={saving || (mode === 'custom' && customPath.trim().length === 0)}
          onClick={() => void save()}
        >
          {saving ? t('settings.workspaceShell.saving') : t('settings.workspaceShell.save')}
        </button>
        {error && <span className="text-[11px] text-destructive">{error}</span>}
      </div>
    </ConfigSection>
  )
}

// ==================== Settings Section ====================

function SettingsSection() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    api.config.load().then(setConfig).catch(() => {})
  }, [])

  if (!config) return <PageLoading />

  return (
    <div className="mx-auto w-full max-w-[1100px]">
      {/* Appearance */}
      <AppearanceSection />

      {/* Language */}
      <LanguageSection />

      {/* Complete OpenAlice home + runtime lock boundary */}
      <DataHomeSection />

      {/* Windows-only workspace shell */}
      <WorkspaceShellSection />

      {/* Persona */}
      <ConfigSection title={t('settings.persona.title')} description={t('settings.persona.description')}>
        <PersonaEditor />
      </ConfigSection>

      {/* Compaction */}
      <ConfigSection title={t('settings.compaction.title')} description={t('settings.compaction.description')}>
        <CompactionForm config={config} />
      </ConfigSection>
    </div>
  )
}

// ==================== Compaction Form ====================

function CompactionForm({ config }: { config: AppConfig }) {
  const { t } = useTranslation()
  const [ctx, setCtx] = useState(String(config.compaction?.maxContextTokens || ''))
  const [out, setOut] = useState(String(config.compaction?.maxOutputTokens || ''))

  const data = useMemo(
    () => ({ maxContextTokens: Number(ctx), maxOutputTokens: Number(out) }),
    [ctx, out],
  )

  const save = useCallback(async (d: { maxContextTokens: number; maxOutputTokens: number }) => {
    await api.config.updateSection('compaction', d)
  }, [])

  const { status, retry } = useAutoSave({ data, save })

  return (
    <>
      <Field label={t('settings.compaction.maxContextTokens')}>
        <input className={inputClass} type="number" step={1000} value={ctx} onChange={(e) => setCtx(e.target.value)} />
      </Field>
      <Field label={t('settings.compaction.maxOutputTokens')}>
        <input className={inputClass} type="number" step={1000} value={out} onChange={(e) => setOut(e.target.value)} />
      </Field>
      <SaveIndicator status={status} onRetry={retry} />
    </>
  )
}

// ==================== Persona Editor ====================

function PersonaEditor() {
  const { t } = useTranslation()
  const [content, setContent] = useState('')
  const [filePath, setFilePath] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    api.persona.get()
      .then(({ content, path }) => {
        setContent(content)
        setFilePath(path)
      })
      .catch(() => setError(t('settings.persona.loadError')))
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await api.persona.update(content)
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError(t('settings.persona.saveError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground">{t('settings.persona.loading')}</div>

  return (
    <>
      <textarea
        className={`${inputClass} min-h-[200px] max-h-[400px] resize-y font-mono text-xs leading-relaxed`}
        value={content}
        onChange={(e) => { setContent(e.target.value); setDirty(true) }}
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="btn-primary-sm"
        >
          {saving ? t('settings.persona.saving') : t('settings.persona.save')}
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            <span className="text-muted-foreground">{t('settings.persona.saved')}</span>
          </span>
        )}
        {error && (
          <span className="inline-flex items-center gap-1.5 text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
            <span className="text-destructive">{error}</span>
          </span>
        )}
        {dirty && !saved && !error && (
          <span className="text-[11px] text-muted-foreground">{t('settings.persona.unsaved')}</span>
        )}
      </div>
      {filePath && <p className="text-[11px] text-muted-foreground mt-1">{filePath}</p>}
    </>
  )
}

// ==================== Tools Section ====================

interface ToolGroup {
  key: string
  tools: ToolInfo[]
}

function ToolsSection() {
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
  const [inventory, setInventory] = useState<ToolInfo[]>([])
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    api.tools.load().then((res) => {
      setInventory(res.inventory)
      setDisabled(new Set(res.disabled))
      setLoaded(true)
    }).catch(() => {})
  }, [])

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

  return (
    <div className="mx-auto w-full max-w-[1100px]">
      {!loaded ? (
        <PageLoading />
      ) : groups.length === 0 ? (
        <EmptyState title={t('settings.tools.emptyTitle')} description={t('settings.tools.emptyDescription')} />
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] text-muted-foreground">
              {t('settings.tools.summary', { tools: inventory.length, groups: groups.length })}
            </p>
            <SaveIndicator status={status} onRetry={retry} />
          </div>
          <div className="space-y-2">
            {groups.map((g) => (
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
  const enabledCount = group.tools.filter((t) => !disabled.has(t.name)).length
  const noneEnabled = enabledCount === 0

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Group header */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-secondary">
        <button
          onClick={onToggleExpanded}
          className="flex items-center gap-2 flex-1 text-left min-w-0"
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="text-sm font-medium text-foreground truncate">{label}</span>
          <span className="text-[11px] text-muted-foreground shrink-0">
            {enabledCount}/{group.tools.length}
          </span>
        </button>
        <Toggle
          size="sm"
          checked={!noneEnabled}
          onChange={(v) => onToggleGroup(group.tools, v)}
        />
      </div>

      {/* Tool list */}
      <div
        className={`transition-all duration-150 ${
          expanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        } overflow-hidden`}
      >
        <div className="divide-y divide-border">
          {group.tools.map((t) => {
            const enabled = !disabled.has(t.name)
            return (
              <div
                key={t.name}
                className={`flex items-center gap-3 px-4 py-2 ${
                  enabled ? '' : 'opacity-50'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] text-foreground font-mono">{t.name}</span>
                  {t.description && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                      {t.description}
                    </p>
                  )}
                </div>
                <Toggle
                  size="sm"
                  checked={enabled}
                  onChange={() => onToggleTool(t.name)}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ==================== Page ====================

type Tab = 'settings' | 'tools'

const TABS: { key: Tab; labelKey: 'settings.tab.settings' | 'settings.tab.tools' }[] = [
  { key: 'settings', labelKey: 'settings.tab.settings' },
  { key: 'tools', labelKey: 'settings.tab.tools' },
]

export function SettingsPage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('settings')

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t('settings.title')} />

      <div className="px-4 md:px-6 border-b border-border/60">
        <div className="flex gap-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`px-3 py-2 text-sm font-medium transition-colors relative ${
                tab === item.key ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(item.labelKey)}
              {tab === item.key && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary rounded-t" />
              )}
            </button>
          ))}
        </div>
      </div>

      <SettingsScrollArea className="px-4 py-6 md:px-8">
        {tab === 'settings' ? <SettingsSection /> : <ToolsSection />}
      </SettingsScrollArea>
    </div>
  )
}
