import { describe, expect, it, vi } from 'vitest'

import type { AppearancePreferences } from '../../core/preferences.js'
import { BUILTIN_OPENALICE_FAMILY } from '../../core/themes/builtins.js'
import type { GeneratorDetectionSnapshot } from '../../core/themes/generators/detection.js'
import { importThemeScheme } from '../../core/themes/importer.js'
import { ThemeGenerationError } from '../../core/themes/generators/service.js'
import { ThemeFamilyConflictError, ThemeFamilyDeleteError, ThemeFamilyNotFoundError } from '../../core/themes/store.js'
import type { ThemeFamily } from '../../core/themes/types.js'
import { createThemeRoutes } from './themes.js'

const defaultAppearance: AppearancePreferences = {
  activeFamilyId: 'builtin-openalice',
  mode: 'system',
  terminal: { mode: 'follow' },
  marketColors: 'protected',
  marketDirection: 'green-up-red-down',
  statusColors: 'protected',
}

describe('theme routes', () => {
  it('previews a strict import without persisting it', async () => {
    const deps = memoryDeps()
    const app = createThemeRoutes(deps)
    const response = await app.request('/imports/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: tintedDocument(), filename: 'theme.json' }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ format: 'tinted-base16', family: { name: 'Eighties' } })
    expect(deps.saveFamily).not.toHaveBeenCalled()
  })

  it('persists a preview explicitly and exposes stable-id conflicts', async () => {
    const deps = memoryDeps()
    const app = createThemeRoutes(deps)
    const family = importThemeScheme(tintedDocument(), { filename: 'theme.json' }).family
    expect((await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(family) })).status).toBe(201)
    expect((await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(family) })).status).toBe(409)
  })

  it('rejects system mode for a single-variant family and validates terminal overrides', async () => {
    const deps = memoryDeps()
    const family = importThemeScheme(tintedDocument(), { filename: 'theme.json' }).family
    await deps.saveFamily(family)
    const app = createThemeRoutes(deps)
    const response = await app.request('/appearance', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...defaultAppearance, activeFamilyId: family.id }),
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'system_requires_complete_family' })
    expect(deps.saveAppearance).not.toHaveBeenCalled()
  })

  it('fails loudly when persisted appearance references a missing family', async () => {
    const deps = memoryDeps()
    deps.appearance.activeFamilyId = 'missing-family'
    const response = await createThemeRoutes(deps).request('/appearance')
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: 'theme_family_not_found',
      familyId: 'missing-family',
    })
  })

  it('protects active and built-in families from deletion', async () => {
    const deps = memoryDeps()
    const family = importThemeScheme(tintedDocument(), { filename: 'theme.json' }).family
    await deps.saveFamily(family)
    deps.appearance.activeFamilyId = family.id
    const app = createThemeRoutes(deps)
    expect((await app.request(`/${family.id}`, { method: 'DELETE' })).status).toBe(409)
    expect((await app.request('/builtin-openalice', { method: 'DELETE' })).status).toBe(409)
  })

  it('protects a family referenced by the terminal override from deletion', async () => {
    const deps = memoryDeps()
    const family = importThemeScheme(tintedDocument(), { filename: 'theme.json' }).family
    await deps.saveFamily(family)
    deps.appearance.terminal = { mode: 'override', familyId: family.id, variant: 'dark' }
    const response = await createThemeRoutes(deps).request(`/${family.id}`, { method: 'DELETE' })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'theme_family_terminal_referenced',
      familyId: family.id,
    })
    expect(deps.deleteFamily).not.toHaveBeenCalled()
  })

  it('reports cached generator availability and explicitly refreshes detection', async () => {
    const deps = memoryDeps()
    deps.generatorService.availability
      .mockResolvedValueOnce(generatorSnapshot('cached'))
      .mockResolvedValueOnce(generatorSnapshot('refreshed'))
    const app = createThemeRoutes(deps)

    expect(await (await app.request('/generators')).json()).toMatchObject({ refreshedAt: 'cached' })
    expect(await (await app.request('/generators/refresh', { method: 'POST' })).json()).toMatchObject({ refreshedAt: 'refreshed' })
    expect(deps.generatorService.availability).toHaveBeenNthCalledWith(1)
    expect(deps.generatorService.availability).toHaveBeenNthCalledWith(2, true)
  })

  it('passes multipart request and image bytes to preview without persisting', async () => {
    const deps = memoryDeps()
    deps.generatorService.preview.mockResolvedValue(BUILTIN_OPENALICE_FAMILY)
    const body = generationForm({ generator: 'matugen', detectionId: crypto.randomUUID() }, new Uint8Array([0, 1, 2, 255]))
    const response = await createThemeRoutes(deps).request('/generators/preview', { method: 'POST', body })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: BUILTIN_OPENALICE_FAMILY.id })
    expect(deps.generatorService.preview).toHaveBeenCalledTimes(1)
    const [request, image, signal] = deps.generatorService.preview.mock.calls[0]!
    expect(request).toMatchObject({ generator: 'matugen' })
    expect([...image]).toEqual([0, 1, 2, 255])
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(deps.saveFamily).not.toHaveBeenCalled()
  })

  it('accepts multipart uploads through the Blob-compatible arrayBuffer contract', async () => {
    const deps = memoryDeps()
    deps.generatorService.preview.mockResolvedValue(BUILTIN_OPENALICE_FAMILY)
    const body = generationForm({ generator: 'hellwal' }, new Uint8Array([4, 5, 6]))
    const response = await createThemeRoutes(deps).request('/generators/preview', { method: 'POST', body })
    expect(response.status).toBe(200)
    expect([...deps.generatorService.preview.mock.calls[0]![1]]).toEqual([4, 5, 6])
  })

  it.each([
    ['invalid_parameters', 400],
    ['detection_stale', 409],
    ['generator_unavailable', 422],
    ['generator_unsupported', 422],
    ['spawn_failed', 422],
    ['cancelled', 422],
    ['non_zero_exit', 422],
    ['invalid_output', 422],
    ['contrast_failed', 422],
    ['staging_cleanup_failed', 422],
  ] as const)('maps %s generation failures to HTTP %i', async (code, status) => {
    const deps = memoryDeps()
    deps.generatorService.preview.mockRejectedValue(new ThemeGenerationError(
      code,
      'hellwal',
      ['diagnostic'],
      code === 'non_zero_exit' ? { exitCode: 2, signal: null } : undefined,
    ))
    const response = await createThemeRoutes(deps).request('/generators/preview', {
      method: 'POST',
      body: generationForm({ generator: 'hellwal' }, new Uint8Array([1])),
    })
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({
      error: code,
      generator: 'hellwal',
      diagnostics: ['diagnostic'],
      ...(code === 'non_zero_exit' ? { process: { exitCode: 2, signal: null } } : {}),
    })
  })

  it('rejects malformed multipart bodies before invoking the generator', async () => {
    const deps = memoryDeps()
    const invalidJson = new FormData()
    invalidJson.set('request', '{')
    invalidJson.set('image', new Blob([new Uint8Array([1])]), 'input.png')
    const malformed = await createThemeRoutes(deps).request('/generators/preview', { method: 'POST', body: invalidJson })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ error: 'invalid_generation_request' })

    const missingImage = new FormData()
    missingImage.set('request', '{}')
    const incomplete = await createThemeRoutes(deps).request('/generators/preview', { method: 'POST', body: missingImage })
    expect(incomplete.status).toBe(400)
    expect(deps.generatorService.preview).not.toHaveBeenCalled()
  })

  it('forwards request disconnect cancellation to the generator preview', async () => {
    const deps = memoryDeps()
    let receivedSignal: AbortSignal | undefined
    let started!: () => void
    const previewStarted = new Promise<void>((resolve) => { started = resolve })
    deps.generatorService.preview.mockImplementation(async (_request, _image, signal) => {
      receivedSignal = signal
      started()
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }))
      throw new ThemeGenerationError('cancelled', 'matugen', ['generation cancelled'])
    })
    const controller = new AbortController()
    const request = new Request('http://localhost/generators/preview', {
      method: 'POST',
      body: generationForm({ generator: 'matugen' }, new Uint8Array([1])),
      signal: controller.signal,
    })
    const responsePromise = createThemeRoutes(deps).fetch(request)
    await previewStarted
    controller.abort()
    const response = await responsePromise

    expect(receivedSignal).toBe(request.signal)
    expect(receivedSignal?.aborted).toBe(true)
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'cancelled' })
  })
})

