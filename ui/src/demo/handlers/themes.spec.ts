// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { themesApi, type ThemeFamily } from '../../api/themes'
import { demoGeneratorDetectionIds, demoThemeImportFixtures, demoThemeFamily } from '../fixtures/themes'
import { themesHandlers } from './themes'
import { importThemeScheme } from '../../../../src/core/themes/importer'

vi.hoisted(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  } })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL('http://localhost/') })
})

const server = setupServer(...themesHandlers)
const api = (path: string, init?: RequestInit) => fetch(new URL(path, 'http://localhost/'), init)
const json = { 'content-type': 'application/json' }
const upload = (bytes: readonly number[]) => new Blob([new Uint8Array(bytes)], { type: 'image/png' })

let interceptedFetch: typeof fetch
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
  interceptedFetch = globalThis.fetch
  globalThis.fetch = (input, init) => interceptedFetch(
    typeof input === 'string' && input.startsWith('/') ? new URL(input, 'http://localhost/') : input,
    init,
  )
})
afterAll(() => {
  globalThis.fetch = interceptedFetch
  server.close()
})

describe('demo theme API', () => {
  it('previews every supported demo format and rejects the invalid fixture', async () => {
    for (const fixture of demoThemeImportFixtures) {
      const legacyVariant = fixture.format === 'tinted-base16' || fixture.format === 'tinted-base24'
        || fixture.format === 'flat-base24' ? undefined : 'dark'
      const response = await api('/api/themes/imports/preview', {
        method: 'POST', headers: json,
        body: JSON.stringify({ contents: fixture.contents, filename: fixture.filename, legacyVariant }),
      })
      expect(response.status, fixture.filename).toBe(fixture.invalid ? 422 : 200)
      if (!fixture.invalid) {
        expect((await response.json()).format).toBe(fixture.format)
        const productionPreview = importThemeScheme(fixture.contents, {
          filename: fixture.filename,
          ...(legacyVariant === undefined ? {} : { legacyVariant }),
        })
        expect(productionPreview.format, fixture.filename).toBe(fixture.format)
        expect(productionPreview.family.variants.dark?.palette, fixture.filename).toBeDefined()
      }
    }
  })

  it('persists explicitly paired variants, rejects collisions, and enforces appearance/delete rules', async () => {
    const light = demoThemeFamily('legacy-base16', 'Pair Light', ['light'])
    const dark = demoThemeFamily('kitty-ghostty', 'Pair Dark', ['dark'])
    const paired: ThemeFamily = {
      schemaVersion: 1, id: 'demo-explicit-pair', name: 'Explicit Pair',
      variants: { light: light.variants.light, dark: dark.variants.dark },
    }
    expect((await api('/api/themes', { method: 'POST', headers: json, body: JSON.stringify(paired) })).status).toBe(201)
    expect((await api('/api/themes', { method: 'POST', headers: json, body: JSON.stringify(paired) })).status).toBe(409)

    const selected = {
      activeFamilyId: paired.id, mode: 'system', terminal: { mode: 'follow' },
      marketColors: 'protected', marketDirection: 'green-up-red-down', statusColors: 'protected',
    }
    expect((await api('/api/themes/appearance', { method: 'PUT', headers: json, body: JSON.stringify(selected) })).status).toBe(200)
    const themedPolicy = {
      ...selected,
      marketColors: 'theme', marketDirection: 'red-up-green-down', statusColors: 'theme',
    }
    expect((await api('/api/themes/appearance', { method: 'PUT', headers: json, body: JSON.stringify(themedPolicy) })).status).toBe(200)
    await expect((await api('/api/themes/appearance')).json()).resolves.toMatchObject({
      marketColors: 'theme', marketDirection: 'red-up-green-down', statusColors: 'theme',
    })
    expect((await api(`/api/themes/${paired.id}`, { method: 'DELETE' })).status).toBe(409)
    const builtinDelete = await api('/api/themes/builtin-openalice', { method: 'DELETE' })
    expect(builtinDelete.status).toBe(409)
    await expect(builtinDelete.json()).resolves.toMatchObject({ error: 'theme_family_builtin' })

    const persisted = await api(`/api/themes/${paired.id}`)
    expect((await persisted.json()).variants).toHaveProperty('light')
    expect((await api('/api/themes/appearance')).json()).resolves.toMatchObject({ activeFamilyId: paired.id, mode: 'system' })
  })

  it('does not allow system mode for a single-variant family', async () => {
    const single = demoThemeFamily('alacritty', 'Single Only', ['dark'])
    await api('/api/themes', { method: 'POST', headers: json, body: JSON.stringify(single) })
    const response = await api('/api/themes/appearance', {
      method: 'PUT', headers: json,
      body: JSON.stringify({
        activeFamilyId: single.id, mode: 'system', terminal: { mode: 'follow' },
        marketColors: 'protected', marketDirection: 'green-up-red-down', statusColors: 'protected',
      }),
    })
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ error: 'system_requires_complete_family' })
  })

  it('reports available, unavailable, and unsupported generator capabilities and refreshes them', async () => {
    await expect(themesApi.generatorAvailability()).resolves.toMatchObject({
      generators: {
        matugen: { kind: 'available', capabilities: { schemes: ['tonal-spot', 'vibrant'] } },
        hellwal: { kind: 'available', capabilities: { offsets: ['dark', 'bright'] } },
      },
    })
    const unavailable = await api('/api/themes/generators', { headers: { 'x-openalice-generator-fixture': 'unavailable' } })
    await expect(unavailable.json()).resolves.toMatchObject({
      generators: { matugen: { kind: 'unavailable' }, hellwal: { kind: 'unavailable' } },
    })
    const unsupported = await api('/api/themes/generators/refresh', {
      method: 'POST', headers: { 'x-openalice-generator-fixture': 'unsupported' },
    })
    await expect(unsupported.json()).resolves.toMatchObject({
      refreshedAt: '2026-07-18T00:01:00.000Z',
      generators: { matugen: { kind: 'unsupported' }, hellwal: { kind: 'unsupported' } },
    })
  })

  it('previews full Matugen and single Hellwal families without saving them', async () => {
    const image = upload([1, 2, 3])
    const matugen = await themesApi.generatePreview({
      generator: 'matugen', detectionId: demoGeneratorDetectionIds.matugen,
      name: 'Generated Matugen', modes: ['light', 'dark'], scheme: 'vibrant',
    }, image)
    expect(matugen.variants.light?.provenance).toMatchObject({ kind: 'generated', generator: 'matugen' })
    expect(matugen.variants.dark).toBeDefined()
    expect((await api(`/api/themes/${matugen.id}`)).status).toBe(404)

    const hellwal = await themesApi.generatePreview({
      generator: 'hellwal', detectionId: demoGeneratorDetectionIds.hellwal,
      name: 'Generated Hellwal', modes: ['dark'], darkOffset: 0.2, brightOffset: 0.8,
    }, image)
    expect(hellwal.variants.light).toBeUndefined()
    expect(hellwal.variants.dark?.provenance).toMatchObject({
      kind: 'generated', generator: 'hellwal', parameters: { darkOffset: 0.2, brightOffset: 0.8 },
    })
  })

  it.each([
    ['unavailable', 'generator_unavailable', 422],
    ['unsupported', 'generator_unsupported', 422],
    ['failed', 'non_zero_exit', 422],
  ] as const)('exposes the %s Matugen demo path', async (fixture, error, status) => {
    const body = new FormData()
    body.set('request', JSON.stringify({
      generator: 'matugen', detectionId: demoGeneratorDetectionIds.matugen,
      name: 'Failure', modes: ['dark'], scheme: 'vibrant',
    }))
    body.set('image', upload([1]), 'input.png')
    const response = await api('/api/themes/generators/preview', {
      method: 'POST', headers: { 'x-openalice-generator-fixture': fixture }, body,
    })
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toMatchObject({ error, generator: 'matugen' })
  })

  it('rejects stale detection and malformed generator inputs with production error semantics', async () => {
    const stale = new FormData()
    stale.set('request', JSON.stringify({
      generator: 'hellwal', detectionId: '33333333-3333-4333-8333-333333333333',
      name: 'Stale', modes: ['light'], darkOffset: 0, brightOffset: 1,
    }))
    stale.set('image', upload([1]), 'input.png')
    const staleResponse = await api('/api/themes/generators/preview', { method: 'POST', body: stale })
    expect(staleResponse.status).toBe(409)
    await expect(staleResponse.json()).resolves.toMatchObject({ error: 'detection_stale' })

    const malformed = new FormData()
    malformed.set('request', JSON.stringify({ generator: 'hellwal', darkOffset: 2 }))
    malformed.set('image', new Blob([]), 'empty.png')
    const malformedResponse = await api('/api/themes/generators/preview', { method: 'POST', body: malformed })
    expect(malformedResponse.status).toBe(400)
    await expect(malformedResponse.json()).resolves.toMatchObject({ error: 'invalid_generation_request' })
  })

  it('rejects unsupported schemes and lets callers cancel generator preview requests', async () => {
    const body = new FormData()
    body.set('request', JSON.stringify({
      generator: 'matugen', detectionId: demoGeneratorDetectionIds.matugen,
      name: 'Unsupported', modes: ['dark'], scheme: 'not-installed',
    }))
    body.set('image', upload([1]), 'input.png')
    const unsupported = await api('/api/themes/generators/preview', { method: 'POST', body })
    expect(unsupported.status).toBe(400)
    await expect(unsupported.json()).resolves.toMatchObject({ error: 'invalid_parameters', generator: 'matugen' })

    const controller = new AbortController()
    controller.abort()
    await expect(themesApi.generatePreview({
      generator: 'hellwal', detectionId: demoGeneratorDetectionIds.hellwal,
      name: 'Cancelled', modes: ['dark'], darkOffset: 0, brightOffset: 0,
    }, upload([1]), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
