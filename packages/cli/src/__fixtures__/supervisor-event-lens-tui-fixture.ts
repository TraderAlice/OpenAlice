import { resolveLaunchContext } from '../launch-context.ts'
import { runSupervisorTui } from '../supervisor-tui.ts'

const exitCode = await runSupervisorTui({}, {
  env: process.env,
  resolveContext: () => resolveLaunchContext({
    cwd: process.cwd(),
    homeDir: '/fixture',
    flags: { project: 'default', home: '/fixture/default' },
  }),
  inspect: async () => ({ class: 'running', state: 'running', owner: null, endpoints: {} }),
  readLogs: async () => ({
    entries: Array.from({ length: 10 }, (_, index) => ({
      text: index === 8
        ? '{"ts":"2026-09-02T03:04:09Z","level":"warn","msg":"Fixture event 9","scope":"pty"}'
        : `fixture event ${index + 1}`,
    })),
  }),
  discoverUpdate: async () => null,
  pollIntervalMs: 60_000,
})

process.stdout.write('\nFIXTURE_RESULT event-lens\n')
process.exitCode = exitCode
