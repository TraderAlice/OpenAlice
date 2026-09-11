import { runSupervisorTui } from '../supervisor-tui.ts'
// Real creation/registry and PTY input; lifecycle is isolated from network/process launches.
const code = await runSupervisorTui({}, {
  env: process.env,
  inspect: async () => ({ class: 'absent', state: 'absent', owner: null, endpoints: {} }),
  start: async () => {},
  open: async () => {},
})
process.exitCode = code
