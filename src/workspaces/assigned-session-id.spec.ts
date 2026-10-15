import { describe, expect, it } from 'vitest';

import { claudeAdapter } from './adapters/claude.js';
import { piAdapter } from './adapters/pi.js';
import { mintAssignedSessionId, resolveWebLaunchResume } from './assigned-session-id.js';

describe('assigned session ids', () => {
  it('mints only for runtimes that assign their own id at spawn', () => {
    const minted = mintAssignedSessionId(piAdapter);
    expect(minted).toMatch(/^[0-9a-f-]{36}$/);
    expect(mintAssignedSessionId(claudeAdapter)).toBeNull();
  });

  it('gives a fresh Pi Web launch the same assigned-id resume the TUI pool uses', () => {
    const fresh = resolveWebLaunchResume({ adapter: piAdapter });
    expect(fresh.assigned).toBe(true);
    expect(fresh.nativeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fresh.resume).toEqual({ sessionId: fresh.nativeSessionId });
    expect(piAdapter.composeWebCommand!([], {
      cwd: '/w',
      env: {},
      resume: fresh.resume,
    })).toEqual(['pi', '--session-id', fresh.nativeSessionId, '--mode', 'rpc']);
  });

  it('keeps an already-bound native id and does not mint another', () => {
    const bound = resolveWebLaunchResume({
      adapter: piAdapter,
      nativeSessionId: 'already-bound',
    });
    expect(bound).toEqual({
      resume: { sessionId: 'already-bound' },
      nativeSessionId: 'already-bound',
      assigned: false,
    });
  });

  it('leaves Claude-style Web launches without a launcher-minted resume', () => {
    expect(resolveWebLaunchResume({ adapter: claudeAdapter })).toEqual({
      resume: undefined,
      nativeSessionId: undefined,
      assigned: false,
    });
  });
});
