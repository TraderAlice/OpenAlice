import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedSessionRuntimeBinding } from '../cli-adapter.js';
import { logger } from '../logger.js';
import { codexAdapter } from './codex.js';

const ctx = { cwd: '/tmp/ws', env: { AQ_WS_ID: 'ws-1' } };

describe('codexAdapter.sessionRuntime.project', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits --model for native Codex when no model is explicitly selected', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const runtime: ResolvedSessionRuntimeBinding = {
      binding: {
        version: 1,
        credential: { source: 'native' },
        reasoningEffort: 'medium',
      },
      ai: { model: null, reasoningEffort: 'medium' },
    };

    const projected = codexAdapter.sessionRuntime!.project(ctx, runtime);
    expect(projected.interactiveArgs).toEqual(['-c', 'model_reasoning_effort="medium"']);
    expect(projected.headlessArgs).toEqual(['-c', 'model_reasoning_effort="medium"']);
    expect(projected.webArgs).toEqual(['-c', 'model_reasoning_effort="medium"']);
    expect(projected.env).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it('passes --model through for supported native Codex models', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const runtime: ResolvedSessionRuntimeBinding = {
      binding: {
        version: 1,
        credential: { source: 'native' },
        model: 'gpt-5.6-terra',
      },
      ai: { model: 'gpt-5.6-terra', reasoningEffort: null },
    };

    const projected = codexAdapter.sessionRuntime!.project(ctx, runtime);
    expect(projected.interactiveArgs).toEqual(['--model', 'gpt-5.6-terra']);
    expect(projected.headlessArgs).toEqual(['--model', 'gpt-5.6-terra']);
    expect(projected.webArgs).toEqual(['--model', 'gpt-5.6-terra']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops stale gpt-5.6-sol with a warning on native Codex OAuth so CLI uses account default', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const runtime: ResolvedSessionRuntimeBinding = {
      binding: {
        version: 1,
        credential: { source: 'native' },
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high',
      },
      ai: { model: 'gpt-5.6-sol', reasoningEffort: 'high' },
    };

    const projected = codexAdapter.sessionRuntime!.project(ctx, runtime);
    expect(projected.interactiveArgs).toEqual(['-c', 'model_reasoning_effort="high"']);
    expect(projected.headlessArgs).toEqual(['-c', 'model_reasoning_effort="high"']);
    expect(projected.webArgs).toEqual(['-c', 'model_reasoning_effort="high"']);
    expect(warn).toHaveBeenCalledWith(
      'codex.native_unavailable_model_dropped',
      expect.objectContaining({ model: 'gpt-5.6-sol' }),
    );
  });

  it('preserves gpt-5.6-sol for vault API-key credentials', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const runtime: ResolvedSessionRuntimeBinding = {
      binding: {
        version: 1,
        credential: { source: 'vault', credentialSlug: 'openai-1', wireShape: 'openai-responses' },
        model: 'gpt-5.6-sol',
      },
      ai: {
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.6-sol',
        wireShape: 'openai-responses',
      },
    };

    const projected = codexAdapter.sessionRuntime!.project(ctx, runtime);
    expect(projected.headlessArgs.slice(0, 2)).toEqual(['--model', 'gpt-5.6-sol']);
    expect(projected.env).toEqual({ OPENALICE_SESSION_KEY: 'sk-test' });
    expect(warn).not.toHaveBeenCalled();
  });
});
