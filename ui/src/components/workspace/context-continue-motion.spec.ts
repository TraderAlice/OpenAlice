// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { clearDockDismissStyles, dockDismissTransform, prefersReducedMotion } from './context-continue-motion'

describe('context-continue dock motion', () => {
  it('aims the surface center at the affordance and keeps a readable shrink', () => {
    const motion = dockDismissTransform(
      { left: 100, top: 100, width: 400, height: 500 },
      { left: 900, top: 20, width: 80, height: 28 },
    )
    expect(motion.dx).toBeCloseTo(940 - 300)
    expect(motion.dy).toBeCloseTo(34 - 350)
    expect(motion.dx).toBeGreaterThan(0)
    expect(motion.dy).toBeLessThan(0)
    expect(motion.scale).toBeGreaterThan(0.05)
    expect(motion.scale).toBeLessThanOrEqual(0.18)
  })

  it('honors reduced-motion media', () => {
    expect(prefersReducedMotion({ matches: true })).toBe(true)
    expect(prefersReducedMotion({ matches: false })).toBe(false)
  })

  it('clears transform and opacity residue after a dock dismiss', () => {
    const surface = {
      style: {
        transform: 'translate(1px, 2px) scale(0.1)',
        opacity: '0',
        transformOrigin: 'center center',
        removeProperty(name: string) {
          Reflect.deleteProperty(this, name === 'transform-origin' ? 'transformOrigin' : name)
        },
      },
      getAnimations: () => [{ cancel: vi.fn() }],
    } as unknown as HTMLElement
    clearDockDismissStyles(surface)
    expect(surface.style.transform).toBeUndefined()
    expect(surface.style.opacity).toBeUndefined()
  })
})
