/**
 * Golden / characterization test for launcher-owned context injection. The
 * MCP bytes are asserted exactly; the persona composition is asserted to equal
 * `persona + "\n\n---\n\n" + <template>/CLAUDE.md` — byte-identical to what the
 * old `compose_persona_claude_md` bash produced. Skills are asserted to land in
 * both discovery paths.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dataPath, defaultPath } from '@/core/paths.js';

import { injectWorkspaceContext } from './context-injector.js';
import type { TemplateMeta } from './template-registry.js';

// src/workspaces/ — this spec's directory.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const CHAT_FILES = join(HERE, 'templates', 'chat', 'files');

function makeTemplate(over: Partial<TemplateMeta>): TemplateMeta {
  return {
    name: 'test',
    bootstrapScript: '',
    filesDir: '',
    templateDir: '',
    version: '0.0.0',
    defaultAgents: ['claude'],
    injectMcp: false,
    injectPersona: false,
    bundledSkills: [],
    ...over,
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'inject-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const read = (rel: string): Promise<string> => readFile(join(dir, rel), 'utf8');

describe('injectWorkspaceContext — MCP', () => {
  it('writes .mcp.json byte-exact with __WS_ID__ substituted and the URL placeholder intact', async () => {
    await injectWorkspaceContext({ template: makeTemplate({ injectMcp: true }), wsId: 'ws-abc', dir });
    expect(await read('.mcp.json')).toBe(
      '{\n'
      + '  "mcpServers": {\n'
      + '    "openalice": {\n'
      + '      "type": "streamable-http",\n'
      + '      "url": "${OPENALICE_MCP_URL:-http://127.0.0.1:47332/mcp}"\n'
      + '    },\n'
      + '    "openalice-workspace": {\n'
      + '      "type": "streamable-http",\n'
      + '      "url": "${OPENALICE_MCP_URL:-http://127.0.0.1:47332/mcp}/ws-abc"\n'
      + '    }\n'
      + '  }\n'
      + '}\n',
    );
  });

  it('writes inbox-only .mcp.json when injectMcp is "inbox" (no global tool server)', async () => {
    await injectWorkspaceContext({ template: makeTemplate({ injectMcp: 'inbox' }), wsId: 'ws-abc', dir });
    expect(await read('.mcp.json')).toBe(
      '{\n'
      + '  "mcpServers": {\n'
      + '    "openalice-workspace": {\n'
      + '      "type": "streamable-http",\n'
      + '      "url": "${OPENALICE_MCP_URL:-http://127.0.0.1:47332/mcp}/ws-abc"\n'
      + '    }\n'
      + '  }\n'
      + '}\n',
    );
  });

  it('does not write .mcp.json when injectMcp is false', async () => {
    await injectWorkspaceContext({ template: makeTemplate({ injectMcp: false }), wsId: 'ws-abc', dir });
    expect(existsSync(join(dir, '.mcp.json'))).toBe(false);
  });
});

describe('injectWorkspaceContext — persona', () => {
  it('composes persona + separator + template instruction into CLAUDE.md and AGENTS.md', async () => {
    // Mirror the injector's persona precedence: a live data/brain/persona.md
    // override wins over the shipped default.
    const personaPath = existsSync(dataPath('brain', 'persona.md'))
      ? dataPath('brain', 'persona.md')
      : defaultPath('persona.default.md');
    const persona = await readFile(personaPath, 'utf8');
    const instruction = await readFile(join(CHAT_FILES, 'instruction.md'), 'utf8');
    const expected = `${persona}\n\n---\n\n${instruction}`;

    await injectWorkspaceContext({
      template: makeTemplate({ injectPersona: true, filesDir: CHAT_FILES }),
      wsId: 'ws-abc',
      dir,
    });

    expect(await read('CLAUDE.md')).toBe(expected);
    expect(await read('AGENTS.md')).toBe(expected);
  });

  it('does not touch CLAUDE.md / AGENTS.md when injectPersona is false', async () => {
    await injectWorkspaceContext({ template: makeTemplate({ injectPersona: false }), wsId: 'ws-abc', dir });
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
  });
});

describe('injectWorkspaceContext — skills', () => {
  it('copies a bundled skill into both discovery paths', async () => {
    await injectWorkspaceContext({
      template: makeTemplate({ bundledSkills: ['scan-value-chain'] }),
      wsId: 'ws-abc',
      dir,
    });
    const expected = await readFile(defaultPath('skills', 'scan-value-chain', 'SKILL.md'), 'utf8');
    expect(await read('.claude/skills/scan-value-chain/SKILL.md')).toBe(expected);
    expect(await read('.agents/skills/scan-value-chain/SKILL.md')).toBe(expected);
  });
});
