// @vitest-environment jsdom

import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ModelCombobox } from './PresetFields'

afterEach(cleanup)

const suggestions = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (flagship)' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (fast / economical)' },
]

describe('ModelCombobox', () => {
  it('shows every provider suggestion even when the current model is an exact match', async () => {
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

    await userEvent.click(screen.getByRole('combobox', { name: 'Model' }))

    expect(screen.getByRole('option', { name: /DeepSeek V4 Pro/ })).toBeTruthy()
    const flash = screen.getByRole('option', { name: /DeepSeek V4 Flash/ })
    expect(flash).toBeTruthy()
    fireEvent.click(flash)
    expect(onChange).toHaveBeenCalledWith('deepseek-v4-flash')
  })

  it('keeps free-typed model ids and supports keyboard selection', async () => {
    const onChange = vi.fn()
    function ModelForm() {
      const [value, setValue] = useState('')
      return <ModelCombobox value={value} suggestions={suggestions} onChange={(model) => { setValue(model); onChange(model) }} ariaLabel="Model" suggestionsLabel="Model suggestions" />
    }
    render(<ModelForm />)
    const input = screen.getByRole('combobox', { name: 'Model' })

    await userEvent.type(input, 'deepseek-v4-pro-private')
    expect(onChange).toHaveBeenLastCalledWith('deepseek-v4-pro-private')

    await userEvent.click(screen.getByRole('button', { name: 'Model suggestions' }))
    await userEvent.click(await screen.findByRole('option', { name: /DeepSeek V4 Pro/ }))

    await userEvent.clear(input)
    await userEvent.type(input, 'flash')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('deepseek-v4-flash')
  })
})
