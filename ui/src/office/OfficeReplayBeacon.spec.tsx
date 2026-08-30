// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { OfficeInteractionTarget } from './interaction-targets'
import { OfficeReplayBeacon, officeReplayBeaconAvoidBounds } from './OfficeReplayBeacon'

describe('OfficeReplayBeacon', () => {
  it('marks a historical actor with readable event context', () => {
    const target: OfficeInteractionTarget = {
      id: 'employee:prediction-1:resume-scout',
      kind: 'employee',
      x: 360,
      y: 280,
      workspaceId: 'prediction-1',
      roomName: 'Prediction Lab',
      employee: {
        resumeId: 'resume-scout',
        agent: 'grok',
        name: 'g1',
        title: 'Market Scout',
        mood: 'idle',
        awake: false,
        bubble: null,
        lastSeq: 42,
        lastInteractionAt: 1,
        drawers: [],
      },
    }
    render(
      <OfficeReplayBeacon
        target={target}
        label="Market Scout"
        sequenceLabel="Seq 42"
        reducedMotion={false}
        zIndex={1480}
      />,
    )

    const beacon = screen.getByRole('status', { name: 'Seq 42 · Market Scout' })
    expect(beacon.style.left).toBe('360px')
    expect(beacon.style.top).toBe('278px')
    expect(beacon.style.zIndex).toBe('1480')
    expect(beacon.querySelector('img')?.getAttribute('src'))
      .toBe('/office/furniture/route-destination-v1.png')
    expect(officeReplayBeaconAvoidBounds(target)).toEqual({
      left: 148,
      top: 226,
      right: 352,
      bottom: 282,
    })
  })
})
