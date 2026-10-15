import { join } from 'node:path'

// PTY callers own and remove this temporary HOME. Never write fixture config
// into a global /fixture or fall back to the developer's real home.
const home = process.env.HOME
if (!home) throw new Error('Supervisor PTY fixtures require an isolated HOME.')
export const fixtureHome = join(home, 'fixture')
