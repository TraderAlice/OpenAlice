import { useEffect, useMemo, useRef, useState } from 'react'

import {
  ThemeApiError,
  themesApi,
  type ThemeFamily,
  type ThemeGenerationErrorCode,
  type ThemeGenerationRequest,
  type ThemeGeneratorDetection,
  type ThemeGeneratorDetectionSnapshot,
  type ThemeGeneratorId,
  type ThemeVariantMode,
} from '../../api/themes'

export interface ThemeGeneratorPanelLabels {
  readonly title: string
  readonly loading: string
  readonly loadFailed: string
  readonly refresh: string
  readonly refreshing: string
  readonly generator: string
  readonly statuses: { readonly available: string; readonly unavailable: string; readonly unsupported: string }
  readonly executablePath: string
  readonly version: string
  readonly image: string
  readonly chooseImage: string
  readonly name: string
  readonly modes: string
  readonly mode: Readonly<Record<ThemeVariantMode, string>>
  readonly matugenScheme: string
  readonly hellwalDarkOffset: string
  readonly hellwalBrightOffset: string
  readonly offsetHint: string
  readonly generate: string
  readonly generating: string
  readonly cancel: string
  readonly validation: { readonly imageRequired: string; readonly nameRequired: string; readonly modeRequired: string; readonly offsetInvalid: string; readonly schemeRequired: string }
  readonly errors: Partial<Record<ThemeGenerationErrorCode, string>> & { readonly unknown: string }
}

interface ThemeGeneratorPanelProps {
  readonly labels: ThemeGeneratorPanelLabels
  readonly onPreview: (family: ThemeFamily) => void
  readonly disabled?: boolean
}

interface GenerationFields {
  readonly generator: ThemeGeneratorId
  readonly name: string
  readonly light: boolean
  readonly dark: boolean
  readonly scheme: string
  readonly darkOffset: string
  readonly brightOffset: string
}

type InvalidGenerationField = 'generator' | 'name' | 'modes' | 'scheme' | 'offset'

export type GenerationRequestResult =
  | { readonly kind: 'valid'; readonly request: ThemeGenerationRequest }
  | { readonly kind: 'invalid'; readonly field: InvalidGenerationField }

export function buildGenerationRequest(
  fields: GenerationFields,
  detection: ThemeGeneratorDetection,
): GenerationRequestResult {
  if (detection.kind !== 'available' || detection.generator !== fields.generator) {
    return { kind: 'invalid', field: 'generator' }
  }
  const name = fields.name.trim()
  if (name.length === 0) return { kind: 'invalid', field: 'name' }
  const modes = selectedModes(fields.light, fields.dark)
  if (modes === null) return { kind: 'invalid', field: 'modes' }
  if (fields.generator === 'matugen') {
    if (detection.capabilities.kind !== 'matugen' || !detection.capabilities.schemes.includes(fields.scheme)) {
      return { kind: 'invalid', field: 'scheme' }
    }
    return { kind: 'valid', request: { generator: 'matugen', detectionId: detection.detectionId, name, modes, scheme: fields.scheme } }
  }
  const darkOffset = strictOffset(fields.darkOffset)
  const brightOffset = strictOffset(fields.brightOffset)
  if (darkOffset === null || brightOffset === null) return { kind: 'invalid', field: 'offset' }
  return {
    kind: 'valid',
    request: { generator: 'hellwal', detectionId: detection.detectionId, name, modes, darkOffset, brightOffset },
  }
}

