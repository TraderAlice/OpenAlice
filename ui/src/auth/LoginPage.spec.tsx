// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { LoginPage } from './LoginPage'

vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    state: 'login_required',
    backendUnavailable: false,
    refresh: vi.fn(async () => undefined),
  }),
}))

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('LoginPage form accessibility', () => {
  it('pairs the admin token label with a required password input', () => {
    render(<LoginPage />)

    const input = screen.getByLabelText(i18n.t('auth.adminTokenLabel')) as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.required).toBe(true)
    expect(input.autocomplete).toBe('current-password')
    expect(input.id).toBeTruthy()
  })
})
