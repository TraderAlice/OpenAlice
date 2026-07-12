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
    injectTools: false,
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

describe('injectWorkspaceContext — no MCP injection (CLI-only)', () => {
  it('never writes .mcp.json, even for a tool-bearing template', async () => {
    await injectWorkspaceContext({ template: makeTemplate({ injectTools: true }), wsId: 'ws-abc', dir });
    expect(existsSync(join(dir, '.mcp.json'))).toBe(false);
  });

  it('never writes the Pi MCP bridge extension', async () => {
    await injectWorkspaceContext({ template: makeTemplate({ injectTools: true }), wsId: 'ws-abc', dir });
    expect(existsSync(join(dir, '.pi/extensions/openalice-bridge.ts'))).toBe(false);
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

  it('keeps the always-loaded Chat contract compact and routes manuals to skills', async () => {
    const instruction = await readFile(join(CHAT_FILES, 'instruction.md'), 'utf8');
    expect(instruction.split('\n').length).toBeLessThan(120);
    expect(instruction).toContain('Every price, return, date, ratio');
    expect(instruction).toContain('A comment is a board');
    expect(instruction).toContain('The `alice-workspace` skill contains the exact commands');
    expect(instruction).not.toContain('alice-workspace issue comment --text');
    expect(instruction).not.toContain('alice-workspace inbox push --doc');
    expect(instruction).not.toContain('--when');
  });
});

describe('injectWorkspaceContext — skills', () => {
  it('copies a bundled skill into the canonical shared discovery paths', async () => {
    await injectWorkspaceContext({
      template: makeTemplate({ bundledSkills: ['scan-value-chain'] }),
      wsId: 'ws-abc',
      dir,
    });
    const expected = await readFile(defaultPath('skills', 'scan-value-chain', 'SKILL.md'), 'utf8');
    expect(await read('.claude/skills/scan-value-chain/SKILL.md')).toBe(expected);  // Claude Code
    expect(await read('.agents/skills/scan-value-chain/SKILL.md')).toBe(expected);  // Codex + Pi
    expect(existsSync(join(dir, '.pi/skills'))).toBe(false);                        // no Pi collision copy
  });

  it('injects the per-CLI playbooks (alice* + traderhub) for a tool-bearing template', async () => {
    await injectWorkspaceContext({
      template: makeTemplate({ injectTools: true, bundledSkills: ['scan-value-chain'] }),
      wsId: 'ws-abc',
      dir,
    });
    for (const name of ['alice', 'alice-analysis', 'alice-uta', 'alice-workspace', 'traderhub', 'scan-value-chain']) {
      expect(existsSync(join(dir, '.claude/skills', name, 'SKILL.md')), name).toBe(true);
      expect(existsSync(join(dir, '.agents/skills', name, 'SKILL.md')), name).toBe(true);
    }
    expect(existsSync(join(dir, '.pi/skills'))).toBe(false);
  });

  it('does not inject CLI playbooks when the template is not tool-bearing', async () => {
    await injectWorkspaceContext({
      template: makeTemplate({ injectTools: false, bundledSkills: ['scan-value-chain'] }),
      wsId: 'ws-abc',
      dir,
    });
    expect(existsSync(join(dir, '.claude/skills/alice-uta/SKILL.md'))).toBe(false);
    expect(existsSync(join(dir, '.claude/skills/scan-value-chain/SKILL.md'))).toBe(true);
  });

  it('injects the self-scheduling skill into every workspace, even an untooled one', async () => {
    await injectWorkspaceContext({
      template: makeTemplate({ injectTools: false }),
      wsId: 'ws-abc',
      dir,
    });
    expect(existsSync(join(dir, '.claude/skills/self-scheduling/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.agents/skills/self-scheduling/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.pi/skills/self-scheduling/SKILL.md'))).toBe(false);
  });

  it('leaves a legacy .pi/skills directory untouched', async () => {
    const legacy = join(dir, '.pi/skills/custom/SKILL.md');
    await mkdir(join(dir, '.pi/skills/custom'), { recursive: true });
    await writeFile(legacy, 'legacy user skill\n');

    await injectWorkspaceContext({
      template: makeTemplate({ bundledSkills: ['scan-value-chain'] }),
      wsId: 'ws-abc',
      dir,
    });

    expect(await read('.pi/skills/custom/SKILL.md')).toBe('legacy user skill\n');
    expect(existsSync(join(dir, '.pi/skills/scan-value-chain/SKILL.md'))).toBe(false);
  });
});
