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
  opts: { root?: string; aiMockPort?: number } = {},
): OnboardingTestEnvPlan {
  const root = opts.root ?? input['OPENALICE_ONBOARDING_TEST_ROOT'] ?? mkdtempSync(join(tmpdir(), 'openalice-onboarding-'))
  const credentialTestMode = input['OPENALICE_CREDENTIAL_TEST_MODE']?.trim() || 'mock'
  // The dev launcher binds the mock to port 0 first, then passes the actual
  // loopback port here. A direct/--print-env call uses 0 to truthfully signal
  // "assigned at launch" instead of claiming a fixed port that may be owned by
  // macOS or another developer process.
  const resolvedAiMockPort = opts.aiMockPort
    ?? Number(input['OPENALICE_ONBOARDING_AI_MOCK_PORT']?.trim() || '0')
  if (!Number.isInteger(resolvedAiMockPort) || resolvedAiMockPort < 0 || resolvedAiMockPort > 65_535) {
    throw new Error('OPENALICE_ONBOARDING_AI_MOCK_PORT must be an integer from 0 to 65535')
  }
  const aiMockPort = String(resolvedAiMockPort)
  const aiBaseUrl = input['OPENALICE_ONBOARDING_AI_BASE_URL']?.trim()
    || `http://127.0.0.1:${aiMockPort}/v1`
  const env: NodeJS.ProcessEnv = {
    ...input,
    OPENALICE_ONBOARDING_TEST: '1',
    OPENALICE_CREDENTIAL_TEST_MODE: credentialTestMode,
    OPENALICE_HOME: input['OPENALICE_HOME'] ?? join(root, 'home'),
    AQ_LAUNCHER_ROOT: input['AQ_LAUNCHER_ROOT'] ?? join(root, 'workspaces'),
    OPENALICE_GLOBAL_DIR: input['OPENALICE_GLOBAL_DIR'] ?? join(root, 'global'),
    // Pi otherwise falls back to ~/.pi/agent and silently spends the developer's
    // real provider quota during what is supposed to be an isolated first run.
    PI_CODING_AGENT_DIR: input['PI_CODING_AGENT_DIR'] ?? join(root, 'pi-agent'),
    OPENALICE_AGENT_RUNTIME_INSTALLS: input['OPENALICE_AGENT_RUNTIME_INSTALLS'] ?? 'only:pi',
    OPENALICE_ONBOARDING_AI_MOCK_PORT: aiMockPort,
    OPENALICE_ONBOARDING_AI_BASE_URL: aiBaseUrl,
    VITE_OPENALICE_FIRST_RUN_GUIDE: input['VITE_OPENALICE_FIRST_RUN_GUIDE'] ?? '1',
    VITE_OPENALICE_ONBOARDING_TEST: '1',
    VITE_OPENALICE_CREDENTIAL_TEST_MODE: input['VITE_OPENALICE_CREDENTIAL_TEST_MODE'] ?? credentialTestMode,
    VITE_OPENALICE_ONBOARDING_AI_BASE_URL: input['VITE_OPENALICE_ONBOARDING_AI_BASE_URL'] ?? aiBaseUrl,
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
