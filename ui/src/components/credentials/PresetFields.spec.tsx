// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ModelCombobox } from './PresetFields'

afterEach(cleanup)

const suggestions = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (flagship)' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (fast / economical)' },
]

describe('ModelCombobox', () => {
  it('shows every provider suggestion even when the current model is an exact match', () => {
    const onChange = vi.fn()
    render(
      <ModelCombobox
        value="deepseek-v4-pro"
        suggestions={suggestions}
        onChange={onChange}
        ariaLabel="Model"
        suggestionsLabel="Model suggestions"
      />,
    )

    fireEvent.focus(screen.getByRole('combobox', { name: 'Model' }))

    expect(screen.getByRole('option', { name: /deepseek-v4-pro/ })).toBeTruthy()
    const flash = screen.getByRole('option', { name: /deepseek-v4-flash/ })
    expect(flash).toBeTruthy()
    fireEvent.click(flash)
    expect(onChange).toHaveBeenCalledWith('deepseek-v4-flash')
  })

  it('keeps free-typed model ids and supports keyboard selection', () => {
    const onChange = vi.fn()
    render(
      <ModelCombobox
        value=""
        suggestions={suggestions}
        onChange={onChange}
        ariaLabel="Model"
        suggestionsLabel="Model suggestions"
      />,
    )
    const input = screen.getByRole('combobox', { name: 'Model' })

    fireEvent.change(input, { target: { value: 'private-model' } })
    expect(onChange).toHaveBeenCalledWith('private-model')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('deepseek-v4-flash')
  })
})
