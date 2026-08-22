// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import type { AgentInfo, AgentRuntimeReadinessSnapshot } from './api'
import { AgentRuntimePicker } from './AgentRuntimePicker'

const capabilities: AgentInfo['capabilities'] = {
  parallelPerCwd: true,
  resumeLast: true,
  resumeById: true,
  transcriptDiscovery: 'none',
}

function agent(id: string, displayName = id, installed = true): AgentInfo {
  return { id, displayName, kind: 'agent', installed, capabilities }
}

const agents: AgentInfo[] = [
  agent('claude', 'Claude'),
  agent('codex', 'Codex', false),
  agent('cursor', 'Cursor Agent'),
  agent('agy', 'Antigravity'),
  agent('grok', 'Grok Build'),
  agent('omp', 'Oh My Pi'),
  agent('opencode', 'OpenCode'),
  agent('pi', 'Pi'),
]

const primary = agents.filter((item) => item.installed !== false).slice(0, 4)

const readiness: AgentRuntimeReadinessSnapshot = {
  overallReady: true,
  checkedAt: '2026-08-18T00:00:00.000Z',
  agents: {
    claude: {
      agent: 'claude',
      displayName: 'Claude',
      installed: true,
      binPath: '/usr/bin/claude',
      status: 'ready',
      ready: true,
      source: 'global-login',
      checkedAt: '2026-08-18T00:00:00.000Z',
      durationMs: 8,
    },
  },
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('AgentRuntimePicker', () => {
  it('exposes at most four quick choices plus Others and keeps a selected outsider visible', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <AgentRuntimePicker
        agents={agents}
        primary={primary}
        selectedId="pi"
        readiness={readiness}
        onSelect={onSelect}
      />,
    )

    const trigger = screen.getByRole('button', { name: i18n.t('chatLanding.selectAgent') })
    expect(trigger.textContent).toContain('Pi')
    await user.click(trigger)
    expect(await screen.findByRole('menuitem', { name: /Claude/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Cursor Agent/ })).toBeTruthy()
    expect(screen.getByText(i18n.t('chatLanding.currentRuntime'))).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /^Pi/ })).toBeTruthy()
    expect(screen.getAllByRole('menuitem').filter((item) => item.textContent && /Claude|Cursor|Antigravity|Grok/.test(item.textContent))).toHaveLength(4)
    expect(screen.getByRole('menuitem', { name: i18n.t('chatLanding.otherRuntimes') })).toBeTruthy()
  })

  it('shows a disabled current-selection row for an uninstalled outsider without changing shortcuts', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <AgentRuntimePicker
        agents={agents}
        primary={primary}
        selectedId="codex"
        readiness={readiness}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByRole('button', { name: i18n.t('chatLanding.selectAgent') }))
    const current = await screen.findByRole('menuitem', { name: /Codex/ })
    expect(current.getAttribute('data-disabled')).toBe('')
    expect(current.textContent).toContain(i18n.t('chatLanding.agentNotInstalled'))
    expect(screen.getAllByRole('menuitem').filter((item) => (
      item.textContent?.includes('Claude')
      || item.textContent?.includes('Cursor')
      || item.textContent?.includes('Antigravity')
      || item.textContent?.includes('Grok')
    ) && !item.textContent?.includes('Codex'))).toHaveLength(4)
    await user.click(current)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('opens the complete catalog in Others with install guidance and never leaves a blank icon', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <AgentRuntimePicker
        agents={agents}
        primary={primary}
        selectedId="pi"
        readiness={readiness}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByRole('button', { name: i18n.t('chatLanding.selectAgent') }))
    await user.click(await screen.findByRole('menuitem', { name: i18n.t('chatLanding.otherRuntimes') }))

    expect(screen.getByRole('heading', { name: i18n.t('chatLanding.allRuntimesTitle') })).toBeTruthy()
    expect(screen.getByRole('heading', { name: i18n.t('chatLanding.installedRuntimes') })).toBeTruthy()
    expect(screen.getByRole('heading', { name: i18n.t('chatLanding.notInstalledRuntimes') })).toBeTruthy()
    expect(screen.getByText('Codex').closest('div')?.textContent).toContain(
      i18n.t('chatLanding.agentNotInstalled'),
    )
    expect(screen.getByText('npm install -g @openai/codex')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pi' }).querySelector('svg')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Grok Build/ }).querySelector('svg')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Pi' }))
    expect(onSelect).toHaveBeenCalledWith('pi')
    expect(screen.queryByRole('heading', { name: i18n.t('chatLanding.allRuntimesTitle') })).toBeNull()
  })

  it('keeps an uninstalled runtime as install guidance instead of selecting it', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(
      <AgentRuntimePicker
        agents={agents}
        primary={primary}
        selectedId="pi"
        readiness={readiness}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByRole('button', { name: i18n.t('chatLanding.selectAgent') }))
    await user.click(await screen.findByRole('menuitem', { name: i18n.t('chatLanding.otherRuntimes') }))

    expect(screen.queryByRole('button', { name: 'Codex' })).toBeNull()
    await user.click(screen.getByRole('button', {
      name: i18n.t('chatLanding.copyInstallCommand', { name: 'Codex' }),
    }))
    expect(writeText).toHaveBeenCalledWith('npm install -g @openai/codex')
    expect(screen.getByRole('link', {
      name: i18n.t('chatLanding.openInstallDocs', { name: 'Codex' }),
    })).toHaveProperty('href', 'https://github.com/openai/codex')
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: i18n.t('chatLanding.allRuntimesTitle') })).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('heading', { name: i18n.t('chatLanding.allRuntimesTitle') })).toBeNull()
  })

  it('does not treat an unprobed installed runtime as a problem in Others', async () => {
    const user = userEvent.setup()
    render(
      <AgentRuntimePicker
        agents={agents}
        primary={primary}
        selectedId="pi"
        readiness={{
          overallReady: false,
          checkedAt: null,
          agents: {
            claude: {
              agent: 'claude',
              displayName: 'Claude',
              installed: true,
              binPath: '/usr/bin/claude',
              status: 'unknown',
              ready: false,
              source: 'unknown',
              checkedAt: null,
              durationMs: null,
            },
            cursor: {
              agent: 'cursor',
              displayName: 'Cursor Agent',
              installed: true,
              binPath: '/usr/bin/cursor-agent',
              status: 'auth_required',
              ready: false,
              source: 'unknown',
              checkedAt: '2026-08-18T00:00:00.000Z',
              durationMs: 8,
            },
          },
        }}
        onSelect={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: i18n.t('chatLanding.selectAgent') }))
    await user.click(await screen.findByRole('menuitem', { name: i18n.t('chatLanding.otherRuntimes') }))

    expect(screen.getByRole('button', { name: 'Claude' }).textContent).toBe('Claude')
    expect(screen.queryByText(i18n.t('chatLanding.pickerRuntimeChecking'))).toBeNull()
    expect(screen.getByRole('button', { name: /Cursor Agent/ }).textContent).toContain(
      i18n.t('chatLanding.pickerRuntimeAuthRequired'),
    )
  })

  it('restores focus to the trigger on Escape', async () => {
    const user = userEvent.setup()
    render(
      <AgentRuntimePicker
        agents={agents}
        primary={primary}
        selectedId="claude"
        readiness={readiness}
        onSelect={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: i18n.t('chatLanding.selectAgent') })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menu')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
