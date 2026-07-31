// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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
    credentials,
    effectiveCredential: 'primary',
    credential: credentials[0]!,
    detectedCredential: null,
    workspaceConfigResolved: true,
    aiDetails: null,
    selectedRuntimeUsesGlobalConfig: false,
    credentialSelectionReady: true,
    noCredentials: false,
    needsProviderSetup: false,
    willOverwriteCredential: false,
    selectedMissing: false,
    anyInstalled: true,
    agentsKnown: true,
    launchCredentialSlug: 'primary',
    selectAgent: vi.fn(),
    selectCredential: vi.fn(),
    resetCredentialSelection: vi.fn(),
    checkSelectedRuntime: vi.fn(async () => null),
    ...overrides,
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('AgentLaunchSelectors keyboard menus', () => {
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
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Backup/ }))

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    await user.keyboard('{ArrowDown}{End}{Enter}')
    expect(selectCredential).toHaveBeenCalledWith('backup')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
