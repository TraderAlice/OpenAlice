import { http, HttpResponse } from 'msw'
import type {
  AppearancePreferences, ImportedThemeFormat, ThemeFamily, ThemeGenerationRequest,
  ThemeGeneratorDetectionSnapshot,
} from '../../api/themes'
import {
  demoGeneratedThemeFamily, demoGeneratorDetectionIds, demoGeneratorSnapshots,
  demoThemeFamily, demoThemeImportFixtures,
} from '../fixtures/themes'

const builtin = demoThemeFamily('tinted-base16', 'OpenAlice', ['light', 'dark'])
builtin.id = 'builtin-openalice'
for (const [mode, variant] of Object.entries(builtin.variants)) {
  if (variant) {
    variant.id = `builtin-openalice-${mode}`
    variant.provenance = { kind: 'builtin', sourceName: variant.name, mappingVersion: 1 }
  }
}

const DEMO_THEME_STATE_KEY = 'openalice.demo.themes.v1'
const families = new Map<string, ThemeFamily>([[builtin.id, builtin]])
let appearance: AppearancePreferences = {
  activeFamilyId: builtin.id, mode: 'system', terminal: { mode: 'follow' },
  marketColors: 'protected', marketDirection: 'green-up-red-down', statusColors: 'protected',
}

const formats: readonly ImportedThemeFormat[] = [
  'tinted-base16', 'legacy-base16', 'tinted-base24', 'flat-base24', 'iterm2',
  'windows-terminal', 'alacritty', 'kitty-ghostty', 'xresources',
]

function validFamily(value: unknown): value is ThemeFamily {
  if (!value || typeof value !== 'object') return false
  const family = value as Partial<ThemeFamily>
  if (family.schemaVersion !== 1 || typeof family.id !== 'string' || typeof family.name !== 'string') return false
  const variants = family.variants
  if (!variants || (!variants.light && !variants.dark)) return false
  return (['light', 'dark'] as const).every((mode) => !variants[mode] || variants[mode]?.mode === mode)
}

function validAppearance(value: unknown, restoredFamilies: readonly ThemeFamily[]): value is AppearancePreferences {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AppearancePreferences>
  if (typeof candidate.activeFamilyId !== 'string'
    || !restoredFamilies.some((family) => family.id === candidate.activeFamilyId)
    || (candidate.mode !== 'light' && candidate.mode !== 'dark' && candidate.mode !== 'system')
    || (candidate.marketColors !== 'protected' && candidate.marketColors !== 'theme')
    || (candidate.marketDirection !== 'green-up-red-down' && candidate.marketDirection !== 'red-up-green-down')
    || (candidate.statusColors !== 'protected' && candidate.statusColors !== 'theme')
    || !candidate.terminal || typeof candidate.terminal !== 'object') return false
  const terminal = candidate.terminal
  if (terminal.mode === 'follow') return true
  if (terminal.mode !== 'override'
    || typeof terminal.familyId !== 'string'
    || (terminal.variant !== 'light' && terminal.variant !== 'dark')) return false
  const terminalFamily = restoredFamilies.find((family) => family.id === terminal.familyId)
  return terminalFamily?.variants[terminal.variant] !== undefined
}

function familyReferenced(id: string): boolean {
  return appearance.activeFamilyId === id
    || (appearance.terminal.mode === 'override' && appearance.terminal.familyId === id)
}

function restoreDemoState(): void {
  try {
    const raw = localStorage.getItem(DEMO_THEME_STATE_KEY)
    if (raw === null) return
    const parsed = JSON.parse(raw) as { families?: unknown; appearance?: unknown }
    if (!Array.isArray(parsed.families) || !parsed.families.every(validFamily)) return
    const restoredFamilies = parsed.families as ThemeFamily[]
    if (!validAppearance(parsed.appearance, restoredFamilies)) {
      localStorage.removeItem(DEMO_THEME_STATE_KEY)
      return
    }
    families.clear()
    families.set(builtin.id, builtin)
    for (const family of restoredFamilies) {
      if (family.id !== builtin.id) families.set(family.id, structuredClone(family))
    }
    appearance = structuredClone(parsed.appearance)
  } catch {
    localStorage.removeItem(DEMO_THEME_STATE_KEY)
  }
}

function persistDemoState(): void {
  localStorage.setItem(DEMO_THEME_STATE_KEY, JSON.stringify({
    families: [...families.values()],
    appearance,
  }))
}

function generatorFixture(request: Request): keyof typeof demoGeneratorSnapshots | 'failed' {
  const fixture = request.headers.get('x-openalice-generator-fixture')
  return fixture === 'unavailable' || fixture === 'unsupported' || fixture === 'failed' ? fixture : 'available'
}

