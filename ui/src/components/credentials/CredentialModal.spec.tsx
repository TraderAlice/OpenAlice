import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Preset } from '../../api/types'
import { api } from '../../api'
import { CredentialModal } from './CredentialModal'

vi.mock('../../api', () => ({
  api: {
    config: {
      testCredential: vi.fn(),
      addCredential: vi.fn(),
      updateCredential: vi.fn(),
    },
  },
}))

const openAiPreset: Preset = {
  id: 'codex-api',
  label: 'OpenAI',
  description: 'OpenAI-compatible Responses endpoint.',
  category: 'official',
  defaultName: 'OpenAI',
  schema: {
    type: 'object',
    properties: {
      apiKey: { type: 'string' },
      model: {
        type: 'string',
        oneOf: [{ const: 'gpt-test', title: 'GPT Test' }],
      },
    },
  },
  regions: [
    {
      id: 'official',
      label: 'Official',
      wires: { 'openai-responses': 'https://api.openai.com/v1' },
    },
  ],
}

const onboardingTestPreset: Preset = {
  id: 'openalice-onboarding-test',
  label: 'OpenAlice Test Provider',
  description: 'Local mock for onboarding test mode',
  category: 'custom',
  defaultName: 'OpenAlice Test Provider',
  schema: {
    type: 'object',
    properties: {
      apiKey: { type: 'string' },
      model: {
        type: 'string',
        oneOf: [{ const: 'openalice-onboarding-test', title: 'Onboarding Mock' }],
      },
    },
  },
  regions: [
    {
      id: 'local-mock',
      label: 'Local mock',
      wires: { 'openai-chat': 'https://onboarding.openalice.test/openai-chat' },
    },
  ],
}

function setup() {
  const onClose = vi.fn()
  const onSaved = vi.fn().mockResolvedValue(undefined)
  render(
    <CredentialModal
      mode="add"
      presets={[openAiPreset]}
      onClose={onClose}
      onSaved={onSaved}
    />,
  )
  fireEvent.click(screen.getByText('OpenAI'))
  fireEvent.change(screen.getByPlaceholderText('Enter API key'), { target: { value: 'sk-test' } })
  return { onClose, onSaved }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CredentialModal', () => {
  it('can open directly on a provided onboarding test preset', async () => {
    render(
      <CredentialModal
        mode="add"
        presets={[openAiPreset]}
        initialPresetId={openAiPreset.id}
        initialApiKey="sk-prefilled"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )

    expect(screen.getByText('OpenAI')).toBeTruthy()
    expect(screen.getByPlaceholderText('Enter API key')).toHaveProperty('value', 'sk-prefilled')
    await waitFor(() => expect(screen.getByDisplayValue('gpt-test')).toBeTruthy())
  })

  it('keeps the failed test message inside the dialog instead of overflowing', async () => {
    const longError = '401 {"error":{"code":"invalid_api_key","message":"missing_api_key","type":"authentication_error","param":"really_long_unbroken_payload_for_wrapping"}}'
    vi.mocked(api.config.testCredential).mockResolvedValue({ ok: false, error: longError })

    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    const message = await screen.findByText(longError)
    expect(message.className).toContain('break-words')
    expect(screen.getByText('Fix the fields and test again')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Test connection' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('uses one primary action that tests first and then saves after a passing test', async () => {
    vi.mocked(api.config.testCredential).mockResolvedValue({ ok: true, response: 'pong' })
    vi.mocked(api.config.addCredential).mockResolvedValue({ slug: 'openai-1', vendor: 'openai' })
    const { onSaved } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    await waitFor(() => expect(screen.getAllByText('Connection verified').length).toBeGreaterThan(0))
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(false)

    fireEvent.click(save)
    await waitFor(() => expect(api.config.addCredential).toHaveBeenCalled())
    expect(onSaved).toHaveBeenCalled()
  })

  it('keeps a label for fixed custom presets such as the onboarding mock provider', async () => {
    vi.mocked(api.config.testCredential).mockResolvedValue({ ok: true, response: 'ready' })
    vi.mocked(api.config.addCredential).mockResolvedValue({ slug: 'custom-1', vendor: 'custom' })
    const onSaved = vi.fn().mockResolvedValue(undefined)

    render(
      <CredentialModal
        mode="add"
        presets={[onboardingTestPreset]}
        initialPresetId={onboardingTestPreset.id}
        initialApiKey="oa_test_ok"
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.config.addCredential).toHaveBeenCalled())
    expect(api.config.addCredential).toHaveBeenCalledWith(expect.objectContaining({
      vendor: 'custom',
      label: 'OpenAlice Test Provider',
      apiKey: 'oa_test_ok',
      lastModel: 'openalice-onboarding-test',
    }))
    expect(onSaved).toHaveBeenCalled()
  })
})
