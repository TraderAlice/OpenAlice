import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface OnboardingTestEnvPlan {
  readonly root: string
  readonly env: NodeJS.ProcessEnv
}

const DEFAULT_PORTS = {
  OPENALICE_WEB_PORT: '49331',
  OPENALICE_MCP_PORT: '49332',
  OPENALICE_UTA_PORT: '49333',
  OPENALICE_UI_PORT: '15173',
} as const

export function buildOnboardingTestEnv(
  input: NodeJS.ProcessEnv = process.env,
  opts: { root?: string } = {},
): OnboardingTestEnvPlan {
  const root = opts.root ?? input['OPENALICE_ONBOARDING_TEST_ROOT'] ?? mkdtempSync(join(tmpdir(), 'openalice-onboarding-'))
  const credentialTestMode = input['OPENALICE_CREDENTIAL_TEST_MODE']?.trim() || 'mock'
  const env: NodeJS.ProcessEnv = {
    ...input,
    OPENALICE_ONBOARDING_TEST: '1',
    OPENALICE_CREDENTIAL_TEST_MODE: credentialTestMode,
    OPENALICE_HOME: input['OPENALICE_HOME'] ?? join(root, 'home'),
    AQ_LAUNCHER_ROOT: input['AQ_LAUNCHER_ROOT'] ?? join(root, 'workspaces'),
    OPENALICE_GLOBAL_DIR: input['OPENALICE_GLOBAL_DIR'] ?? join(root, 'global'),
    OPENALICE_AGENT_RUNTIME_INSTALLS: input['OPENALICE_AGENT_RUNTIME_INSTALLS'] ?? 'only:pi',
    VITE_OPENALICE_FIRST_RUN_GUIDE: input['VITE_OPENALICE_FIRST_RUN_GUIDE'] ?? '1',
    VITE_OPENALICE_ONBOARDING_TEST: '1',
    VITE_OPENALICE_CREDENTIAL_TEST_MODE: input['VITE_OPENALICE_CREDENTIAL_TEST_MODE'] ?? credentialTestMode,
    VITE_OPENALICE_ONBOARDING_STORAGE_SUFFIX: input['VITE_OPENALICE_ONBOARDING_STORAGE_SUFFIX'] ?? randomUUID(),
  }

  for (const [key, value] of Object.entries(DEFAULT_PORTS)) {
    if (!env[key]) env[key] = value
  }

  // Keep the default onboarding profile honest: no inherited shell trading mode.
  // Use OPENALICE_ONBOARDING_TRADING_MODE to pin a specific mode for a test run.
  const tradingMode = input['OPENALICE_ONBOARDING_TRADING_MODE']?.trim()
  delete env['OPENALICE_LITE_MODE']
  delete env['OPENALICE_UTA_DISABLED']
  if (tradingMode) {
    env['OPENALICE_TRADING_MODE'] = tradingMode
  } else {
    delete env['OPENALICE_TRADING_MODE']
  }

  return { root, env }
}
