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

import { StickerPacks } from './sticker-packs.js';
import { injectAliceHarnessSkills } from './alice-harness-assets.js';
import { ALICE_HARNESS_SKILLS, ALICE_HARNESS_CONFIG_PATH, DEFAULT_ALICE_HARNESS_CONFIG } from './alice-harness-policy.js';
import { writeWorkspaceFile } from './file-service.js';
import type { TemplateMeta } from './template-registry.js';

export async function injectWorkspaceContext(opts: {
  readonly template: TemplateMeta;
  readonly wsId: string;
  readonly dir: string;
  readonly templateOnly?: boolean;
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

  // Template-owned skills remain separate from Project-provided Alice Harness skills.
  const skills = [
    ...new Set([
      ...template.bundledSkills.filter((skill) => !ALICE_HARNESS_SKILLS.includes(skill as typeof ALICE_HARNESS_SKILLS[number])),
    ]),
  ];
  if (!opts.templateOnly) {
    await injectAliceHarnessSkills(dir, template.injectTools);
    if (template.name === 'chat') await new StickerPacks().initialize(dir);
    await writeWorkspaceFile(dir, ALICE_HARNESS_CONFIG_PATH, JSON.stringify(DEFAULT_ALICE_HARNESS_CONFIG, null, 2) + '\n');
  }

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
