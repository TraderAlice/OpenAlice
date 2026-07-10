import { describe, expect, it } from 'vitest';

import { LONGCAT } from './preset-catalog.js';

describe('LONGCAT preset', () => {
  it('uses the versioned OpenAI base URL required by the OpenAI SDK', () => {
    expect(LONGCAT.regions[0]?.wires['openai-chat']).toBe('https://api.longcat.chat/openai/v1');
    const parsed = LONGCAT.zodSchema.parse({
      backend: 'vercel-ai-sdk',
      provider: 'openai-compatible',
      apiKey: 'test-key',
    });
    expect(parsed.baseUrl).toBe('https://api.longcat.chat/openai/v1');
  });
});
