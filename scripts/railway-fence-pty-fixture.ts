import { statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import { adoptRailwayRuntimeFence } from '@traderalice/guardian-runtime'
import * as pty from 'node-pty'

const rawFenceFd = process.env['OPENALICE_RAILWAY_FENCE_FD']
const fencePath = process.env['OPENALICE_TEST_FENCE_PATH']
const fenceFd = Number(rawFenceFd)
if (!fencePath || !Number.isInteger(fenceFd)) {
  throw new Error('fixture requires an inherited Railway fence descriptor')
}

const authority = adoptRailwayRuntimeFence(process.env)
if (authority !== 'railway-fenced-handoff') {
  throw new Error(`fixture did not validate fenced handoff authority: ${authority}`)
}
if (
  'OPENALICE_RAILWAY_FENCE_FD' in process.env
  || 'OPENALICE_RAILWAY_ENTRYPOINT_OWNER' in process.env
) {
  throw new Error('fixture retained Railway fence environment markers after adoption')
}

const fenceIdentity = statIdentity(fencePath)
if (statIdentity(`/proc/self/fd/${fenceFd}`) !== fenceIdentity) {
  throw new Error(`trusted writer did not retain Railway fence fd ${fenceFd}`)
}

const descendantProbe = `
target="$(stat -Lc '%d:%i' "$OPENALICE_TEST_FENCE_PATH")"
for candidate in /proc/$$/fd/[0-9]*; do
  current="$(stat -Lc '%d:%i' "$candidate" 2>/dev/null || true)"
  if [ "$current" = "$target" ]; then
    printf 'FENCE_LEAK:%s\\n' "$candidate"
    exit 41
  fi
done
printf '%s\\n' "$OPENALICE_TEST_SUCCESS"
`
const ordinary = spawnSync('/bin/sh', ['-lc', descendantProbe], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    OPENALICE_TEST_SUCCESS: 'ORDINARY_FENCE_ISOLATED',
  },
  encoding: 'utf8',
})
process.stdout.write(ordinary.stdout)
if (ordinary.status !== 0 || ordinary.stdout.includes('FENCE_LEAK:')) {
  throw new Error(`ordinary child inherited the Railway fence (exit ${ordinary.status})`)
}

const explicitControl = spawnSync('/bin/sh', ['-lc', descendantProbe], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    OPENALICE_TEST_SUCCESS: 'EXPLICIT_FENCE_MISSING',
  },
  stdio: ['ignore', 'pipe', 'pipe', fenceFd],
  encoding: 'utf8',
})
if (explicitControl.status !== 41 || !explicitControl.stdout.includes('FENCE_LEAK:')) {
  throw new Error(`explicit fence inheritance control failed (exit ${explicitControl.status})`)
}
process.stdout.write('EXPLICIT_FENCE_CONTROL\n')

const child = pty.spawn('/bin/sh', ['-lc', `
target="$(stat -Lc '%d:%i' "$OPENALICE_TEST_FENCE_PATH")"
for candidate in /proc/$$/fd/[0-9]*; do
  current="$(stat -Lc '%d:%i' "$candidate" 2>/dev/null || true)"
  if [ "$current" = "$target" ]; then
    printf 'FENCE_LEAK:%s\\n' "$candidate"
    exit 41
  fi
done
printf 'PTY_FENCE_ISOLATED\\n'
`], {
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env as Record<string, string>,
})

let output = ''
child.onData((chunk) => { output += chunk })
const exitCode = await new Promise<number>((resolve) => {
  child.onExit(({ exitCode: code }) => resolve(code))
})
process.stdout.write(output)
if (exitCode !== 0 || !output.includes('PTY_FENCE_ISOLATED') || output.includes('FENCE_LEAK:')) {
  throw new Error(`PTY inherited the Railway fence (exit ${exitCode})`)
}

function statIdentity(path: string): string {
  const row = statSync(path)
  return `${row.dev}:${row.ino}`
}
