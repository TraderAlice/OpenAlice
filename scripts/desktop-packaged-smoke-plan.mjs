import { randomUUID } from 'node:crypto'

export const DESKTOP_PACKAGED_SMOKE_ARGS = new Set([
  '--skip-build',
  '--skip-pack',
  '--keep',
  '--keep-package',
  '--package-root',
  '--temp-data',
  '--real-data',
  '--signed',
  '--onboarding',
  '--trading-mode',
  '--workspace-acceptance',
  '--help',
  '-h',
])

export function buildDesktopPackagedSmokePlan(argv, env = process.env, opts = {}) {
  const args = new Set()
  const unknownArgs = []
  let packageRoot = null
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--package-root') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        unknownArgs.push('--package-root (missing path)')
      } else {
        packageRoot = value
        index += 1
      }
      continue
    }
    if (!DESKTOP_PACKAGED_SMOKE_ARGS.has(arg)) unknownArgs.push(arg)
    else args.add(arg)
  }
  const onboarding = args.has('--onboarding')
  const tradingMode = args.has('--trading-mode')
  const workspaceAcceptance = args.has('--workspace-acceptance')
  const realDataFlag = args.has('--real-data')
  const tempDataFlag = args.has('--temp-data')
  const errors = []
  const warnings = []

  if (unknownArgs.length > 0) {
    errors.push(`[desktop-smoke] unknown option(s): ${unknownArgs.join(', ')}`)
  }
  if (tempDataFlag && realDataFlag) {
    errors.push('[desktop-smoke] choose either --temp-data or --real-data, not both')
  }
  if (onboarding && realDataFlag) {
    errors.push('[desktop-smoke] --onboarding always uses isolated temp data; drop --real-data')
  }
  if (tradingMode && realDataFlag) {
    errors.push('[desktop-smoke] --trading-mode always uses isolated temp data; drop --real-data')
  }
  if (workspaceAcceptance && realDataFlag) {
    errors.push('[desktop-smoke] --workspace-acceptance always uses isolated temp data; drop --real-data')
  }
  if ([onboarding, tradingMode, workspaceAcceptance].filter(Boolean).length > 1) {
    errors.push('[desktop-smoke] choose only one automated smoke mode: --onboarding, --trading-mode, or --workspace-acceptance')
  }

  const skipBuild = args.has('--skip-build')
  const skipPack = args.has('--skip-pack')
  if (packageRoot && !skipPack) {
    errors.push('[desktop-smoke] --package-root reuses an existing package and requires --skip-pack')
  }
  if (args.has('--keep-package') && skipPack) {
    warnings.push('[desktop-smoke] --keep-package has no effect with --skip-pack; reused packages are never deleted')
  }
  if (onboarding && skipBuild) {
    warnings.push('[desktop-smoke] --onboarding with --skip-build assumes ui/dist was already built with first-run guide flags')
  }
  if (onboarding && skipPack) {
    warnings.push('[desktop-smoke] --onboarding with --skip-pack assumes the packaged app already contains that onboarding-enabled ui/dist')
  }

  const tempData = onboarding || tradingMode || workspaceAcceptance || tempDataFlag
  const realData = !tempData
  const storageSuffix = env['VITE_OPENALICE_ONBOARDING_STORAGE_SUFFIX']?.trim() || opts.randomUUID?.() || randomUUID()
  const onboardingBuildEnv = onboarding ? {
    VITE_OPENALICE_FIRST_RUN_GUIDE: '1',
    VITE_OPENALICE_ONBOARDING_TEST: '1',
    VITE_OPENALICE_CREDENTIAL_TEST_MODE: 'mock',
    VITE_OPENALICE_ONBOARDING_STORAGE_SUFFIX: storageSuffix,
  } : {}
  const onboardingLaunchEnv = onboarding ? {
    ...onboardingBuildEnv,
    OPENALICE_ONBOARDING_TEST: '1',
    OPENALICE_CREDENTIAL_TEST_MODE: 'mock',
    OPENALICE_AGENT_RUNTIME_INSTALLS: 'real',
    OPENALICE_MCP_ENABLED: '0',
    OPENALICE_ELECTRON_SMOKE_ONBOARDING: '1',
    OPENALICE_ELECTRON_SMOKE_EXIT: '1',
  } : {}
  const tradingModeLaunchEnv = tradingMode ? {
    OPENALICE_MCP_ENABLED: '0',
    OPENALICE_ELECTRON_SMOKE_TRADING_MODE: '1',
    OPENALICE_ELECTRON_SMOKE_EXIT: '1',
  } : {}
  const workspaceAcceptanceLaunchEnv = workspaceAcceptance ? {
    OPENALICE_MCP_ENABLED: '0',
    OPENALICE_ELECTRON_SMOKE_WORKSPACE_ACCEPTANCE: '1',
    OPENALICE_ELECTRON_SMOKE_EXIT: '1',
  } : {}
  const unsetLaunchEnv = onboarding || tradingMode || workspaceAcceptance ? [
    'OPENALICE_TRADING_MODE',
    'OPENALICE_LITE_MODE',
    'OPENALICE_UTA_DISABLED',
  ] : []

  return {
    errors,
    warnings,
    options: {
      help: args.has('--help') || args.has('-h'),
      keep: args.has('--keep'),
      keepPackage: args.has('--keep-package'),
      onboarding,
      packageRoot,
      tradingMode,
      realData,
      signed: args.has('--signed'),
      skipBuild,
      skipPack,
      tempData,
      workspaceAcceptance,
    },
    buildEnv: onboardingBuildEnv,
    launchEnv: {
      ...onboardingLaunchEnv,
      ...tradingModeLaunchEnv,
      ...workspaceAcceptanceLaunchEnv,
    },
    unsetLaunchEnv,
  }
}
