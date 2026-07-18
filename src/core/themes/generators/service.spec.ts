import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ThemeGeneratorDetectionManager } from './detection.js'
import { createControlledStage } from './process.js'
import { ThemeGenerationError, ThemeGeneratorService } from './service.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const tones = {
  neutral: { 0: '#000000', 10: '#1c1b1e', 15: '#272529', 20: '#313033', 90: '#e6e1e6', 95: '#f4eff4', 98: '#fdf8fd', 100: '#ffffff' },
  neutral_variant: { 40: '#615d66', 60: '#948f99', 70: '#afa9b4' },
  error: { 30: '#93000a', 40: '#ba1a1a', 70: '#ff897d', 80: '#ffb4ab' },
  primary: { 30: '#4f378a', 40: '#6750a4', 70: '#b69df8', 80: '#cfbcff' },
  secondary: { 30: '#4a4458', 40: '#625b71', 70: '#b0a7c0', 80: '#cbc2db' },
  tertiary: { 30: '#633b48', 40: '#7e5260', 70: '#d29dad', 80: '#efb8c8' },
} as const

const matugenJson = JSON.stringify({
  colors: { background: { color: '#ffffff' } },
  palettes: Object.fromEntries(Object.entries(tones).map(([name, palette]) => [
    name, Object.fromEntries(Object.entries(palette).map(([tone, color]) => [tone, { color }])),
  ])),
})

const ansi = [
  '#101010', '#ab4642', '#a1b56c', '#f7ca88', '#7cafc2', '#ba8baf', '#86c1b9', '#d8d8d8',
  '#585858', '#dc9656', '#b5d680', '#ffe0a8', '#9dcfe0', '#d8a9cd', '#a6e1d9', '#f8f8f8',
]
const hellwalJson = JSON.stringify({
  special: { background: '#101010', foreground: '#d8d8d8', cursor: '#e8e8e8' },
  colors: Object.fromEntries(ansi.map((color, index) => [`color${index}`, color])),
})

interface Harness {
  readonly root: string
  readonly env: NodeJS.ProcessEnv
  readonly manager: ThemeGeneratorDetectionManager
  readonly service: ThemeGeneratorService
  readonly detections: Awaited<ReturnType<ThemeGeneratorDetectionManager['refresh']>>
}

