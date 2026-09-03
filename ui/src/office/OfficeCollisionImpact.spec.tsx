// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { OfficeCollisionImpact, officeCollisionImpactPosition } from './OfficeCollisionImpact'

describe('OfficeCollisionImpact', () => {
  it('places the effect between Alice and the blocked tile', () => {
    expect(officeCollisionImpactPosition(
      { x: 480, y: 264 },
      { x: 0, y: -24, direction: 'up' },
    )).toEqual({ x: 480, y: 234, direction: 'up' })
    expect(officeCollisionImpactPosition(
      { x: 480, y: 264 },
      { x: 24, y: 0, direction: 'right' },
    )).toEqual({ x: 510, y: 264, direction: 'right' })
    expect(officeCollisionImpactPosition(
      { x: 480, y: 648 },
      { x: 0, y: 24, direction: 'down' },
      { width: 960, height: 672 },
    )).toEqual({ x: 480, y: 660, direction: 'down' })
  })

  it('renders the generated sheet with direction and reduced-motion state', () => {
    render(<OfficeCollisionImpact
      impact={{ serial: 3, x: 510, y: 264, direction: 'right' }}
      reducedMotion
      zIndex={500}
    />)

    const effect = screen.getByTestId('office-collision-impact')
    expect(effect.getAttribute('aria-hidden')).toBe('true')
    expect(effect.dataset.serial).toBe('3')
    expect(effect.dataset.reducedMotion).toBe('true')
    expect(effect.style.left).toBe('510px')
    expect(effect.style.getPropertyValue('--office-impact-rotation')).toBe('90deg')
    expect(effect.querySelector<HTMLElement>('span')?.style.backgroundImage)
      .toContain('/office/furniture/collision-impact-v1.png')
  })
})
