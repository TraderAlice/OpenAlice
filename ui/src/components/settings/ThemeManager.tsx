import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal as Xterm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import {
  ThemeApiError,
  themesApi,
  type AppearanceMode,
  type ThemeFamily,
  type ThemeImportPreview,
  type ThemeVariant,
  type ThemeVariantMode,
} from '../../api/themes'
import { terminalThemeProfileForVariant } from '../workspace/terminalThemeProfile'
import { useEffectiveTheme } from '../../theme/useEffectiveTheme'
import { useThemeStore } from '../../theme/store'

export function ThemeManager() {
  const { t } = useTranslation()
  const families = useThemeStore((state) => state.families)
  const appearance = useThemeStore((state) => state.appearance)
  const status = useThemeStore((state) => state.status)
  const storeError = useThemeStore((state) => state.error)
  const saveAppearance = useThemeStore((state) => state.saveAppearance)
  const saveFamily = useThemeStore((state) => state.saveFamily)
  const replaceFamily = useThemeStore((state) => state.replaceFamily)
  const deleteFamily = useThemeStore((state) => state.deleteFamily)
  const effectiveMode = useEffectiveTheme()
  const fileInput = useRef<HTMLInputElement | null>(null)
  const [draftFamilyId, setDraftFamilyId] = useState(appearance?.activeFamilyId ?? '')
  const [draftMode, setDraftMode] = useState<AppearanceMode>(appearance?.mode ?? 'system')
  const [legacyVariant, setLegacyVariant] = useState<ThemeVariantMode>('dark')
  const [preview, setPreview] = useState<ThemeImportPreview | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (appearance === null) return
    setDraftFamilyId(appearance.activeFamilyId)
    setDraftMode(appearance.mode)
  }, [appearance])

  const draftFamily = families.find((family) => family.id === draftFamilyId)
  const displayedVariant = resolvePreviewVariant(draftFamily, draftMode, effectiveMode)
  const existingCollision = preview === null
    ? undefined
    : families.find((family) => family.id === preview.family.id)
  const pairable = preview !== null && existingCollision !== undefined
    && complementary(existingCollision, preview.family)
  const dirty = appearance !== null
    && (appearance.activeFamilyId !== draftFamilyId || appearance.mode !== draftMode)

  const selectFamily = (family: ThemeFamily) => {
    setDraftFamilyId(family.id)
    if (draftMode === 'system' && (family.variants.light === undefined || family.variants.dark === undefined)) {
      setDraftMode(family.variants.light === undefined ? 'dark' : 'light')
    } else if (draftMode !== 'system' && family.variants[draftMode] === undefined) {
      setDraftMode(family.variants.light === undefined ? 'dark' : 'light')
    }
  }

  const apply = async () => {
    if (appearance === null || draftFamily === undefined) return
    setBusy(true)
    setNotice(null)
    try {
      await saveAppearance({ ...appearance, activeFamilyId: draftFamily.id, mode: draftMode })
      setNotice(t('settings.themeManager.applied'))
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const chooseFile = async (file: File) => {
    setBusy(true)
    setPreview(null)
    setImportError(null)
    setNotice(null)
    try {
      const parsed = await themesApi.preview(await file.text(), file.name, legacyVariant)
      setPreview(parsed)
    } catch (error) {
      setImportError(importErrorMessage(error))
    } finally {
      setBusy(false)
      if (fileInput.current !== null) fileInput.current.value = ''
    }
  }

  const persistPreview = async (pair: boolean) => {
    if (preview === null) return
    setBusy(true)
    setNotice(null)
    try {
      if (pair) {
        if (existingCollision === undefined || !complementary(existingCollision, preview.family)) return
        await replaceFamily({
          ...existingCollision,
          variants: { ...existingCollision.variants, ...preview.family.variants },
        })
        setNotice(t('settings.themeManager.paired'))
      } else {
        await saveFamily(preview.family)
        setNotice(t('settings.themeManager.imported'))
      }
      setPreview(null)
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (family: ThemeFamily) => {
    setBusy(true)
    setNotice(null)
    try {
      await deleteFamily(family.id)
      setNotice(t('settings.themeManager.deleted'))
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (status === 'error') {
    return <p role="alert" className="py-3 text-sm text-red">{storeError ?? t('settings.themeManager.loadFailed')}</p>
  }
  if (status === 'loading' || appearance === null) {
    return <p className="py-3 text-sm text-text-muted">{t('settings.themeManager.loading')}</p>
  }

  const builtins = families.filter(isBuiltinFamily)
  const imported = families.filter((family) => !isBuiltinFamily(family))

  return (
    <div className="space-y-5" data-testid="theme-manager">
      <div className="grid gap-4 lg:grid-cols-2">
        <ThemeFamilyList
          title={t('settings.themeManager.builtIn')}
          families={builtins}
          activeFamilyId={appearance.activeFamilyId}
          selectedFamilyId={draftFamilyId}
          onSelect={(id) => {
            const family = families.find((item) => item.id === id)
            if (family !== undefined) selectFamily(family)
          }}
        />
        <ThemeFamilyList
          title={t('settings.themeManager.importedThemes')}
          families={imported}
          activeFamilyId={appearance.activeFamilyId}
          selectedFamilyId={draftFamilyId}
          onSelect={(id) => {
            const family = families.find((item) => item.id === id)
            if (family !== undefined) selectFamily(family)
          }}
          onDelete={(family) => void remove(family)}
          busy={busy}
          empty={t('settings.themeManager.noImported')}
        />
      </div>

      <div className="rounded-lg border border-border bg-bg-secondary p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-text">{t('settings.themeManager.selection')}</h4>
            <p className="text-xs text-text-muted">{draftFamily?.name ?? t('settings.themeManager.none')}</p>
          </div>
          <div className="flex gap-2" role="group" aria-label={t('settings.themeManager.mode')}>
            {(['system', 'light', 'dark'] as const).map((mode) => {
              const unavailable = mode === 'system'
                ? draftFamily?.variants.light === undefined || draftFamily?.variants.dark === undefined
                : draftFamily?.variants[mode] === undefined
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={unavailable}
                  aria-pressed={draftMode === mode}
                  onClick={() => setDraftMode(mode)}
                  className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${draftMode === mode
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-text-muted hover:text-text'} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {t(`settings.themeManager.modes.${mode}`)}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() => {
              setDraftFamilyId(appearance.activeFamilyId)
              setDraftMode(appearance.mode)
            }}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text disabled:opacity-40"
          >
            {t('settings.themeManager.cancel')}
          </button>
          <button
            type="button"
            disabled={!dirty || busy || draftFamily === undefined}
            onClick={() => void apply()}
            className="btn-primary-sm disabled:opacity-40"
          >
            {t('settings.themeManager.apply')}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-3" data-testid="theme-import-panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-text">{t('settings.themeManager.importTitle')}</h4>
            <p className="text-xs text-text-muted">{t('settings.themeManager.importDescription')}</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={legacyVariant}
              onChange={(event) => setLegacyVariant(event.target.value as ThemeVariantMode)}
              aria-label={t('settings.themeManager.missingVariant')}
              className="rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-text"
            >
              <option value="light">{t('settings.themeManager.modes.light')}</option>
              <option value="dark">{t('settings.themeManager.modes.dark')}</option>
            </select>
            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              accept=".yaml,.yml,.json,.itermcolors,.plist,.toml,.conf,.theme,.txt,Xresources"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file !== undefined) void chooseFile(file)
              }}
            />
            <button type="button" disabled={busy} className="btn-primary-sm" onClick={() => fileInput.current?.click()}>
              {t('settings.themeManager.chooseFile')}
            </button>
          </div>
        </div>
        {importError !== null && (
          <div role="alert" className="rounded-md border border-red/40 bg-red/10 p-3 text-xs text-red" data-testid="theme-import-error">
            {importError}
          </div>
        )}
        {preview !== null && (
          <ImportPreview
            preview={preview}
            collision={existingCollision}
            pairable={pairable}
            busy={busy}
            onCancel={() => setPreview(null)}
            onSave={() => void persistPreview(false)}
            onPair={() => void persistPreview(true)}
          />
        )}
      </div>

      {displayedVariant !== undefined && <ThemeReference variant={displayedVariant} />}
      {notice !== null && <p className="text-xs text-text-muted" role="status">{notice}</p>}
    </div>
  )
}

function ThemeFamilyList(props: {
  title: string
  families: readonly ThemeFamily[]
  activeFamilyId: string
  selectedFamilyId: string
  onSelect: (id: string) => void
  onDelete?: (family: ThemeFamily) => void
  busy?: boolean
  empty?: string
}) {
  const { t } = useTranslation()
  return (
    <section>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">{props.title}</h4>
      <div className="space-y-2">
        {props.families.length === 0 && <p className="text-xs text-text-muted">{props.empty}</p>}
        {props.families.map((family) => {
          const provenance = family.variants.light?.provenance ?? family.variants.dark?.provenance
          const author = provenance?.kind === 'imported' ? provenance.author : null
          const source = provenance?.kind === 'imported' ? provenance.format
            : provenance?.kind === 'builtin' ? provenance.sourceName
              : provenance?.kind === 'generated' ? provenance.generator : null
          return (
            <div
              key={family.id}
              className={`rounded-lg border p-3 transition-colors ${props.selectedFamilyId === family.id
                ? 'border-accent bg-accent/5'
                : 'border-border bg-bg hover:bg-overlay'}`}
            >
              <button type="button" className="w-full text-left" onClick={() => props.onSelect(family.id)}>
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text">{family.name}</span>
                  {props.activeFamilyId === family.id && (
                    <span className="rounded-full bg-green/15 px-2 py-0.5 text-[10px] font-medium text-green">{t('settings.themeManager.active')}</span>
                  )}
                </span>
                <span className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-text-muted">
                  <span>{family.variants.light ? t('settings.themeManager.modes.light') : '—'}</span>
                  <span>·</span>
                  <span>{family.variants.dark ? t('settings.themeManager.modes.dark') : '—'}</span>
                  {source !== null && <><span>·</span><span>{source}</span></>}
                  {author !== null && <><span>·</span><span>{author}</span></>}
                  {provenance?.kind === 'imported' && <><span>·</span><time dateTime={provenance.importedAt}>{new Date(provenance.importedAt).toLocaleDateString()}</time></>}
                </span>
              </button>
              {props.onDelete !== undefined && (
                <button
                  type="button"
                  disabled={props.busy || props.activeFamilyId === family.id}
                  className="mt-2 text-[11px] text-red hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => props.onDelete?.(family)}
                >
                  {t('settings.themeManager.delete')}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ImportPreview(props: {
  preview: ThemeImportPreview
  collision?: ThemeFamily
  pairable: boolean
  busy: boolean
  onCancel: () => void
  onSave: () => void
  onPair: () => void
}) {
  const { t } = useTranslation()
  const variant = props.preview.family.variants.light ?? props.preview.family.variants.dark!
  return (
    <div className="rounded-lg border border-accent/50 bg-accent/5 p-3 space-y-3" data-testid="theme-import-preview">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text">{props.preview.family.name}</p>
          <p className="text-xs text-text-muted">
            {props.preview.format} · {variant.mode} · {variant.provenance.kind === 'imported'
              ? variant.provenance.author ?? t('settings.themeManager.unknownAuthor')
              : variant.provenance.kind === 'builtin'
                ? variant.provenance.sourceName
                : variant.provenance.generator}
          </p>
        </div>
        <PaletteStrip variant={variant} />
      </div>
      {props.collision !== undefined && (
        <div className="rounded-md border border-notification-border bg-notification-bg p-2 text-xs text-text" data-testid="theme-id-collision">
          {props.pairable
            ? t('settings.themeManager.complementaryCollision')
            : t('settings.themeManager.idCollision')}
          <code className="ml-1 text-[10px]">{props.preview.family.id}</code>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs" onClick={props.onCancel}>
          {t('settings.themeManager.cancel')}
        </button>
        {props.pairable ? (
          <button type="button" disabled={props.busy} className="btn-primary-sm" onClick={props.onPair}>
            {t('settings.themeManager.pairVariants')}
          </button>
        ) : (
          <button type="button" disabled={props.busy || props.collision !== undefined} className="btn-primary-sm disabled:opacity-40" onClick={props.onSave}>
            {t('settings.themeManager.saveImport')}
          </button>
        )}
      </div>
    </div>
  )
}

function ThemeReference({ variant }: { variant: ThemeVariant }) {
  const { t } = useTranslation()
  const terminal = useMemo(() => terminalThemeProfileForVariant(variant), [variant])
  return (
    <section className="rounded-lg border border-border p-4 space-y-4" data-testid="theme-reference">
      <div>
        <h4 className="text-sm font-semibold text-text">{t('settings.themeManager.reference')}</h4>
        <p className="text-xs text-text-muted">{variant.name}</p>
      </div>
      <ThemeXtermPreview variant={variant} />
      <div className="grid grid-cols-3 gap-2">
        {[
          [t('settings.themeManager.surface'), variant.tokens.pageBackground, variant.tokens.bodyText],
          [t('settings.themeManager.card'), variant.tokens.cardSurface, variant.tokens.strongText],
          [t('settings.themeManager.accent'), variant.tokens.accent, variant.tokens.onAccent],
        ].map(([label, background, color]) => (
          <div key={label} className="rounded-md border border-border p-3 text-xs" style={{ background, color }}>
            {label}
          </div>
        ))}
      </div>
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Base16</p>
        <PaletteStrip variant={variant} />
      </div>
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">ANSI 0–15</p>
        <div className="grid grid-cols-8 gap-1" data-testid="ansi-grid">
          {terminal.palette.map((rgb, index) => {
            const color = `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
            return <div key={index} data-ansi-index={index} data-color={color} className="aspect-square rounded-sm border border-border/40" style={{ backgroundColor: color }} title={`${index}: ${color}`} />
          })}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Extended ANSI 16–21</p>
        <div className="grid grid-cols-6 gap-1" data-testid="extended-ansi-grid">
          {terminal.extendedAnsi.map((rgb, index) => {
            const color = `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
            return <div key={index} data-ansi-index={index + 16} data-color={color} className="h-5 rounded-sm border border-border/40" style={{ backgroundColor: color }} title={`${index + 16}: ${color}`} />
          })}
        </div>
      </div>
    </section>
  )
}

function ThemeXtermPreview({ variant }: { variant: ThemeVariant }) {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement | null>(null)
  const profile = useMemo(() => terminalThemeProfileForVariant(variant), [variant])
  useEffect(() => {
    if (host.current === null) return
    const terminal = new Xterm({
      cols: 48,
      rows: 4,
      disableStdin: true,
      convertEol: true,
      fontSize: 11,
      lineHeight: 1.15,
      theme: profile.xtermTheme,
      scrollback: 0,
    })
    terminal.open(host.current)
    terminal.write('ANSI 0-7   ' + Array.from({ length: 8 }, (_, index) => `\x1b[${30 + index}m██`).join('') + '\x1b[0m\r\n')
    terminal.write('ANSI 8-15  ' + Array.from({ length: 8 }, (_, index) => `\x1b[${90 + index}m██`).join('') + '\x1b[0m\r\n')
    terminal.write('ANSI 16-21 ' + Array.from({ length: 6 }, (_, index) => `\x1b[38;5;${16 + index}m██`).join('') + '\x1b[0m')
    return () => terminal.dispose()
  }, [profile])
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">{t('settings.themeManager.xtermPreview')}</p>
      <div ref={host} className="h-[76px] overflow-hidden rounded-md border border-border bg-bg" data-testid="xterm-theme-preview" />
    </div>
  )
}

function PaletteStrip({ variant }: { variant: ThemeVariant }) {
  const entries = Object.entries(variant.palette).filter(([key]) => /^base(?:0[0-9A-F]|1[0-7])$/.test(key))
  return (
    <div className="flex max-w-full overflow-hidden rounded border border-border/50">
      {entries.map(([slot, color]) => (
        <span key={slot} className="h-5 w-4" style={{ backgroundColor: color }} title={`${slot}: ${color}`} />
      ))}
    </div>
  )
}

function resolvePreviewVariant(
  family: ThemeFamily | undefined,
  mode: AppearanceMode,
  effectiveMode: ThemeVariantMode,
): ThemeVariant | undefined {
  return family?.variants[mode === 'system' ? effectiveMode : mode]
}

function isBuiltinFamily(family: ThemeFamily): boolean {
  return Object.values(family.variants).some((variant) => variant?.provenance.kind === 'builtin')
}

function complementary(existing: ThemeFamily, incoming: ThemeFamily): boolean {
  const existingModes = (['light', 'dark'] as const).filter((mode) => existing.variants[mode] !== undefined)
  const incomingModes = (['light', 'dark'] as const).filter((mode) => incoming.variants[mode] !== undefined)
  return existingModes.length === 1 && incomingModes.length === 1 && existingModes[0] !== incomingModes[0]
}

function importErrorMessage(error: unknown): string {
  if (error instanceof ThemeApiError && error.payload.diagnostics !== undefined) {
    return error.payload.diagnostics.map((item) => `${item.path || '<root>'}: ${item.message}`).join(' · ')
  }
  return errorMessage(error)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