async function harness(behavior = 'success'): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'openalice service $() '))
  roots.push(root)
  const bin = join(root, 'bin with spaces $()')
  const home = join(root, 'home')
  await Promise.all([writeFile(join(root, 'argv.log'), ''), writeFile(join(root, 'placeholder'), '')])
  await import('node:fs/promises').then(({ mkdir }) => Promise.all([
    mkdir(bin, { recursive: true }), mkdir(home, { recursive: true }),
  ]))
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const name = path.basename(process.argv[1]);
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log(name + ' 1.2.3'); process.exit(0) }
if (a[0] === '--help') { console.log(name === 'hellwal' ? '--json --no-cache --skip-term-colors --dark --light --dark-offset --bright-offset' : 'matugen help'); process.exit(0) }
if (name === 'matugen' && a[0] === 'image' && a[1] === '--help') { console.log('--dry-run --json --mode light dark --type scheme-tonal-spot scheme-vibrant --source-color-index --include-image-in-json'); process.exit(0) }
fs.appendFileSync(process.env.ARGV_LOG, JSON.stringify({ name, argv: a }) + '\\n');
if (process.env.GEN_BEHAVIOR === 'nonzero') { console.error('controlled failure'); process.exit(7) }
if (process.env.GEN_BEHAVIOR === 'malformed') { process.stdout.write('{'); process.exit(0) }
if (process.env.GEN_BEHAVIOR === 'contrast') {
  const value = name === 'matugen' ? JSON.parse(process.env.MATUGEN_JSON) : JSON.parse(process.env.HELLWAL_JSON);
  if (name === 'matugen') for (const palette of Object.values(value.palettes)) for (const tone of Object.values(palette)) tone.color = '#777777';
  else { for (const key of Object.keys(value.colors)) value.colors[key] = '#777777'; value.special = { background:'#777777', foreground:'#777777', cursor:'#777777' } }
  console.log(JSON.stringify(value)); process.exit(0)
}
if (process.env.GEN_BEHAVIOR === 'wait') { process.on('SIGTERM', () => process.exit(143)); setInterval(() => {}, 1000); return }
console.log(name === 'matugen' ? process.env.MATUGEN_JSON : process.env.HELLWAL_JSON);
`
  for (const name of ['matugen', 'hellwal']) {
    const path = join(bin, name)
    await writeFile(path, script)
    await chmod(path, 0o755)
  }
  const env = {
    ...process.env, HOME: home, PATH: bin, ARGV_LOG: join(root, 'argv.log'),
    MATUGEN_JSON: matugenJson, HELLWAL_JSON: hellwalJson, GEN_BEHAVIOR: behavior,
  }
  const manager = new ThemeGeneratorDetectionManager()
  const detections = await manager.refresh(env)
  const service = new ThemeGeneratorService({ manager, env, now: () => new Date('2026-07-18T00:00:00.000Z') })
  return { root, env, manager, service, detections }
}

function request(h: Harness, generator: 'matugen' | 'hellwal', modes: ['light'] | ['dark'] | ['light', 'dark']) {
  const detection = h.detections.generators[generator]
  if (detection.kind !== 'available') throw new Error(`${generator} fixture was not detected: ${JSON.stringify(detection)}`)
  return generator === 'matugen'
    ? { generator, detectionId: detection.detectionId, name: 'Generated', modes, scheme: 'tonal-spot' }
    : { generator, detectionId: detection.detectionId, name: 'Generated', modes, darkOffset: 0.25, brightOffset: 0.75 }
}

async function loggedArgv(h: Harness) {
  const raw = await readFile(join(h.root, 'argv.log'), 'utf8')
  return raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { name: string; argv: string[] })
}

async function expectCode(run: Promise<unknown>, code: string): Promise<ThemeGenerationError> {
  try {
    await run
    throw new Error('Expected generation to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(ThemeGenerationError)
    expect((error as ThemeGenerationError).code).toBe(code)
    return error as ThemeGenerationError
  }
}

describe('ThemeGeneratorService', () => {
  it('uses exact Matugen argv as discrete arguments and produces both modes without persistence', async () => {
    const h = await harness()
    const family = await h.service.preview(request(h, 'matugen', ['light', 'dark']), new Uint8Array([1, 2, 3]))
    const calls = await loggedArgv(h)
    expect(calls).toHaveLength(2)
    for (const [index, mode] of ['light', 'dark'].entries()) {
      expect(calls[index]?.argv).toEqual([
        'image', expect.stringContaining('openalice-theme-generator-'), '--type', 'scheme-tonal-spot', '--mode', mode,
        '--dry-run', '--json', 'hex', '--source-color-index', '0', '--include-image-in-json', 'false',
      ])
    }
    expect(family.variants.light?.provenance).toMatchObject({ kind: 'generated', generator: 'matugen', executableVersion: 'matugen 1.2.3', parameters: { mode: 'light', scheme: 'tonal-spot' } })
    expect(family.variants.dark?.provenance).toMatchObject({ parameters: { mode: 'dark', scheme: 'tonal-spot' } })
    expect(await readdir(h.env.HOME!)).toEqual([])
  })

  it.each<{ modes: ['light'] | ['dark'] }>([
    { modes: ['light'] }, { modes: ['dark'] },
  ])('uses exact Hellwal argv for $modes', async ({ modes }) => {
    const h = await harness()
    const family = await h.service.preview(request(h, 'hellwal', modes), new Uint8Array([9]))
    const mode: 'light' | 'dark' = modes[0]
    expect((await loggedArgv(h))[0]?.argv).toEqual([
      '--image', expect.stringContaining('openalice-theme-generator-'), mode === 'light' ? '--light' : '--dark',
      '--dark-offset', '0.25', '--bright-offset', '0.75', '--json', '--no-cache', '--skip-term-colors',
    ])
    expect(family.variants[mode]?.provenance).toMatchObject({ kind: 'generated', generator: 'hellwal', parameters: { mode, darkOffset: 0.25, brightOffset: 0.75 } })
  })

  it('keeps identity stable across names and timestamps while retaining complete provenance', async () => {
    const h = await harness()
    const firstRequest = request(h, 'matugen', ['light'])
    const first = await h.service.preview(firstRequest, new Uint8Array([4, 5]))
    const later = new ThemeGeneratorService({ manager: h.manager, env: h.env, now: () => new Date('2030-01-01T00:00:00.000Z') })
    const second = await later.preview({ ...firstRequest, name: 'Renamed' }, new Uint8Array([4, 5]))
    expect(second.id).toBe(first.id)
    expect(second.variants.light?.id).toBe(`${first.id}-light`)
    expect(second.variants.light?.provenance).toMatchObject({ executablePath: h.detections.generators.matugen.kind === 'available' ? h.detections.generators.matugen.executablePath : '', imageSha256: expect.stringMatching(/^[a-f0-9]{64}$/), generatedAt: '2030-01-01T00:00:00.000Z' })
  })

  it.each([Number.NaN, -0.1, 1.1])('rejects invalid Hellwal offset %s before spawning', async (darkOffset) => {
    const h = await harness()
    await expectCode(h.service.preview({ ...request(h, 'hellwal', ['light']), darkOffset }, new Uint8Array([1])), 'invalid_parameters')
    expect(await loggedArgv(h)).toEqual([])
  })

  it('rejects a binary changed after detection without spawning it', async () => {
    const h = await harness()
    const selected = h.detections.generators.matugen
    if (selected.kind !== 'available') throw new Error('fixture unavailable')
    await writeFile(selected.executablePath, `${await readFile(selected.executablePath, 'utf8')}\n// changed`)
    await expectCode(h.service.preview(request(h, 'matugen', ['light']), new Uint8Array([1])), 'detection_stale')
    expect(await loggedArgv(h)).toEqual([])
  })

  it.each([
    ['nonzero', 'non_zero_exit'], ['malformed', 'invalid_output'], ['contrast', 'contrast_failed'],
  ])('maps %s failures to %s and removes its controlled stage', async (behavior, code) => {
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('openalice-theme-generator-')))
    const h = await harness(behavior)
    await expectCode(h.service.preview(request(h, 'matugen', ['light']), new Uint8Array([1])), code)
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith('openalice-theme-generator-') && !before.has(name))
    expect(after).toEqual([])
  })

  it('cancels an in-flight generator and removes its controlled stage', async () => {
    const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith('openalice-theme-generator-')))
    const h = await harness('wait')
    const controller = new AbortController()
    const preview = h.service.preview(request(h, 'hellwal', ['dark']), new Uint8Array([1]), controller.signal)
    while ((await loggedArgv(h)).length === 0) await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    await expectCode(preview, 'cancelled')
    const after = (await readdir(tmpdir())).filter((name) => name.startsWith('openalice-theme-generator-') && !before.has(name))
    expect(after).toEqual([])
  })

  it('reports cleanup failure after otherwise successful generation', async () => {
    const h = await harness()
    const service = new ThemeGeneratorService({
      manager: h.manager,
      env: h.env,
      createStage: async () => {
        const stage = await createControlledStage()
        return {
          ...stage,
          cleanup: async () => {
            await stage.cleanup()
            throw new Error('controlled cleanup failure')
          },
        }
      },
    })
    const error = await expectCode(
      service.preview(request(h, 'hellwal', ['light']), new Uint8Array([1])),
      'staging_cleanup_failed',
    )
    expect(error.diagnostics).toEqual(['cleanup: Error: controlled cleanup failure'])
  })

  it('reports cleanup failure together with the primary generation failure', async () => {
    const h = await harness('nonzero')
    const service = new ThemeGeneratorService({
      manager: h.manager,
      env: h.env,
      createStage: async () => {
        const stage = await createControlledStage()
        return {
          ...stage,
          cleanup: async () => {
            await stage.cleanup()
            throw new Error('controlled cleanup failure')
          },
        }
      },
    })
    const error = await expectCode(
      service.preview(request(h, 'matugen', ['light']), new Uint8Array([1])),
      'staging_cleanup_failed',
    )
    expect(error.diagnostics).toEqual([
      'cleanup: Error: controlled cleanup failure',
      expect.stringContaining('generation: ThemeGenerationError: non_zero_exit'),
    ])
    expect(error.process).toEqual({ kind: 'nonzero', exitCode: 7, signal: null })
  })
})
