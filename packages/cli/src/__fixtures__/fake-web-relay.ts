import type { WebRelay } from '../web-relay.ts'
import { writeStartupTarget } from '../startup-target.ts'

/** Keeps PTY tests focused on TUI flow without binding a port or probing HTTP. */
export function fakeWebRelay(): WebRelay {
  const state = { generation: 0, target: null as null | { machine: string; project: string } }
  const relay = {
    originUrl: 'http://127.0.0.1:45454',
    get status() { return state },
    get activeSelection() { return state.target ? { machine: { key: state.target.machine }, project: { key: state.target.project }, endpoint: 'http://127.0.0.1:47331' } : null },
    startupPreference: async () => ({ target: null, error: null }),
    setStartupError: () => {},
    listen: async () => 'http://127.0.0.1:45454',
    // This fixture models a successful verification, not a real backend.
    connect: async (machine: string, project: string, options?: { remember?: boolean }) => {
      if (options?.remember !== false) await writeStartupTarget({ machine, project })
      state.generation += 1
      state.target = { machine, project }
    },
    connectLocalInvocation: async (machine: { key: string }, project: string) => {
      state.generation += 1
      state.target = { machine: machine.key, project }
    },
    disconnect: () => { state.target = null; state.generation += 1 },
    subscribe: () => () => {},
    close: async () => {},
  }
  // Validate the callable TUI boundary even though WebRelay's private state
  // prevents structural assignment of a presentation-only fake.
  relay satisfies Pick<WebRelay, 'originUrl' | 'startupPreference' | 'setStartupError' | 'listen' | 'connect' | 'connectLocalInvocation' | 'disconnect' | 'subscribe' | 'close'>
  return relay as unknown as WebRelay
}
