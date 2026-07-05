import { existsSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Logger } from './logger.js';

/**
 * A template's declaration that an enabled agent should be seeded, at
 * workspace-create time, from a named credential in Alice's central store.
 * `credentialSlug` points into `aiProviderSchema.credentials`; `model` and the
 * adapter-specific knobs feed `credentialToWorkspaceAiCred`. Sourced from
 * `template.json`'s `agentCredentials` map (agentId → decl).
 */
export interface AgentCredentialDecl {
  readonly credentialSlug: string;
  readonly model?: string;
  /** Claude only. */
  readonly authMode?: 'x-api-key' | 'bearer';
  /** Codex only. */
  readonly wireApi?: 'chat' | 'responses';
}

export interface TemplateMeta {
  readonly name: string;
  readonly description?: string;
  /**
   * Human-readable name surfaced in the UI (dashboard section headers,
   * etc.). Sourced from `template.json`'s `displayName` key. Falls back
   * to a humanized form of `name` on the client when missing.
   */
  readonly displayName?: string;
  /**
   * Sort key for grouping workspaces by template type in the dashboard.
   * Lower = earlier. Sourced from `template.json`'s `groupOrder` key.
   * Templates without a declared `groupOrder` sort after declared ones,
   * by name. New template types just need to add this field to their
   * `template.json` — no frontend code change required.
   */
  readonly groupOrder?: number;
  /**
   * Community-tier template: bundles a third-party ecosystem maintained
   * outside OpenAlice (satellite/upstream repos). UI surfaces render these
   * under a separate "Community" section so the official/community
   * priority split stays legible. Absent = official.
   */
  readonly community?: boolean;
  /** Absolute path to the template's `bootstrap.sh`. */
  readonly bootstrapScript: string;
  /** Absolute path to the template's `files/` directory (may not exist). */
  readonly filesDir: string;
  /** Absolute path to the template root (parent of `files/`). */
  readonly templateDir: string;
  /**
   * Absolute path to the template's `README.md`. Undefined if the template
   * doesn't ship one yet. Future templates should always ship one — VSC's
   * convention: README is the canonical human-facing description.
   */
  readonly readmePath?: string;
  /**
   * Template version, declared in README frontmatter. Used for the
   * lineage-based upgrade hint (compare a workspace's spawned-from version
   * against the current template version). Templates without a README, or
   * without a `version:` key, fall back to "0.0.0".
   */
  readonly version: string;
  /**
   * Adapter ids the template wants enabled by default in new workspaces
   * (the create form pre-checks these). Sourced from `template.json`'s
   * `defaultAgents` key. Empty/missing → `['claude']` to preserve legacy
   * single-agent flow.
   */
  readonly defaultAgents: readonly string[];
  /**
   * Launcher-owned context injection, post-bootstrap, gated per template
   * (defaults preserve each template's pre-standardization behavior):
   *   injectTools   — inject the per-CLI playbooks (alice / alice-uta /
   *                   alice-workspace / traderhub skills) so the agent knows the `alice*` CLI
   *                   surface. The launcher injects NO MCP into workspaces;
   *                   `false` = a template that ships its own tool docs
   *                   (e.g. auto-quant).
   *   injectPersona — compose Alice persona + this template's instruction.md
   *                   into CLAUDE.md / AGENTS.md
   *   bundledSkills — names under `default/skills/` to copy into the
   *                   workspace's `.claude/skills` + `.agents/skills`
   */
  readonly injectTools: boolean;
  readonly injectPersona: boolean;
  readonly bundledSkills: readonly string[];
  /**
   * Optional per-agent credential seeding. When present, the launcher writes
   * each declared agent's workspace AI config at create time from the named
   * central credential — so a workspace boots ready-to-run without a manual
   * UI step. Agents not listed are left to fall back to the CLI's global login.
   */
  readonly agentCredentials?: Readonly<Record<string, AgentCredentialDecl>>;
}

/**
 * Discovers `server/templates/<name>/bootstrap.sh` directories at startup and
 * exposes them as named templates. Each template *must* have an executable
 * `bootstrap.sh`; everything else (`template.json` for metadata, `files/` for
 * static assets the script copies) is optional.
 *
 * Cached for the server's lifetime — templates don't change at runtime.
 */
export class TemplateRegistry {
  private readonly byName = new Map<string, TemplateMeta>();

  private constructor() {}

