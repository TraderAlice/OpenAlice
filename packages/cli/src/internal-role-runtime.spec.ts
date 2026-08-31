import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

describe('private Runtime role fencing', () => {
  it('refuses a direct Railway Connector writer without the Guardian fence', () => {
    const home = join(tmpdir(), `openalice-connector-no-fence-${process.pid}-${randomUUID()}`)
    const result = spawnSync(process.execPath, [
      '--import',
      'tsx',
      'packages/cli/bin/openalice-bun.ts',
      '--internal-role',
      'connector',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_OPTIONS: '--conditions=openalice-source',
        OPENALICE_HOME: home,
        AQ_LAUNCHER_ROOT: join(home, 'workspaces'),
        OPENALICE_SERVICE_MANAGER: 'railway',
        OPENALICE_MACHINE_ID: 'railway-service-service-test',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
      encoding: 'utf8',
      timeout: 10_000,
    })

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
    expect(result.stderr).toContain(
      'invalid or missing inherited Railway lifecycle fence; refusing to start Connector',
    )
    expect(existsSync(home)).toBe(false)
  })

  it('refuses a direct Railway Alice writer without creating Project state', () => {
    const home = join(tmpdir(), `openalice-alice-no-fence-${process.pid}-${randomUUID()}`)
    const result = spawnSync(process.execPath, [
      '--import',
      'tsx',
      'packages/cli/bin/openalice-bun.ts',
      '--internal-role',
      'alice',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_OPTIONS: '--conditions=openalice-source',
        OPENALICE_HOME: home,
        AQ_LAUNCHER_ROOT: join(home, 'workspaces'),
        OPENALICE_SERVICE_MANAGER: 'railway',
        OPENALICE_MACHINE_ID: 'railway-service-service-test',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
      encoding: 'utf8',
      timeout: 10_000,
    })

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(1)
    expect(result.stderr).toContain(
      'invalid or missing inherited Railway lifecycle fence; refusing to start Alice',
    )
    expect(existsSync(home)).toBe(false)
  })
})
