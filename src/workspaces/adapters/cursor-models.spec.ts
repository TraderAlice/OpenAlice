import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CURSOR_FIRST_PARTY_MODEL_IDS,
  CURSOR_FIRST_PARTY_MODELS,
} from './cursor-models.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('cursor first-party model suggestions', () => {
  it('stays on the Cursor Models pool plus auto, with effort baked into the id', () => {
    expect(CURSOR_FIRST_PARTY_MODEL_IDS[0]).toBe('auto');
    expect(CURSOR_FIRST_PARTY_MODEL_IDS).toContain('composer-2.5');
    expect(CURSOR_FIRST_PARTY_MODEL_IDS).toContain('composer-2.5-fast');
    expect(CURSOR_FIRST_PARTY_MODEL_IDS).toContain('cursor-grok-4.6-high');
    expect(CURSOR_FIRST_PARTY_MODEL_IDS).toContain('cursor-grok-4.6-high-fast');
    expect(CURSOR_FIRST_PARTY_MODEL_IDS).toContain('cursor-grok-4.6-xhigh');
    expect(CURSOR_FIRST_PARTY_MODEL_IDS).not.toContain('cursor-grok-4.6');
    expect(CURSOR_FIRST_PARTY_MODEL_IDS).not.toContain('composer-1');
    expect(CURSOR_FIRST_PARTY_MODEL_IDS.some((id) => id.startsWith('cursor-grok-4.5-xhigh')))
      .toBe(false);
    expect(CURSOR_FIRST_PARTY_MODELS.some((model) =>
      /^(gpt-|claude-|gemini-|kimi-|glm-)/.test(model.id),
    )).toBe(false);
  });

  it('keeps the Issue/launch copy on the same ids', () => {
    const ui = readFileSync(resolve(here, '../../../ui/src/lib/cursor-models.ts'), 'utf8');
    const uiIds = [...ui.matchAll(/id: '([^']+)'/g)].map((match) => match[1]);
    expect(uiIds).toEqual([...CURSOR_FIRST_PARTY_MODEL_IDS]);
  });
});
