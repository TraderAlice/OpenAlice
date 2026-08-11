// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentLaunchConfigState } from '../../hooks/useAgentLaunchConfig'
import { i18n } from '../../i18n'
import type { AgentInfo, SavedCredential } from './api'
import { AgentLaunchSelectors } from './AgentLaunchControls'

const agents: AgentInfo[] = [
  {
    id: 'opencode',
    displayName: 'OpenCode',
    installed: true,
    capabilities: {
      parallelPerCwd: true,
      resumeLast: true,
      resumeById: true,
      transcriptDiscovery: 'fs-watch',
    },
  },
  {
    id: 'pi',
    displayName: 'Pi',
    installed: true,
    capabilities: {
      parallelPerCwd: true,
      resumeLast: true,
      resumeById: true,
      transcriptDiscovery: 'fs-watch',
    },
  },
]

const credentials: SavedCredential[] = [
  {
    slug: 'primary',
    vendor: 'OpenAI',
    label: 'Primary',
    authType: 'api-key',
    wires: {},
    resolvedModel: 'gpt-5',
  },
  {
    slug: 'backup',
    vendor: 'OpenAI',
    label: 'Backup',
    authType: 'api-key',
    wires: {},
    resolvedModel: 'gpt-4.1',
  },
]

function launchConfig(overrides: Partial<AgentLaunchConfigState> = {}): AgentLaunchConfigState {
  return {
    agents,
    effectiveAgent: 'opencode',
    selectedAgent: agents[0]!,
    runtimeReadiness: null,
    selectedRuntimeReadiness: null,
    needsCredential: true,
    canSelectCredential: true,
    accessMode: 'vault',
    credentials,
    effectiveCredential: 'primary',
    credential: credentials[0]!,
    detectedCredential: null,
    workspaceConfigResolved: true,
    defaultModel: 'gpt-5',
    modelOptions: [],
    launchModel: undefined,
    effortOptions: ['low', 'medium', 'high'],
    selectedReasoningEffort: undefined,
    launchReasoningEffort: undefined,
    aiDetails: null,
    selectedRuntimeUsesGlobalConfig: false,
    credentialSelectionReady: true,
    noCredentials: false,
    needsProviderSetup: false,
    selectedMissing: false,
    anyInstalled: true,
    agentsKnown: true,
    launchCredentialSlug: 'primary',
    selectAgent: vi.fn(),
    selectCredential: vi.fn(),
    selectRuntimeDefault: vi.fn(),
    selectWorkspaceDefault: vi.fn(),
    selectModel: vi.fn(),
    selectReasoningEffort: vi.fn(),
    resetCredentialSelection: vi.fn(),
    ...overrides,
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('AgentLaunchSelectors keyboard menus', () => {
  it('keeps model and effort together above the phone breakpoint', () => {
    render(<AgentLaunchSelectors config={launchConfig()} onConfigureProvider={vi.fn()} />)

    const group = screen.getByTestId('agent-launch-inference-group')
    expect(group.className).toContain('contents')
    expect(group.className).toContain('sm:flex')
    expect(group.className).toContain('sm:shrink-0')
  })

  it('moves through the agent menu and returns focus on Escape', async () => {
    const user = userEvent.setup()
    render(<AgentLaunchSelectors config={launchConfig()} onConfigureProvider={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: i18n.t('chatLanding.selectAgent') })
    trigger.focus()
    await user.keyboard('{ArrowDown}')

    const openCode = screen.getByRole('menuitem', { name: 'OpenCode' })
    const pi = screen.getByRole('menuitem', { name: 'Pi' })
    expect(document.activeElement).toBe(openCode)

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(pi)
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(openCode)
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(pi)
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(openCode)
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(pi)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('selects an agent with Enter and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    const selectAgent = vi.fn()
    render(
      <AgentLaunchSelectors
        config={launchConfig({ selectAgent })}
        onConfigureProvider={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: i18n.t('chatLanding.selectAgent') })
    trigger.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(selectAgent).toHaveBeenCalledWith('pi')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('applies the same keyboard contract to credentials', async () => {
    const user = userEvent.setup()
    const selectCredential = vi.fn()
    render(
      <AgentLaunchSelectors
        config={launchConfig({ selectCredential })}
        onConfigureProvider={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: i18n.t('chatLanding.selectCredential') })
    trigger.focus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByText(i18n.t('chatLanding.credentialMenuTitle', { runtime: 'OpenCode' }))).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Backup/ }))

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Managed by OpenCode/ }))
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Backup/ }))
    await user.keyboard('{Enter}')
    expect(selectCredential).toHaveBeenCalledWith('backup')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps native runtime login as the default and makes a vault override explicit', async () => {
    const user = userEvent.setup()
    const selectCredential = vi.fn()
    const selectRuntimeDefault = vi.fn()
    render(
      <AgentLaunchSelectors
        config={launchConfig({
          needsCredential: false,
          accessMode: 'native',
          effectiveCredential: null,
          credential: null,
          launchCredentialSlug: undefined,
          selectCredential,
          selectRuntimeDefault,
        })}
        onConfigureProvider={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: i18n.t('chatLanding.selectCredential') })
    expect(trigger.textContent).toContain(i18n.t('chatLanding.runtimeAccount', { runtime: 'OpenCode' }))
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: /Primary/ }))
    expect(selectCredential).toHaveBeenCalledWith('primary')

    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', {
      name: new RegExp(i18n.t('chatLanding.runtimeAccount', { runtime: 'OpenCode' })),
    }))
    expect(selectRuntimeDefault).toHaveBeenCalledOnce()
  })

  it('shows the provider as the saved access identity instead of exposing only its slug', () => {
    const deepseek = {
      ...credentials[0]!,
      slug: 'deepseek-1',
      vendor: 'deepseek',
      label: 'deepseek-1',
    }
    render(
      <AgentLaunchSelectors
        config={launchConfig({
          accessMode: 'vault',
          credentials: [deepseek],
          effectiveCredential: deepseek.slug,
          credential: deepseek,
          launchCredentialSlug: deepseek.slug,
        })}
        onConfigureProvider={vi.fn()}
        labeled
      />,
    )

    const trigger = screen.getByRole('button', { name: i18n.t('chatLanding.selectCredential') })
    expect(trigger.textContent).toContain('DeepSeek API')
    expect(trigger.textContent).toContain('deepseek-1')
  })

  it('renders paused-session settings as two full-width rows', () => {
    render(
      <AgentLaunchSelectors
        config={launchConfig()}
        onConfigureProvider={vi.fn()}
        showRuntime={false}
        toolbar
        layout="settings"
      />,
    )

    const credentialTrigger = screen.getByRole('button', { name: i18n.t('chatLanding.selectCredential') })
    const inferenceTrigger = screen.getByRole('button', { name: i18n.t('chatLanding.selectModelAndEffort') })
    expect(credentialTrigger.className).toContain('w-full')
    expect(inferenceTrigger.className).toContain('w-full')
    expect(inferenceTrigger.textContent).toContain('gpt-5')
    expect(inferenceTrigger.textContent).toContain('Effort not specified')
  })

  it('combines model and reasoning into a nested toolbar menu', async () => {
    const user = userEvent.setup()
    const selectModel = vi.fn()
    const selectReasoningEffort = vi.fn()
    render(
      <AgentLaunchSelectors
        config={launchConfig({
          defaultModel: 'gpt-5',
          modelOptions: [
            { id: 'gpt-5', label: 'GPT-5' },
            { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
          ],
          aiDetails: {
            model: 'gpt-5',
            contextWindow: null,
            reasoning: true,
            reasoningEffort: 'high',
            reasoningMode: 'adaptive',
            source: 'new-injection',
          },
          launchReasoningEffort: 'high',
          selectModel,
          selectReasoningEffort,
        })}
        onConfigureProvider={vi.fn()}
        showRuntime={false}
        toolbar
      />,
    )

    const trigger = screen.getByRole('button', { name: i18n.t('chatLanding.selectModelAndEffort') })
    expect(trigger.textContent).toContain('gpt-5')
    expect(trigger.textContent).toContain('high reasoning')

    trigger.focus()
    await user.keyboard('{ArrowDown}')
    await user.click(screen.getByRole('menuitem', { name: /Model/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /GPT-5.6/ }))
    expect(selectModel).toHaveBeenCalledWith('gpt-5.6-sol')

    await user.keyboard('{Escape}{Escape}')
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    await user.click(screen.getByRole('menuitem', { name: /Effort/ }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'low reasoning' }))
    expect(selectReasoningEffort).toHaveBeenCalledWith('low')
  })

  it('keeps free-typed custom models available behind the model submenu', async () => {
    const user = userEvent.setup()
    const selectModel = vi.fn()
    render(
      <AgentLaunchSelectors
        config={launchConfig({ selectModel })}
        onConfigureProvider={vi.fn()}
        showRuntime={false}
        toolbar
      />,
    )

    const trigger = screen.getByRole('button', { name: i18n.t('chatLanding.selectModelAndEffort') })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    await user.click(screen.getByRole('menuitem', { name: /Model/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: i18n.t('chatLanding.customModel') }))

    const input = await screen.findByRole('textbox', { name: i18n.t('chatLanding.customModelId') })
    await user.clear(input)
    await user.type(input, 'private-model-1')
    await user.click(screen.getByRole('button', { name: i18n.t('common.save') }))
    expect(selectModel).toHaveBeenCalledWith('private-model-1')
  })
})
