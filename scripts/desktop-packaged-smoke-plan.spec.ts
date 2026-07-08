import { describe, expect, it } from 'vitest'

import { buildDesktopPackagedSmokePlan } from './desktop-packaged-smoke-plan.mjs'

describe('buildDesktopPackagedSmokePlan', () => {
  it('keeps the default packaged smoke on real data', () => {
    const plan = buildDesktopPackagedSmokePlan([], {}, { randomUUID: () => 'fixed' })

    expect(plan.errors).toEqual([])
    expect(plan.options).toMatchObject({
      onboarding: false,
      realData: true,
      tempData: false,
    })
    expect(plan.buildEnv).toEqual({})
    expect(plan.launchEnv).toEqual({})
  })

  it('makes onboarding smoke isolated and deterministic', () => {
    const plan = buildDesktopPackagedSmokePlan(['--onboarding'], {
      OPENALICE_TRADING_MODE: 'pro',
      OPENALICE_LITE_MODE: '1',
    }, { randomUUID: () => 'fixed-onboarding' })

    expect(plan.errors).toEqual([])
    expect(plan.options).toMatchObject({
      onboarding: true,
      realData: false,
      tempData: true,
    })
    expect(plan.buildEnv).toMatchObject({
      VITE_OPENALICE_FIRST_RUN_GUIDE: '1',
      VITE_OPENALICE_ONBOARDING_TEST: '1',
      VITE_OPENALICE_CREDENTIAL_TEST_MODE: 'mock',
      VITE_OPENALICE_ONBOARDING_STORAGE_SUFFIX: 'fixed-onboarding',
    })
    expect(plan.launchEnv).toMatchObject({
      OPENALICE_ONBOARDING_TEST: '1',
      OPENALICE_CREDENTIAL_TEST_MODE: 'mock',
      OPENALICE_AGENT_RUNTIME_INSTALLS: 'real',
      OPENALICE_MCP_ENABLED: '0',
      OPENALICE_ELECTRON_SMOKE_ONBOARDING: '1',
      OPENALICE_ELECTRON_SMOKE_EXIT: '1',
    })
    expect(plan.unsetLaunchEnv).toEqual([
      'OPENALICE_TRADING_MODE',
      'OPENALICE_LITE_MODE',
      'OPENALICE_UTA_DISABLED',
    ])
  })

  it('rejects onboarding against real user data', () => {
    const plan = buildDesktopPackagedSmokePlan(['--onboarding', '--real-data'])

    expect(plan.errors).toContain('[desktop-smoke] --onboarding always uses isolated temp data; drop --real-data')
  })

  it('rejects contradictory data flags', () => {
    const plan = buildDesktopPackagedSmokePlan(['--temp-data', '--real-data'])

    expect(plan.errors).toContain('[desktop-smoke] choose either --temp-data or --real-data, not both')
  })
})