function snapshotFor(request: Request): ThemeGeneratorDetectionSnapshot {
  const fixture = generatorFixture(request)
  return fixture === 'failed' ? demoGeneratorSnapshots.available : demoGeneratorSnapshots[fixture]
}

function validGenerationRequest(value: unknown): value is ThemeGenerationRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  if ((request.generator !== 'matugen' && request.generator !== 'hellwal')
    || typeof request.detectionId !== 'string' || typeof request.name !== 'string' || request.name.trim() === ''
    || !Array.isArray(request.modes) || request.modes.length < 1 || request.modes.length > 2
    || request.modes.some((mode) => mode !== 'light' && mode !== 'dark')
    || (request.modes.length === 2 && (request.modes[0] !== 'light' || request.modes[1] !== 'dark'))) return false
  if (request.generator === 'matugen') return typeof request['scheme'] === 'string' && request['scheme'].length > 0
  return typeof request.darkOffset === 'number' && Number.isFinite(request.darkOffset)
    && request.darkOffset >= 0 && request.darkOffset <= 1
    && typeof request.brightOffset === 'number' && Number.isFinite(request.brightOffset)
    && request.brightOffset >= 0 && request.brightOffset <= 1
}

function validImageUpload(value: unknown): value is Blob {
  return typeof value === 'object' && value !== null
    && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
    && typeof (value as { size?: unknown }).size === 'number'
    && (value as { size: number }).size > 0
}

restoreDemoState()

