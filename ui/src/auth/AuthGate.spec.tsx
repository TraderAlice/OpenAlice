// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import '../i18n'
import { AuthGate } from './AuthGate'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => undefined),
}))

vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    state: 'authed',
    backendUnavailable: true,
    refresh: mocks.refresh,
  }),
}))

vi.mock('./LoginPage', () => ({
  LoginPage: () => null,
  NoTokenPage: () => null,
}))

afterEach(cleanup)

describe('AuthGate backend recovery', () => {
  it('top-anchors overflow while preserving vertical centering when the content fits', () => {
    render(
      <AuthGate>
        <div>Application</div>
      </AuthGate>,
    )

    const dialog = screen.getByRole('alertdialog')
    const content = dialog.querySelector('section')
    expect(dialog.className).toContain('items-start')
    expect(dialog.className).toContain('justify-start')
    expect(dialog.className).toContain('overflow-y-auto')
    expect(document.activeElement).toBe(dialog)
    expect(dialog.scrollTop).toBe(0)
    expect(content?.className).toContain('my-auto')
  })
})
