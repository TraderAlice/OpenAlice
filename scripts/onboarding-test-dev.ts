import { spawn } from 'node:child_process'
import type { AddressInfo } from 'node:net'

import { startOnboardingAiMockServer } from './onboarding-ai-mock.js'
import { buildOnboardingTestEnv } from './onboarding-test-env.js'

const printOnly = process.argv.includes('--print-env')
const credentialTestMode = process.env['OPENALICE_CREDENTIAL_TEST_MODE']?.trim() || 'mock'
const requestedMockPort = Number(process.env['OPENALICE_ONBOARDING_AI_MOCK_PORT']?.trim() || '0')
if (!Number.isInteger(requestedMockPort) || requestedMockPort < 0 || requestedMockPort > 65_535) {
  throw new Error('OPENALICE_ONBOARDING_AI_MOCK_PORT must be an integer from 0 to 65535')
}
const mockServer = !printOnly && credentialTestMode === 'mock'
  ? await startOnboardingAiMockServer(requestedMockPort)
  : null
const boundMockPort = mockServer
  ? (mockServer.address() as AddressInfo).port
  : undefined
const { root, env } = buildOnboardingTestEnv(process.env, {
  ...(boundMockPort !== undefined ? { aiMockPort: boundMockPort } : {}),
})

console.log('')
console.log('[onboarding-test] starting OpenAlice with isolated first-run state')
console.log(`[onboarding-test] root       → ${root}`)
console.log(`[onboarding-test] data       → ${env['OPENALICE_HOME']}`)
console.log(`[onboarding-test] workspaces → ${env['AQ_LAUNCHER_ROOT']}`)
console.log(`[onboarding-test] global     → ${env['OPENALICE_GLOBAL_DIR']}`)
console.log(`[onboarding-test] agents     → ${env['OPENALICE_AGENT_RUNTIME_INSTALLS']}`)
console.log(`[onboarding-test] cred test  → ${env['OPENALICE_CREDENTIAL_TEST_MODE']}`)
console.log(`[onboarding-test] AI mock    → ${env['OPENALICE_ONBOARDING_AI_BASE_URL']}`)
console.log(`[onboarding-test] guide     → ${env['VITE_OPENALICE_FIRST_RUN_GUIDE'] === '1' ? 'enabled' : 'disabled'}`)
console.log(`[onboarding-test] storage   → ${env['VITE_OPENALICE_ONBOARDING_STORAGE_SUFFIX']}`)
console.log(`[onboarding-test] UI         → http://localhost:${env['OPENALICE_UI_PORT']}`)
console.log('')

if (printOnly) {
  console.log(JSON.stringify({
    root,
    OPENALICE_HOME: env['OPENALICE_HOME'],
    AQ_LAUNCHER_ROOT: env['AQ_LAUNCHER_ROOT'],
    OPENALICE_GLOBAL_DIR: env['OPENALICE_GLOBAL_DIR'],
    OPENALICE_AGENT_RUNTIME_INSTALLS: env['OPENALICE_AGENT_RUNTIME_INSTALLS'],
    OPENALICE_CREDENTIAL_TEST_MODE: env['OPENALICE_CREDENTIAL_TEST_MODE'],
    OPENALICE_ONBOARDING_AI_MOCK_PORT: env['OPENALICE_ONBOARDING_AI_MOCK_PORT'],
    OPENALICE_ONBOARDING_AI_BASE_URL: env['OPENALICE_ONBOARDING_AI_BASE_URL'],
    PI_CODING_AGENT_DIR: env['PI_CODING_AGENT_DIR'],
    VITE_OPENALICE_FIRST_RUN_GUIDE: env['VITE_OPENALICE_FIRST_RUN_GUIDE'],
    OPENALICE_TRADING_MODE: env['OPENALICE_TRADING_MODE'] ?? null,
    VITE_OPENALICE_ONBOARDING_TEST: env['VITE_OPENALICE_ONBOARDING_TEST'],
    VITE_OPENALICE_CREDENTIAL_TEST_MODE: env['VITE_OPENALICE_CREDENTIAL_TEST_MODE'],
    VITE_OPENALICE_ONBOARDING_AI_BASE_URL: env['VITE_OPENALICE_ONBOARDING_AI_BASE_URL'],
    VITE_OPENALICE_ONBOARDING_STORAGE_SUFFIX: env['VITE_OPENALICE_ONBOARDING_STORAGE_SUFFIX'],
    OPENALICE_UI_PORT: env['OPENALICE_UI_PORT'],
  }, null, 2))
  process.exit(0)
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const child = spawn(pnpm, ['dev'], {
  env,
  stdio: 'inherit',
})

const closeMockServer = (): Promise<void> => new Promise((resolve) => {
  if (!mockServer) return resolve()
  mockServer.close(() => resolve())
})

child.on('error', async (error) => {
  await closeMockServer()
  console.error('[onboarding-test] failed to start OpenAlice:', error)
  process.exit(1)
})

child.on('exit', async (code, signal) => {
  await closeMockServer()
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
