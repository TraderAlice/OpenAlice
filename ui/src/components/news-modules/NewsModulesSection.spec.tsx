// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api, type ModuleStatus } from '../../api'
import { i18n } from '../../i18n'
import { NewsModulesSection, RssHubKeySection } from './NewsModulesSection'

const module: ModuleStatus = {
  moduleId: 'example', contentHash: 'a'.repeat(64), installed: true, approved: false,
  desiredEnabled: false, loaded: false, loadedHash: null, state: 'unapproved', lastError: null,
  manifest: { abiVersion: 1, moduleId: 'example', version: '1', name: 'Example module', description: '', entry: 'index.js',
    sources: [{ key: 'news', name: 'Example news', parameters: [] }] },
}
const props = { selections: [], subscriptions: [], onSelectionsChange: vi.fn(), onSubscriptionsChange: vi.fn(), collectorEnabled: true, saveStatus: 'idle' as const }
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

it('validates an empty RSSHub key with a described error and preserves focus during save', async () => {
  vi.spyOn(api.news, 'getRssHubKeyStatus').mockResolvedValue({ available: true, configured: false, baseUrl: null })
  let finish!: (value: { available: boolean; configured: boolean; baseUrl: null }) => void
  const save = vi.spyOn(api.news, 'updateRssHubKey').mockReturnValue(new Promise(resolve => { finish = resolve }))
  render(<RssHubKeySection />)
  const input = screen.getByLabelText(i18n.t('newsModules.keyInput'))
  fireEvent.submit(input.closest('form')!)
  expect(input.getAttribute('aria-invalid')).toBe('true')
  await waitFor(() => expect(document.activeElement).toBe(input))
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Enter a key.')
  expect(save).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: 'demo-only-value' } })
  const button = screen.getByRole('button', { name: 'Save key' })
  button.focus()
  fireEvent.click(button)
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(document.activeElement).toBe(button)
  fireEvent.click(button)
  expect(save).toHaveBeenCalledOnce()
  await act(async () => finish({ available: true, configured: true, baseUrl: null }))
  expect(screen.getByText('Key saved.')).toBeTruthy()
})

it('pauses automatic module status updates while retaining manual refresh', async () => {
  vi.useFakeTimers()
  const list = vi.spyOn(api.news, 'getModules').mockResolvedValue({ modules: [] })
  const view = render(<NewsModulesSection {...props} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  view.rerender(<NewsModulesSection {...props} autoRefresh={false} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(list).toHaveBeenCalledOnce()
  view.rerender(<NewsModulesSection {...props} autoRefresh={false} refreshToken={1} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(list).toHaveBeenCalledTimes(2)
  view.rerender(<NewsModulesSection {...props} autoRefresh />)
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
  expect(list).toHaveBeenCalledTimes(4)
})

it('links approval errors to the hash field and focuses it without approving', async () => {
  vi.spyOn(api.news, 'getModules').mockResolvedValue({ modules: [module] })
  const approve = vi.spyOn(api.news, 'approveModule')
  render(<NewsModulesSection {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('newsModules.approve') }))
  fireEvent.click(screen.getByRole('button', { name: i18n.t('newsModules.approveHash') }))
  const input = screen.getByLabelText(i18n.t('newsModules.approvalPrompt'))
  await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'))
  await waitFor(() => expect(document.activeElement).toBe(input))
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(i18n.t('newsModules.approvalMismatch'))
  expect(approve).not.toHaveBeenCalled()
})

it('links category validation to the subscription field and focuses it', async () => {
  vi.spyOn(api.news, 'getModules').mockResolvedValue({ modules: [{ ...module, approved: true }] })
  render(<NewsModulesSection {...props} selections={[{ moduleId: 'example', contentHash: module.contentHash, enabled: false }]} />)
  await screen.findByRole('heading', { name: 'Example module' })
  fireEvent.click(screen.getByRole('button', { name: i18n.t('newsModules.addSubscription') }))
  const input = screen.getByLabelText(i18n.t('newsModules.categories'))
  fireEvent.change(input, { target: { value: 'x'.repeat(81) } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(input.getAttribute('aria-invalid')).toBe('true')
  await waitFor(() => expect(document.activeElement).toBe(input))
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe(i18n.t('newsModules.categoriesInvalid'))
  expect(props.onSubscriptionsChange).not.toHaveBeenCalled()
  const name = screen.getByLabelText(i18n.t('newsModules.subscriptionName'))
  fireEvent.change(name, { target: { value: '   ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(name.getAttribute('aria-invalid')).toBe('true')
  await waitFor(() => expect(document.activeElement).toBe(name))
  expect(document.getElementById(name.getAttribute('aria-describedby')!)?.textContent).toBe('Enter a value.')
})