export const themesHandlers = [
  http.get('/api/themes', () => HttpResponse.json({ families: [...families.values()] })),
  http.get('/api/themes/appearance', () => HttpResponse.json(appearance)),
  http.put('/api/themes/appearance', async ({ request }) => {
    const next = await request.json().catch(() => null) as AppearancePreferences | null
    const active = next && families.get(next.activeFamilyId)
    const terminalFamily = next?.terminal.mode === 'override' ? families.get(next.terminal.familyId) : undefined
    const validMode = next?.mode === 'light' || next?.mode === 'dark' || next?.mode === 'system'
    if (!next || !validMode) return HttpResponse.json({ error: 'invalid_appearance' }, { status: 400 })
    if (!active) return HttpResponse.json({ error: 'theme_family_not_found', familyId: next.activeFamilyId }, { status: 422 })
    if (next.mode === 'system' && (!active.variants.light || !active.variants.dark)) {
      return HttpResponse.json({ error: 'system_requires_complete_family', familyId: active.id }, { status: 422 })
    }
    if (next.terminal.mode === 'override' && !terminalFamily) {
      return HttpResponse.json({ error: 'theme_family_not_found', familyId: next.terminal.familyId }, { status: 422 })
    }
    if (next.terminal.mode === 'override' && !terminalFamily?.variants[next.terminal.variant]) {
      return HttpResponse.json({ error: 'terminal_variant_not_found', familyId: terminalFamily!.id }, { status: 422 })
    }
    appearance = structuredClone(next)
    persistDemoState()
    return HttpResponse.json(appearance)
  }),
  http.post('/api/themes/imports/preview', async ({ request }) => {
    const body = await request.json().catch(() => null) as { contents?: unknown; filename?: unknown; legacyVariant?: unknown } | null
    if (!body || typeof body.contents !== 'string' || typeof body.filename !== 'string') {
      return HttpResponse.json({ error: 'invalid_import_request' }, { status: 400 })
    }
    const fixture = demoThemeImportFixtures.find((candidate) => candidate.filename === body.filename
      && candidate.contents === body.contents)
    if (!fixture || fixture.invalid || !fixture.format || !formats.includes(fixture.format)) {
      return HttpResponse.json({
        error: 'theme_import_failed', diagnostics: [{ path: 'contents', message: 'Unsupported or invalid demo theme fixture' }],
      }, { status: 422 })
    }
    const format = fixture.format
    const legacyVariant = body.legacyVariant === 'light' || body.legacyVariant === 'dark' ? body.legacyVariant : undefined
    if (format === 'legacy-base16' && !legacyVariant) {
      return HttpResponse.json({ error: 'theme_import_failed', diagnostics: [{ path: 'legacyVariant', message: 'Choose light or dark' }] }, { status: 422 })
    }
    const name = body.filename.replace(/\.[^.]+$/, '')
    const family = demoThemeFamily(format, name, [legacyVariant ?? (name.includes('light') ? 'light' : 'dark')])
    return HttpResponse.json({ family, format })
  }),
  http.get('/api/themes/generators', ({ request }) => HttpResponse.json(snapshotFor(request))),
  http.post('/api/themes/generators/refresh', ({ request }) => HttpResponse.json({
    ...snapshotFor(request), refreshedAt: '2026-07-18T00:01:00.000Z',
  })),
  http.post('/api/themes/generators/preview', async ({ request }) => {
    const fixture = generatorFixture(request)
    const body = await request.formData().catch(() => null)
    const raw = body?.get('request')
    const image = body?.get('image')
    let generation: unknown
    try { generation = typeof raw === 'string' ? JSON.parse(raw) : null } catch { generation = null }
    if (generation === null || !validImageUpload(image)) {
      return HttpResponse.json({ error: 'invalid_generation_request', diagnostics: ['multipart fields request and image are required'] }, { status: 400 })
    }
    if (!validGenerationRequest(generation)) {
      const generator = typeof generation === 'object' && generation !== null
        && (generation as { generator?: unknown }).generator === 'hellwal' ? 'hellwal' : 'matugen'
      return HttpResponse.json({ error: 'invalid_parameters', generator, diagnostics: ['request parameters are invalid'] }, { status: 400 })
    }
    const detection = snapshotFor(request).generators[generation.generator]
    if (detection.kind === 'unavailable') {
      return HttpResponse.json({ error: 'generator_unavailable', generator: generation.generator, diagnostics: [detection.reason] }, { status: 422 })
    }
    if (detection.kind === 'unsupported') {
      return HttpResponse.json({ error: 'generator_unsupported', generator: generation.generator, diagnostics: [detection.reason] }, { status: 422 })
    }
    if (generation.detectionId !== detection.detectionId) {
      return HttpResponse.json({ error: 'detection_stale', generator: generation.generator, diagnostics: ['detection id is stale'] }, { status: 409 })
    }
    if (generation.generator === 'matugen' && detection.capabilities.kind === 'matugen'
      && !detection.capabilities.schemes.includes(generation.scheme)) {
      return HttpResponse.json({ error: 'invalid_parameters', generator: 'matugen', diagnostics: [`scheme: unsupported ${generation.scheme}`] }, { status: 400 })
    }
    if (fixture === 'failed') {
      return HttpResponse.json({ error: 'non_zero_exit', generator: generation.generator, diagnostics: ['demo generator failed'], process: { exitCode: 2, signal: null } }, { status: 422 })
    }
    if (generation.generator === 'matugen') {
      return HttpResponse.json(demoGeneratedThemeFamily('matugen', generation.name, generation.modes, {
        scheme: generation.scheme,
      }))
    }
    return HttpResponse.json(demoGeneratedThemeFamily('hellwal', generation.name, generation.modes, {
      darkOffset: generation.darkOffset, brightOffset: generation.brightOffset,
    }))
  }),
  http.post('/api/themes', async ({ request }) => {
    const family = await request.json().catch(() => null)
    if (!validFamily(family)) return HttpResponse.json({ error: 'invalid_theme_family' }, { status: 400 })
    if (families.has(family.id)) return HttpResponse.json({ error: 'theme_family_conflict', familyId: family.id }, { status: 409 })
    families.set(family.id, structuredClone(family))
    persistDemoState()
    return HttpResponse.json(family, { status: 201 })
  }),
  http.get('/api/themes/:familyId', ({ params }) => {
    const family = families.get(String(params.familyId))
    return family ? HttpResponse.json(family) : HttpResponse.json({ error: 'theme_family_not_found' }, { status: 404 })
  }),
  http.put('/api/themes/:familyId', async ({ params, request }) => {
    const id = String(params.familyId)
    const family = await request.json().catch(() => null)
    if (!validFamily(family) || family.id !== id) return HttpResponse.json({ error: 'invalid_theme_family' }, { status: 400 })
    const current = families.get(id)
    if (!current) return HttpResponse.json({ error: 'theme_family_not_found' }, { status: 404 })
    if (current.variants.light?.provenance.kind === 'builtin' || current.variants.dark?.provenance.kind === 'builtin') {
      return HttpResponse.json({ error: 'theme_family_builtin', familyId: id }, { status: 409 })
    }
    families.set(id, structuredClone(family))
    persistDemoState()
    return HttpResponse.json(family)
  }),
  http.delete('/api/themes/:familyId', ({ params }) => {
    const id = String(params.familyId)
    const family = families.get(id)
    if (!family) return HttpResponse.json({ error: 'theme_family_not_found' }, { status: 404 })
    if (family.variants.light?.provenance.kind === 'builtin' || family.variants.dark?.provenance.kind === 'builtin') {
      return HttpResponse.json({ error: 'theme_family_builtin', familyId: id }, { status: 409 })
    }
    if (familyReferenced(id)) return HttpResponse.json({ error: 'theme_family_active', familyId: id }, { status: 409 })
    families.delete(id)
    persistDemoState()
    return new HttpResponse(null, { status: 204 })
  }),
]
