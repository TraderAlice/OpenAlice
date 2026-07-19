import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Preset } from '../../api/types'
import { api } from '../../api'
import { i18n } from '../../i18n'
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
      wires: { 'openai-chat': 'http://127.0.0.1:0/v1' },
    },
  ],
}

const geminiPreset: Preset = {
  id: 'gemini',
  label: 'Google Gemini',
  description: 'Google AI via API key',
  category: 'third-party',
  defaultName: 'Google Gemini',
  hint: 'OpenAlice uses Google’s native Gemini API.',
  setup: {
    apiKeyLabel: 'Google AI API key',
    apiKeyPlaceholder: 'AQ... or AIza...',
    apiKeyHelp: 'Use a Gemini API key from Google AI Studio. AQ and AIza keys are supported.',
    modelHelp: 'Choose a Gemini model exposed by the native endpoint.',
  },
  schema: {
    type: 'object',
    properties: {
      apiKey: { type: 'string' },
      model: {
        type: 'string',
        default: 'gemini-default',
        oneOf: [
          { const: 'gemini-list-first', title: 'First suggestion' },
          { const: 'gemini-default', title: 'Catalog default' },
        ],
      },
    },
  },
  regions: [
    {
      id: 'google',
      label: 'Google',
      wires: { 'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta' },
    },
  ],
}

const customPreset: Preset = {
  id: 'custom',
  label: 'Custom',
  description: 'Custom compatible endpoint',
  category: 'custom',
  defaultName: '',
  setup: {
    apiKeyLabel: 'Endpoint API key',
    apiKeyHelp: 'Use a key accepted by this endpoint.',
    modelHelp: 'Enter the exact model ID.',
  },
  schema: {
    type: 'object',
    properties: {
      apiKey: { type: 'string' },
      model: { type: 'string' },
    },
  },
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

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CredentialModal', () => {
  it('explains provider-specific key, runtime, and model behavior before testing', () => {
    render(
      <CredentialModal
        mode="add"
        presets={[geminiPreset]}
        initialPresetId={geminiPreset.id}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )

    expect(screen.getByText('Use a Gemini API key from Google AI Studio. AQ and AIza keys are supported.')).toBeTruthy()
    expect(screen.getByText('Choose a Gemini model exposed by the native endpoint.')).toBeTruthy()
    expect(screen.getByText('Pi')).toBeTruthy()
    expect(screen.getByText('opencode')).toBeTruthy()
    expect(screen.queryByText('Claude Code')).toBeNull()
    expect(screen.queryByText('Codex')).toBeNull()
    expect(screen.getByPlaceholderText('AQ... or AIza...')).toBeTruthy()
    expect(screen.getByDisplayValue('gemini-default')).toBeTruthy()
  })

  it('requires a concrete URL for custom providers and explains mode compatibility', () => {
    render(
      <CredentialModal
        mode="add"
        presets={[customPreset]}
        initialPresetId={customPreset.id}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('e.g. OpenRouter work key'), { target: { value: 'Gateway' } })
    fireEvent.change(screen.getByPlaceholderText('Enter API key'), { target: { value: 'sk-gateway' } })
    fireEvent.change(screen.getByPlaceholderText('Exact provider model ID'), { target: { value: 'gateway-model' } })

    expect(screen.getByRole('option', { name: /OpenAI Chat Completions — opencode, Pi/ })).toBeTruthy()
    const testButton = screen.getByRole('button', { name: 'Test connection' }) as HTMLButtonElement
    expect(testButton.disabled).toBe(true)
    expect(testButton.title).toBe('Enter the custom API base URL.')
  })

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

  it('preserves a remembered model and unmatched stored endpoint while editing', async () => {
    vi.mocked(api.config.testCredential).mockResolvedValue({ ok: true, response: 'ready' })
    vi.mocked(api.config.updateCredential).mockResolvedValue(undefined)
    const onSaved = vi.fn().mockResolvedValue(undefined)

    render(
      <CredentialModal
        mode="edit"
        cred={{
          slug: 'openai-1',
          vendor: 'openai',
          authType: 'api-key',
          wires: { 'openai-responses': 'https://gateway.example/responses' },
          apiKey: 'sk-existing',
          hasApiKey: true,
          lastModel: 'gpt-account-specific',
        }}
        presets={[openAiPreset]}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    )

    expect(screen.getByDisplayValue('gpt-account-specific')).toBeTruthy()
    expect(screen.getByDisplayValue('Saved custom endpoint (keep unchanged)')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.config.updateCredential).toHaveBeenCalled())
    expect(api.config.updateCredential).toHaveBeenCalledWith('openai-1', expect.objectContaining({
      wires: { 'openai-responses': 'https://gateway.example/responses' },
      lastModel: 'gpt-account-specific',
    }))
    expect(onSaved).toHaveBeenCalled()
  })
})
