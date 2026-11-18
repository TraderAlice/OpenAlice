// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CRYPTO_GUARD_TYPES, GuardsSection, type GuardEntry } from './guards'

afterEach(cleanup)

function renderGuards(guards: GuardEntry[]) {
  const onChangeImmediate = vi.fn()
  render(
    <GuardsSection
      guards={guards}
      guardTypes={CRYPTO_GUARD_TYPES}
      description="test"
      onChange={vi.fn()}
      onChangeImmediate={onChangeImmediate}
    />,
  )
  return { onChangeImmediate }
}

describe('GuardsSection', () => {
  it('does not offer the removed max-leverage guard', () => {
    renderGuards([])
    fireEvent.click(screen.getByText('+ Add Guard'))

    expect(screen.queryByText('Max Leverage')).toBeNull()
    expect(screen.getByText('Cooldown')).toBeTruthy()
  })

  it('flags a saved non-built-in guard type and lets the user remove it', () => {
    const saved: GuardEntry = { type: 'max-leverage', options: { maxLeverage: 10 } }
    const { onChangeImmediate } = renderGuards([saved])

    expect(screen.getByText(/Not a built-in guard/)).toBeTruthy()

    fireEvent.click(screen.getByTitle('Remove'))
    expect(onChangeImmediate).toHaveBeenCalledWith([])
  })

  it('shows supported guards with their summary and no unsupported warning', () => {
    renderGuards([{ type: 'cooldown', options: { minIntervalMs: 30000 } }])

    expect(screen.getByText('Cooldown')).toBeTruthy()
    expect(screen.getByText('30s')).toBeTruthy()
    expect(screen.queryByText(/Not a built-in guard/)).toBeNull()
  })
})
