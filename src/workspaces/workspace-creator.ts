import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { readCredentials } from '@/core/config.js';

import type { AdapterRegistry } from './cli-adapter.js';
import { injectWorkspaceContext, resolveInjection, type ToolAccess } from './context-injector.js';
import { injectWorkspaceCredentials } from './credential-injection.js';
import type { Logger } from './logger.js';
import type { TemplateRegistry } from './template-registry.js';
import type { WorkspaceMeta, WorkspaceRegistry } from './workspace-registry.js';

export interface BootstrapEnv {
  /**
   * Optional path to an Auto-Quant clone the user wants to override the
   * managed mirror with. Templates that don't read `AQ_TEMPLATE_DIR`
   * ignore this. Empty string when env unset.
   */
  readonly templateDir: string;
  /** Absolute path to the launcher repo root (for `${AQ_LAUNCHER_REPO_ROOT}` references). */
  readonly launcherRepoRoot: string;
}

export interface CreatorOptions {
  readonly workspacesRoot: string;
  readonly templateRegistry: TemplateRegistry;
  readonly adapterRegistry: AdapterRegistry;
  readonly bootstrapEnv: BootstrapEnv;
  readonly bootstrapTimeoutMs: number;
  readonly registry: WorkspaceRegistry;
  readonly logger: Logger;
}

export type CreateResult =
  | { readonly ok: true; readonly workspace: WorkspaceMeta }
  | {
      readonly ok: false;
      readonly code:
        | 'invalid_tag'
        | 'tag_in_use'
        | 'bootstrap_failed'
        | 'injection_failed'
        | 'unknown_template'
        | 'unknown_agent';
      readonly message: string;
      readonly stderr?: string;
      readonly exitCode?: number;
    };

export interface CreateOptions {
  /** Launcher-level: where the agent reaches Alice's data tools (default 'mcp'). */
  readonly toolAccess?: ToolAccess;
}

const TAG_RE = /^[a-z0-9][a-z0-9_-]{0,32}$/;

/**
 * Creates a workspace by invoking the template's bootstrap script.
 *
 * The launcher itself knows nothing about git, branches, or results.tsv —
 * each template's script encapsulates that. We give it `tag` + `outDir` +
 * a small env contract (`AQ_TEMPLATE_DIR`, `AQ_SHARED_DATA_DIR`,
 * `AQ_TEMPLATE_FILES_DIR`, `AQ_LAUNCHER_REPO_ROOT`), wait for exit 0, and
 * on success append the resulting WorkspaceMeta to the registry.
 */
export class WorkspaceCreator {
  constructor(private readonly opts: CreatorOptions) {}

  async create(
    tag: string,
    templateName: string,
    agentsRequested?: readonly string[],
    options?: CreateOptions,
  ): Promise<CreateResult> {
    if (!TAG_RE.test(tag)) {
      return {
        ok: false,
        code: 'invalid_tag',
        message: `tag must match ${TAG_RE.source}`,
      };
    }
    if (this.opts.registry.hasTag(tag)) {
      return { ok: false, code: 'tag_in_use', message: `tag in use: ${tag}` };
    }
    const template = this.opts.templateRegistry.get(templateName);
    if (!template) {
      return {
        ok: false,
        code: 'unknown_template',
        message: `unknown template: ${templateName}`,
      };
    }

    const agents = agentsRequested && agentsRequested.length > 0
      ? agentsRequested
      : template.defaultAgents;

    // Validate every requested adapter exists in the registry.
    for (const a of agents) {
      if (!this.opts.adapterRegistry.get(a)) {
        return {
          ok: false,
          code: 'unknown_agent',
          message: `unknown agent: ${a}`,
        };
      }
    }

    const id = randomUUID();
    const dir = join(this.opts.workspacesRoot, id);
    const log = this.opts.logger.child({ tag, id, dir, template: templateName, agents });

    log.info('bootstrap.start', { script: template.bootstrapScript });

    const result = await runScript(
      template.bootstrapScript,
      [tag, dir],
      {
        AQ_TEMPLATE_DIR: this.opts.bootstrapEnv.templateDir,
        AQ_TEMPLATE_FILES_DIR: template.filesDir,
        AQ_TEMPLATE_ROOT: template.templateDir,
        AQ_LAUNCHER_REPO_ROOT: this.opts.bootstrapEnv.launcherRepoRoot,
        // AQ_LAUNCHER_ROOT is intentionally NOT set here. bootstrap.sh's
        // ${AQ_LAUNCHER_ROOT:-$HOME/.openalice/workspaces} default matches
        // config.ts's default; a user-exported value flows in via
        // `process.env` inheritance (see `runScript()` below).
      },
      this.opts.bootstrapTimeoutMs,
    );

    if (!result.ok) {
      log.warn('bootstrap.failed', {
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 4000),
      });
      return {
        ok: false,
        code: 'bootstrap_failed',
        message: `bootstrap script exited with code ${result.exitCode ?? 'unknown'}`,
        stderr: result.stderr,
        ...(result.exitCode !== null ? { exitCode: result.exitCode } : {}),
      };
    }

