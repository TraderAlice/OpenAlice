import { Hono, type Context } from 'hono'
import { z } from 'zod'

import {
  appearancePreferencesSchema,
  readAppearancePreferences,
  saveAppearancePreferences,
  type AppearancePreferences,
} from '../../core/preferences.js'
import { ThemeImportError, importThemeScheme } from '../../core/themes/importer.js'
import { ThemeContrastError } from '../../core/themes/colors.js'
import {
  ThemeFamilyConflictError,
  ThemeFamilyDeleteError,
  ThemeFamilyNotFoundError,
  ThemeFamilyValidationError,
  deleteThemeFamily,
  listThemeFamilies,
  readThemeFamily,
  replaceThemeFamily,
  saveThemeFamily,
} from '../../core/themes/store.js'
import { themeFamilySchema, type ThemeFamily } from '../../core/themes/types.js'
import { ThemeGenerationError, ThemeGeneratorService } from '../../core/themes/generators/service.js'

const importPreviewSchema = z.object({
  contents: z.string().min(1).max(1024 * 1024),
  filename: z.string().trim().min(1).max(255).optional(),
  legacyVariant: z.enum(['light', 'dark']).optional(),
}).strict()

interface ThemeRouteDeps {
  listFamilies(): Promise<ThemeFamily[]>
  readFamily(familyId: string): Promise<ThemeFamily>
  saveFamily(family: ThemeFamily): Promise<ThemeFamily>
  replaceFamily(family: ThemeFamily): Promise<ThemeFamily>
  deleteFamily(familyId: string, activeFamilyId: string): Promise<void>
  readAppearance(): Promise<AppearancePreferences>
  saveAppearance(appearance: AppearancePreferences): Promise<AppearancePreferences>
  generatorService: Pick<ThemeGeneratorService, 'availability' | 'preview'>
}

const defaultDeps: ThemeRouteDeps = {
  listFamilies: () => listThemeFamilies(),
  readFamily: (familyId) => readThemeFamily(familyId),
  saveFamily: (family) => saveThemeFamily(family),
  replaceFamily: (family) => replaceThemeFamily(family),
  deleteFamily: (familyId, activeFamilyId) => deleteThemeFamily(familyId, activeFamilyId),
  readAppearance: () => readAppearancePreferences(),
  saveAppearance: (appearance) => saveAppearancePreferences(appearance),
  generatorService: new ThemeGeneratorService(),
}

