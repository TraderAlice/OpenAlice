import { sessionProcessStop } from './session-process-stop.js';
import { createRequire } from 'node:module';

import type { PtyBackend, PtyProcess } from './pty-types.js';

const runtimeRequire = createRequire(import.meta.url);
let cachedNodePty: typeof import('node-pty') | null = null;

function loadNodePty(): typeof import('node-pty') {
  cachedNodePty ??= runtimeRequire('node-pty') as typeof import('node-pty');
  return cachedNodePty;
}

export const ptyBackend: PtyBackend = {
  name: 'node-pty',
  supportsFlowControl: true,
  spawn(file, args, options) {
    const child = loadNodePty().spawn(file, [...args], {
      ...options,
      // Preserve raw byte boundaries for xterm's streaming decoder.
      encoding: null,
    }) as unknown as PtyProcess;
    child.terminateTree = sessionProcessStop(child.pid, 2000);
    return child;
  },
};
