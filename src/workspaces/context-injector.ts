/**
 * Launcher-owned context injection, run after a template's bootstrap.sh and
 * before the initial commit. Replaces what the per-template bootstrap scripts
 * used to do via `_common.sh` helpers (`write_mcp_config`,
 * `compose_persona_claude_md`) plus the chat skill-copy stopgap — so the
 * launcher, not each script, owns *what* gets injected. Gated per template by
 * the manifest flags (`injectMcp` / `injectPersona` / `bundledSkills`).
 *
 * Reproduces the old bash output byte-for-byte (the workspace-creation golden
 * spec asserts this) — the only behavioral change is that the launcher now
 * owns the files, not bash.
 */

import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { dataPath, defaultPath } from '@/core/paths.js';

import { writeWorkspaceFile } from './file-service.js';
import type { TemplateMeta } from './template-registry.js';

/**
 * Standard OpenAlice `.mcp.json`. The `${OPENALICE_MCP_URL:-...}` placeholder
 * is intentionally left literal — the agent CLI evaluates it at spawn against
 * the env the launcher injects (`service.ts` sets OPENALICE_MCP_URL to the
 * backend's live port). `__WS_ID__` is substituted with the workspace UUID.
 */
const MCP_JSON = `{
  "mcpServers": {
    "openalice": {
      "type": "streamable-http",
      "url": "\${OPENALICE_MCP_URL:-http://127.0.0.1:47332/mcp}"
    },
    "openalice-workspace": {
      "type": "streamable-http",
      "url": "\${OPENALICE_MCP_URL:-http://127.0.0.1:47332/mcp}/__WS_ID__"
    }
  }
}
`;

/**
 * Inbox-only variant (`injectMcp: 'inbox'`): keep just the workspace-scoped
 * `openalice-workspace` server — the inbox-push outbound channel, which is
 * stateful and stays on MCP — and DROP the global `openalice` tool server. In
 * this mode the agent reaches market/data tools through the `alice` CLI on its
 * PATH instead of MCP. Selected by the launcher-level `toolAccess: 'cli'`
 * option — see `resolveInjection`.
 */
const MCP_JSON_INBOX_ONLY = `{
  "mcpServers": {
    "openalice-workspace": {
      "type": "streamable-http",
      "url": "\${OPENALICE_MCP_URL:-http://127.0.0.1:47332/mcp}/__WS_ID__"
    }
  }
}
`;

/** Launcher-level option: where the agent reaches Alice's data tools. */
export type ToolAccess = 'mcp' | 'cli';

/** Launcher-level skills teaching the CLIs (`alice*` + `traderhub`); added in CLI mode. */
const CLI_TOOLS_SKILLS = ['openalice-cli', 'traderhub'];

/**
 * Resolve a template's injection config against the launcher-level `toolAccess`
 * option. A template with `injectMcp: true` is "tool-injectable, user-choosable"
 * — `toolAccess` picks the mode: `'mcp'` keeps the full MCP tool server; `'cli'`
 * drops it to inbox-only MCP and adds the `openalice-cli` skill (tools reached
 * via the `alice` CLI on PATH instead). `injectMcp: false` (no tools) and
 * `injectMcp: 'inbox'` (a template locked to CLI) ignore `toolAccess`.
 */
export function resolveInjection(template: TemplateMeta, toolAccess: ToolAccess): TemplateMeta {
  if (template.injectMcp !== true) return template;
  if (toolAccess !== 'cli') return template;
  const missing = CLI_TOOLS_SKILLS.filter((skill) => !template.bundledSkills.includes(skill));
  return { ...template, injectMcp: 'inbox', bundledSkills: [...template.bundledSkills, ...missing] };
}

