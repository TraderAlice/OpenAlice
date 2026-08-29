// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { OfficeInteractionTarget } from './interaction-targets'
import {
  OfficeRouteTargetPointer,
  officeRouteTargetPointerPosition,
} from './OfficeRouteTargetPointer'

const operationsTarget: OfficeInteractionTarget = {
  id: 'operations',
  kind: 'operations',
  x: 480,
  y: 204,
}

describe('OfficeRouteTargetPointer', () => {
  it('places one generated pointer above the active world target', () => {
    expect(officeRouteTargetPointerPosition(operationsTarget)).toEqual({ x: 480, y: 132 })

    const { unmount } = render(
      <OfficeRouteTargetPointer
        target={operationsTarget}
        reducedMotion={false}
        zIndex={1404}
      />,
    )

    const pointer = screen.getByTestId('office-route-target-pointer')
    expect(pointer.getAttribute('aria-hidden')).toBe('true')
    expect(pointer.dataset.kind).toBe('operations')
    expect(pointer.style.left).toBe('480px')
    expect(pointer.style.top).toBe('132px')
    expect(pointer.style.zIndex).toBe('1404')
    expect(pointer.querySelector('img')?.getAttribute('src'))
      .toBe('/office/furniture/route-destination-v1.png')
    unmount()
  })

  it('keeps the pointer still when reduced motion is active', () => {
    render(
      <OfficeRouteTargetPointer
        target={operationsTarget}
        reducedMotion
        zIndex={1404}
      />,
    )

    expect(screen.getByTestId('office-route-target-pointer').dataset.reducedMotion).toBe('true')
  })

  it('nudges right-edge furniture pointers inward without moving the target', () => {
    expect(officeRouteTargetPointerPosition({
      id: 'cabinet:office-1',
      kind: 'cabinet',
      x: 960,
      y: 500,
      workspaceId: 'office-1',
      roomName: 'Office 1',
    })).toEqual({ x: 952, y: 450 })

    expect(officeRouteTargetPointerPosition({
      id: 'floor-terminal',
      kind: 'floor-terminal',
      x: 880,
      y: 164,
    })).toEqual({ x: 880, y: 102 })
  })
})
