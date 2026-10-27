import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../api'
import { i18n } from '../../i18n'
import { ModuleCredentials } from './ModuleCredentials'

const hash = 'a'.repeat(64)
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('validates an empty key on submit and focuses its described invalid field', async () => {
  vi.spyOn(api.news, 'getModuleCredentials').mockResolvedValue({ credentials: [{ key: 'apiKey', label: 'Provider key', configured: false, available: true }] })
  const save = vi.spyOn(api.news, 'updateModuleCredential')
  render(<ModuleCredentials hash={hash} />)
  const input = await screen.findByLabelText('Provider key')
  const button = screen.getByRole('button', { name: 'Save key' }) as HTMLButtonElement
  expect(button.disabled).toBe(false)
  fireEvent.submit(input.closest('form')!)
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('Enter a key.')
  await waitFor(() => expect(document.activeElement).toBe(input))
  expect(save).not.toHaveBeenCalled()
})
it('saves a masked credential to its exact artifact and clears the input without returning the value', async () => {
  vi.spyOn(api.news, 'getModuleCredentials').mockResolvedValue({ credentials: [{ key: 'apiKey', label: 'Provider key', configured: false, available: true }] })
  const save = vi.spyOn(api.news, 'updateModuleCredential').mockResolvedValue({ credentials: [{ key: 'apiKey', label: 'Provider key', configured: true, available: true }] })
  render(<ModuleCredentials hash={hash} />)
  const input = await screen.findByLabelText('Provider key') as HTMLInputElement
  expect(input.type).toBe('password')
  fireEvent.change(input, { target: { value: 'unit-private-key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith(hash, 'apiKey', 'set', 'unit-private-key'))
  await waitFor(() => expect(input.value).toBe(''))
  expect(screen.getByText('Configured')).toBeTruthy()
  expect(screen.queryByText('unit-private-key')).toBeNull()
})
