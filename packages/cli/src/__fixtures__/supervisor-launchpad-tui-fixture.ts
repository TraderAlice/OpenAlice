import { resolveLaunchContext } from '../launch-context.ts'
import { runSupervisorTui } from '../supervisor-tui.ts'

let starts = 0
let opens = 0
const running = process.env['OPENALICE_TUI_FIXTURE_RUNTIME'] === 'running'

const exitCode = await runSupervisorTui({}, {
  env: process.env,
  resolveContext: () => resolveLaunchContext({
    cwd: process.cwd(),
    homeDir: '/fixture',
    flags: { project: 'default', home: '/fixture/default' },
  }),
  inspect: async () => running
    ? {
        class: 'running',
        state: 'ready',
        owner: { surface: 'cli-server', pid: 4242 },
        endpoints: { web: 'http://127.0.0.1:47331' },
      }
    : { class: 'absent', state: 'absent', owner: null, endpoints: {} },
  start: async () => { starts += 1 },
  open: async () => { opens += 1 },
  discoverUpdate: async () => null,
  pollIntervalMs: 60_000,
})

process.stdout.write(`\nFIXTURE_RESULT starts=${starts} opens=${opens}\n`)
process.exitCode = exitCode
