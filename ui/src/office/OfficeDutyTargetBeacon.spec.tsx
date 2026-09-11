// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { OfficeInteractionTarget } from './interaction-targets'
import { OfficeDutyTargetBeacon } from './OfficeDutyTargetBeacon'

const inboxTarget: OfficeInteractionTarget = {
  id: 'inbox-service',
  kind: 'inbox-service',
  x: 720,
  y: 260,
}

describe('OfficeDutyTargetBeacon', () => {
  it('marks the current duty target with the generated route destination asset', () => {
    const { unmount } = render(
      <OfficeDutyTargetBeacon
        target={inboxTarget}
        reducedMotion={false}
        zIndex={1460}
      />,
    )

    const beacon = screen.getByTestId('office-duty-target-beacon')
    expect(beacon.classList.contains('oa-office-duty-target-beacon')).toBe(true)
    expect(beacon.getAttribute('aria-hidden')).toBe('true')
    expect(beacon.dataset.kind).toBe('inbox-service')
    expect(beacon.dataset.reducedMotion).toBeUndefined()
    expect(beacon.style.left).toBe('720px')
    expect(beacon.style.top).toBe('202px')
    expect(beacon.style.zIndex).toBe('1460')
    expect(beacon.querySelector('img')?.getAttribute('src'))
      .toBe('/office/furniture/route-destination-v1.png')
    unmount()
  })

  it('exposes the reduced-motion state without changing target placement', () => {
    render(
      <OfficeDutyTargetBeacon
        target={inboxTarget}
        reducedMotion
        zIndex={1460}
      />,
    )

    const beacon = screen.getByTestId('office-duty-target-beacon')
    expect(beacon.dataset.reducedMotion).toBe('true')
    expect(beacon.style.left).toBe('720px')
    expect(beacon.style.top).toBe('202px')
  })
})
