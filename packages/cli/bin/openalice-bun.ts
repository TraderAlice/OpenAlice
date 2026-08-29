#!/usr/bin/env bun

import { INTERNAL_BOOTSTRAP_ROLE } from '../../../src/workspaces/bootstrap-runtime.js'
import { parseInternalRole } from '../src/internal-role.js'

const WORKSPACE_CLI_FLAG = '--workspace-cli'

declare global {
  // Prevent the dynamically selected service module from also running its
  // legacy direct-entry wrapper inside the standalone executable.
  // eslint-disable-next-line no-var
  var __OPENALICE_INTERNAL_ROLE_DISPATCH__: boolean | undefined
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  if (argv[0] === WORKSPACE_CLI_FLAG) {
    const binary = argv[1]
    if (!binary || !['alice', 'alice-workspace', 'alice-uta', 'traderhub'].includes(binary)) {
      throw new Error(`invalid private Workspace CLI name: ${binary ?? '(missing)'}`)
    }
    globalThis.__OPENALICE_INTERNAL_ROLE_DISPATCH__ = true
    process.env['OPENALICE_CLI_BIN'] = binary
    process.argv.splice(2, process.argv.length - 2, ...argv.slice(2))
    const loaded = await import('../../../src/workspaces/cli/bin/openalice-cli.cjs') as {
      main?: () => Promise<void>
      default?: { main?: () => Promise<void> }
    }
    const runWorkspaceCli = loaded.main ?? loaded.default?.main
    if (!runWorkspaceCli) throw new Error('Workspace CLI payload did not export main()')
    await runWorkspaceCli()
    return 0
  }
  const parsed = parseInternalRole(argv)
  if (parsed) {
    globalThis.__OPENALICE_INTERNAL_ROLE_DISPATCH__ = true
    process.argv.splice(2, process.argv.length - 2, ...parsed.argv)
    switch (parsed.role) {
      case 'guardian':
        await (await import('../../../scripts/guardian/prod.mjs')).startGuardianRuntime()
        return 0
      case 'alice': {
        const { runAliceEntrypoint } = await import('../../../src/main.js')
        await runAliceEntrypoint()
        return 0
      }
      case 'uta': {
        const { startUTAService } = await import('../../../services/uta/src/main.js')
        await startUTAService()
        return 0
      }
      case 'connector': {
        const { startConnectorService } = await import('../../../services/connector/src/main.js')
        await startConnectorService()
        return 0
      }
    }
  }

  // Workspace template bootstrap is a private Alice subprocess role that
  // predates the general role flag. Keep it available from the same binary.
  if (argv[0] === INTERNAL_BOOTSTRAP_ROLE) {
    globalThis.__OPENALICE_INTERNAL_ROLE_DISPATCH__ = true
    const { runAliceEntrypoint } = await import('../../../src/main.js')
    await runAliceEntrypoint()
    return 0
  }

  const { main: runCli } = await import('../src/main.js')
  return runCli(argv)
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`openalice: ${message}\n`)
    process.exitCode = 1
  },
)
