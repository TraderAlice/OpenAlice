import { join } from 'node:path'

export const DESKTOP_PACKAGED_SMOKE_ARGS = new Set([
  '--skip-build',
  '--skip-pack',
  '--keep',
  '--keep-package',
  '--package-root',
  '--temp-data',
  '--real-data',
  '--signed',
  '--credential-pi',
  '--onboarding', // Deprecated public alias.
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
  const credentialPi = args.has('--credential-pi') || args.has('--onboarding')
  const tradingMode = args.has('--trading-mode')
  const workspaceAcceptance = args.has('--workspace-acceptance')
  const realDataFlag = args.has('--real-data')
  const tempDataFlag = args.has('--temp-data')
  const errors = []
  const warnings = []
  if (args.has('--onboarding')) {
    warnings.push('[desktop-smoke] --onboarding is deprecated; use --credential-pi (credential UI + native Pi execution, not launcher or Chat composer acceptance)')
  }

  if (unknownArgs.length > 0) {
    errors.push(`[desktop-smoke] unknown option(s): ${unknownArgs.join(', ')}`)
  }
  if (tempDataFlag && realDataFlag) {
    errors.push('[desktop-smoke] choose either --temp-data or --real-data, not both')
  }
  if (credentialPi && realDataFlag) {
    errors.push('[desktop-smoke] --credential-pi always uses isolated temp data; drop --real-data')
  }
  if (tradingMode && realDataFlag) {
    errors.push('[desktop-smoke] --trading-mode always uses isolated temp data; drop --real-data')
  }
  if (workspaceAcceptance && realDataFlag) {
    errors.push('[desktop-smoke] --workspace-acceptance always uses isolated temp data; drop --real-data')
  }
  if ([credentialPi, tradingMode, workspaceAcceptance].filter(Boolean).length > 1) {
    errors.push('[desktop-smoke] choose only one automated smoke mode: --credential-pi, --trading-mode, or --workspace-acceptance')
  }

  const skipBuild = args.has('--skip-build')
  const skipPack = args.has('--skip-pack')
  if (packageRoot && !skipPack) {
    errors.push('[desktop-smoke] --package-root reuses an existing package and requires --skip-pack')
  }
  if (args.has('--keep-package') && skipPack) {
    warnings.push('[desktop-smoke] --keep-package has no effect with --skip-pack; reused packages are never deleted')
  }
  if (credentialPi && skipBuild) {
    warnings.push('[desktop-smoke] --credential-pi with --skip-build assumes ui/dist was built for the credential + Pi acceptance')
  }
  if (credentialPi && skipPack) {
    warnings.push('[desktop-smoke] --credential-pi with --skip-pack assumes the packaged app contains the credential + Pi acceptance UI')
  }

  const realData = realDataFlag
  const tempData = !realData
  // Shared dev fixture switches retain their existing names; they do not define this gate's scope.
  const credentialPiBuildEnv = credentialPi ? {
    VITE_OPENALICE_ONBOARDING_TEST: '1',
    VITE_OPENALICE_CREDENTIAL_TEST_MODE: 'http',
  } : {}
  const credentialPiLaunchEnv = credentialPi ? {
    ...credentialPiBuildEnv,
    OPENALICE_ONBOARDING_TEST: '1',
    OPENALICE_CREDENTIAL_TEST_MODE: 'http',
    OPENALICE_AGENT_RUNTIME_INSTALLS: 'only:pi',
    OPENALICE_MCP_ENABLED: '0',
    OPENALICE_ELECTRON_SMOKE_CREDENTIAL_PI: '1',
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
  const unsetLaunchEnv = credentialPi || tradingMode || workspaceAcceptance ? [
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
      credentialPi,
      packageRoot,
      tradingMode,
      realData,
      signed: args.has('--signed'),
      skipBuild,
      skipPack,
      tempData,
      workspaceAcceptance,
    },
    buildEnv: credentialPiBuildEnv,
    launchEnv: {
      ...credentialPiLaunchEnv,
      ...tradingModeLaunchEnv,
      ...workspaceAcceptanceLaunchEnv,
    },
    unsetLaunchEnv,
  }
}

// Only host plumbing crosses the temporary smoke boundary. In particular no
// ambient provider credentials/endpoints, native config files, NODE_OPTIONS,
// cloud credentials or arbitrary OPENALICE_* overrides reach a fresh user.
// Omitting Pi session/OMP profile overrides keeps their default layouts under
// the isolated agent root, consistently for native writes and adapter reads.
const SMOKE_HOST_ENV = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir',
  'COMSPEC', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'SHELL',
  'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
  // Explicit invocation-only host workaround; the runner never enables this.
  'ELECTRON_DISABLE_SANDBOX',
]

/** Complete launch environment for temporary smokes, before explicit plan flags. */
export function desktopSmokeStateEnv(root, parent = {}) {
  const host = Object.fromEntries(SMOKE_HOST_ENV.flatMap(key =>
    typeof parent[key] === 'string' ? [[key, parent[key]]] : [],
  ))
  return {
    ...host,
    HOME: join(root, 'os-home'),
    USERPROFILE: join(root, 'os-home'),
    APPDATA: join(root, 'os-home', 'AppData', 'Roaming'),
    LOCALAPPDATA: join(root, 'os-home', 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_CACHE_HOME: join(root, 'cache'),
    XDG_DATA_HOME: join(root, 'data'),
    OPENALICE_ELECTRON_SMOKE_USER_DATA: join(root, 'electron-profile'),
    OPENALICE_SUPERVISOR_HOME: join(root, 'supervisor'),
    OPENALICE_HOME: join(root, 'home'),
    AQ_LAUNCHER_ROOT: join(root, 'workspaces'),
    OPENALICE_GLOBAL_DIR: join(root, 'global'),
    PI_CODING_AGENT_DIR: join(root, 'pi-agent'),
    CODEX_HOME: join(root, 'codex'),
    CLAUDE_CONFIG_DIR: join(root, 'claude'),
    CURSOR_DATA_DIR: join(root, 'cursor'),
    GROK_HOME: join(root, 'grok'),
  }
}
