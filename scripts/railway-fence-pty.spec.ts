import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const linuxIt = process.platform === 'linux' && existsSync('/dev/shm') ? it : it.skip

describe('Railway lifecycle fence PTY isolation', () => {
  linuxIt('retains the validated writer fd without exposing it to child processes or node-pty', () => {
    const volumeRoot = '/dev/shm'
    const home = join(volumeRoot, `openalice-railway-fence-pty-${process.pid}`)
    const fixture = resolve('scripts/railway-fence-pty-fixture.ts')
    const result = spawnSync('/bin/bash', ['-lc', `
set -euo pipefail
mkdir -p "$OPENALICE_HOME" "$OPENALICE_INSTALL_DIR"
exec 9<"$OPENALICE_RAILWAY_VOLUME_ROOT"
flock --exclusive 9
export OPENALICE_RAILWAY_FENCE_FD=3
export OPENALICE_TEST_FENCE_PATH="$OPENALICE_RAILWAY_VOLUME_ROOT"
"$OPENALICE_TEST_NODE" --import tsx "$OPENALICE_TEST_FIXTURE" 3<&9 9<&-
if (exec 9<&-; flock --nonblock "$OPENALICE_RAILWAY_VOLUME_ROOT" /bin/true); then
  printf 'PARENT_FENCE_LOST\\n'
  exit 42
fi
printf 'GUARDIAN_COPY_HELD\\n'
exec 9<&-
# Another Vitest file also exercises the real /dev/shm mount fence. Wait for
# that short-lived, legitimate contender instead of making this release probe
# race whichever spec happens to acquire the shared mount inode next. A leaked
# PTY descendant still keeps this blocked until the timeout and fails the test.
flock --exclusive --timeout 10 "$OPENALICE_RAILWAY_VOLUME_ROOT" /bin/true
printf 'FENCE_RELEASED\\n'
`], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENALICE_HOME: home,
        OPENALICE_INSTALL_DIR: join(home, 'install'),
        OPENALICE_RAILWAY_VOLUME_ROOT: volumeRoot,
        RAILWAY_VOLUME_MOUNT_PATH: volumeRoot,
        OPENALICE_SERVICE_MANAGER: 'railway',
        OPENALICE_MACHINE_ID: 'railway-service-fence-pty-test',
        RAILWAY_SERVICE_ID: 'fence-pty-test',
        RAILWAY_ENVIRONMENT_ID: 'fence-pty-environment',
        OPENALICE_RAILWAY_ENTRYPOINT_OWNER: '1',
        OPENALICE_RAILWAY_INSTANCE_ID: '22222222-2222-4222-8222-222222222222',
        OPENALICE_TEST_NODE: process.execPath,
        OPENALICE_TEST_FIXTURE: fixture,
        NODE_OPTIONS: '--conditions=openalice-source',
      },
      encoding: 'utf8',
      timeout: 30_000,
    })

    try {
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      expect(result.stdout).toContain('PTY_FENCE_ISOLATED')
      expect(result.stdout).toContain('ORDINARY_FENCE_ISOLATED')
      expect(result.stdout).toContain('EXPLICIT_FENCE_CONTROL')
      expect(result.stdout).toContain('GUARDIAN_COPY_HELD')
      expect(result.stdout).toContain('FENCE_RELEASED')
      expect(result.stdout).not.toContain('FENCE_LEAK:')
      expect(result.stdout).not.toContain('PARENT_FENCE_LOST')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