  static async load(dir: string, logger: Logger): Promise<TemplateRegistry> {
    const reg = new TemplateRegistry();
    const absDir = resolve(dir);
    if (!existsSync(absDir)) {
      logger.warn('templates.dir_missing', { dir: absDir });
      return reg;
    }
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      const templateDir = join(absDir, name);
      // Prefer the cross-platform Node bootstrap (`bootstrap.mjs`, run on the
      // bundled Node + bundled git — works on bare Windows/Mac). Fall back to
      // `bootstrap.sh` for third-party templates that still ship bash (only
      // runnable where bash is on PATH).
      const mjsScript = join(templateDir, 'bootstrap.mjs');
      const shScript = join(templateDir, 'bootstrap.sh');
      const bootstrapScript = existsSync(mjsScript)
        ? mjsScript
        : existsSync(shScript)
          ? shScript
          : undefined;
      if (bootstrapScript === undefined) {
        logger.warn('templates.no_bootstrap', { name, templateDir });
        continue;
      }
      const filesDir = join(templateDir, 'files');
      const tplMeta = await readTemplateMeta(join(templateDir, 'template.json'));
      const readmePath = join(templateDir, 'README.md');
      const hasReadme = existsSync(readmePath);
      const version = hasReadme ? await readReadmeVersion(readmePath) : '0.0.0';
      const meta: TemplateMeta = {
        name,
        ...(tplMeta.description !== undefined ? { description: tplMeta.description } : {}),
        ...(tplMeta.displayName !== undefined ? { displayName: tplMeta.displayName } : {}),
        ...(tplMeta.groupOrder !== undefined ? { groupOrder: tplMeta.groupOrder } : {}),
        ...(tplMeta.community !== undefined ? { community: tplMeta.community } : {}),
        bootstrapScript,
        filesDir,
        templateDir,
        ...(hasReadme ? { readmePath } : {}),
        version,
        defaultAgents: tplMeta.defaultAgents,
        injectTools: tplMeta.injectTools,
        injectPersona: tplMeta.injectPersona,
        bundledSkills: tplMeta.bundledSkills,
        ...(tplMeta.agentCredentials !== undefined ? { agentCredentials: tplMeta.agentCredentials } : {}),
      };
      reg.byName.set(name, meta);
    }
    logger.info('templates.loaded', { dir: absDir, names: Array.from(reg.byName.keys()) });
    return reg;
  }

  /**
   * Register a synthetic template at runtime — used for the legacy
   * `AQ_BOOTSTRAP_SCRIPT` fallback so old configurations keep working
   * during the migration window.
   */
  registerSynthetic(meta: TemplateMeta): void {
    this.byName.set(meta.name, meta);
  }

  list(): TemplateMeta[] {
    return Array.from(this.byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): TemplateMeta | undefined {
    return this.byName.get(name);
  }

  /**
   * Name used when a client doesn't specify a template. Prefers `chat`
   * (the new MCP-injection demo) if available, otherwise falls back to the
   * first alphabetical template.
   */
  defaultName(): string | undefined {
    if (this.byName.has('chat')) return 'chat';
    const first = this.list()[0];
    return first?.name;
  }
}

interface ParsedTemplateMeta {
  readonly description?: string;
  readonly displayName?: string;
  readonly groupOrder?: number;
  /** Community-tier template: bundles a third-party ecosystem maintained
   *  outside OpenAlice. UI surfaces separate these from official templates. */
  readonly community?: boolean;
  readonly defaultAgents: readonly string[];
  readonly injectTools: boolean;
  readonly injectPersona: boolean;
  readonly bundledSkills: readonly string[];
  readonly agentCredentials?: Readonly<Record<string, AgentCredentialDecl>>;
}

/**
 * Read the `version:` field from a README's YAML frontmatter. We keep this
 * deliberately tiny — full YAML support is overkill for what is, by design,
 * a single string field. Anything more structured belongs in `template.json`,
 * not in README frontmatter (the frontmatter is the human-facing
 * description's metadata, not a config surface).
 *
 * Returns "0.0.0" when:
 *   - the file is unreadable
 *   - there's no frontmatter block (no `---` at the very top)
 *   - the frontmatter has no `version:` key
 *   - the value isn't a non-empty string
 */
export async function readReadmeVersion(readmePath: string): Promise<string> {
  try {
    const raw = await readFile(readmePath, 'utf8');
    return extractVersion(raw);
  } catch {
    return '0.0.0';
  }
}

