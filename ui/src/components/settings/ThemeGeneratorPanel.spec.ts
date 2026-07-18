import { describe, expect, it } from 'vitest'

import type { ThemeGeneratorDetection } from '../../api/themes'
import { buildGenerationRequest } from './ThemeGeneratorPanel'

const matugen: ThemeGeneratorDetection = {
  kind: 'available', generator: 'matugen', detectionId: 'matugen-snapshot',
  executablePath: '/path with spaces/matugen', version: '4.1.0', binarySha256: 'abc',
  capabilities: { kind: 'matugen', dryRunJson: true, modes: ['light', 'dark'], schemes: ['tonal-spot', 'vibrant'] },
}
const hellwal: ThemeGeneratorDetection = {
  kind: 'available', generator: 'hellwal', detectionId: 'hellwal-snapshot',
  executablePath: '/opt/homebrew/bin/hellwal', version: '1.0.7', binarySha256: 'def',
  capabilities: { kind: 'hellwal', json: true, noCache: true, skipTermColors: true, modes: ['light', 'dark'], offsets: ['dark', 'bright'] },
}

describe('ThemeGeneratorPanel request state', () => {
  it('constructs a canonical Matugen request from retained fields', () => {
    expect(buildGenerationRequest({
      generator: 'matugen', name: '  Photo theme  ', light: true, dark: true,
      scheme: 'vibrant', darkOffset: 'invalid-but-irrelevant', brightOffset: '',
    }, matugen)).toEqual({
      kind: 'valid',
      request: {
        generator: 'matugen', detectionId: 'matugen-snapshot', name: 'Photo theme',
        modes: ['light', 'dark'], scheme: 'vibrant',
      },
    })
  })

  it('constructs Hellwal single-mode requests and preserves exact offsets', () => {
    expect(buildGenerationRequest({
      generator: 'hellwal', name: 'Wal', light: false, dark: true,
      scheme: '', darkOffset: '0.25', brightOffset: '1',
    }, hellwal)).toEqual({
      kind: 'valid',
      request: {
        generator: 'hellwal', detectionId: 'hellwal-snapshot', name: 'Wal',
        modes: ['dark'], darkOffset: 0.25, brightOffset: 1,
      },
    })
  })

  it.each(['', 'NaN', '-0.01', '1.01', 'Infinity'])('rejects invalid Hellwal offset %j before API invocation', (offset) => {
    expect(buildGenerationRequest({
      generator: 'hellwal', name: 'Wal', light: true, dark: false,
      scheme: '', darkOffset: offset, brightOffset: '0',
    }, hellwal)).toEqual({ kind: 'invalid', field: 'offset' })
  })

  it('rejects empty names, empty modes, unsupported schemes, and stale generator selection', () => {
    const base = { generator: 'matugen' as const, name: 'Theme', light: true, dark: false, scheme: 'tonal-spot', darkOffset: '0', brightOffset: '0' }
    expect(buildGenerationRequest({ ...base, name: ' ' }, matugen)).toEqual({ kind: 'invalid', field: 'name' })
    expect(buildGenerationRequest({ ...base, light: false }, matugen)).toEqual({ kind: 'invalid', field: 'modes' })
    expect(buildGenerationRequest({ ...base, scheme: 'smart' }, matugen)).toEqual({ kind: 'invalid', field: 'scheme' })
    expect(buildGenerationRequest(base, { kind: 'unavailable', generator: 'matugen', reason: 'not-on-path' })).toEqual({ kind: 'invalid', field: 'generator' })
    expect(buildGenerationRequest(base, hellwal)).toEqual({ kind: 'invalid', field: 'generator' })
  })
})
