import { describe, expect, it } from 'vitest'

import { buildDesktopPackagedSmokePlan } from './desktop-packaged-smoke-plan.mjs'

describe('buildDesktopPackagedSmokePlan', () => {
  it('keeps --onboarding as an explicitly deprecated alias with identical execution', () => {
    const canonical = buildDesktopPackagedSmokePlan(['--credential-pi'])
    const legacy = buildDesktopPackagedSmokePlan(['--onboarding'])
    expect({ ...legacy, warnings: [] }).toEqual(canonical)
    expect(legacy.warnings).toEqual([expect.stringContaining('--onboarding is deprecated; use --credential-pi')])
  })

  it('makes credential-pi acceptance isolated and deterministic', () => {
    const plan = buildDesktopPackagedSmokePlan(['--credential-pi'], {
      OPENALICE_TRADING_MODE: 'pro',
      OPENALICE_LITE_MODE: '1',
    }, { randomUUID: () => 'fixed-credential-pi' })

    expect(plan.errors).toEqual([])
    expect(plan.options).toMatchObject({
      credentialPi: true,
      realData: false,
      tempData: true,
    })
    expect(plan.buildEnv).toMatchObject({
      VITE_OPENALICE_ONBOARDING_TEST: '1',
      VITE_OPENALICE_CREDENTIAL_TEST_MODE: 'http',
    })
    expect(plan.launchEnv).toMatchObject({
      OPENALICE_ONBOARDING_TEST: '1',
      OPENALICE_CREDENTIAL_TEST_MODE: 'http',
      OPENALICE_AGENT_RUNTIME_INSTALLS: 'only:pi',
      OPENALICE_MCP_ENABLED: '0',
      OPENALICE_ELECTRON_SMOKE_CREDENTIAL_PI: '1',
      OPENALICE_ELECTRON_SMOKE_EXIT: '1',
    })
    expect(plan.unsetLaunchEnv).toEqual([
      'OPENALICE_TRADING_MODE',
      'OPENALICE_LITE_MODE',
      'OPENALICE_UTA_DISABLED',
    ])
  })

  it('rejects credential-pi acceptance against real user data', () => {
    const plan = buildDesktopPackagedSmokePlan(['--credential-pi', '--real-data'])

    expect(plan.errors).toContain('[desktop-smoke] --credential-pi always uses isolated temp data; drop --real-data')
  })

  it('makes the trading-mode lifecycle smoke isolated and self-terminating', () => {
    const plan = buildDesktopPackagedSmokePlan(['--trading-mode'], {
      OPENALICE_TRADING_MODE: 'pro',
      OPENALICE_LITE_MODE: '1',
    })

    expect(plan.errors).toEqual([])
    expect(plan.options).toMatchObject({
      credentialPi: false,
      realData: false,
      tempData: true,
      tradingMode: true,
    })
    expect(plan.launchEnv).toEqual({
      OPENALICE_MCP_ENABLED: '0',
      OPENALICE_ELECTRON_SMOKE_TRADING_MODE: '1',
      OPENALICE_ELECTRON_SMOKE_EXIT: '1',
    })
    expect(plan.unsetLaunchEnv).toEqual([
      'OPENALICE_TRADING_MODE',
      'OPENALICE_LITE_MODE',
      'OPENALICE_UTA_DISABLED',
    ])
  })

  it('rejects unsafe or contradictory trading-mode smoke flags', () => {
    expect(buildDesktopPackagedSmokePlan(['--trading-mode', '--real-data']).errors)
      .toContain('[desktop-smoke] --trading-mode always uses isolated temp data; drop --real-data')
    expect(buildDesktopPackagedSmokePlan(['--trading-mode', '--credential-pi']).errors)
      .toContain('[desktop-smoke] choose only one automated smoke mode: --credential-pi, --trading-mode, or --workspace-acceptance')
  })

  it('makes Workspace acceptance isolated, self-terminating, and provider-independent', () => {
    const plan = buildDesktopPackagedSmokePlan(['--workspace-acceptance'], {
      OPENALICE_TRADING_MODE: 'pro',
    })

    expect(plan.errors).toEqual([])
    expect(plan.options).toMatchObject({
      credentialPi: false,
      realData: false,
      tempData: true,
      tradingMode: false,
      workspaceAcceptance: true,
    })
    expect(plan.buildEnv).toEqual({})
    expect(plan.launchEnv).toEqual({
      OPENALICE_MCP_ENABLED: '0',
      OPENALICE_ELECTRON_SMOKE_WORKSPACE_ACCEPTANCE: '1',
      OPENALICE_ELECTRON_SMOKE_EXIT: '1',
    })
    expect(plan.unsetLaunchEnv).toEqual([
      'OPENALICE_TRADING_MODE',
      'OPENALICE_LITE_MODE',
      'OPENALICE_UTA_DISABLED',
    ])
  })

  it('rejects unsafe or contradictory Workspace acceptance flags', () => {
    expect(buildDesktopPackagedSmokePlan(['--workspace-acceptance', '--real-data']).errors)
      .toContain('[desktop-smoke] --workspace-acceptance always uses isolated temp data; drop --real-data')
    expect(buildDesktopPackagedSmokePlan(['--workspace-acceptance', '--credential-pi']).errors)
      .toContain('[desktop-smoke] choose only one automated smoke mode: --credential-pi, --trading-mode, or --workspace-acceptance')
  })

  it('rejects contradictory data flags', () => {
    const plan = buildDesktopPackagedSmokePlan(['--temp-data', '--real-data'])

    expect(plan.errors).toContain('[desktop-smoke] choose either --temp-data or --real-data, not both')
  })

  it('treats an explicit package root as externally owned reuse', () => {
    const plan = buildDesktopPackagedSmokePlan([
      '--skip-pack',
      '--package-root',
      '/tmp/openalice-package',
    ])

    expect(plan.errors).toEqual([])
    expect(plan.options).toMatchObject({
      packageRoot: '/tmp/openalice-package',
      skipPack: true,
    })
  })

  it('rejects package roots for package-producing runs', () => {
    const plan = buildDesktopPackagedSmokePlan(['--package-root', '/tmp/openalice-package'])

    expect(plan.errors).toContain(
      '[desktop-smoke] --package-root reuses an existing package and requires --skip-pack',
    )
  })

  it('rejects a missing package root value', () => {
    const plan = buildDesktopPackagedSmokePlan(['--skip-pack', '--package-root'])

    expect(plan.errors).toContain('[desktop-smoke] unknown option(s): --package-root (missing path)')
  })

  it('explains that reused packages are never deleted', () => {
    const plan = buildDesktopPackagedSmokePlan(['--skip-pack', '--keep-package'])

    expect(plan.warnings).toContain(
      '[desktop-smoke] --keep-package has no effect with --skip-pack; reused packages are never deleted',
    )
  })
})
