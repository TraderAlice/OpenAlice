// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer } from './ChatComposer'

afterEach(cleanup)

describe('ChatComposer IME Enter safety', () => {
  it('submits on plain Enter but ignores Shift+Enter and IME composition (isComposing and keyCode 229)', () => {
    const onSubmit = vi.fn()
    render(
      <ChatComposer
        value="分析持仓"
        onChange={vi.fn()}
        onSubmit={onSubmit}
        placeholder="Ask Alice…"
        canSend
      />,
    )

    const textarea = screen.getByRole('textbox', { name: 'Ask Alice…' })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: false, keyCode: 13 })
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})
