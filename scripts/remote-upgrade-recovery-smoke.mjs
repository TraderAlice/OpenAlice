/** Explicit external acceptance: published artifacts on the disposable SSH host. */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { compareVersions } from '@traderalice/update-lifecycle'
import { connectRemote, createRemotePlan, parseRemoteArgs, probeRemoteHost } from '../packages/cli/src/remote.mjs'
import { allocateLoopbackPort, waitForOpenAlice } from '../packages/cli/src/runtime-client.mjs'

export async function verifyRemoteUpgradeRecovery({ from, to, remoteTarget, env, scratch, run, remoteJson }) {
  if (compareVersions(to, from) <= 0) throw new Error('Recovery acceptance requires an increasing release pair')
  const project = '/home/smoke/upgrade-recovery'
  const statusCommand = `"$HOME/.openalice/bin/openalice" server status --home '${project}' --json`
  const ssh = command => run('ssh', [remoteTarget, command], { env })
  const install = version => {
    console.log(`[remote-upgrade-recovery] installing published ${version}`)
    ssh(`bash /fixture/www/install --channel ${version.includes('-') ? 'beta' : 'stable'} --version '${version}' --yes --no-modify-path`)
  }
  install(from)
  ssh(`OPENALICE_TRADING_MODE=lite "$HOME/.openalice/bin/openalice" server start --home '${project}' --wait 120`)
  const previous = remoteJson(remoteTarget, env, statusCommand)
  if (previous.class !== 'running' || previous.productVersion !== from) throw new Error('Previous published Runtime did not start')
  install(to)
  const pending = remoteJson(remoteTarget, env, statusCommand)
  if (pending.owner?.pid !== previous.owner.pid || pending.productVersion !== from || pending.pendingActivation?.productVersion !== to)
    throw new Error('Fixture did not retain the old running release after installation')
  const clientEnv = { ...env, OPENALICE_REMOTE_STATE_FILE: join(scratch, 'upgrade-recovery.json') }
  delete clientEnv.OPENALICE_INSTALL_SOURCE
  delete clientEnv.OPENALICE_CONTENT_IDENTITY
  delete clientEnv.OPENALICE_REMOTE_TEST_DEV_MANIFEST_URL
  const options = parseRemoteArgs([remoteTarget, '--home', project, '--yes'])
  const dependencies = { env: clientEnv, spawnProcess: (command, args, spawnOptions) => spawn(command, args, { ...spawnOptions, env: clientEnv }) }
  const observed = await probeRemoteHost(options, dependencies)
  // This scenario explicitly reviews the installed published release. Source
  // execution must not manufacture a stable controller installation receipt.
  dependencies.installSource = observed.installSource
  const plan = createRemotePlan(options, observed, { installSource: observed.installSource })
  if (plan.blocker || plan.installCli || !plan.restartServer || plan.installSource.cliVersion !== to)
    throw new Error(`Expected activation-only plan: ${JSON.stringify(plan)}`)
  console.log(`[remote-upgrade-recovery] confirmed ${from} active / ${to} installed; activating without reinstall`)
  try {
    await connectRemote(options, { ...dependencies,
      afterRuntimeReady: async () => { throw new Error('acceptance: relay interrupted after activation') },
    })
    throw new Error('Reconnect fault was not exercised')
  } catch (error) {
    if (error.message !== 'acceptance: relay interrupted after activation') throw error
  }
  const activated = remoteJson(remoteTarget, env, statusCommand)
  if (activated.productVersion !== to || activated.owner.pid === previous.owner.pid)
    throw new Error('Activation did not replace the old Runtime with the installed target')
  await connectRemote(options, { ...dependencies,
    onPlan: current => { if (current.mutations.length) throw new Error('Reconnect recovery would repeat completed mutations') },
    connectTunnel: async tunnel => {
      const port = await allocateLoopbackPort()
      const child = spawn('ssh', ['-N', '-o', 'ExitOnForwardFailure=yes', '-L',
        `127.0.0.1:${port}:127.0.0.1:${tunnel.remotePort}`, remoteTarget], { env, stdio: 'ignore' })
      const exited = once(child, 'exit')
      try {
        await waitForOpenAlice(`http://127.0.0.1:${port}`, { timeoutMs: 20_000 })
        await tunnel.onReady({ localPort: port })
      } finally { child.kill('SIGTERM'); await exited }
      return 0
    },
  })
  const reconnected = remoteJson(remoteTarget, env, statusCommand)
  if (reconnected.owner.pid !== activated.owner.pid) throw new Error('Recovery restarted an already activated Runtime')
  ssh(`"$HOME/.openalice/bin/openalice" server stop --home '${project}' --wait 30`)
  console.log(`[remote-upgrade-recovery] PASS: ${from} -> ${to}; activation-only; interrupted relay recovered through real SSH/HTTP without another restart`)
}
