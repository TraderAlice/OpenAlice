import { describe, expect, it } from 'vitest'

import { OFFICE_POD_GAP, OFFICE_POD_HEIGHT, OFFICE_POD_WIDTH, layoutOfficeMap } from './map-layout'
import { officeServiceLandmarks } from './map-landmarks'

function layout(count: number) {
  return layoutOfficeMap(Array.from({ length: count }, (_, index) => ({
    id: `workspace-${index}`,
    harness: 'chat' as const,
  })))
}

describe('Office service landmarks', () => {
  it('retains the lower service edge for a one-row floor', () => {
    const floor = layout(2)
    const services = officeServiceLandmarks(floor)

    expect(floor).toMatchObject({ columns: 2, rows: 1 })
    expect(services.map((service) => service.id)).toEqual(['mail-service', 'archive-service'])
    expect(services.every((service) => service.y + service.height < floor.height)).toBe(true)
  })

  it('centers a service bay in the first empty cell of a partial final row', () => {
    const floor = layout(3)
    const services = officeServiceLandmarks(floor)
    const emptyCellX = floor.pods[0]!.x + OFFICE_POD_WIDTH + OFFICE_POD_GAP
    const finalRowY = floor.pods.at(-1)!.y

    expect(floor).toMatchObject({ columns: 2, rows: 2 })
    expect(services).toHaveLength(2)
    expect(services[0]).toMatchObject({ x: emptyCellX + 14, y: finalRowY + 72 })
    expect(services[1]).toMatchObject({ x: emptyCellX + 154, y: finalRowY + 72 })
    expect(services[1]!.x + services[1]!.width).toBe(emptyCellX + OFFICE_POD_WIDTH - 14)
    expect(services.every((service) => service.y + service.height < finalRowY + OFFICE_POD_HEIGHT)).toBe(true)
  })

  it('adds nothing when the final row is complete', () => {
    expect(officeServiceLandmarks(layout(4))).toEqual([])
  })
})
