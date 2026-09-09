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
    expect(projected.webArgs).toEqual([]);
    expect(JSON.parse(projected.env['OPENCODE_CONFIG_CONTENT']!)).toEqual({ model: 'openai/gpt-5.6-sol', permission: 'allow' });
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

it('preserves process config while selecting the ACP model without unsupported flags', () => {
  const projected = opencodeAdapter.sessionRuntime!.project({ cwd: '/workspace', env: { OPENCODE_CONFIG_CONTENT: '{"theme":"system"}' } }, runtime);
  expect(JSON.parse(projected.env['OPENCODE_CONFIG_CONTENT']!)).toEqual({ theme: 'system', model: 'openai/gpt-5.6-sol', permission: 'allow' });
  expect(opencodeAdapter.composeWebCommand!([], { cwd: '/workspace', env: projected.env, sessionRuntime: projected })).toEqual(['opencode', 'acp']);
});


it('applies full access even without a model override, preserving other process config', () => {
  const projected = opencodeAdapter.sessionRuntime!.project(
    { cwd: '/workspace', env: { OPENCODE_CONFIG_CONTENT: '{"theme":"system","permission":"ask"}' } },
    { binding: { version: 1, credential: { source: 'native' } }, ai: null },
  );
  expect(JSON.parse(projected.env['OPENCODE_CONFIG_CONTENT']!)).toEqual({ theme: 'system', permission: 'allow' });
});
