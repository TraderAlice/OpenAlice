import { describe, expect, it } from 'vitest';

import { loadPtyBackend } from './pty-runtime.js';

describe('PTY runtime selection', () => {
  it('keeps Node and Electron on the lazy node-pty backend', () => {
    const backend = loadPtyBackend();

    expect(backend.name).toBe('node-pty');
    expect(backend.supportsFlowControl).toBe(true);
  });
});
