import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const temporaryPaths: string[] = []
const entrypoint = resolve('scripts/railway/entrypoint.sh')
const commandWrapper = resolve('scripts/railway/command-wrapper.sh')
const retainedLockPreflight = resolve('scripts/railway/preflight-retained-locks.py')
const shellEnvironment = resolve('scripts/railway/shell-env.sh')

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('Railway native CLI host entrypoint', () => {
  it('bootstraps an empty persistent volume and runs the Guardian in foreground mode', async () => {
    const fixture = await makeFixture({ installer: 'success' })

    await execFileAsync('bash', [entrypoint], { env: fixture.env })

    expect(await readFile(fixture.installCalled, 'utf8')).toContain('--channel beta')
    expect(await readFile(fixture.runtimeCalled, 'utf8')).toContain(
      `server run --home ${join(fixture.volume, 'projects', 'default')} --port 47331 --wait 180`,
    )
  })

  it('starts an existing verified release without contacting the installer', async () => {
    const fixture = await makeFixture({ installer: 'failure', existing: true })

    await execFileAsync('bash', [entrypoint], { env: fixture.env })

    await expect(readFile(fixture.installCalled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(fixture.runtimeCalled, 'utf8')).toContain('server run')
  })

  it('falls back to the existing release when an explicit refresh fails', async () => {
    const fixture = await makeFixture({ installer: 'failure', existing: true })

    const result = await execFileAsync('bash', [entrypoint], {
      env: { ...fixture.env, OPENALICE_RAILWAY_FORCE_INSTALL: '1' },
    })

    expect(result.stderr).toContain('starting previously verified OpenAlice 0.91.0-beta.1')
    expect(await readFile(fixture.installCalled, 'utf8')).toContain('--channel beta')
    expect(await readFile(fixture.runtimeCalled, 'utf8')).toContain('server run')
  })

  it('fails closed when an empty volume cannot be bootstrapped', async () => {
    const fixture = await makeFixture({ installer: 'failure' })

    await expect(execFileAsync('bash', [entrypoint], { env: fixture.env }))
      .rejects.toMatchObject({ stderr: expect.stringContaining('no previously verified OpenAlice release') })
    await expect(readFile(fixture.runtimeCalled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the user install layout fixed while selecting an overridden Project home', async () => {
    const fixture = await makeFixture({ installer: 'success' })
    const projectHome = join(fixture.volume, 'projects', 'main-cloud')

    await execFileAsync('bash', [entrypoint], {
      env: {
        ...fixture.env,
        OPENALICE_HOME: projectHome,
      },
    })

    expect(await readFile(fixture.runtimeCalled, 'utf8')).toContain([
      `HOME=${join(fixture.volume, 'home')}`,
      `OPENALICE_HOME=${projectHome}`,
      `AQ_LAUNCHER_ROOT=${join(projectHome, 'workspaces')}`,
      `OPENALICE_INSTALL_DIR=${join(fixture.volume, 'home', '.openalice')}`,
      `NPM_CONFIG_PREFIX=${join(fixture.volume, 'home', '.local')}`,
      `BUN_INSTALL=${join(fixture.volume, 'home', '.bun')}`,
    ].join('\n'))
  })

  it('rejects a persistent path that escapes the mounted volume after normalization', async () => {
    const fixture = await makeFixture({ installer: 'success' })

    await expect(execFileAsync('bash', [entrypoint], {
      env: { ...fixture.env, OPENALICE_HOME: join(fixture.volume, '..', 'outside') },
    })).rejects.toMatchObject({ stderr: expect.stringContaining('must stay beneath the persistent volume root') })
    await expect(readFile(fixture.installCalled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a Project Home inside the reserved reversible-quarantine tree', async () => {
    const fixture = await makeFixture({ installer: 'success' })

    await expect(execFileAsync('bash', [entrypoint], {
      env: {
        ...fixture.env,
        OPENALICE_HOME: join(fixture.volume, 'quarantine', 'old-project'),
      },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining('cannot select the reserved Railway quarantine tree'),
    })
    await expect(readFile(fixture.installCalled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a Project Home reached through a symlinked quarantine alias', async () => {
    const fixture = await makeFixture({ installer: 'success' })
    await mkdir(join(fixture.volume, 'quarantine-target'))
    await symlink('quarantine-target', join(fixture.volume, 'quarantine'))

    await expect(execFileAsync('bash', [entrypoint], {
      env: {
        ...fixture.env,
        OPENALICE_HOME: join(fixture.volume, 'quarantine', 'old-project'),
      },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining('cannot select the reserved Railway quarantine tree'),
    })
    await expect(readFile(fixture.installCalled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects the legacy Node-managed 0.90.1 release before invoking the installer', async () => {
    const fixture = await makeFixture({ installer: 'success' })

    await expect(execFileAsync('bash', [entrypoint], {
      env: {
        ...fixture.env,
        OPENALICE_RAILWAY_CHANNEL: 'stable',
        OPENALICE_RAILWAY_VERSION: '0.90.1',
      },
    })).rejects.toMatchObject({ stderr: expect.stringContaining('legacy Node-managed layout') })
    await expect(readFile(fixture.installCalled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.runIf(process.platform === 'linux')('rejects a Railway fence rooted at an ordinary directory instead of a mounted Volume', async () => {
    const fixture = await makeFixture({ installer: 'success' })

    await expect(execFileAsync('bash', [entrypoint], {
      env: {
        ...fixture.env,
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
    })).rejects.toMatchObject({ stderr: expect.stringContaining('must be an actual mount point') })
    await expect(readFile(fixture.installCalled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.runIf(process.platform === 'linux' && existsSync('/dev/shm'))('blocks legacy retained ownership before installer or Project mutation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-railway-legacy-preflight-'))
    const fixtureRoot = join('/dev/shm', `openalice-legacy-preflight-${process.pid}-${Date.now()}`)
    const legacyProject = join(fixtureRoot, 'projects', 'legacy-a')
    const selectedProject = join(fixtureRoot, 'projects', 'empty-b')
    temporaryPaths.push(root, fixtureRoot)
    const lockDir = join(legacyProject, 'state', 'guardian.lock')
    const installCalled = join(root, 'installer-called')
    const installer = join(root, 'install')
    await mkdir(lockDir, { recursive: true })
    await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
      schemaVersion: 1,
      pid: 101,
      hostname: 'legacy-container',
      machineId: 'env:railway-service-service-test',
      token: 'legacy-owner',
      launcher: 'guardian-cli-server',
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    }))
    await writeFile(installer, `#!/usr/bin/env bash\nprintf called >${JSON.stringify(installCalled)}\n`, { mode: 0o755 })

    await expect(execFileAsync('bash', [entrypoint], {
      env: {
        PATH: process.env.PATH,
        HOME: '/dev/shm/home',
        OPENALICE_HOME: selectedProject,
        OPENALICE_INSTALL_DIR: '/dev/shm/home/.openalice',
        NPM_CONFIG_PREFIX: '/dev/shm/home/.local',
        BUN_INSTALL: '/dev/shm/home/.bun',
        RAILWAY_VOLUME_MOUNT_PATH: '/dev/shm',
        OPENALICE_RAILWAY_VOLUME_ROOT: '/dev/shm',
        OPENALICE_RAILWAY_INSTALLER_PATH: installer,
        OPENALICE_RAILWAY_PREFLIGHT_PATH: retainedLockPreflight,
        OPENALICE_RAILWAY_COMMAND_WRAPPER_PATH: commandWrapper,
        OPENALICE_RAILWAY_LINK_DIR: join(root, 'links'),
        OPENALICE_RAILWAY_CHANNEL: 'dev',
        OPENALICE_RAILWAY_WAIT_SECONDS: '10',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining(
        `${fixtureRoot.slice('/dev/shm/'.length)}/projects/legacy-a/state/guardian.lock`,
      ),
    })
    await expect(readFile(installCalled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(existsSync(selectedProject)).toBe(false)
  })

  it('accepts only retained lock owners written by the same fenced Railway service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-railway-retained-locks-'))
    temporaryPaths.push(root)
    const project = join(root, 'project')
    const launcher = join(project, 'workspaces')
    const owner = {
      schemaVersion: 1,
      pid: 101,
      hostname: 'previous-container',
      machineId: 'env:railway-service-service-test',
      token: 'fenced-owner',
      launcher: 'guardian-cli-server',
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      fencingProtocol: 'railway-flock-v1',
    }
    for (const lockDir of [
      join(project, 'state', 'guardian.lock'),
      join(project, 'state', 'runtime.lock'),
      join(launcher, 'state', 'runtime.lock'),
      join(project, 'data', 'state', 'config-bootstrap.lock'),
    ]) {
      await mkdir(lockDir, { recursive: true })
      await writeFile(join(lockDir, 'owner.json'), JSON.stringify(owner))
    }

    await expect(execFileAsync('python3', [
      retainedLockPreflight,
      root,
      project,
      launcher,
      'env:railway-service-service-test',
    ])).resolves.toMatchObject({ stderr: '' })

    await writeFile(join(project, 'state', 'guardian.lock', 'owner.json'), JSON.stringify({
      ...owner,
      machineId: 'env:railway-service-other',
    }))
    await expect(execFileAsync('python3', [
      retainedLockPreflight,
      root,
      project,
      launcher,
      'env:railway-service-service-test',
    ])).rejects.toMatchObject({
      stderr: expect.stringContaining('state/guardian.lock'),
    })
  })

  it('discovers a nested legacy owner beyond another Project marker before an A-to-B cutover', async () => {
    const volume = await mkdtemp(join(tmpdir(), 'openalice-railway-volume-scan-'))
    temporaryPaths.push(volume)
    const outerProject = join(volume, 'projects', 'outer')
    const legacyProject = join(outerProject, 'nested', 'legacy-a')
    const selectedProject = join(volume, 'projects', 'empty-b')
    const lockDir = join(legacyProject, 'state', 'guardian.lock')
    await mkdir(lockDir, { recursive: true })
    await mkdir(join(outerProject, 'data', 'config'), { recursive: true })
    await writeFile(join(outerProject, 'data', 'config', 'alice-project.json'), '{}')
    await writeFile(join(lockDir, 'owner.json'), JSON.stringify({
      schemaVersion: 1,
      pid: 101,
      hostname: 'legacy-container',
      machineId: 'env:railway-service-service-test',
      token: 'legacy-owner',
      launcher: 'guardian-cli-server',
      acquiredAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    }))

    await expect(execFileAsync('python3', [
      retainedLockPreflight,
      volume,
      selectedProject,
      join(selectedProject, 'workspaces'),
      'env:railway-service-service-test',
    ])).rejects.toMatchObject({
      stderr: expect.stringContaining('projects/outer/nested/legacy-a/state/guardian.lock'),
    })
    expect(existsSync(selectedProject)).toBe(false)
  })

  it('rejects a configured machine identity that does not match the Railway service', async () => {
    const fixture = await makeFixture({ installer: 'success' })

    await expect(execFileAsync('bash', [entrypoint], {
      env: {
        ...fixture.env,
        OPENALICE_MACHINE_ID: 'railway-service-other',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining('must match the Railway service identity'),
    })
    await expect(readFile(fixture.installCalled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a Dashboard override that disables Railway lifecycle authority', async () => {
    const fixture = await makeFixture({ installer: 'success' })

    await expect(execFileAsync('bash', [entrypoint], {
      env: {
        ...fixture.env,
        OPENALICE_SERVICE_MANAGER: 'docker',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining('OPENALICE_SERVICE_MANAGER must be railway'),
    })
    await expect(readFile(fixture.installCalled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an invalid Railway lifecycle-fence wait bound', async () => {
    const fixture = await makeFixture({ installer: 'success' })

    await expect(execFileAsync('bash', [entrypoint], {
      env: {
        ...fixture.env,
        OPENALICE_RAILWAY_WAIT_SECONDS: '0',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining('must be between 1 and 600'),
    })
    await expect(readFile(fixture.installCalled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an ephemeral Railway shell home that would split SSH from the Runtime', async () => {
    const fixture = await makeFixture({ installer: 'success' })

    await expect(execFileAsync('bash', [entrypoint], {
      env: {
        ...fixture.env,
        HOME: '/root',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
    })).rejects.toMatchObject({ stderr: expect.stringContaining('HOME must use the persistent Railway user layout') })
    await expect(readFile(fixture.installCalled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('bakes the persistent SSH home and user executable paths into the Railway image', async () => {
    const dockerfile = await readFile(resolve('Dockerfile.railway'), 'utf8')

    expect(dockerfile).toMatch(/^FROM debian:bookworm-slim$/m)
    expect(dockerfile).not.toMatch(/^FROM node:/m)
    expect(dockerfile).toContain('util-linux')
    expect(dockerfile).toContain('HOME=/data/home')
    expect(dockerfile).toContain('OPENALICE_INSTALL_DIR=/data/home/.openalice')
    expect(dockerfile).toContain(
      'PATH=/usr/local/sbin:/usr/local/bin:/data/home/.openalice/bin:/data/home/.local/bin:/data/home/.bun/bin:',
    )
    expect(dockerfile).toContain('scripts/railway/command-wrapper.sh')
    expect(dockerfile).toContain('scripts/railway/preflight-retained-locks.py')
    expect(dockerfile).toContain('scripts/railway/shell-env.sh')
    expect(await readFile(entrypoint, 'utf8')).toContain('/usr/bin/flock --exclusive --timeout "$wait_seconds" 9')
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "-s", "-g", "--"')
  })

  it('restores the persistent user environment in a Railway login shell', async () => {
    const result = await execFileAsync('sh', [
      '-c',
      '. "$1"; printf "%s|%s|%s|%s\n" "$HOME" "$PATH" "$AQ_LAUNCHER_ROOT" "$OPENALICE_MACHINE_ID"',
      'openalice-shell-test',
      shellEnvironment,
    ], {
      env: {
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        HOME: '/root',
        OPENALICE_HOME: '/data/projects/main-cloud',
        OPENALICE_MACHINE_ID: 'railway-service-wrong',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
    })

    expect(result.stdout.trim()).toBe([
      '/data/home',
      '/usr/local/sbin:/usr/local/bin:/data/home/.openalice/bin:/data/home/.local/bin:/data/home/.bun/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      '/data/projects/main-cloud/workspaces',
      'railway-service-service-test',
    ].join('|'))
  })

  it('gives Railway SSH commands the same stable machine identity as the foreground Runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-railway-wrapper-'))
    temporaryPaths.push(root)
    const installRoot = join(root, 'install')
    const wrapper = join(root, 'openalice')
    await writeActiveRelease(installRoot, `#!/usr/bin/env bash
printf '%s|%s|%s\n' "\${OPENALICE_MACHINE_ID:-}" "$HOME" "$*"
`)
    await writeFile(wrapper, await readFile(commandWrapper), { mode: 0o755 })

    const result = await execFileAsync('bash', [wrapper, 'server', 'status'], {
      env: {
        PATH: process.env.PATH,
        HOME: '/data/home',
        OPENALICE_INSTALL_DIR: installRoot,
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
    })

    expect(result.stdout.trim()).toBe(
      'railway-service-service-test|/data/home|server status',
    )
  })

  it.each(['update', 'rollback', 'uninstall'])('keeps Railway %s mutations out of the persistent release', async (action) => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-railway-wrapper-authority-'))
    temporaryPaths.push(root)
    const installRoot = join(root, 'install')
    const wrapper = join(root, 'openalice')
    const invoked = join(root, 'invoked')
    await writeActiveRelease(
      installRoot,
      `#!/usr/bin/env bash\nprintf 'invoked' >${JSON.stringify(invoked)}\n`,
    )
    await writeFile(wrapper, await readFile(commandWrapper), { mode: 0o755 })

    const result = await execFileAsync('bash', [wrapper, action, '--yes'], {
      env: {
        PATH: process.env.PATH,
        HOME: '/data/home',
        OPENALICE_INSTALL_DIR: installRoot,
        OPENALICE_SERVICE_MANAGER: 'railway',
        RAILWAY_ENVIRONMENT_ID: 'environment-test',
        RAILWAY_SERVICE_ID: 'service-test',
      },
    })

    expect(result.stdout).toContain('openalice railway:')
    await expect(readFile(invoked, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('replaces the persistent installer launcher so old releases cannot bypass Railway authority', async () => {
    const fixture = await makeFixture({ installer: 'success' })

    await execFileAsync('bash', [entrypoint], { env: fixture.env })
    const before = await readFile(fixture.runtimeCalled, 'utf8')
    const result = await execFileAsync('bash', [fixture.launcher, 'update', '--channel', 'stable', '--yes'], {
      env: {
        ...fixture.env,
        OPENALICE_INSTALL_DIR: join(fixture.volume, 'home', '.openalice'),
        OPENALICE_SERVICE_MANAGER: 'railway',
      },
    })

    expect(result.stdout).toContain('service variables own release selection')
    expect(await readFile(fixture.runtimeCalled, 'utf8')).toBe(before)
  })

  it('rejects a configured volume root that disagrees with the Railway mount', async () => {
    const fixture = await makeFixture({ installer: 'success' })

    await expect(execFileAsync('bash', [entrypoint], {
      env: {
        ...fixture.env,
        OPENALICE_RAILWAY_VOLUME_ROOT: join(fixture.volume, 'other'),
      },
    })).rejects.toMatchObject({ stderr: expect.stringContaining('must match the Railway Volume mount path') })
    await expect(readFile(fixture.installCalled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refreshes an exact pin mismatch and names the verified fallback when refresh fails', async () => {
    const fixture = await makeFixture({ installer: 'failure', existing: true })

    const result = await execFileAsync('bash', [entrypoint], {
      env: { ...fixture.env, OPENALICE_RAILWAY_VERSION: '0.91.0-beta.2' },
    })

    expect(await readFile(fixture.installCalled, 'utf8')).toContain('--version 0.91.0-beta.2')
    expect(result.stderr).toContain('starting previously verified OpenAlice 0.91.0-beta.1')
  })

  it('falls back when the installer exits successfully without producing the selected release', async () => {
    const fixture = await makeFixture({ installer: 'noop', existing: true })

    const result = await execFileAsync('bash', [entrypoint], {
      env: { ...fixture.env, OPENALICE_RAILWAY_VERSION: '0.91.0-beta.2' },
    })

    expect(result.stderr).toContain('installer returned without the selected verified release')
    expect(result.stderr).toContain('starting previously verified OpenAlice 0.91.0-beta.1')
    expect(await readFile(fixture.runtimeCalled, 'utf8')).toContain('server run')
  })

  it('restores the exact previous pointer when a successful installer activates another valid release', async () => {
    const fixture = await makeSwitchingFixture()

    const result = await execFileAsync('bash', [entrypoint], { env: fixture.env })

    expect(result.stderr).toContain('installer returned without the selected verified release')
    expect(result.stderr).toContain('starting previously verified OpenAlice 0.91.0-beta.1')
    expect(await readlink(fixture.current)).toBe(`releases/${fixture.previousReleaseName}`)
    expect(await readFile(fixture.runtimeCalled, 'utf8')).toContain(`release=${fixture.previousReleaseName}`)
  })

  it('resolves the rolling dev selector on every container start and keeps the exact fallback', async () => {
    const fixture = await makeFixture({ installer: 'failure', existing: true, existingChannel: 'dev' })

    const result = await execFileAsync('bash', [entrypoint], {
      env: {
        ...fixture.env,
        OPENALICE_RAILWAY_CHANNEL: 'dev',
        OPENALICE_RAILWAY_VERSION: '',
      },
    })

    expect(await readFile(fixture.installCalled, 'utf8')).toContain('--channel dev')
    expect(result.stderr).toContain('starting previously verified OpenAlice 0.91.0-dev.1')
    expect(await readFile(fixture.runtimeCalled, 'utf8')).toContain('server run')
  })

  it('does not treat a launcher with incomplete provenance as a verified fallback', async () => {
    const fixture = await makeFixture({ installer: 'failure', existing: true })
    await writeFile(fixture.launcher, `#!/usr/bin/env bash
if [[ "\${1:-}" == --version ]]; then printf '0.91.0-beta.1\\n'; exit 0; fi
if [[ "\${1:-}" == version ]]; then printf '{"version":"0.91.0-beta.1"}\\n'; exit 0; fi
exit 1
`, { mode: 0o755 })

    await expect(execFileAsync('bash', [entrypoint], { env: fixture.env }))
      .rejects.toMatchObject({ stderr: expect.stringContaining('no previously verified OpenAlice release') })
  })

  it('rejects a native release that cannot retain the Railway lifecycle fence', async () => {
    const fixture = await makeFixture({
      installer: 'failure',
      existing: true,
      existingFenceCapability: false,
    })

    await expect(execFileAsync('bash', [entrypoint], { env: fixture.env }))
      .rejects.toMatchObject({ stderr: expect.stringContaining('no previously verified OpenAlice release') })
    await expect(readFile(fixture.runtimeCalled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

})

async function makeFixture(options: {
  installer: 'success' | 'failure' | 'noop'
  existing?: boolean
  existingChannel?: 'beta' | 'dev'
  existingFenceCapability?: boolean
}) {
  const root = await mkdtemp(join(tmpdir(), 'openalice-railway-entrypoint-'))
  temporaryPaths.push(root)
  const volumePath = join(root, 'volume')
  const installer = join(root, 'install')
  const installCalled = join(root, 'installer-called')
  const runtimeCalled = join(root, 'runtime-called')
  const linkDir = join(root, 'links')
  await mkdir(volumePath, { recursive: true })
  const volume = await realpath(volumePath)
  const installRoot = join(volume, 'home', '.openalice')
  await writeInstaller(installer, options.installer, installCalled, runtimeCalled)
  if (options.existing) {
    await writeLauncher(join(installRoot, 'bin', 'openalice'), runtimeCalled, {
      ...(options.existingChannel === 'dev'
        ? { version: '0.91.0-dev.1', channel: 'dev' as const }
        : {}),
      ...(options.existingFenceCapability === false ? { runtimeCapabilities: [] } : {}),
    })
  }
  return {
    volume,
    launcher: join(installRoot, 'bin', 'openalice'),
    installCalled,
    runtimeCalled,
    env: {
      PATH: process.env.PATH,
      RAILWAY_VOLUME_MOUNT_PATH: volume,
      OPENALICE_RAILWAY_VOLUME_ROOT: volume,
      OPENALICE_RAILWAY_INSTALLER_PATH: installer,
      OPENALICE_RAILWAY_COMMAND_WRAPPER_PATH: commandWrapper,
      OPENALICE_RAILWAY_LINK_DIR: linkDir,
      OPENALICE_RAILWAY_CHANNEL: 'beta',
      OPENALICE_RAILWAY_VERSION: '0.91.0-beta.1',
    },
  }
}

async function makeSwitchingFixture() {
  const root = await mkdtemp(join(tmpdir(), 'openalice-railway-switch-'))
  temporaryPaths.push(root)
  const volumePath = join(root, 'volume')
  const volume = await realpath(await mkdir(volumePath, { recursive: true }).then(() => volumePath))
  const installRoot = join(volume, 'home', '.openalice')
  const cliRoot = join(installRoot, 'cli')
  const previousReleaseName = '0.91.0-beta.1-linux-x64-aaaaaaaaaaaaaaaa'
  const otherReleaseName = '0.91.0-beta.3-linux-x64-bbbbbbbbbbbbbbbb'
  const runtimeCalled = join(root, 'runtime-called')
  const installCalled = join(root, 'installer-called')
  const installer = join(root, 'install')
  const current = join(cliRoot, 'current')
  const previousRuntimeRoot = join(cliRoot, 'releases', previousReleaseName)
  const previousProfile = { version: '0.91.0-beta.1', channel: 'beta' as const, identity: 'aaaaaaaaaaaaaaaa' }
  await mkdir(join(installRoot, 'bin'), { recursive: true })
  await writeDynamicLauncher(join(installRoot, 'bin', 'openalice'))
  await writeReleaseLauncher(
    previousRuntimeRoot,
    runtimeCalled,
    previousReleaseName,
    previousProfile,
  )
  await writeReleaseLauncher(
    join(cliRoot, 'releases', otherReleaseName),
    runtimeCalled,
    otherReleaseName,
    { version: '0.91.0-beta.3', channel: 'beta', identity: 'bbbbbbbbbbbbbbbb' },
  )
  await symlink(`releases/${previousReleaseName}`, current)
  await writeFile(installer, `#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >'${installCalled}'
printf '%s\n' '${JSON.stringify(versionPayload(previousRuntimeRoot, {
    ...previousProfile,
    installedAt: '2026-08-31T02:00:00.000Z',
  }))}' >'${join(previousRuntimeRoot, 'version.json')}'
rm -f "$OPENALICE_INSTALL_DIR/cli/current"
ln -s 'releases/${otherReleaseName}' "$OPENALICE_INSTALL_DIR/cli/current"
`, { mode: 0o755 })
  return {
    current,
    previousReleaseName,
    runtimeCalled,
    env: {
      PATH: process.env.PATH,
      RAILWAY_VOLUME_MOUNT_PATH: volume,
      OPENALICE_RAILWAY_VOLUME_ROOT: volume,
      OPENALICE_RAILWAY_INSTALLER_PATH: installer,
      OPENALICE_RAILWAY_COMMAND_WRAPPER_PATH: commandWrapper,
      OPENALICE_RAILWAY_LINK_DIR: join(root, 'links'),
      OPENALICE_RAILWAY_CHANNEL: 'beta',
      OPENALICE_RAILWAY_VERSION: '0.91.0-beta.2',
    },
  }
}

async function writeInstaller(
  path: string,
  outcome: 'success' | 'failure' | 'noop',
  installCalled: string,
  runtimeCalled: string,
) {
  await writeFile(path, outcome !== 'success'
    ? `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >'${installCalled}'\n${outcome === 'failure' ? 'exit 23' : 'exit 0'}\n`
    : `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >'${installCalled}'
mkdir -p "$OPENALICE_INSTALL_DIR/bin"
mkdir -p "$OPENALICE_INSTALL_DIR/cli/releases/0.91.0-beta.1-linux-x64-aaaaaaaaaaaaaaaa/bin"
ln -sfn 'releases/0.91.0-beta.1-linux-x64-aaaaaaaaaaaaaaaa' "$OPENALICE_INSTALL_DIR/cli/current"
cat >"$OPENALICE_INSTALL_DIR/cli/current/bin/openalice" <<'LAUNCHER'
#!/usr/bin/env bash
if [[ "\${1:-}" == --version ]]; then printf '0.91.0-beta.1\\n'; exit 0; fi
if [[ "\${1:-}" == version && "\${2:-}" == --json ]]; then
  printf '{"version":"0.91.0-beta.1","installSource":{"schemaVersion":3,"repository":"TraderAlice/OpenAlice","cliVersion":"0.91.0-beta.1","selector":{"kind":"version","value":"v0.91.0-beta.1"},"installerUrl":"https://openalice.ai/install","updateChannel":"beta","method":"direct","artifact":{"platform":"linux","arch":"x64","sha256":"%s"},"installedAt":"2026-08-31T00:00:00.000Z"},"contentIdentity":"aaaaaaaaaaaaaaaa","managedRuntime":{"productVersion":"0.91.0-beta.1","platform":"linux","arch":"x64","path":"%s","contentIdentity":"aaaaaaaaaaaaaaaa"},"runtimeCapabilities":["railway-flock-v1"]}\\n' \\
    "$(printf '0%.0s' {1..64})" "$OPENALICE_INSTALL_DIR/cli/releases/0.91.0-beta.1-linux-x64-aaaaaaaaaaaaaaaa"
  exit 0
fi
if [[ -n "\${OPENALICE_RAILWAY_FENCE_FD:-}" ]]; then
  grep -Eq '^lock:[[:space:]]+[0-9]+:[[:space:]]+FLOCK[[:space:]]+ADVISORY[[:space:]]+WRITE' "/proc/self/fdinfo/\${OPENALICE_RAILWAY_FENCE_FD}" || exit 97
fi
printf 'HOME=%s\\nOPENALICE_HOME=%s\\nAQ_LAUNCHER_ROOT=%s\\nOPENALICE_INSTALL_DIR=%s\\nNPM_CONFIG_PREFIX=%s\\nBUN_INSTALL=%s\\nOPENALICE_MACHINE_ID=%s\\nOPENALICE_RAILWAY_ENTRYPOINT_OWNER=%s\\nOPENALICE_RAILWAY_FENCE_FD=%s\\n' \\
  "$HOME" "$OPENALICE_HOME" "$AQ_LAUNCHER_ROOT" "$OPENALICE_INSTALL_DIR" "$NPM_CONFIG_PREFIX" "$BUN_INSTALL" "\${OPENALICE_MACHINE_ID:-}" "\${OPENALICE_RAILWAY_ENTRYPOINT_OWNER:-}" "\${OPENALICE_RAILWAY_FENCE_FD:-}" >'${runtimeCalled}'
printf '%s\\n' "$*" >>'${runtimeCalled}'
LAUNCHER
chmod 0755 "$OPENALICE_INSTALL_DIR/cli/current/bin/openalice"
ln -s ../cli/current/bin/openalice "$OPENALICE_INSTALL_DIR/bin/openalice"
`, { mode: 0o755 })
  await chmod(path, 0o755)
}

async function writeLauncher(
  path: string,
  runtimeCalled: string,
  profile: { version?: string; channel?: 'beta' | 'dev'; identity?: string; runtimeCapabilities?: string[] } = {},
) {
  const installRoot = resolve(path, '..', '..')
  const version = profile.version ?? '0.91.0-beta.1'
  const channel = profile.channel ?? 'beta'
  const identity = profile.identity ?? 'aaaaaaaaaaaaaaaa'
  const releaseName = `${version}-linux-x64-${identity}`
  const runtimeRoot = join(installRoot, 'cli', 'releases', releaseName)
  await mkdir(join(runtimeRoot, 'bin'), { recursive: true })
  await mkdir(join(path, '..'), { recursive: true })
  await symlink(join('releases', releaseName), join(installRoot, 'cli', 'current'))
  await writeFile(join(runtimeRoot, 'bin', 'openalice'), `#!/usr/bin/env bash
if [[ "\${1:-}" == --version ]]; then printf '${version}\\n'; exit 0; fi
if [[ "\${1:-}" == version && "\${2:-}" == --json ]]; then printf '%s\\n' '${JSON.stringify(versionPayload(runtimeRoot, { version, channel, identity, runtimeCapabilities: profile.runtimeCapabilities }))}'; exit 0; fi
if [[ -n "\${OPENALICE_RAILWAY_FENCE_FD:-}" ]]; then
  grep -Eq '^lock:[[:space:]]+[0-9]+:[[:space:]]+FLOCK[[:space:]]+ADVISORY[[:space:]]+WRITE' "/proc/self/fdinfo/\${OPENALICE_RAILWAY_FENCE_FD}" || exit 97
fi
printf 'HOME=%s\\nOPENALICE_HOME=%s\\nAQ_LAUNCHER_ROOT=%s\\nOPENALICE_INSTALL_DIR=%s\\nNPM_CONFIG_PREFIX=%s\\nBUN_INSTALL=%s\\nOPENALICE_MACHINE_ID=%s\\nOPENALICE_RAILWAY_ENTRYPOINT_OWNER=%s\\nOPENALICE_RAILWAY_FENCE_FD=%s\\n' \\
  "$HOME" "$OPENALICE_HOME" "$AQ_LAUNCHER_ROOT" "$OPENALICE_INSTALL_DIR" "$NPM_CONFIG_PREFIX" "$BUN_INSTALL" "\${OPENALICE_MACHINE_ID:-}" "\${OPENALICE_RAILWAY_ENTRYPOINT_OWNER:-}" "\${OPENALICE_RAILWAY_FENCE_FD:-}" >'${runtimeCalled}'
printf '%s\\n' "$*" >>'${runtimeCalled}'
`, { mode: 0o755 })
  await writeDynamicLauncher(path)
}

async function writeDynamicLauncher(path: string) {
  await writeFile(path, `#!/usr/bin/env bash
set -eu
release_root="$(CDPATH= cd -- "$OPENALICE_INSTALL_DIR/cli/current" && pwd -P)"
exec "$release_root/bin/openalice" "$@"
`, { mode: 0o755 })
}

async function writeActiveRelease(installRoot: string, executable: string) {
  const releaseName = '0.91.0-beta.1-linux-x64-aaaaaaaaaaaaaaaa'
  const releaseRoot = join(installRoot, 'cli', 'releases', releaseName)
  await mkdir(join(releaseRoot, 'bin'), { recursive: true })
  await writeFile(join(releaseRoot, 'bin', 'openalice'), executable, { mode: 0o755 })
  await symlink(join('releases', releaseName), join(installRoot, 'cli', 'current'))
}

async function writeReleaseLauncher(
  runtimeRoot: string,
  runtimeCalled: string,
  releaseName: string,
  profile: { version: string; channel: 'beta' | 'dev'; identity: string; installedAt?: string; runtimeCapabilities?: string[] },
) {
  await mkdir(join(runtimeRoot, 'bin'), { recursive: true })
  const versionFile = join(runtimeRoot, 'version.json')
  await writeFile(versionFile, `${JSON.stringify(versionPayload(runtimeRoot, profile))}\n`)
  await writeFile(join(runtimeRoot, 'bin', 'openalice'), `#!/usr/bin/env bash
if [[ "\${1:-}" == --version ]]; then printf '${profile.version}\\n'; exit 0; fi
if [[ "\${1:-}" == version && "\${2:-}" == --json ]]; then cat '${versionFile}'; exit 0; fi
printf 'release=${releaseName}\\n%s\\n' "$*" >'${runtimeCalled}'
`, { mode: 0o755 })
}

function versionPayload(
  runtimeRoot: string,
  profile: { version?: string; channel?: 'beta' | 'dev'; identity?: string; installedAt?: string; runtimeCapabilities?: string[] } = {},
) {
  const version = profile.version ?? '0.91.0-beta.1'
  const channel = profile.channel ?? 'beta'
  const identity = profile.identity ?? 'aaaaaaaaaaaaaaaa'
  return {
    version,
    installSource: {
      schemaVersion: 3,
      repository: 'TraderAlice/OpenAlice',
      cliVersion: version,
      selector: channel === 'dev'
        ? { kind: 'branch', value: 'dev' }
        : { kind: 'version', value: `v${version}` },
      installerUrl: 'https://openalice.ai/install',
      updateChannel: channel === 'dev' ? 'development' : channel,
      method: 'direct',
      artifact: { platform: 'linux', arch: 'x64', sha256: '0'.repeat(64) },
      installedAt: profile.installedAt ?? '2026-08-31T00:00:00.000Z',
    },
    contentIdentity: identity,
    runtimeCapabilities: profile.runtimeCapabilities ?? ['railway-flock-v1'],
    managedRuntime: {
      productVersion: version,
      platform: 'linux',
      arch: 'x64',
      path: runtimeRoot,
      contentIdentity: identity,
    },
  }
}