    // Launcher-owned context injection (MCP / persona / skills, gated by the
    // template manifest), then the initial commit. The launcher — not the
    // bootstrap script — owns what lands in the workspace's first commit.
    try {
      const effectiveTemplate = resolveInjection(template, options?.toolAccess ?? 'mcp');
      await injectWorkspaceContext({ template: effectiveTemplate, wsId: id, dir });
    } catch (err) {
      log.warn('inject.failed', { err });
      await rm(dir, { recursive: true, force: true });
      return {
        ok: false,
        code: 'injection_failed',
        message: `context injection failed: ${(err as Error).message}`,
      };
    }
    try {
      await commitInitial(dir, `${templateName}: ${tag}`);
    } catch (err) {
      log.warn('initial_commit.failed', { err });
      await rm(dir, { recursive: true, force: true });
      return {
        ok: false,
        code: 'injection_failed',
        message: `initial commit failed: ${(err as Error).message}`,
      };
    }

    // Per-adapter technical bootstrap (MCP wiring, trust entries, …). Each
    // adapter is responsible for idempotency. We log but don't fail the
    // workspace create on a single adapter's bootstrap failure — the user
    // can still use it manually, the launcher just won't have prepped it.
    for (const a of agents) {
      const adapter = this.opts.adapterRegistry.get(a);
      if (!adapter?.bootstrap) continue;
      try {
        await adapter.bootstrap({
          wsId: id,
          cwd: dir,
          launcherRepoRoot: this.opts.bootstrapEnv.launcherRepoRoot,
        });
      } catch (err) {
        log.warn('adapter.bootstrap_failed', { agent: a, err });
      }
    }

    // Template-declared credential seeding — runs POST-commit so the secret
    // never lands in the initial commit (the adapter config files are kept out
    // of git by `_common.sh`'s excludes; post-commit is the belt-and-braces).
    // Best-effort: a miss warns + skips, the workspace stays usable.
    if (template.agentCredentials) {
      try {
        const credentials = await readCredentials();
        await injectWorkspaceCredentials({
          dir,
          agents,
          agentCredentials: template.agentCredentials,
          adapterRegistry: this.opts.adapterRegistry,
          credentials,
          logger: log,
        });
      } catch (err) {
        log.warn('cred_inject.failed', { err });
      }
    }

    const workspace: WorkspaceMeta = {
      id,
      tag,
      dir,
      createdAt: new Date().toISOString(),
      template: templateName,
      spawnedFromVersion: template.version,
      agents,
    };
    await this.opts.registry.add(workspace);
    log.info('bootstrap.ok', { stdout: result.stdout.slice(-400) });
    return { ok: true, workspace };
  }
}

/**
 * The launcher's initial commit — uniform across templates (the "Harness rule":
 * every workspace is a fresh-git repo with a clean initial commit, no inherited
 * history, no pushable remote). Replaces the old per-template `commit_initial`
 * bash helper, byte-identical in message + author. The bootstrap script has
 * already run `git init` and set excludes; we just stage and commit.
 */
export async function commitInitial(dir: string, message: string): Promise<void> {
  await runGit(dir, ['add', '.']);
  await runGit(dir, [
    '-c', 'user.email=launcher@local',
    '-c', 'user.name=launcher',
    'commit', '-q', '-m', message,
  ]);
}

function runGit(dir: string, args: readonly string[]): Promise<void> {
  return new Promise((resolveCommit, reject) => {
    const child = spawn('git', [...args], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolveCommit();
      else reject(new Error(`git ${args[0] ?? ''} exited ${code ?? 'null'}: ${stderr.slice(0, 500)}`));
    });
  });
}

interface RunResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

const WINDOWS_BASH_HINT =
  'hint: bash not found on PATH. Install Git for Windows (accept the default ' +
  '"Use Git from the Windows Command Prompt" option) from https://gitforwindows.org/, ' +
  'or run OpenAlice from inside WSL2.';

/**
 * Run a bootstrap script.
 *
 * On macOS / Linux the script is invoked directly — the kernel reads the
 * `#!/usr/bin/env bash` shebang and launches bash. On Windows the kernel
 * doesn't read shebangs and there's no native bash, so we invoke bash
 * explicitly with the script as its first argument. This requires `bash`
 * to be on PATH, which Git for Windows provides under its default install
 * options (WSL also works if OpenAlice itself is run from inside WSL).
 *
 * Exported for unit testing — the platform branch needs coverage that
 * doesn't depend on which OS the tests happen to run on.
 */
export function runScript(
  script: string,
  args: readonly string[],
  extraEnv: { [key: string]: string },
  timeoutMs: number,
): Promise<RunResult> {
  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'bash' : script;
  const cmdArgs = isWindows ? [script, ...args] : args;

  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, {
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 2000);
    }, timeoutMs);
    timer.unref();

    child.on('error', (err) => {
      clearTimeout(timer);
      const errMsg = (err as Error).message;
      // ENOENT on Windows when we tried `bash` means Git Bash / WSL bash
      // isn't on PATH — surface the install hint right next to the failure.
      const hinted =
        isWindows && /ENOENT/i.test(errMsg) ? `${errMsg}\n${WINDOWS_BASH_HINT}` : errMsg;
      resolve({
        ok: false,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: `${hinted}\n${Buffer.concat(stderrChunks).toString('utf8')}`,
        exitCode: null,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (timedOut) {
        resolve({
          ok: false,
          stdout,
          stderr: `[timed out after ${timeoutMs}ms]\n${stderr}`,
          exitCode: code,
        });
        return;
      }
      resolve({
        ok: code === 0,
        stdout,
        stderr,
        exitCode: code,
      });
    });
  });
}