export function ThemeGeneratorPanel({ labels, onPreview, disabled = false }: ThemeGeneratorPanelProps) {
  const [snapshot, setSnapshot] = useState<ThemeGeneratorDetectionSnapshot | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [generator, setGenerator] = useState<ThemeGeneratorId>('matugen')
  const [name, setName] = useState('')
  const [image, setImage] = useState<File | null>(null)
  const [light, setLight] = useState(true)
  const [dark, setDark] = useState(true)
  const [scheme, setScheme] = useState('')
  const [darkOffset, setDarkOffset] = useState('0')
  const [brightOffset, setBrightOffset] = useState('0')
  const [generating, setGenerating] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let live = true
    void themesApi.generatorAvailability().then((value) => {
      if (!live) return
      setSnapshot(value)
      setLoadError(false)
    }).catch(() => { if (live) setLoadError(true) })
    return () => {
      live = false
      abortRef.current?.abort()
    }
  }, [])

  const selectedDetection = snapshot?.generators[generator]
  const schemes = selectedDetection?.kind === 'available' && selectedDetection.capabilities.kind === 'matugen'
    ? selectedDetection.capabilities.schemes
    : []
  useEffect(() => {
    if (generator !== 'matugen' || schemes.length === 0 || schemes.includes(scheme)) return
    setScheme(schemes[0]!)
  }, [generator, scheme, schemes])

  const fields = useMemo<GenerationFields>(() => ({
    generator, name, light, dark, scheme, darkOffset, brightOffset,
  }), [generator, name, light, dark, scheme, darkOffset, brightOffset])
  const requestResult = selectedDetection === undefined
    ? { kind: 'invalid', field: 'generator' } as const
    : buildGenerationRequest(fields, selectedDetection)

  const refresh = async () => {
    setRefreshing(true)
    setLoadError(false)
    try {
      setSnapshot(await themesApi.refreshGeneratorAvailability())
    } catch {
      setLoadError(true)
    } finally {
      setRefreshing(false)
    }
  }

  const generate = async () => {
    if (image === null) {
      setFailure(labels.validation.imageRequired)
      return
    }
    if (requestResult.kind === 'invalid') {
      setFailure(validationMessage(requestResult.field, labels))
      return
    }
    const abort = new AbortController()
    abortRef.current = abort
    setGenerating(true)
    setFailure(null)
    try {
      onPreview(await themesApi.generatePreview(requestResult.request, image, abort.signal))
    } catch (error) {
      setFailure(generationErrorMessage(error, labels))
    } finally {
      if (abortRef.current === abort) abortRef.current = null
      setGenerating(false)
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-border p-4" data-testid="theme-generator-panel">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-text">{labels.title}</h4>
        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs" disabled={disabled || refreshing || generating} onClick={() => void refresh()}>
          {refreshing ? labels.refreshing : labels.refresh}
        </button>
      </div>
      {snapshot === null && !loadError && <p className="text-xs text-text-muted">{labels.loading}</p>}
      {loadError && <p role="alert" className="text-xs text-red">{labels.loadFailed}</p>}
      {snapshot !== null && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['matugen', 'hellwal'] as const).map((id) => (
              <GeneratorChoice key={id} detection={snapshot.generators[id]} selected={generator === id} labels={labels} disabled={disabled || generating} onSelect={() => setGenerator(id)} />
            ))}
          </div>
          <label className="block text-xs font-medium text-text">{labels.name}
            <input className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm" value={name} disabled={disabled || generating} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block text-xs font-medium text-text">{labels.image}
            <span className="mt-1 flex items-center gap-2">
              <input type="file" accept="image/*" disabled={disabled || generating} onChange={(event) => setImage(event.currentTarget.files?.[0] ?? null)} />
              {image !== null && <span className="truncate text-xs text-text-muted">{image.name}</span>}
            </span>
          </label>
          <fieldset><legend className="mb-1 text-xs font-medium text-text">{labels.modes}</legend>
            <div className="flex gap-4">
              <Check label={labels.mode.light} checked={light} disabled={disabled || generating} onChange={setLight} />
              <Check label={labels.mode.dark} checked={dark} disabled={disabled || generating} onChange={setDark} />
            </div>
          </fieldset>
          {generator === 'matugen' ? (
            <label className="block text-xs font-medium text-text">{labels.matugenScheme}
              <select className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm" value={scheme} disabled={disabled || generating || schemes.length === 0} onChange={(event) => setScheme(event.target.value)}>
                {schemes.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Offset label={labels.hellwalDarkOffset} value={darkOffset} hint={labels.offsetHint} disabled={disabled || generating} onChange={setDarkOffset} />
              <Offset label={labels.hellwalBrightOffset} value={brightOffset} hint={labels.offsetHint} disabled={disabled || generating} onChange={setBrightOffset} />
            </div>
          )}
          {failure !== null && <p role="alert" className="text-xs text-red">{failure}</p>}
          <div className="flex justify-end gap-2">
            {generating && <button type="button" className="rounded-md border border-border px-3 py-1.5 text-xs" onClick={() => abortRef.current?.abort()}>{labels.cancel}</button>}
            <button type="button" className="btn-primary-sm" disabled={disabled || generating || selectedDetection?.kind !== 'available'} onClick={() => void generate()}>
              {generating ? labels.generating : labels.generate}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function GeneratorChoice(props: { detection: ThemeGeneratorDetection; selected: boolean; labels: ThemeGeneratorPanelLabels; disabled: boolean; onSelect: () => void }) {
  const status = props.detection.kind === 'available' ? props.labels.statuses.available
    : props.detection.kind === 'unsupported' ? props.labels.statuses.unsupported : props.labels.statuses.unavailable
  return <button type="button" disabled={props.disabled} aria-pressed={props.selected} className={`rounded-md border p-3 text-left text-xs ${props.selected ? 'border-accent bg-accent/5' : 'border-border'}`} onClick={props.onSelect}>
    <span className="block font-medium text-text">{props.detection.generator}</span>
    <span className="block text-text-muted">{status}</span>
    {props.detection.kind !== 'unavailable' && <span className="mt-1 block break-all text-text-muted">{props.labels.executablePath}: {props.detection.executablePath}</span>}
    {props.detection.kind === 'available' && <span className="block text-text-muted">{props.labels.version}: {props.detection.version}</span>}
    {props.detection.kind === 'unsupported' && <span className="block text-red">{props.detection.reason}</span>}
  </button>
}

function Check(props: { label: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center gap-2 text-xs text-text"><input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(event) => props.onChange(event.target.checked)} />{props.label}</label>
}

function Offset(props: { label: string; value: string; hint: string; disabled: boolean; onChange: (value: string) => void }) {
  return <label className="text-xs font-medium text-text">{props.label}<input type="number" min="0" max="1" step="0.01" className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm" value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value)} /><span className="mt-1 block text-text-muted">{props.hint}</span></label>
}

function selectedModes(light: boolean, dark: boolean): ThemeGenerationRequest['modes'] | null {
  if (light && dark) return ['light', 'dark']
  if (light) return ['light']
  if (dark) return ['dark']
  return null
}

function strictOffset(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null
}

function validationMessage(field: InvalidGenerationField, labels: ThemeGeneratorPanelLabels): string {
  switch (field) {
    case 'generator': return labels.errors.generator_unavailable ?? labels.errors.unknown
    case 'name': return labels.validation.nameRequired
    case 'modes': return labels.validation.modeRequired
    case 'scheme': return labels.validation.schemeRequired
    case 'offset': return labels.validation.offsetInvalid
    default: return assertNever(field)
  }
}

function generationErrorMessage(error: unknown, labels: ThemeGeneratorPanelLabels): string {
  if (error instanceof ThemeApiError) {
    const code = error.payload.error as ThemeGenerationErrorCode | undefined
    if (code !== undefined && labels.errors[code] !== undefined) return labels.errors[code]!
  }
  if (error instanceof DOMException && error.name === 'AbortError') return labels.errors.cancelled ?? labels.errors.unknown
  return labels.errors.unknown
}

function assertNever(value: never): never {
  throw new Error(`Unhandled generator field: ${String(value)}`)
}
