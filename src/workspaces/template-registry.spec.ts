import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Logger } from './logger.js';
import { TemplateRegistry } from './template-registry.js';

const logger = {
  debug() {}, info() {}, warn() {}, error() {}, event() {}, child() { return this; },
} as unknown as Logger;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('TemplateRegistry manifest compatibility', () => {
  it('maps the released injectPersona spelling to template instruction injection only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'template-registry-'));
    roots.push(root);
    const templateDir = join(root, 'legacy-template');
    await mkdir(templateDir, { recursive: true });
    await writeFile(join(templateDir, 'bootstrap.mjs'), 'export {}\n');
    await writeFile(join(templateDir, 'template.json'), JSON.stringify({
      injectPersona: true,
      injectTools: false,
    }));

    const registry = await TemplateRegistry.load(root, logger);

    expect(registry.get('legacy-template')).toMatchObject({
      injectInstructions: true,
      injectTools: false,
    });
  });
});
