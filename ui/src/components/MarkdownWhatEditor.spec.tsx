// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { MarkdownWhatEditor } from './MarkdownWhatEditor'

Object.defineProperties(Range.prototype, {
  getClientRects: {
    configurable: true,
    value: () => [],
  },
  getBoundingClientRect: {
    configurable: true,
    value: () => new DOMRect(),
  },
})

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MarkdownWhatEditor', () => {
  it.each([
    ['en', 'Issue description', 'Describe what this Issue should accomplish…'],
    ['zh', '议题内容', '描述这个议题需要完成什么…'],
    ['zh-Hant', '議題內容', '描述這個議題需要完成什麼…'],
    ['ja', '課題の内容', 'この課題で達成する内容を記述…'],
  ] as const)('localizes its editable surface in %s', async (locale, label, placeholder) => {
    await i18n.changeLanguage(locale)
    const { container } = render(
      <MarkdownWhatEditor value="Initial description" onSave={vi.fn(async () => true)} />,
    )

    const editor = await waitFor(() => {
      const element = container.querySelector('[contenteditable="true"]')
      expect(element?.getAttribute('aria-label')).toBe(label)
      expect(element?.getAttribute('data-placeholder')).toBe(placeholder)
      return element as HTMLElement
    })
    const shell = container.querySelector('.what-editor-shell') as HTMLElement

    expect(shell.className).toContain('cursor-text')
    expect(container.querySelector('[aria-live="polite"]')?.className).toContain('sticky')
    fireEvent.click(shell)
    await waitFor(() => {
      expect(document.activeElement).toBe(editor)
      expect(editor?.getAttribute('aria-label')).toBe(label)
    })
  })

  it('keeps localized save feedback visible above a long editable body', async () => {
    await i18n.changeLanguage('zh')
    const onSave = vi.fn(async () => true)
    const { container, getByText } = render(
      <MarkdownWhatEditor value="Initial description" onSave={onSave} />,
    )
    const editor = await waitFor(() => {
      const element = container.querySelector('[contenteditable="true"]')
      expect(element).toBeTruthy()
      return element as HTMLElement
    })

    editor.textContent = '更新后的描述'
    fireEvent.input(editor)

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('更新后的描述'), { timeout: 2_000 })
    expect(getByText('已保存')).toBeTruthy()
  })
})
