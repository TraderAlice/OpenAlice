// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { QuickStartPage } from './QuickStartPage'
import '../i18n'

vi.mock('./ChatLandingPage', () => {
  const page = (name: string) => ({ spec, onPromptChange, showHeader }: {
    spec: { params: { initialPrompt?: string } }; onPromptChange: (value: string) => void; showHeader: boolean
  }) => <div>
    <span>{name} shared landing</span>
    <span>{showHeader ? 'Duplicate header' : 'Shared Quick Start header'}</span>
    <textarea aria-label={`${name} draft`} value={spec.params.initialPrompt} onChange={event => onPromptChange(event.target.value)} />
  </div>
  return { ChatLandingPage: page('Chat'), AutoQuantLandingPage: page('Auto Quant'), AutoPredictionLandingPage: page('Auto Prediction') }
})
afterEach(cleanup)

it('defaults to the shared Chat flow and keeps separate drafts when selecting Harnesses', async () => {
  const user = userEvent.setup()
  render(<QuickStartPage />)
  expect(screen.getByRole('heading', { name: 'Quick Start' })).toBeTruthy()
  expect(screen.queryByText('Duplicate header')).toBeNull()
  fireEvent.change(screen.getByRole('textbox', { name: 'Chat draft' }), { target: { value: 'Chat draft to keep' } })
  await user.click(screen.getByRole('button', { name: 'Choose Harness: Chat' }))
  await user.click(await screen.findByRole('menuitemradio', { name: 'Auto Quant' }))
  expect(screen.getByText('Auto Quant shared landing')).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: 'Auto Quant draft' }), { target: { value: 'Quant draft to keep' } })
  await user.click(screen.getByRole('button', { name: 'Choose Harness: Auto Quant' }))
  await user.click(await screen.findByRole('menuitemradio', { name: 'Auto Prediction' }))
  expect(screen.getByText('Auto Prediction shared landing')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Choose Harness: Auto Prediction' }))
  await user.click(await screen.findByRole('menuitemradio', { name: 'Chat' }))
  expect((screen.getByRole('textbox', { name: 'Chat draft' }) as HTMLTextAreaElement).value).toBe('Chat draft to keep')
  await user.click(screen.getByRole('button', { name: 'Choose Harness: Chat' }))
  await user.click(await screen.findByRole('menuitemradio', { name: 'Auto Quant' }))
  expect((screen.getByRole('textbox', { name: 'Auto Quant draft' }) as HTMLTextAreaElement).value).toBe('Quant draft to keep')
})