export function createThemeRoutes(overrides: Partial<ThemeRouteDeps> = {}) {
  const deps: ThemeRouteDeps = { ...defaultDeps, ...overrides }
  const app = new Hono()

  app.get('/', async (c) => c.json({ families: await deps.listFamilies() }))

  app.get('/appearance', async (c) => {
    const appearance = await deps.readAppearance()
    try {
      await validateAppearance(appearance, deps.readFamily)
      return c.json(appearance)
    } catch (error) {
      if (error instanceof ThemeFamilyNotFoundError) {
        return c.json({ error: 'theme_family_not_found', familyId: error.familyId }, 422)
      }
      if (error instanceof InvalidAppearanceError) {
        return c.json({ error: error.code, familyId: error.familyId }, 422)
      }
      throw error
    }
  })

  app.put('/appearance', async (c) => {
    const parsed = appearancePreferencesSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_appearance', issues: parsed.error.issues }, 400)
    try {
      await validateAppearance(parsed.data, deps.readFamily)
      return c.json(await deps.saveAppearance(parsed.data))
    } catch (error) {
      if (error instanceof ThemeFamilyNotFoundError) {
        return c.json({ error: 'theme_family_not_found', familyId: error.familyId }, 422)
      }
      if (error instanceof InvalidAppearanceError) {
        return c.json({ error: error.code, familyId: error.familyId }, 422)
      }
      throw error
    }
  })

  app.post('/imports/preview', async (c) => {
    const parsed = importPreviewSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_import_request', issues: parsed.error.issues }, 400)
    try {
      return c.json(importThemeScheme(parsed.data.contents, parsed.data))
    } catch (error) {
      if (error instanceof ThemeImportError) {
        return c.json({ error: error.code, diagnostics: error.diagnostics }, 422)
      }
      throw error
    }
  })

  app.get('/generators', async (c) => c.json(await deps.generatorService.availability()))

  app.post('/generators/refresh', async (c) => c.json(await deps.generatorService.availability(true)))

  app.post('/generators/preview', async (c) => {
    const body = await c.req.parseBody().catch(() => null)
    const rawRequest = body?.['request']
    const image = body?.['image']
    if (typeof rawRequest !== 'string' || !isUploadedFile(image)) {
      return c.json({ error: 'invalid_generation_request', diagnostics: ['multipart fields request and image are required'] }, 400)
    }
    let request: unknown
    try {
      request = JSON.parse(rawRequest)
    } catch {
      return c.json({ error: 'invalid_generation_request', diagnostics: ['request must be valid JSON'] }, 400)
    }
    try {
      const family = await deps.generatorService.preview(
        request,
        new Uint8Array(await image.arrayBuffer()),
        c.req.raw.signal,
      )
      return c.json(family)
    } catch (error) {
      if (error instanceof ThemeGenerationError) {
        const status = error.code === 'invalid_parameters' ? 400
          : error.code === 'detection_stale' ? 409
            : 422
        return c.json({
          error: error.code,
          generator: error.generator,
          diagnostics: error.diagnostics,
          ...(error.process === undefined ? {} : { process: error.process }),
        }, status)
      }
      throw error
    }
  })

  app.post('/', async (c) => {
    const parsed = themeFamilySchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid_theme_family', issues: parsed.error.issues }, 400)
    try {
      return c.json(await deps.saveFamily(parsed.data), 201)
    } catch (error) {
      if (error instanceof ThemeFamilyConflictError) {
        return c.json({ error: 'theme_family_conflict', familyId: error.familyId }, 409)
      }
      return themeStoreError(c, error)
    }
  })

  app.put('/:familyId', async (c) => {
    const parsed = themeFamilySchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success || parsed.data.id !== c.req.param('familyId')) {
      return c.json({ error: 'invalid_theme_family' }, 400)
    }
    try {
      return c.json(await deps.replaceFamily(parsed.data))
    } catch (error) {
      return themeStoreError(c, error)
    }
  })

  app.get('/:familyId', async (c) => {
    try {
      return c.json(await deps.readFamily(c.req.param('familyId')))
    } catch (error) {
      return themeStoreError(c, error)
    }
  })

  app.delete('/:familyId', async (c) => {
    try {
      const appearance = await deps.readAppearance()
      await deps.deleteFamily(c.req.param('familyId'), appearance.activeFamilyId)
      return c.body(null, 204)
    } catch (error) {
      return themeStoreError(c, error)
    }
  })

  return app
}

function isUploadedFile(value: unknown): value is Blob {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
}

class InvalidAppearanceError extends Error {
  constructor(
    readonly code: 'system_requires_complete_family' | 'terminal_variant_not_found',
    readonly familyId: string,
  ) {
    super(code)
  }
}

async function validateAppearance(
  appearance: AppearancePreferences,
  readFamily: (familyId: string) => Promise<ThemeFamily>,
): Promise<void> {
  const active = await readFamily(appearance.activeFamilyId)
  if (appearance.mode === 'system'
    && (active.variants.light === undefined || active.variants.dark === undefined)) {
    throw new InvalidAppearanceError('system_requires_complete_family', active.id)
  }
  if (appearance.terminal.mode === 'override') {
    const terminal = await readFamily(appearance.terminal.familyId)
    if (terminal.variants[appearance.terminal.variant] === undefined) {
      throw new InvalidAppearanceError('terminal_variant_not_found', terminal.id)
    }
  }
}

function themeStoreError(c: Context, error: unknown) {
  if (error instanceof ThemeFamilyNotFoundError) {
    return c.json({ error: 'theme_family_not_found', familyId: error.familyId }, 404)
  }
  if (error instanceof ThemeFamilyConflictError) {
    return c.json({ error: 'theme_family_conflict', familyId: error.familyId }, 409)
  }
  if (error instanceof ThemeFamilyDeleteError) {
    return c.json({ error: `theme_family_${error.code}`, familyId: error.familyId }, 409)
  }
  if (error instanceof ThemeFamilyValidationError) {
    return c.json({ error: 'invalid_resolved_theme', familyId: error.familyId, variant: error.variant }, 422)
  }
  if (error instanceof ThemeContrastError) {
    return c.json({ error: 'theme_contrast_failed', failures: error.failures }, 422)
  }
  throw error
}
