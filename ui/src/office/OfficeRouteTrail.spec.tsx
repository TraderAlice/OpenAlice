// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { OfficeInteractionPathStep } from './interaction-path'
import { OfficeRouteTrail, visibleOfficeRouteSteps } from './OfficeRouteTrail'

const steps: OfficeInteractionPathStep[] = [
  { x: 24, y: 48, direction: 'up' },
  { x: 24, y: 24, direction: 'up' },
  { x: 48, y: 24, direction: 'right' },
  { x: 72, y: 24, direction: 'right' },
]

describe('OfficeRouteTrail', () => {
  it('keeps route endpoints and turns while thinning long straight runs', () => {
    expect(visibleOfficeRouteSteps(steps)).toEqual([
      steps[0],
      steps[1],
      steps[2],
      steps[3],
    ])
    expect(visibleOfficeRouteSteps([
      { x: 24, y: 120, direction: 'up' },
      { x: 24, y: 96, direction: 'up' },
      { x: 24, y: 72, direction: 'up' },
      { x: 24, y: 48, direction: 'up' },
      { x: 24, y: 24, direction: 'up' },
    ])).toHaveLength(3)
  })

  it('renders generated directional floor inlays and marks the destination', () => {
    render(<OfficeRouteTrail steps={steps} />)

    const trail = screen.getByTestId('office-route-trail')
    expect(trail.getAttribute('aria-hidden')).toBe('true')
    const markers = trail.querySelectorAll<HTMLElement>('.oa-office-route-trail__step')
    expect(markers).toHaveLength(4)
    expect(markers[0].style.getPropertyValue('--office-route-rotation')).toBe('0deg')
    expect(markers[2].style.getPropertyValue('--office-route-rotation')).toBe('90deg')
    expect(markers[3].dataset.destination).toBe('true')
    expect(markers[3].querySelector('img')?.getAttribute('src'))
      .toBe('/office/furniture/route-chevron-v1.png')
  })
})
