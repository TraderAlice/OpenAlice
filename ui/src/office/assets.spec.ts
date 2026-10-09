import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { OFFICE_FURNITURE } from './furniture'
import { OFFICE_HUD_ASSETS } from './hud-assets'
import { OFFICE_LOG_ASSETS, officeLogAssetKind } from './log-assets'

const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../public')

// Follow the shipped manifests: changing a versioned filename should not need
// a matching test edit, while a missing file or incompatible image still fails.
function expectPng(url: string, dimensions?: readonly [number, number], colorType = 6) {
  const bytes = readFileSync(resolve(publicRoot, url.replace(/^\//, '')))
  expect([...bytes.subarray(0, 8)], url).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(bytes[25], `${url}: color type`).toBe(colorType)
  if (dimensions) {
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], `${url}: dimensions`)
      .toEqual(dimensions)
  }
}

describe('Office asset contracts', () => {
  it('ships furniture at the native dimensions used by the scene', () => {
    const dimensions = {
      workstation: [112, 84],
      vacantWorkstation: [112, 84],
      cabinet: [48, 96],
      emptyCabinet: [96, 88],
      terminal: [48, 72],
      plant: [64, 64],
      wallWindow: [204, 102],
      wallWindowNight: [204, 102],
      wallUtility: [204, 102],
      wallUtilityNight: [204, 102],
      buildingFoundation: [192, 192],
      floorEdgeBottom: [360, 24],
      floorEdgeSide: [24, 360],
      floorTile: [96, 96],
      workspaceRug: [264, 138],
      coffeeStation: [72, 72],
      serverRack: [48, 72],
      predictionConsole: [72, 88],
      personnelBoard: [48, 48],
      operationsBoard: [176, 132],
      workspaceSign: [264, 64],
      spawnInlay: [80, 80],
      routeFootsteps: [12, 12],
      routeDestination: [20, 20],
      collisionImpact: [96, 24],
      inboxTerminal: [136, 116],
      newsTerminal: [136, 116],
      servicePlacard: [80, 40],
    } satisfies Record<keyof typeof OFFICE_FURNITURE.generated, [number, number]>

    for (const key of Object.keys(dimensions) as (keyof typeof dimensions)[]) {
      expectPng(OFFICE_FURNITURE.generated[key], dimensions[key],
        key === 'floorTile' || key === 'buildingFoundation' ? 2 : 6)
    }
  })

  it('ships HUD controls at their native sizes with transparency', () => {
    for (const [name, url] of Object.entries(OFFICE_HUD_ASSETS)) {
      const size = name === 'movePad' ? 96 : name === 'actionButton' ? 72
        : ['journalCursor', 'replayLatch', 'replayVisitor'].includes(name) ? 32 : 48
      expectPng(url, [size, size])
    }
  })

  it('ships a transparent badge for every journal category', () => {
    for (const url of Object.values(OFFICE_LOG_ASSETS)) expectPng(url)
  })

  it('maps runtime event families to the appropriate journal category', () => {
    expect(officeLogAssetKind('session.born')).toBe('lifecycle')
    expect(officeLogAssetKind('runtime.started')).toBe('lifecycle')
    expect(officeLogAssetKind('runtime.stopped')).toBe('lifecycle')
    expect(officeLogAssetKind('runtime.turn.text')).toBe('message')
    expect(officeLogAssetKind('runtime.turn.tool')).toBe('tool')
    expect(officeLogAssetKind('runtime.turn.error')).toBe('alert')
    expect(officeLogAssetKind('runtime.spawn_failed')).toBe('alert')
    expect(officeLogAssetKind('runtime.rejected')).toBe('alert')
  })
})
