import { describe, expect, it } from 'vitest';

import { BUILTIN_ADAPTERS, createBuiltinAdapterRegistry } from './index.js';

describe('built-in adapter provider capabilities', () => {
  it('keeps provider semantics on each native runtime adapter', () => {
    const registry = createBuiltinAdapterRegistry();

    expect(registry.resolve(null).id).toBe('claude');
    expect(registry.list()).toEqual(BUILTIN_ADAPTERS);
    expect(registry.get('claude')?.capabilities.aiProvider).toMatchObject({
      credentialSource: 'runtime-or-workspace',
      wirePreference: ['anthropic'],
    });
    expect(registry.get('codex')?.capabilities.aiProvider).toMatchObject({
      credentialSource: 'runtime-or-workspace',
      wirePreference: ['openai-responses'],
    });
    expect(registry.get('cursor')?.capabilities.aiProvider).toMatchObject({
      credentialSource: 'runtime-or-workspace',
      wirePreference: [],
      directVendors: ['cursor'],
    });
    expect(registry.get('cursor')?.capabilities.transcriptDiscovery).toBe('subprocess');
    expect(registry.get('cursor')?.capabilities.assignsSessionId ?? false).toBe(false);
    expect(registry.get('cursor')?.binary).toBe('cursor-agent');
    expect(registry.get('agy')?.capabilities.aiProvider).toMatchObject({
      credentialSource: 'runtime-or-workspace',
      wirePreference: ['google-generative-ai'],
      defaultWire: 'google-generative-ai',
    });
    expect(registry.get('agy')?.capabilities.transcriptDiscovery).toBe('subprocess');
    expect(registry.get('agy')?.capabilities.assignsSessionId ?? false).toBe(false);
    expect(registry.get('agy')?.binary).toBe('agy');
    expect(registry.get('grok')?.capabilities.aiProvider).toMatchObject({
      credentialSource: 'runtime-or-workspace',
      wirePreference: ['openai-chat', 'openai-responses'],
      defaultWire: 'openai-chat',
    });
    expect(registry.get('opencode')?.capabilities.aiProvider).toMatchObject({
      credentialSource: 'runtime-or-workspace',
      defaultWire: 'openai-chat',
      modelRegistration: {
        contextWindow: true,
        reasoning: true,
        effortVariants: true,
      },
    });
    expect(registry.get('omp')?.capabilities.aiProvider).toMatchObject({
      credentialSource: 'runtime-or-workspace',
      defaultWire: 'openai-chat',
      modelRegistration: {
        contextWindow: true,
        reasoning: true,
      },
    });
    expect(registry.get('omp')?.capabilities.transcriptDiscovery).toBe('subprocess');
    expect(registry.get('omp')?.capabilities.assignsSessionId ?? false).toBe(false);
    expect(registry.get('pi')?.capabilities.aiProvider).toMatchObject({
      credentialSource: 'runtime-or-workspace',
      defaultWire: 'openai-chat',
      modelRegistration: {
        contextWindow: true,
        reasoning: true,
      },
    });
    expect(registry.get('shell')?.capabilities.aiProvider).toBeUndefined();
  });
});