function extractVersion(raw: string): string {
  // Frontmatter must be at the very top — no leading whitespace except a BOM.
  const text = raw.replace(/^﻿/, '');
  if (!text.startsWith('---')) return '0.0.0';
  // Find the closing fence. Must start at column 0 on its own line.
  const closeRe = /^---\s*$/m;
  const remainder = text.slice(3);
  const closeMatch = closeRe.exec(remainder);
  if (!closeMatch || closeMatch.index === undefined) return '0.0.0';
  const block = remainder.slice(0, closeMatch.index);
  // Naive line-by-line parse — sufficient for `version: 1.0.0` and
  // `version: "1.0.0"`. Quoted strings get unquoted.
  for (const line of block.split(/\r?\n/)) {
    const m = /^\s*version\s*:\s*(.+?)\s*$/.exec(line);
    if (m && m[1]) {
      let v = m[1];
      // Strip surrounding quotes if present.
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (v.length > 0) return v;
    }
  }
  return '0.0.0';
}

async function readTemplateMeta(path: string): Promise<ParsedTemplateMeta> {
  const fallback: ParsedTemplateMeta = {
    defaultAgents: ['claude'], injectTools: false, injectPersona: false, bundledSkills: [],
  };
  try {
    if (!statSync(path).isFile()) return fallback;
  } catch {
    return fallback;
  }
  try {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const obj = parsed as Record<string, unknown>;
    const description = typeof obj['description'] === 'string' ? obj['description'] : undefined;
    const displayName = typeof obj['displayName'] === 'string' ? obj['displayName'] : undefined;
    const groupOrder =
      typeof obj['groupOrder'] === 'number' && Number.isFinite(obj['groupOrder'])
        ? obj['groupOrder']
        : undefined;
    const community = obj['community'] === true ? true : undefined;
    const defaultAgents = Array.isArray(obj['defaultAgents'])
      ? obj['defaultAgents'].filter((a): a is string => typeof a === 'string')
      : null;
    const injectTools = obj['injectTools'] === true;
    const injectPersona = obj['injectPersona'] === true;
    // Skill names become directory names under `.claude/skills/` — reject any
    // with path separators / traversal as a defensive measure.
    const bundledSkills = Array.isArray(obj['bundledSkills'])
      ? obj['bundledSkills'].filter(
          (s): s is string => typeof s === 'string' && !s.includes('/') && !s.includes('..'),
        )
      : [];
    const agentCredentials = parseAgentCredentials(obj['agentCredentials']);
    return {
      ...(description !== undefined ? { description } : {}),
      ...(displayName !== undefined ? { displayName } : {}),
      ...(groupOrder !== undefined ? { groupOrder } : {}),
      ...(community !== undefined ? { community } : {}),
      defaultAgents: defaultAgents && defaultAgents.length > 0 ? defaultAgents : ['claude'],
      injectTools,
      injectPersona,
      bundledSkills,
      ...(agentCredentials !== undefined ? { agentCredentials } : {}),
    };
  } catch {
    return fallback;
  }
}

/**
 * Parse the optional `agentCredentials` map from a template.json. Shape:
 *   { "<agentId>": { "credentialSlug": "openai-1", "model": "gpt-5.5",
 *                    "authMode"?: "x-api-key"|"bearer", "wireApi"?: "chat"|"responses" } }
 * Entries missing a string `credentialSlug` are dropped. Returns undefined when
 * nothing valid is present (so the field stays absent on the meta).
 */
function parseAgentCredentials(raw: unknown): Record<string, AgentCredentialDecl> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const out: Record<string, AgentCredentialDecl> = {};
  for (const [agentId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const v = value as Record<string, unknown>;
    if (typeof v['credentialSlug'] !== 'string' || v['credentialSlug'].length === 0) continue;
    const decl: AgentCredentialDecl = { credentialSlug: v['credentialSlug'] };
    if (typeof v['model'] === 'string') (decl as { model?: string }).model = v['model'];
    if (v['authMode'] === 'x-api-key' || v['authMode'] === 'bearer') {
      (decl as { authMode?: 'x-api-key' | 'bearer' }).authMode = v['authMode'];
    }
    if (v['wireApi'] === 'chat' || v['wireApi'] === 'responses') {
      (decl as { wireApi?: 'chat' | 'responses' }).wireApi = v['wireApi'];
    }
    out[agentId] = decl;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

