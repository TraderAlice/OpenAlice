import { describe, expect, it } from 'vitest'

import {
  requireBrokerAccountNeedsInstall,
  requireDiscoveredAgentRuntime,
  requireMissingAgentRuntime,
} from './remote-ssh-smoke-targets.mjs'

describe('remote SSH smoke target assertions', () => {
  const missingRuntime = {
    readiness: {
      agents: {
        pi: { installed: false, status: 'not_installed', ready: false, fingerprint: null },
      },
    },
    catalog: {
      agents: [{ id: 'pi', installed: false, binPath: null, fingerprint: null }],
    },
  }

  it('accepts a missing Runtime without probing it', () => {
    expect(requireMissingAgentRuntime(missingRuntime, 'pi').readinessRow.status)
      .toBe('not_installed')
  })

  it('requires fresh discovery to replace a cached missing Runtime', () => {
    const discovered = {
      readiness: {
        agents: {
          pi: {
            installed: true,
            status: 'unknown',
            ready: false,
            checkedAt: null,
            fingerprint: 'shim-v1',
          },
        },
      },
      catalog: {
        agents: [{
          id: 'pi',
          installed: true,
          binPath: '/usr/local/bin/pi',
          fingerprint: 'shim-v1',
        }],
      },
    }
    expect(requireDiscoveredAgentRuntime(discovered, 'pi', '/usr/local/bin/pi').detected.fingerprint)
      .toBe('shim-v1')
    expect(() => requireDiscoveredAgentRuntime({
      ...discovered,
      readiness: { agents: { pi: { ...discovered.readiness.agents.pi, status: 'not_installed' } } },
    }, 'pi', '/usr/local/bin/pi')).toThrow('cached missing state')
  })

  it('requires missing Broker Packs to block each configured account', () => {
    const payload = {
      packs: [{
        engine: 'alpaca',
        installed: false,
        source: 'missing',
        requiredBy: ['Paper'],
      }],
      accounts: [{
        accountId: 'paper',
        label: 'Paper',
        presetId: 'alpaca',
        configuredEnabled: true,
        engine: 'alpaca',
        state: 'needs-install',
        operational: false,
        action: 'install',
      }],
    }
    expect(requireBrokerAccountNeedsInstall(payload, {
      accountId: 'paper',
      presetId: 'alpaca',
      engine: 'alpaca',
    }).account.operational).toBe(false)
    expect(() => requireBrokerAccountNeedsInstall({
      ...payload,
      accounts: [{ ...payload.accounts[0], operational: true }],
    }, {
      accountId: 'paper',
      presetId: 'alpaca',
      engine: 'alpaca',
    })).toThrow('fail closed')
  })
})
