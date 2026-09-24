import { runSupervisorTui } from '../supervisor-tui.ts'
import { fakeWebRelay } from './fake-web-relay.ts'
// Real creation/registry and PTY input; lifecycle is isolated from network/process launches.
const code = await runSupervisorTui({}, {
  env: process.env,
  webRelay: fakeWebRelay(),
  inspect: async () => ({ class: 'absent', state: 'absent', owner: null, endpoints: {} }),
  start: async () => {},
  openBrowser: async () => {},
})
process.exitCode = code
