import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { OFFICE_FURNITURE } from './furniture'

const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10]
const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../public')

describe('OFFICE_FURNITURE', () => {
  it('ships every runtime prop as a native-size pixel PNG', () => {
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
      spawnCompass: [80, 80],
      routeFootsteps: [12, 12],
      routeDestination: [20, 20],
      collisionImpact: [96, 24],
      inboxTerminal: [136, 116],
      newsTerminal: [136, 116],
    } satisfies Record<keyof typeof OFFICE_FURNITURE.generated, [number, number]>

    for (const [key, url] of Object.entries(OFFICE_FURNITURE.generated)) {
      expect(url.endsWith('.png')).toBe(true)
      expect(url.includes('.jpg')).toBe(false)
      expect(url.includes('treadmill')).toBe(false)
      const file = resolve(publicRoot, url.replace(/^\//, ''))
      const bytes = readFileSync(file)
      expect([...bytes.subarray(0, 8)]).toEqual(PNG_MAGIC)
      expect(bytes.byteLength).toBeGreaterThan(
        key === 'routeFootsteps' || key === 'routeDestination' ? 100 : 1000,
      )
      expect(bytes.readUInt32BE(16)).toBe(dimensions[key as keyof typeof dimensions][0])
      expect(bytes.readUInt32BE(20)).toBe(dimensions[key as keyof typeof dimensions][1])
      expect(bytes[25]).toBe(
        key === 'floorTile' || key === 'buildingFoundation' ? 2 : 6,
      )
    }
  })
})
