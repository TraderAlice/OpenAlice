import { randomUUID } from 'node:crypto';

import type { CliAdapter } from './cli-adapter.js';

/**
 * Pi (and any future `assignsSessionId` runtime) needs the launcher to mint
 * the native id before compose. The TUI pool already did this; the Web host
 * must do the same so a fresh GUI Session arrives with `--session-id`.
 */
export function mintAssignedSessionId(
  adapter: Pick<CliAdapter, 'capabilities'>,
): string | null {
  return adapter.capabilities.assignsSessionId ? randomUUID() : null;
}

export function resolveWebLaunchResume(input: {
  readonly adapter: Pick<CliAdapter, 'capabilities'>;
  readonly nativeSessionId?: string | null;
}): {
  readonly resume: { readonly sessionId: string } | undefined;
  readonly nativeSessionId: string | undefined;
  readonly assigned: boolean;
} {
  if (input.nativeSessionId) {
    return {
      resume: { sessionId: input.nativeSessionId },
      nativeSessionId: input.nativeSessionId,
      assigned: false,
    };
  }
  const minted = mintAssignedSessionId(input.adapter);
  if (minted) {
    return { resume: { sessionId: minted }, nativeSessionId: minted, assigned: true };
  }
  return { resume: undefined, nativeSessionId: undefined, assigned: false };
}
