import { readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll } from 'vitest'

export const cliEntry = join(dirname(fileURLToPath(import.meta.url)), '../../bin/openalice.ts')
export const transferFixtureEntry = join(
  dirname(fileURLToPath(import.meta.url)),
  'supervisor-transfer-tui-fixture.ts',
)
export const confirmationFixtureEntry = join(
  dirname(fileURLToPath(import.meta.url)),
  'supervisor-confirmation-tui-fixture.ts',
)
export const launchpadFixtureEntry = join(
  dirname(fileURLToPath(import.meta.url)),
  'supervisor-launchpad-tui-fixture.ts',
)
export const doctorPrimaryFixtureEntry = join(
  dirname(fileURLToPath(import.meta.url)),
  'supervisor-doctor-primary-tui-fixture.ts',
)
export const releaseFixtureEntry = join(
  dirname(fileURLToPath(import.meta.url)),
  'supervisor-release-tui-fixture.ts',
)
export const eventLensFixtureEntry = join(
  dirname(fileURLToPath(import.meta.url)),
  'supervisor-event-lens-tui-fixture.ts',
)
export const cliPackageRoot = dirname(dirname(cliEntry))
export const cliVersion = JSON.parse(
  await readFile(new URL('../../../../package.json', import.meta.url), 'utf8'),
).version
export const temporaryPaths: string[] = []
const originalStartView = process.env.OPENALICE_TUI_START_VIEW
const originalNoColor = process.env.NO_COLOR

beforeAll(() => {
  process.env.OPENALICE_TUI_START_VIEW = 'home'
  process.env.NO_COLOR = '1'
})

afterAll(() => {
  if (originalStartView === undefined) delete process.env.OPENALICE_TUI_START_VIEW
  else process.env.OPENALICE_TUI_START_VIEW = originalStartView
  if (originalNoColor === undefined) delete process.env.NO_COLOR
  else process.env.NO_COLOR = originalNoColor
})

export function stripSgr(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/gu, '')
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )))
})

export const projectCreateFixtureEntry = join(dirname(fileURLToPath(import.meta.url)), 'supervisor-project-create-fixture.ts')
