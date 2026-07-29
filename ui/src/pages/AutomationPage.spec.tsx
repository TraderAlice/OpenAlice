// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { AutomationPage } from './AutomationPage'

vi.mock('./AutomationApiSection', () => ({
  AutomationApiSection: () => <div>API content</div>,
}))

vi.mock('./AutomationRunsSection', () => ({
  AutomationRunsSection: () => <div>Runs content</div>,
}))

beforeEach(async () => {
  await i18n.changeLanguage('zh')
})

afterEach(cleanup)

describe('AutomationPage localization', () => {
  it('localizes the Runs header and description', () => {
    render(<AutomationPage spec={{ kind: 'automation', params: { section: 'runs' } }} />)

    expect(screen.getByRole('heading', { name: '运行' })).toBeTruthy()
    expect(screen.getByText('查看跨工作区的无头 Agent 运行及工作进度。')).toBeTruthy()
  })

  it('localizes the API header description', () => {
    render(<AutomationPage spec={{ kind: 'automation', params: { section: 'api' } }} />)

    expect(screen.getByRole('heading', { name: 'API' })).toBeTruthy()
    expect(screen.getByText('从外部触发工作区自动化，并查看调度文件格式。')).toBeTruthy()
  })
})
