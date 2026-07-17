import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import type { ThemeFamily } from '../../api/themes'
import { demoThemeImportFixtures, demoThemeFamily } from '../fixtures/themes'
import { themesHandlers } from './themes'
import { importThemeScheme } from '../../../../src/core/themes/importer'

const server = setupServer(...themesHandlers)
const api = (path: string, init?: RequestInit) => fetch(new URL(path, window.location.href), init)
const json = { 'content-type': 'application/json' }

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

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
    expect((await api(`/api/themes/${paired.id}`, { method: 'DELETE' })).status).toBe(409)
    expect((await api('/api/themes/builtin-openalice', { method: 'DELETE' })).status).toBe(403)

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
    expect(response.status).toBe(400)
  })
})
