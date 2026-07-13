import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SegmentedControl } from './SegmentedControl'

afterEach(cleanup)

describe('SegmentedControl', () => {
  it('exposes the active option and reports a new selection', () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        value="24h"
        options={[
          { value: '1h', label: '1H' },
          { value: '24h', label: '24H' },
        ]}
        onChange={onChange}
        ariaLabel="Time range"
      />,
    )

    expect(screen.getByRole('group', { name: 'Time range' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '24H' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '1H' }).getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: '1H' }))
    expect(onChange).toHaveBeenCalledWith('1h')
  })
})
