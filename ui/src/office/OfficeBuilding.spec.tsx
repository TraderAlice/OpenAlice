// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { OfficeBuilding } from './OfficeBuilding'

afterEach(cleanup)

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

describe('OfficeBuilding', () => {
  it('places every office bay on one floor', () => {
    render(
      <OfficeBuilding
        building={{
          lastSeq: 1,
          firstSeq: 1,
          offices: [
            { workspace: { id: 'chat-1', tag: 'chat' }, employees: [] },
            { workspace: { id: 'quant-1', tag: 'auto-quant' }, employees: [] },
          ],
        }}
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenFiles={vi.fn()}
      />,
    )
    expect(screen.getByTestId('office-building')).toBeTruthy()
    expect(screen.getByTestId('office-wall')).toBeTruthy()
    expect(screen.getByTestId('office-floor')).toBeTruthy()
    expect(screen.getByTestId('office-partition')).toBeTruthy()
    expect(screen.getByTestId('office-room-chat-1')).toBeTruthy()
    expect(screen.getByTestId('office-room-quant-1')).toBeTruthy()
    expect(screen.getByText('Coffee')).toBeTruthy()
  })
})
