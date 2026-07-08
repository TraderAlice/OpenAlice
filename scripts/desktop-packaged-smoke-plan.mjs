import { randomUUID } from 'node:crypto'

export const DESKTOP_PACKAGED_SMOKE_ARGS = new Set([
  '--skip-build',
  '--skip-pack',
  '--keep',
  '--temp-data',
  '--real-data',
  '--signed',
  '--onboarding',
  '--help',
  '-h',
])

export function buildDesktopPackagedSmokePlan(argv, env = process.env, opts = {}) {
  const args = new Set(argv)
  const unknownArgs = [...args].filter((arg) => !DESKTOP_PACKAGED_SMOKE_ARGS.has(arg))
  const onboarding = args.has('--onboarding')
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

  const skipBuild = args.has('--skip-build')
  const skipPack = args.has('--skip-pack')
  if (onboarding && skipBuild) {
    warnings.push('[desktop-smoke] --onboarding with --skip-build assumes ui/dist was already built with first-run guide flags')
  }
  if (onboarding && skipPack) {
    warnings.push('[desktop-smoke] --onboarding with --skip-pack assumes the packaged app already contains that onboarding-enabled ui/dist')
  }

  const tempData = onboarding || tempDataFlag
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
  const unsetLaunchEnv = onboarding ? [
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
      onboarding,
      realData,
      signed: args.has('--signed'),
      skipBuild,
      skipPack,
      tempData,
    },
    buildEnv: onboardingBuildEnv,
    launchEnv: onboardingLaunchEnv,
    unsetLaunchEnv,
  }
}
