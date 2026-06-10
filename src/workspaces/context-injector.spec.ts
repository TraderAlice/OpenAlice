/**
 * Golden / characterization test for launcher-owned context injection. The
 * MCP bytes are asserted exactly; the persona composition is asserted to equal
 * `persona + "\n\n---\n\n" + <template>/CLAUDE.md` — byte-identical to what the
 * old `compose_persona_claude_md` bash produced. Skills are asserted to land in
 * both discovery paths.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dataPath, defaultPath } from '@/core/paths.js';

import { injectWorkspaceContext, resolveInjection } from './context-injector.js';
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

describe('resolveInjection (toolAccess)', () => {
  it('mcp mode leaves an injectable template unchanged', () => {
    const t = makeTemplate({ injectMcp: true, bundledSkills: ['scan-value-chain'] });
    expect(resolveInjection(t, 'mcp')).toEqual(t);
  });

  it('cli mode drops to inbox-only MCP and adds the openalice-cli skill', () => {
    const t = makeTemplate({ injectMcp: true, bundledSkills: ['scan-value-chain'] });
    const r = resolveInjection(t, 'cli');
    expect(r.injectMcp).toBe('inbox');
    expect(r.bundledSkills).toEqual(['scan-value-chain', 'openalice-cli']);
  });

  it('cli mode does not duplicate an already-present openalice-cli', () => {
    const t = makeTemplate({ injectMcp: true, bundledSkills: ['openalice-cli'] });
    expect(resolveInjection(t, 'cli').bundledSkills).toEqual(['openalice-cli']);
  });

  it('a non-injectable template (injectMcp false) ignores toolAccess', () => {
    const t = makeTemplate({ injectMcp: false });
    expect(resolveInjection(t, 'cli')).toEqual(t);
    expect(resolveInjection(t, 'mcp')).toEqual(t);
  });

  it('a CLI-locked template (injectMcp inbox) ignores toolAccess', () => {
    const t = makeTemplate({ injectMcp: 'inbox', bundledSkills: ['openalice-cli'] });
    expect(resolveInjection(t, 'mcp')).toEqual(t);
  });
});

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
    // No tools injected → no Pi bridge either.
    expect(existsSync(join(dir, '.pi/extensions/openalice-bridge.ts'))).toBe(false);
  });

  it('writes the Pi MCP bridge extension when injecting MCP (Pi has no native MCP)', async () => {
    await injectWorkspaceContext({ template: makeTemplate({ injectMcp: true }), wsId: 'ws-abc', dir });
    const bridge = await read('.pi/extensions/openalice-bridge.ts');
    expect(bridge).toContain('openalice-bridge');
    expect(bridge).toContain('registerTool');
    expect(bridge).toContain('OPENALICE_MCP_URL');
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
  it('copies a bundled skill into all three CLI discovery paths', async () => {
    await injectWorkspaceContext({
      template: makeTemplate({ bundledSkills: ['scan-value-chain'] }),
      wsId: 'ws-abc',
      dir,
    });
    const expected = await readFile(defaultPath('skills', 'scan-value-chain', 'SKILL.md'), 'utf8');
    expect(await read('.claude/skills/scan-value-chain/SKILL.md')).toBe(expected);  // Claude Code
    expect(await read('.agents/skills/scan-value-chain/SKILL.md')).toBe(expected);  // Codex (+ opencode default)
    expect(await read('.pi/skills/scan-value-chain/SKILL.md')).toBe(expected);      // Pi
  });
});

// User-skill discovery + override: skills dropped under `data/skills/<name>/`
// are auto-bundled (no template edit needed), and a user-shipped skill of the
// same name as a default one wins — same precedence model as persona.
describe('injectWorkspaceContext — user skills (data/skills/)', () => {
  const USER_SKILL_NAME = '__test-user-skill__';
  const OVERRIDE_NAME = 'scan-value-chain';   // shipped default; user copy should win
  const userSkillDir = dataPath('skills', USER_SKILL_NAME);
  const overrideDir = dataPath('skills', OVERRIDE_NAME);
  const userSkillBody = '---\nname: __test-user-skill__\ndescription: user-installed test skill\n---\nUSER-BODY\n';
  const overrideBody = '---\nname: scan-value-chain\ndescription: user override\n---\nOVERRIDE-BODY\n';

  beforeEach(async () => {
    await mkdir(userSkillDir, { recursive: true });
    await writeFile(join(userSkillDir, 'SKILL.md'), userSkillBody);
    await mkdir(overrideDir, { recursive: true });
    await writeFile(join(overrideDir, 'SKILL.md'), overrideBody);
  });
  afterEach(async () => {
    await rm(userSkillDir, { recursive: true, force: true });
    await rm(overrideDir, { recursive: true, force: true });
  });

  it('auto-discovers user skills from data/skills/* even when template lists none', async () => {
    await injectWorkspaceContext({ template: makeTemplate({ bundledSkills: [] }), wsId: 'ws-abc', dir });
    expect(await read(`.claude/skills/${USER_SKILL_NAME}/SKILL.md`)).toBe(userSkillBody);
    expect(await read(`.agents/skills/${USER_SKILL_NAME}/SKILL.md`)).toBe(userSkillBody);
    expect(await read(`.pi/skills/${USER_SKILL_NAME}/SKILL.md`)).toBe(userSkillBody);
  });

  it('a user-shipped skill of the same name wins over the default (persona-style precedence)', async () => {
    await injectWorkspaceContext({
      template: makeTemplate({ bundledSkills: [OVERRIDE_NAME] }),
      wsId: 'ws-abc',
      dir,
    });
    expect(await read(`.claude/skills/${OVERRIDE_NAME}/SKILL.md`)).toBe(overrideBody);
  });

  it('skips a data/skills/<name>/ entry that has no SKILL.md (WIP guard)', async () => {
    const wipDir = dataPath('skills', '__wip-no-manifest__');
    await mkdir(wipDir, { recursive: true });
    try {
      await injectWorkspaceContext({ template: makeTemplate({ bundledSkills: [] }), wsId: 'ws-abc', dir });
      expect(existsSync(join(dir, '.claude/skills/__wip-no-manifest__'))).toBe(false);
    } finally {
      await rm(wipDir, { recursive: true, force: true });
    }
  });
});
