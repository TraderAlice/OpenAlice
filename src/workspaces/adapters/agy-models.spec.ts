import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AGY_FIRST_PARTY_MODEL_IDS,
  AGY_FIRST_PARTY_MODELS,
} from './agy-models.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('agy first-party model suggestions', () => {
  it('stays on the documented Gemini pool and omits third-party slugs', () => {
    expect(AGY_FIRST_PARTY_MODEL_IDS).toEqual([
      'gemini-3.5-flash',
      'gemini-3.6-flash',
      'gemini-3.1-pro-preview',
      'gemini-3.7-flash-high',
      'gemini-3.7-flash-medium',
      'gemini-3.6-flash-high',
      'gemini-3.6-flash-medium',
      'gemini-3.5-flash-medium',
      'gemini-3.1-pro-high',
    ]);
    expect(AGY_FIRST_PARTY_MODELS.some((model) =>
      /^(claude-|gpt-|composer-|auto$)/.test(model.id),
    )).toBe(false);
  });

  it('keeps the Issue/launch copy on the same ids', () => {
    const ui = readFileSync(resolve(here, '../../../ui/src/lib/agy-models.ts'), 'utf8');
    const uiIds = [...ui.matchAll(/id: '([^']+)'/g)].map((match) => match[1]);
    expect(uiIds).toEqual([...AGY_FIRST_PARTY_MODEL_IDS]);
  });
});
