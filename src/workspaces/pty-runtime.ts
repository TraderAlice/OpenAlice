import { ptyBackend } from '#openalice/pty-backend';

import type { PtyBackend } from './pty-types.js';

/** Selected at bundle time: Bun CLI uses Bun.Terminal; Node and Electron use node-pty. */
export function loadPtyBackend(): PtyBackend {
  return ptyBackend;
}
