import { delimiter } from 'node:path';

import { describe, expect, it } from 'vitest';

import { launchEnvironmentDisclosure } from './service.js';

describe('launchEnvironmentDisclosure', () => {
  it('shows only controlled keys and redacts adapter credential values', () => {
    const result = launchEnvironmentDisclosure({
      TERM: 'xterm-256color',
      PATH: ['/openalice/bin', '/usr/bin'].join(delimiter),
      PWD: '/workspace',
      AQ_WS_ID: 'ws-1',
      OPENALICE_TOOL_SOCKET: '/private/openalice.sock',
      CODEX_HOME: '/workspace/.codex/openalice-home',
      OPENALICE_WORKSPACE_KEY: 'must-never-leak',
      CUSTOM_PROVIDER_HINT: 'could-still-be-sensitive',
      HOST_ONLY: 'not-part-of-the-plan',
    }, {
      CODEX_HOME: '/workspace/.codex/openalice-home',
      OPENALICE_WORKSPACE_KEY: 'must-never-leak',
      CUSTOM_PROVIDER_HINT: 'could-still-be-sensitive',
    });

    expect(result).toContainEqual({
      key: 'PATH',
      source: 'tools',
      presentation: 'path-count',
      count: 2,
    });
    expect(result).toContainEqual({
      key: 'OPENALICE_TOOL_SOCKET',
      source: 'tools',
      presentation: 'configured',
    });
    expect(result).toContainEqual({
      key: 'CODEX_HOME',
      source: 'adapter',
      presentation: 'value',
      value: '/workspace/.codex/openalice-home',
    });
    expect(result).toContainEqual({
      key: 'OPENALICE_WORKSPACE_KEY',
      source: 'adapter',
      presentation: 'redacted',
    });
    expect(result).toContainEqual({
      key: 'CUSTOM_PROVIDER_HINT',
      source: 'adapter',
      presentation: 'configured',
    });
    expect(result.some((entry) => entry.key === 'HOST_ONLY')).toBe(false);
    expect(JSON.stringify(result)).not.toContain('must-never-leak');
    expect(JSON.stringify(result)).not.toContain('could-still-be-sensitive');
    expect(JSON.stringify(result)).not.toContain('/private/openalice.sock');
  });

  it('attributes an adapter override to the adapter even for a shared key', () => {
    expect(launchEnvironmentDisclosure(
      { PATH: ['/adapter/bin', '/usr/bin'].join(delimiter) },
      { PATH: ['/adapter/bin', '/usr/bin'].join(delimiter) },
    )).toEqual([{
      key: 'PATH',
      source: 'adapter',
      presentation: 'path-count',
      count: 2,
    }]);
  });
});
