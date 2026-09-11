// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { OfficeShiftHarvestMeter } from './OfficeShiftHarvestMeter'

describe('OfficeShiftHarvestMeter', () => {
  it('renders only the real frozen slots and distinguishes completed, current, and pending work', () => {
    const { container } = render(
      <OfficeShiftHarvestMeter
        total={3}
        completed={1}
        state="active"
        variant="hud"
      />,
    )

    const meter = container.querySelector<HTMLElement>(
      '[data-testid="office-shift-harvest-hud"]',
    )!
    const slots = Array.from(container.querySelectorAll<HTMLElement>(
      '.oa-office-shift-harvest__slot',
    ))
    expect(meter.getAttribute('aria-hidden')).toBe('true')
    expect(meter.dataset.total).toBe('3')
    expect(meter.dataset.completed).toBe('1')
    expect(slots.map((slot) => slot.dataset.slotState)).toEqual([
      'completed',
      'current',
      'pending',
    ])
  })

  it('caps malformed counts without inventing slots for an empty shift', () => {
    const view = render(
      <OfficeShiftHarvestMeter
        total={8}
        completed={12}
        state="clear"
        variant="board"
      />,
    )

    const meter = view.container.querySelector<HTMLElement>(
      '[data-testid="office-shift-harvest-board"]',
    )!
    expect(meter.dataset.total).toBe('4')
    expect(meter.dataset.completed).toBe('4')
    expect(view.container.querySelectorAll('.oa-office-shift-harvest__slot')).toHaveLength(4)

    view.rerender(
      <OfficeShiftHarvestMeter
        total={0}
        completed={0}
        state="quiet"
        variant="board"
      />,
    )
    expect(view.container.querySelector('[data-testid="office-shift-harvest-board"]')).toBeNull()
  })

  it('marks only the newest completed slot for the acknowledgement animation', () => {
    const { container } = render(
      <OfficeShiftHarvestMeter
        total={4}
        completed={2}
        state="active"
        acknowledgementToken={7}
        variant="board"
      />,
    )

    const acknowledged = container.querySelectorAll(
      '.oa-office-shift-harvest__slot[data-acknowledged="true"]',
    )
    expect(acknowledged).toHaveLength(1)
    expect(acknowledged[0]?.getAttribute('data-slot-state')).toBe('completed')
  })

  it('exposes unknown source state and a static reduced-motion contract', () => {
    const { container } = render(
      <OfficeShiftHarvestMeter
        total={2}
        completed={1}
        state="degraded"
        reducedMotion
        variant="hud"
      />,
    )

    expect(container.querySelector<HTMLElement>(
      '[data-testid="office-shift-harvest-hud"]',
    )?.dataset.reducedMotion).toBe('true')
    expect(Array.from(container.querySelectorAll<HTMLElement>(
      '.oa-office-shift-harvest__slot',
    )).map((slot) => slot.dataset.slotState)).toEqual(['completed', 'unknown'])
  })
})
