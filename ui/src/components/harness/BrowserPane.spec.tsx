// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { BrowserPane, browserAddress } from './BrowserPane'
import { i18n } from '../../i18n'
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)
it('accepts web addresses and rejects executable URLs and credentials', () => {
  expect(browserAddress('example.com')).toBe('https://example.com/')
  expect(browserAddress('localhost:5173')).toBe('https://localhost:5173/')
  for (const value of ['javascript:alert(1)', 'file:///tmp/a', 'https://user:pass@example.com']) expect(() => browserAddress(value)).toThrow()
})
it('opens addresses in one retained frame and replaces forward address history', () => {
  render(<BrowserPane title="Test browser" />)
  const address = screen.getByRole('textbox', { name: 'Address (https://…)' })
  const navigate = (url: string) => { fireEvent.change(address, { target: { value: url } }); fireEvent.submit(address.closest('form')!) }
  navigate('https://example.com/one')
  navigate('https://example.com/two')
  fireEvent.click(screen.getByRole('button', { name: 'Previous address' }))
  expect(screen.getByTitle('Test browser').getAttribute('src')).toBe('https://example.com/one')
  navigate('https://example.com/three')
  expect(screen.getByRole('button', { name: 'Next address' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByTitle('Test browser').getAttribute('sandbox')).not.toContain('allow-top-navigation')
})
it('turns a managed starting state into the same browser when Studio becomes ready', () => {
  const { rerender } = render(<BrowserPane title="Studio" pending={<div>Starting Studio</div>} />)
  expect(screen.getByText('Starting Studio')).toBeTruthy()
  rerender(<BrowserPane title="Studio" initialUrl="http://studio.localhost/" pending={<div>Starting Studio</div>} />)
  expect(screen.getByTitle('Studio').getAttribute('src')).toBe('http://studio.localhost/')
  expect(screen.queryByText('Starting Studio')).toBeNull()
})