function memoryDeps() {
  const families = new Map<string, ThemeFamily>([[BUILTIN_OPENALICE_FAMILY.id, BUILTIN_OPENALICE_FAMILY]])
  const appearance = structuredClone(defaultAppearance)
  return {
    appearance,
    listFamilies: vi.fn(async () => [...families.values()]),
    readFamily: vi.fn(async (familyId: string) => {
      const family = families.get(familyId)
      if (family === undefined) throw new ThemeFamilyNotFoundError(familyId)
      return family
    }),
    saveFamily: vi.fn(async (family: ThemeFamily) => {
      if (families.has(family.id)) throw new ThemeFamilyConflictError(family.id)
      families.set(family.id, family)
      return family
    }),
    replaceFamily: vi.fn(async (family: ThemeFamily) => {
      if (!families.has(family.id)) throw new ThemeFamilyNotFoundError(family.id)
      families.set(family.id, family)
      return family
    }),
    deleteFamily: vi.fn(async (familyId: string, activeFamilyId: string) => {
      if (familyId === 'builtin-openalice') throw new ThemeFamilyDeleteError('builtin', familyId)
      if (familyId === activeFamilyId) throw new ThemeFamilyDeleteError('active', familyId)
      if (!families.delete(familyId)) throw new ThemeFamilyNotFoundError(familyId)
    }),
    readAppearance: vi.fn(async () => structuredClone(appearance)),
    saveAppearance: vi.fn(async (next: AppearancePreferences) => {
      Object.assign(appearance, next)
      return structuredClone(appearance)
    }),
    generatorService: {
      availability: vi.fn(async (_refresh?: boolean) => generatorSnapshot('default')),
      preview: vi.fn(async (_request: unknown, _image: Uint8Array, _signal?: AbortSignal) => BUILTIN_OPENALICE_FAMILY),
    },
  }
}

function generationForm(request: Record<string, unknown>, image: Uint8Array): FormData {
  const body = new FormData()
  body.set('request', JSON.stringify(request))
  body.set('image', new Blob([new Uint8Array([...image]).buffer]), 'input.png')
  return body
}

function generatorSnapshot(refreshedAt: string): GeneratorDetectionSnapshot {
  return {
    refreshedAt,
    generators: {
      matugen: { kind: 'unavailable', generator: 'matugen', reason: 'not-on-path' },
      hellwal: { kind: 'unavailable', generator: 'hellwal', reason: 'not-on-path' },
    },
  }
}

function tintedDocument(): string {
  return JSON.stringify({
    system: 'base16', name: 'Eighties', author: 'Chris Kempson', variant: 'dark',
    palette: {
      base00: '101010', base01: '181818', base02: '282828', base03: '585858',
      base04: 'b8b8b8', base05: 'd8d8d8', base06: 'e8e8e8', base07: 'f8f8f8',
      base08: 'ab4642', base09: 'dc9656', base0A: 'f7ca88', base0B: 'a1b56c',
      base0C: '86c1b9', base0D: '7cafc2', base0E: 'ba8baf', base0F: 'a16946',
    },
  })
}
