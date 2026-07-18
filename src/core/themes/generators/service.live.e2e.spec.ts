import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ThemeGenerationError, ThemeGeneratorService } from './service.js'

const live = process.env['OPENALICE_THEME_GENERATORS_LIVE'] === '1' ? describe : describe.skip
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAABFElEQVR4nNXYIUplcRiG8ec8yI0uwC3I2Ew3CxZBg7axTDBajCZ3cMGm3R2YDe5gGNA4TBAsLsAwbuB/gihcnl98yznwwnk53/T485yR1eJlmD+/Lof50/XpMN/9cTbMH/7sDfON/fFzjy63hrnESZzESZzESZzETYu/b2v5fl/c/x7mn92ffAMSJ3ESJ3ESJ3HT/+2rtXy/v+v/QeIkTuIkTuIkTuKm418nifvPxcz+5BuQOImTOImTOImblpsnifvP08z+5BuQOImTOImTOImbDu9uE/efjZn9yTcgcRIncRIncRI37RysEvef1cz+5BuQOImTOImTOImb3v/dJO4/uzP7k29A4iRO4iRO4lz3C3zVB1EdYFCFXNbaAAAAAElFTkSuQmCC',
  'base64',
)

live('installed theme generators', () => {
  let home: string
  let service: ThemeGeneratorService

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'openalice-theme-generator-live-home-'))
    service = new ThemeGeneratorService({ env: { ...process.env, HOME: home } })
  })

  afterAll(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('detects actual Matugen capabilities and reproducibly generates two schemes in both modes', async () => {
    const snapshot = await service.availability(true)
    const detection = snapshot.generators.matugen
    expect(detection.kind).toBe('available')
    if (detection.kind !== 'available' || detection.capabilities.kind !== 'matugen') return
    expect(detection.executablePath).toMatch(/^\//)
    expect(detection.capabilities.schemes.length).toBeGreaterThanOrEqual(2)

    for (const scheme of detection.capabilities.schemes.slice(0, 2)) {
      const request = {
        generator: 'matugen' as const,
        detectionId: detection.detectionId,
        name: `Live ${scheme}`,
        modes: ['light', 'dark'] as const,
        scheme,
      }
      const first = await service.preview(request, image)
      const second = await service.preview(request, image)
      expect(second.id).toBe(first.id)
      expect(second.variants.light?.palette).toEqual(first.variants.light?.palette)
      expect(second.variants.dark?.palette).toEqual(first.variants.dark?.palette)
      expect(first.variants.light?.palette).not.toEqual(first.variants.dark?.palette)
      for (const mode of request.modes) {
        expect(first.variants[mode]?.provenance).toMatchObject({
          kind: 'generated', generator: 'matugen', executablePath: detection.executablePath,
          executableVersion: detection.version, imageSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          parameters: { mode, scheme }, mappingVersion: 1,
        })
      }
    }
  }, 30_000)

  it('generates Hellwal light/dark ANSI16 themes and observes offset changes without HOME residue', async () => {
    const snapshot = await service.availability()
    const detection = snapshot.generators.hellwal
    expect(detection.kind).toBe('available')
    if (detection.kind !== 'available') return

    const generate = (darkOffset: number, brightOffset: number, modes: ['light'] | ['dark']) => service.preview({
      generator: 'hellwal', detectionId: detection.detectionId, name: 'Live Hellwal',
      modes, darkOffset, brightOffset,
    }, image)
    const light = await generate(0.9, 0.9, ['light'])
    const baseline = await generate(0, 0.6, ['dark'])
    const shifted = await generate(0.3, 0.9, ['dark'])
    expect(light.variants.light?.ansi16Override?.colors).toHaveLength(16)
    expect(baseline.variants.dark?.ansi16Override?.colors).toHaveLength(16)
    expect(light.variants.light?.palette).not.toEqual(baseline.variants.dark?.palette)
    expect(shifted.variants.dark?.ansi16Override?.colors).not.toEqual(
      baseline.variants.dark?.ansi16Override?.colors,
    )
    expect(shifted.variants.dark?.provenance).toMatchObject({
      kind: 'generated', generator: 'hellwal', executablePath: detection.executablePath,
      executableVersion: detection.version,
      parameters: { mode: 'dark', darkOffset: 0.3, brightOffset: 0.9 }, mappingVersion: 1,
    })
    expect(await readdir(home)).toEqual([])
  }, 30_000)

  it('rejects an invalid offset against the live detection without generator residue', async () => {
    const snapshot = await service.availability()
    const detection = snapshot.generators.hellwal
    expect(detection.kind).toBe('available')
    if (detection.kind !== 'available') return
    const run = service.preview({
      generator: 'hellwal', detectionId: detection.detectionId, name: 'Rejected live Hellwal',
      modes: ['dark'], darkOffset: -0.1, brightOffset: 0.5,
    }, image)
    await expect(run).rejects.toMatchObject({ code: 'invalid_parameters' } satisfies Partial<ThemeGenerationError>)
    expect(await readdir(home)).toEqual([])
  })
})
