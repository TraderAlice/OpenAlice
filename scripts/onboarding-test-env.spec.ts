import { describe, expect, it } from 'vitest'
import { join } from 'node:path'

import { buildOnboardingTestEnv } from './onboarding-test-env.js'

describe('buildOnboardingTestEnv', () => {
  it('builds an isolated fresh-run environment by default', () => {
    const { root, env } = buildOnboardingTestEnv({}, { root: '/tmp/oa-onboarding' })

    expect(root).toBe('/tmp/oa-onboarding')
    expect(env['OPENALICE_ONBOARDING_TEST']).toBe('1')
    expect(env['OPENALICE_HOME']).toBe(join(root, 'home'))
    expect(env['AQ_LAUNCHER_ROOT']).toBe(join(root, 'workspaces'))
    expect(env['OPENALICE_GLOBAL_DIR']).toBe(join(root, 'global'))
    expect(env['PI_CODING_AGENT_DIR']).toBe(join(root, 'pi-agent'))
    expect(env['OPENALICE_AGENT_RUNTIME_INSTALLS']).toBe('only:pi')
    expect(env['OPENALICE_CREDENTIAL_TEST_MODE']).toBe('mock')
    expect(env['VITE_OPENALICE_FIRST_RUN_GUIDE']).toBe('1')
    expect(env['VITE_OPENALICE_ONBOARDING_TEST']).toBe('1')
    expect(env['VITE_OPENALICE_CREDENTIAL_TEST_MODE']).toBe('mock')
    expect(env['VITE_OPENALICE_ONBOARDING_STORAGE_SUFFIX']).toMatch(/^[0-9a-f-]{36}$/)
    expect(env['OPENALICE_UI_PORT']).toBe('15173')
    expect(env['OPENALICE_ONBOARDING_AI_MOCK_PORT']).toBe('0')
    expect(env['OPENALICE_ONBOARDING_AI_BASE_URL']).toBe('http://127.0.0.1:0/v1')
    expect(env['VITE_OPENALICE_ONBOARDING_AI_BASE_URL']).toBe('http://127.0.0.1:0/v1')
    expect(env['OPENALICE_TRADING_MODE']).toBeUndefined()
  })

  it('allows a fixed onboarding storage suffix for reproducing browser state', () => {
    const { env } = buildOnboardingTestEnv({
      VITE_OPENALICE_ONBOARDING_STORAGE_SUFFIX: 'fixed-ui-state',
    }, { root: '/tmp/oa-onboarding' })

    expect(env['VITE_OPENALICE_ONBOARDING_STORAGE_SUFFIX']).toBe('fixed-ui-state')
  })

  it('threads the dynamically bound mock port through backend and Vite config', () => {
    const { env } = buildOnboardingTestEnv({}, {
      root: '/tmp/oa-onboarding',
      aiMockPort: 61234,
    })

    expect(env['OPENALICE_ONBOARDING_AI_MOCK_PORT']).toBe('61234')
    expect(env['OPENALICE_ONBOARDING_AI_BASE_URL']).toBe('http://127.0.0.1:61234/v1')
    expect(env['VITE_OPENALICE_ONBOARDING_AI_BASE_URL']).toBe('http://127.0.0.1:61234/v1')
  })

  it('rejects invalid mock ports before starting the product', () => {
    expect(() => buildOnboardingTestEnv({
      OPENALICE_ONBOARDING_AI_MOCK_PORT: 'not-a-port',
    }, { root: '/tmp/oa-onboarding' })).toThrow(/must be an integer/)
  })

  it('allows disabling the first-run guide in onboarding test mode', () => {
    const { env } = buildOnboardingTestEnv({
      VITE_OPENALICE_FIRST_RUN_GUIDE: '0',
    }, { root: '/tmp/oa-onboarding' })

    expect(env['VITE_OPENALICE_FIRST_RUN_GUIDE']).toBe('0')
  })

  it('scrubs inherited trading env unless the onboarding-specific mode is set', () => {
    const { env } = buildOnboardingTestEnv({
      OPENALICE_TRADING_MODE: 'pro',
      OPENALICE_LITE_MODE: '1',
      OPENALICE_ONBOARDING_TRADING_MODE: 'readonly',
    }, { root: '/tmp/oa-onboarding' })

    expect(env['OPENALICE_TRADING_MODE']).toBe('readonly')
    expect(env['OPENALICE_LITE_MODE']).toBeUndefined()
    expect(env['OPENALICE_UTA_DISABLED']).toBeUndefined()
  })

  it('preserves explicit roots, ports, and agent runtime profile', () => {
    const { env } = buildOnboardingTestEnv({
      OPENALICE_HOME: '/custom/home',
      AQ_LAUNCHER_ROOT: '/custom/workspaces',
      OPENALICE_GLOBAL_DIR: '/custom/global',
      OPENALICE_UI_PORT: '25173',
      OPENALICE_ONBOARDING_AI_MOCK_PORT: '25174',
      OPENALICE_AGENT_RUNTIME_INSTALLS: 'only:codex',
      OPENALICE_CREDENTIAL_TEST_MODE: 'real',
    }, { root: '/tmp/oa-onboarding' })

    expect(env['OPENALICE_HOME']).toBe('/custom/home')
    expect(env['AQ_LAUNCHER_ROOT']).toBe('/custom/workspaces')
    expect(env['OPENALICE_GLOBAL_DIR']).toBe('/custom/global')
    expect(env['OPENALICE_UI_PORT']).toBe('25173')
    expect(env['OPENALICE_ONBOARDING_AI_BASE_URL']).toBe('http://127.0.0.1:25174/v1')
    expect(env['OPENALICE_AGENT_RUNTIME_INSTALLS']).toBe('only:codex')
    expect(env['OPENALICE_CREDENTIAL_TEST_MODE']).toBe('real')
    expect(env['VITE_OPENALICE_CREDENTIAL_TEST_MODE']).toBe('real')
  })
})
