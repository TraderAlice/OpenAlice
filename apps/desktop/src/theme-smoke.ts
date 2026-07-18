import type { BrowserWindow } from 'electron'

export interface ThemeSmokeReceipt {
  readonly stage: 'seed' | 'apply' | 'restart'
  readonly familyId: string
  readonly checks: Readonly<Record<string, boolean>>
  readonly generatorDetections?: Readonly<Record<string, {
    readonly kind: string
    readonly executablePath?: string
    readonly version?: string
  }>>
}

/**
 * Packaged-renderer acceptance for the file-backed theme path. The seed stage
 * imports a real Base16 document and deliberately selects both a built-in and
 * the imported family through the same appearance endpoint. The restart stage
 * runs in a new Electron process/profile session and checks both authoritative
 * file-backed state and the first-paint token cache.
 */
export async function runRendererThemeSmoke(
  win: BrowserWindow,
  stage: 'seed' | 'apply' | 'restart',
  verifyGenerators = false,
): Promise<ThemeSmokeReceipt> {
  return win.webContents.executeJavaScript(`(async () => {
    const request = async (url, init) => {
      const response = await fetch(url, init)
      const payload = response.status === 204 ? null : await response.json().catch(() => null)
      if (!response.ok) throw new Error(url + ' returned ' + response.status + ': ' + JSON.stringify(payload))
      return payload
    }
    const headers = { 'content-type': 'application/json' }
    const imported = ${JSON.stringify({
      system: 'base16',
      name: 'Packaged Restart Eighties',
      author: 'OpenAlice packaged smoke',
      variant: 'dark',
      palette: {
        base00: '101010', base01: '181818', base02: '282828', base03: '585858',
        base04: 'b8b8b8', base05: 'd8d8d8', base06: 'e8e8e8', base07: 'f8f8f8',
        base08: 'ab4642', base09: 'dc9656', base0A: 'f7ca88', base0B: 'a1b56c',
        base0C: '86c1b9', base0D: '7cafc2', base0E: 'ba8baf', base0F: 'a16946',
      },
    })}
    const stage = ${JSON.stringify(stage)}
    const verifyGenerators = ${JSON.stringify(verifyGenerators)}
    if (stage === 'seed') {
      const generatorSnapshot = verifyGenerators ? await request('/api/themes/generators') : null
      const preview = await request('/api/themes/imports/preview', {
        method: 'POST', headers, body: JSON.stringify({ filename: 'packaged-restart.json', contents: JSON.stringify(imported) }),
      })
      await request('/api/themes', { method: 'POST', headers, body: JSON.stringify(preview.family) })
      const original = await request('/api/themes/appearance')
      const select = (activeFamilyId, mode) => request('/api/themes/appearance', {
        method: 'PUT', headers, body: JSON.stringify({ ...original, activeFamilyId, mode }),
      })
      const builtin = await select('builtin-openalice', 'dark')
      const selected = await select(preview.family.id, 'dark')
      return {
        stage, familyId: preview.family.id,
        checks: {
          builtinUsedAppearancePath: builtin.activeFamilyId === 'builtin-openalice',
          importedUsedAppearancePath: selected.activeFamilyId === preview.family.id,
          importedFamilyPersisted: (await request('/api/themes/' + encodeURIComponent(preview.family.id))).id === preview.family.id,
          ...(verifyGenerators ? {
            packagedMatugenDetected: generatorSnapshot?.generators?.matugen?.kind === 'available' && generatorSnapshot.generators.matugen.executablePath?.startsWith('/'),
            packagedHellwalDetected: generatorSnapshot?.generators?.hellwal?.kind === 'available' && generatorSnapshot.generators.hellwal.executablePath?.startsWith('/'),
          } : {}),
        },
        ...(verifyGenerators ? { generatorDetections: generatorSnapshot.generators } : {}),
      }
    }

    const appearance = await request('/api/themes/appearance')
    const family = await request('/api/themes/' + encodeURIComponent(appearance.activeFamilyId))
    const rawCache = localStorage.getItem('openalice.theme.first-paint.v1')
    const cache = rawCache ? JSON.parse(rawCache) : null
    const root = document.documentElement
    return {
      stage, familyId: appearance.activeFamilyId,
      checks: {
        importedFamilyRestoredFromFiles: family.id === appearance.activeFamilyId && family.variants?.dark?.provenance?.kind === 'imported',
        activeAppearanceRestoredFromFiles: appearance.mode === 'dark',
        resolvedCacheIsMinimal: cache?.schemaVersion === 1 && cache?.familyId === appearance.activeFamilyId && cache?.variables?.['--oa-token-page-background'] === '#101010' && !Object.keys(cache.variables ?? {}).some((key) => /^--oa-base/.test(key)) && !('tokens' in cache) && !('palette' in cache) && !('provenance' in cache) && !('family' in cache),
        firstPaintLifecycleIsExplicit: stage === 'restart'
          ? root.dataset.themeFirstPaint === 'cache'
          : root.dataset.themeFirstPaint === 'stale',
        firstFrameFamilyMatchesActive: root.dataset.themeFamily === appearance.activeFamilyId && root.dataset.themeVariant === family.variants.dark.id,
        firstFrameTokenMatchesActive: getComputedStyle(root).getPropertyValue('--color-bg').trim() === '#101010',
      },
    }
  })()`, true) as Promise<ThemeSmokeReceipt>
}
