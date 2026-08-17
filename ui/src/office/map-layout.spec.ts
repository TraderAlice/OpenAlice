import { describe, expect, it } from 'vitest'

import {
  OFFICE_MAP_TILE,
  layoutOfficeMap,
  type OfficeMapLayoutInput,
} from './map-layout'

function inputs(count: number): OfficeMapLayoutInput[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `workspace-${index}`,
    harness: index % 3 === 0 ? 'chat' : index % 3 === 1 ? 'auto-quant' : 'other',
  }))
}

function expectValidGeometry(count: number) {
  const layout = layoutOfficeMap(inputs(count))
  expect(layout.pods).toHaveLength(count)
  expect(layout.width / layout.height).toBeGreaterThan(0.9)
  expect(layout.width / layout.height).toBeLessThan(1.8)
  expect(layout.alice.x % OFFICE_MAP_TILE).toBe(0)
  expect(layout.alice.y % OFFICE_MAP_TILE).toBe(0)
  for (const pod of layout.pods) {
    expect(pod.x % OFFICE_MAP_TILE).toBe(0)
    expect(pod.y % OFFICE_MAP_TILE).toBe(0)
    expect(pod.x + pod.width).toBeLessThanOrEqual(layout.width)
    expect(pod.y + pod.height).toBeLessThanOrEqual(layout.height)
  }
  for (let left = 0; left < layout.pods.length; left += 1) {
    for (let right = left + 1; right < layout.pods.length; right += 1) {
      const a = layout.pods[left]!
      const b = layout.pods[right]!
      const separated = a.x + a.width <= b.x
        || b.x + b.width <= a.x
        || a.y + a.height <= b.y
        || b.y + b.height <= a.y
      expect(separated, `${a.id} overlaps ${b.id}`).toBe(true)
    }
  }
  expect(layout.pods.every((pod) =>
    layout.alice.x < pod.x
    || layout.alice.x > pod.x + pod.width
    || layout.alice.y < pod.y
    || layout.alice.y > pod.y + pod.height,
  )).toBe(true)
  return layout
}

describe('layoutOfficeMap', () => {
  it.each([1, 2, 5, 17])('packs %i Workspace pods into a bounded 2D tilemap', (count) => {
    expectValidGeometry(count)
  })

  it('keeps the default Chat and AutoQuant pair inside one 4:3 frame', () => {
    const layout = expectValidGeometry(2)
    expect(layout.columns).toBe(2)
    expect(layout.rows).toBe(1)
    expect(layout.width).toBe(960)
    expect(layout.height).toBe(672)
    expect(layout.pods[0]?.x).not.toBe(layout.pods[1]?.x)
    expect(layout.pods[0]?.y).toBe(layout.pods[1]?.y)
  })

  it('keeps dense maps close to the 4:3 game viewport', () => {
    const layout = expectValidGeometry(17)
    expect(Math.abs(layout.width / layout.height - 4 / 3)).toBeLessThan(0.3)
  })
})