export async function injectWorkspaceContext(opts: {
  readonly template: TemplateMeta;
  readonly wsId: string;
  readonly dir: string;
}): Promise<void> {
  const { template, wsId, dir } = opts;

  if (template.injectMcp) {
    const json = template.injectMcp === 'inbox' ? MCP_JSON_INBOX_ONLY : MCP_JSON;
    await writeWorkspaceFile(dir, '.mcp.json', json.replaceAll('__WS_ID__', wsId));
    // Pi has no native MCP, so `.mcp.json` is invisible to it. Give Pi the same
    // tool surface via our bridge extension: it reads OPENALICE_MCP_URL /
    // AQ_WS_ID from the spawn env (the same values `.mcp.json`'s placeholder
    // resolves at spawn) and registers OpenAlice's MCP tools as native Pi tools.
    // Pi auto-discovers `.pi/extensions/`. Verified live: registers the full
    // 47-tool surface (incl. trading) from the global server.
    const piBridge = await readFile(defaultPath('pi', 'openalice-bridge.ts'), 'utf8');
    await writeWorkspaceFile(dir, '.pi/extensions/openalice-bridge.ts', piBridge);
  }

  if (template.injectPersona) {
    // One neutral instruction source (`<template>/instruction.md`), composed
    // with the persona, then written byte-identically to BOTH CLAUDE.md (Claude
    // Code's filename) and AGENTS.md (Codex's). The CLIs disagree on the
    // filename; we don't pick a side — we copy to each at injection. A template
    // that asks for persona injection but ships no instruction.md is a
    // misconfiguration — let the readFile throw so the create fails loudly
    // (matches the old `compose_persona_claude_md` exit 4).
    const persona = await resolvePersona();
    const instruction = await readFile(join(template.filesDir, 'instruction.md'), 'utf8');
    const composed = persona !== null ? `${persona}\n\n---\n\n${instruction}` : instruction;
    await writeWorkspaceFile(dir, 'CLAUDE.md', composed);
    await writeWorkspaceFile(dir, 'AGENTS.md', composed);
  }

  // Merge template-declared skills with auto-discovered user skills from
  // `data/skills/<name>/` (USER_DATA_HOME survives upgrades, mirroring the same
  // override model `data/brain/persona.md` uses for persona). A user skill with
  // the same name as a default one wins — `resolveSkillSource` below picks the
  // user copy first. Order: template first, then user-added (de-duplicated).
  const userSkills = await discoverUserSkills();
  const allSkills = [...new Set([...template.bundledSkills, ...userSkills])];

  if (allSkills.length > 0) {
    // Each agent CLI discovers skills from its own dir: Claude Code reads
    // `.claude/skills`, Codex reads `.agents/skills`, Pi reads `.pi/skills`.
    // (opencode reads `.claude/skills` + `.agents/skills` by default via its
    // Claude-Code compat, so the two below already cover it — no `.opencode`
    // copy needed unless OPENCODE_DISABLE_CLAUDE_CODE is ever set.)
    await mkdir(join(dir, '.claude/skills'), { recursive: true });
    await mkdir(join(dir, '.agents/skills'), { recursive: true });
    await mkdir(join(dir, '.pi/skills'), { recursive: true });
    for (const name of allSkills) {
      const src = resolveSkillSource(name);
      await cp(src, join(dir, '.claude/skills', name), { recursive: true });
      await cp(src, join(dir, '.agents/skills', name), { recursive: true });
      await cp(src, join(dir, '.pi/skills', name), { recursive: true });
    }
  }
}

/**
 * Auto-discover user-installed skills under `data/skills/<name>/`. A directory
 * with a `SKILL.md` inside counts as a skill; anything else (stray files, dirs
 * without a manifest) is silently ignored so users can stash WIP without
 * accidentally injecting it into every new workspace.
 *
 * Returns sorted names for deterministic ordering across runs.
 */
async function discoverUserSkills(): Promise<string[]> {
  const dir = dataPath('skills');
  if (!existsSync(dir)) return [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'SKILL.md')))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * A user-shipped skill (`data/skills/<name>/`) wins over the default
 * (`default/skills/<name>/`) — same precedence as persona. Lets users override
 * a shipped skill (e.g. tweak `sector-rotation` for a personal screen) without
 * forking the app, and lets them add new skills without editing
 * `template.json`.
 */
function resolveSkillSource(name: string): string {
  const userSrc = dataPath('skills', name);
  return existsSync(userSrc) ? userSrc : defaultPath('skills', name);
}

/**
 * Live persona override (`data/brain/persona.md`) wins; else the shipped
 * default (`default/persona.default.md`); else none. Same precedence the
 * persona route and `main.ts` use.
 */
async function resolvePersona(): Promise<string | null> {
  const live = dataPath('brain', 'persona.md');
  if (existsSync(live)) return readFile(live, 'utf8');
  const fallback = defaultPath('persona.default.md');
  if (existsSync(fallback)) return readFile(fallback, 'utf8');
  return null;
}
