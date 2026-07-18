import { randomUUID } from 'node:crypto'
import { link, mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { dataPath } from '../paths.js'
import { BUILTIN_THEME_FAMILIES } from './builtins.js'
import { resolveThemeTokens, validateTerminalThemeContrast } from './colors.js'
import { containsBuiltinThemeVariant, themeFamilySchema, type ThemeFamily } from './types.js'

export class ThemeFamilyConflictError extends Error {
  constructor(readonly familyId: string) {
    super(`Theme family ${familyId} already exists`)
    this.name = 'ThemeFamilyConflictError'
  }
}

export class ThemeFamilyNotFoundError extends Error {
  constructor(readonly familyId: string) {
    super(`Theme family ${familyId} does not exist`)
    this.name = 'ThemeFamilyNotFoundError'
  }
}

export class ThemeFamilyDeleteError extends Error {
  constructor(readonly code: 'builtin' | 'active', readonly familyId: string) {
    super(code === 'builtin'
      ? `Built-in theme family ${familyId} cannot be deleted`
      : `Active theme family ${familyId} cannot be deleted`)
    this.name = 'ThemeFamilyDeleteError'
  }
}

export class ThemeFamilyValidationError extends Error {
  constructor(readonly familyId: string, readonly variant: 'light' | 'dark') {
    super(`Theme family ${familyId} has stale or fabricated resolved tokens for ${variant}`)
    this.name = 'ThemeFamilyValidationError'
  }
}

export function themesDirectory(): string {
  return dataPath('themes')
}

export async function listThemeFamilies(directory = themesDirectory()): Promise<ThemeFamily[]> {
  const persisted = await readPersistedFamilies(directory)
  return [...BUILTIN_THEME_FAMILIES, ...persisted].sort((a, b) => a.name.localeCompare(b.name))
}

export async function readThemeFamily(
  familyId: string,
  directory = themesDirectory(),
): Promise<ThemeFamily> {
  const builtin = BUILTIN_THEME_FAMILIES.find((family) => family.id === familyId)
  if (builtin !== undefined) return builtin
  try {
    return validateThemeFamily(JSON.parse(await readFile(themeFile(directory, familyId), 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ThemeFamilyNotFoundError(familyId)
    throw error
  }
}

export async function saveThemeFamily(
  input: ThemeFamily,
  directory = themesDirectory(),
): Promise<ThemeFamily> {
  const family = validateThemeFamily(input)
  if (containsBuiltinThemeVariant(family) || BUILTIN_THEME_FAMILIES.some((item) => item.id === family.id)) {
    throw new ThemeFamilyConflictError(family.id)
  }
  await mkdir(directory, { recursive: true })
  const path = themeFile(directory, family.id)
  const temporary = join(dirname(path), `.${family.id}.${process.pid}.${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(family, null, 2)}\n`, 'utf8')
    } finally {
      await handle.close()
    }
    await link(temporary, path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') throw new ThemeFamilyConflictError(family.id)
      throw error
    })
  } catch (error) {
    throw error
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
  return family
}

export async function replaceThemeFamily(
  input: ThemeFamily,
  directory = themesDirectory(),
): Promise<ThemeFamily> {
  const family = validateThemeFamily(input)
  if (containsBuiltinThemeVariant(family) || BUILTIN_THEME_FAMILIES.some((item) => item.id === family.id)) {
    throw new ThemeFamilyConflictError(family.id)
  }
  await readThemeFamily(family.id, directory)
  await mkdir(directory, { recursive: true })
  const path = themeFile(directory, family.id)
  const temporary = join(dirname(path), `.${family.id}.${process.pid}.${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(family, null, 2)}\n`, 'utf8')
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  return family
}

export async function deleteThemeFamily(
  familyId: string,
  activeFamilyId: string,
  directory = themesDirectory(),
): Promise<void> {
  if (BUILTIN_THEME_FAMILIES.some((family) => family.id === familyId)) {
    throw new ThemeFamilyDeleteError('builtin', familyId)
  }
  if (familyId === activeFamilyId) throw new ThemeFamilyDeleteError('active', familyId)
  try {
    await unlink(themeFile(directory, familyId))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ThemeFamilyNotFoundError(familyId)
    throw error
  }
}

async function readPersistedFamilies(directory: string): Promise<ThemeFamily[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(async (entry) => validateThemeFamily(
      JSON.parse(await readFile(join(directory, entry.name), 'utf8')),
    )))
}

function validateThemeFamily(input: unknown): ThemeFamily {
  const family = themeFamilySchema.parse(input)
  for (const mode of ['light', 'dark'] as const) {
    const variant = family.variants[mode]
    if (variant === undefined) continue
    const expected = resolveThemeTokens(variant.palette)
    if (JSON.stringify(variant.tokens) !== JSON.stringify(expected)) {
      throw new ThemeFamilyValidationError(family.id, mode)
    }
    const terminal = variant.ansi16Override
    validateTerminalThemeContrast({
      foreground: terminal?.foreground ?? variant.palette.base05,
      background: terminal?.background ?? variant.palette.base00,
      cursor: terminal?.cursor ?? variant.palette.base0D,
      selectionForeground: terminal?.selectionForeground ?? variant.palette.base05,
      selectionBackground: terminal?.selectionBackground ?? variant.tokens.selection,
    })
  }
  return family
}

function themeFile(directory: string, familyId: string): string {
  const parsed = themeFamilySchema.shape.id.safeParse(familyId)
  if (!parsed.success) throw new ThemeFamilyNotFoundError(familyId)
  return join(directory, `${parsed.data}.json`)
}
