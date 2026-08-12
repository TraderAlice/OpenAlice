/**
 * Launcher-owned context injection, run after a template's bootstrap.sh and
 * before the initial commit. Replaces what the per-template bootstrap scripts
 * used to do via `_common.sh` helpers plus the chat skill-copy stopgap — so the
 * launcher, not each script, owns *what* gets injected. Gated per template by
 * the manifest flags (`injectTools` / `injectInstructions` / `bundledSkills`).
 *
 * The workspace-creation golden spec owns the resulting file contract; the
 * launcher, rather than bootstrap shell, owns these durable files.
 */

import { cp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { defaultPath } from '@/core/paths.js';

import { writeWorkspaceFile } from './file-service.js';
import type { TemplateMeta } from './template-registry.js';

/**
 * Skills teaching the `alice*` + `traderhub` CLIs — injected into every
 * tool-bearing template (`injectTools` truthy). The launcher injects NO MCP into
 * workspaces at all (no `.mcp.json`, no Pi bridge); these skills are how the
 * agent learns the CLI surface that is now its ONLY path to OpenAlice's tools.
 */
const CLI_TOOLS_SKILLS = ['alice', 'alice-analysis', 'alice-uta', 'alice-workspace', 'traderhub'];

/**
 * Skills injected into EVERY new workspace, regardless of template — generic
 * launcher capabilities every agent should know about. Unlike CLI_TOOLS_SKILLS
 * (gated on `injectTools`), these are UNGATED: self-scheduling works in any
 * workspace because the `alice` CLI is on PATH everywhere (so even an untooled
 * template's headless run can report back to the Inbox).
 */
const ALWAYS_SKILLS = ['self-scheduling'];

export async function injectWorkspaceContext(opts: {
  readonly template: TemplateMeta;
  readonly wsId: string;
  readonly dir: string;
}): Promise<void> {
  const { template, dir } = opts;

  if (template.injectInstructions) {
    // One template-owned instruction source, written byte-identically to both
    // native filenames. Alice's baseline identity is intentionally frozen in
    // the Chat template instead of coming from a mutable global brain file.
    // Existing Workspaces keep their durable files; future edits belong to the
    // Workspace/template upgrade boundary rather than a hidden global prompt.
    const instruction = await readFile(join(template.filesDir, 'instruction.md'), 'utf8');
    await writeWorkspaceFile(dir, 'CLAUDE.md', instruction);
    await writeWorkspaceFile(dir, 'AGENTS.md', instruction);
  }

  // Every workspace gets ALWAYS_SKILLS (generic launcher capabilities). Tool-
  // bearing templates additionally get the per-CLI playbooks (alice / alice-uta
  // / alice-workspace / traderhub) so the agent knows the CLI surface — its ONLY
  // path to OpenAlice tools, since the launcher injects no MCP. All de-duped.
  const skills = [
    ...new Set([
      ...ALWAYS_SKILLS,
      ...template.bundledSkills,
      ...(template.injectTools ? CLI_TOOLS_SKILLS : []),
    ]),
  ];
  if (skills.length > 0) {
    // Claude Code reads `.claude/skills`; Codex and current Pi both read the
    // shared `.agents/skills` path. Do not also copy into `.pi/skills`: Pi
    // discovers both locations and reports every duplicate as a startup
    // collision, which can bury the first user prompt. Existing workspaces are
    // intentionally left alone; this only defines the canonical layout for new
    // workspaces. (OpenCode reads `.claude/skills` + `.agents/skills` through
    // its Claude-Code compatibility layer, so no `.opencode` copy is needed.)
    await mkdir(join(dir, '.claude/skills'), { recursive: true });
    await mkdir(join(dir, '.agents/skills'), { recursive: true });
    for (const name of skills) {
      const src = defaultPath('skills', name);
      await cp(src, join(dir, '.claude/skills', name), { recursive: true });
      await cp(src, join(dir, '.agents/skills', name), { recursive: true });
    }
  }
}
