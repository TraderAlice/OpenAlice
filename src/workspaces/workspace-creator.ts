import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { exec as gitExec } from 'dugite';

import { readCredentials, readWorkspaceCredentialDefaults } from '@/core/config.js';

import type { AdapterRegistry } from './cli-adapter.js';
import { injectWorkspaceContext } from './context-injector.js';
import { injectWorkspaceCredentials } from './credential-injection.js';
import type { Logger } from './logger.js';
import type { AgentCredentialDecl, TemplateRegistry } from './template-registry.js';
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

const TAG_RE = /^[a-z0-9][a-z0-9_-]{0,32}$/;

/**
 * Resolve the adapter set a new workspace is created with. This is the single
 * home of the agent policy, so every create path — the form, quick-chat,
 * headless — converges on it:
 *
 * - An explicit `agentsRequested` (a caller pinning a subset) wins verbatim.
 * - Otherwise a workspace gets EVERY registered adapter enabled; restricting
 *   it was a create-time decision with no first-action basis. The template's
 *   `defaultAgents` is honored only as the HEAD of the list (first-wins
 *   dedupe), so `agents[0]` — the "spawn a new session" default — follows
 *   template intent without limiting what's available.
 *
 * This used to live in the frontend create hook alone, which silently left
 * backend-only callers (quick-chat) on the bare-`defaultAgents` set.
 */
export function resolveCreateAgents(
  agentsRequested: readonly string[] | undefined,
  templateDefaultAgents: readonly string[],
  allAdapterIds: readonly string[],
): readonly string[] {
  if (agentsRequested && agentsRequested.length > 0) return agentsRequested;
  return [...new Set([...templateDefaultAgents, ...allAdapterIds])];
}

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

    // Agent policy lives in `resolveCreateAgents` (this file) so every create
    // path — form, quick-chat, headless — converges on it.
    const agents = resolveCreateAgents(
      agentsRequested,
      template.defaultAgents,
      this.opts.adapterRegistry.list().map((a) => a.id),
    );

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
      // Surface the actual reason in the message, not just the exit code —
      // a null exit code (spawn failure: bash-not-found on Windows, timeout)
      // rendered as "code unknown" tells the user nothing, while result.stderr
      // already carries the why (e.g. the Git-for-Windows install hint).
      const reason = result.stderr.trim();
      const headline =
        result.exitCode === null
          ? 'bootstrap could not start'
          : `bootstrap script exited with code ${result.exitCode}`;
      return {
        ok: false,
        code: 'bootstrap_failed',
        message: reason ? `${headline}:\n${reason.slice(-500)}` : headline,
        stderr: result.stderr,
        ...(result.exitCode !== null ? { exitCode: result.exitCode } : {}),
      };
    }

    // Launcher-owned context injection (MCP / persona / skills, gated by the
    // template manifest), then the initial commit. The launcher — not the
    // bootstrap script — owns what lands in the workspace's first commit.
    try {
      await injectWorkspaceContext({ template, wsId: id, dir });
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

    // Credential seeding — runs POST-commit so the secret never lands in the
    // initial commit (the adapter config files are kept out of git by
    // `_common.sh`'s excludes; post-commit is the belt-and-braces). The source
    // is the user's per-agent workspace defaults (Settings › AI Provider) merged
    // with any template-declared `agentCredentials` — the template wins per agent
    // (explicit per-template intent), though in practice no in-repo template
    // declares them, so the user defaults are the effective source. Best-effort:
    // a miss (disabled agent, dangling slug, incompatible wire) warns + skips,
    // the workspace stays usable.
    try {
      const userDefaults = await readWorkspaceCredentialDefaults();
      const effective: Record<string, AgentCredentialDecl> = {
        ...userDefaults,
        ...(template.agentCredentials ?? {}),
      };
      if (Object.keys(effective).length > 0) {
        const credentials = await readCredentials();
        await injectWorkspaceCredentials({
          dir,
          agents,
          agentCredentials: effective,
          adapterRegistry: this.opts.adapterRegistry,
          credentials,
          logger: log,
        });
      }
    } catch (err) {
      log.warn('cred_inject.failed', { err });
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

// Routes through the bundled git (dugite) so the launcher's initial commit
// needs no system git — same reason the bootstrap scripts use _common.mjs's
// git(). dugite resolves with an exitCode (it only rejects when git fails to
// launch), so a non-zero exit is turned into a throw to preserve the old
// reject-on-failure contract.
async function runGit(dir: string, args: readonly string[]): Promise<void> {
  const r = await gitExec([...args], dir);
  if (r.exitCode !== 0) {
    throw new Error(`git ${args[0] ?? ''} exited ${r.exitCode}: ${String(r.stderr).slice(0, 500)}`);
  }
}

interface RunResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

const WINDOWS_BASH_HINT =
  'hint: this template ships a bash bootstrap script. OpenAlice\'s built-in ' +
  'templates (chat, auto-quant) need no bash — only third-party templates do. ' +
  'To use this one, install Git for Windows from https://gitforwindows.org/ so ' +
  'bash is on PATH, or run OpenAlice from inside WSL2.';

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
  const isMjs = script.endsWith('.mjs');
  const isWindows = process.platform === 'win32';

  // `.mjs` (built-in templates): run on the Electron-bundled Node. In the
  // packaged app `process.execPath` is the Electron binary; ELECTRON_RUN_AS_NODE
  // flips it to pure-Node mode (a harmless no-op for a plain `node` execPath in
  // dev). No bash, no shebang reliance → works on a bare Windows/Mac box.
  // `.sh` (third-party fallback): unix reads the `#!/usr/bin/env bash` shebang;
  // Windows has no native bash, so we invoke `bash <script>` explicitly, which
  // requires bash on PATH (Git for Windows / WSL).
  const cmd = isMjs ? process.execPath : isWindows ? 'bash' : script;
  const cmdArgs = isMjs || isWindows ? [script, ...args] : args;
  const env = isMjs
    ? { ...process.env, ...extraEnv, ELECTRON_RUN_AS_NODE: '1' }
    : { ...process.env, ...extraEnv };

  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, {
      env,
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
      // ENOENT on Windows when we tried `bash` (a `.sh` third-party template)
      // means Git Bash / WSL bash isn't on PATH — surface the install hint.
      // Built-in `.mjs` templates run on the bundled Node and never hit this.
      const hinted =
        !isMjs && isWindows && /ENOENT/i.test(errMsg) ? `${errMsg}\n${WINDOWS_BASH_HINT}` : errMsg;
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
