import { describe, expect, it } from 'vitest';

import type { ResolvedSessionRuntimeBinding } from '../cli-adapter.js';
import { opencodeAdapter } from './opencode.js';

const runtime: ResolvedSessionRuntimeBinding = {
  binding: {
    version: 1,
    credential: { source: 'native' },
    model: 'openai/gpt-5.6-sol',
    reasoningEffort: 'high',
  },
  ai: {
    model: 'openai/gpt-5.6-sol',
    reasoningEffort: 'high',
  },
};

describe('opencode runtime flags', () => {
  it('keeps run-only --variant off the interactive and web launch surfaces', () => {
    const projected = opencodeAdapter.sessionRuntime!.project(
      { cwd: '/workspace', env: {} },
      runtime,
    );

    expect(projected.interactiveArgs).toEqual(['--model', 'openai/gpt-5.6-sol']);
    expect(projected.webArgs).toEqual(['--model', 'openai/gpt-5.6-sol']);
    expect(projected.headlessArgs).toEqual([
      '--model', 'openai/gpt-5.6-sol',
      '--variant', 'high',
    ]);

    expect(opencodeAdapter.composeCommand([], {
      cwd: '/workspace',
      env: {},
      resume: 'last',
      sessionRuntime: projected,
    })).toEqual(['opencode', '--model', 'openai/gpt-5.6-sol', '--continue']);

    expect(opencodeAdapter.composeHeadlessCommand!([], {
      cwd: '/workspace',
      env: {},
      sessionRuntime: projected,
    }, 'hello')).toContain('--variant');
  });
});
