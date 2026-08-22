/**
 * End-to-end check of the create flow, exercising the real moving parts in
 * order: bootstrap.mjs (run on the bundled Node + dugite's bundled git) →
 * launcher context injection → launcher commit. Proves Chat starts a clean
 * local repository, AutoQuant retains its verified upstream ancestry, and —
 * via the PATH-stripped case — creation needs NO system git or bash.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { injectWorkspaceContext } from './context-injector.js';
import type { TemplateMeta } from './template-registry.js';
import { commitInitial } from './workspace-creator.js';

const HERE = fileURLToPath(new URL('.', import.meta.url)); // src/workspaces/
const CHAT_DIR = join(HERE, 'templates', 'chat');
const CHAT_FILES = join(CHAT_DIR, 'files');
const CHAT_BOOTSTRAP = join(CHAT_DIR, 'bootstrap.mjs');
const AQ_DIR = join(HERE, 'templates', 'auto-quant-v2');
const AQ_BOOTSTRAP = join(AQ_DIR, 'bootstrap.mjs');
const AP_DIR = join(HERE, 'templates', 'auto-prediction');
const AP_BOOTSTRAP = join(AP_DIR, 'bootstrap.mjs');

/**
 * Run a bootstrap.mjs exactly as the launcher's runScript does: on the bundled
 * Node (`process.execPath`) with ELECTRON_RUN_AS_NODE. `strip` removes git/bash
 * from PATH to prove the bare-machine path uses only dugite's embedded git.
 */
function runBootstrap(
  script: string,
  args: readonly string[],
  extraEnv: NodeJS.ProcessEnv,
  strip = false,
): Promise<string> {
  const env = strip
    ? { HOME: process.env.HOME, ELECTRON_RUN_AS_NODE: '1', PATH: '', ...extraEnv }
    : { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...extraEnv };
  return run(process.execPath, [script, ...args], env);
}

function autoQuantMeta(): TemplateMeta {
  return {
    name: 'auto-quant-v2',
    bootstrapScript: AQ_BOOTSTRAP,
    filesDir: join(AQ_DIR, 'files'),
    templateDir: AQ_DIR,
    version: '1.0.0',
    defaultAgents: ['claude', 'codex'],
    injectTools: true,
    injectInstructions: false,
    bundledSkills: [],
  };
}

function autoPredictionMeta(): TemplateMeta {
  return {
    name: 'auto-prediction',
    bootstrapScript: AP_BOOTSTRAP,
    filesDir: join(AP_DIR, 'files'),
    templateDir: AP_DIR,
    version: '0.1.0',
    defaultAgents: ['codex', 'claude'],
    injectTools: true,
    injectInstructions: false,
    bundledSkills: [],
  };
}

function run(cmd: string, args: readonly string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => { out += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { err += c.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err}`))));
  });
}

function chatMeta(): TemplateMeta {
  return {
    name: 'chat',
    bootstrapScript: CHAT_BOOTSTRAP,
    filesDir: CHAT_FILES,
    templateDir: CHAT_DIR,
    version: '1.0.0',
    defaultAgents: ['claude', 'codex'],
    injectTools: true,
    injectInstructions: true,
    bundledSkills: ['scan-value-chain', 'delegate-autoquant'],
  };
}

let parent: string;
let dir: string;
beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), 'ws-e2e-'));
  dir = join(parent, 'workspace');
});
afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

describe('chat workspace create: bootstrap → inject → commit', () => {
  it('yields a fresh-git workspace with one clean launcher commit', async () => {
    // 1. real bootstrap.mjs — git init + README + excludes, NO commit. PATH
    //    stripped: proves a bare machine (no system git, no bash) still works
    //    via dugite's bundled git.
    await runBootstrap(CHAT_BOOTSTRAP, ['testtag', dir], { AQ_TEMPLATE_ROOT: CHAT_DIR }, true);
    // 2. launcher-owned injection
    await injectWorkspaceContext({ template: chatMeta(), wsId: 'ws-e2e-1', dir });
    // 3. launcher-owned initial commit
    await commitInitial(dir, 'chat: testtag');

    // injected files all present
    for (const rel of [
      'CLAUDE.md', 'AGENTS.md', 'README.md',
      '.claude/skills/scan-value-chain/SKILL.md',
      '.agents/skills/scan-value-chain/SKILL.md',
      '.claude/skills/delegate-autoquant/SKILL.md',
      '.agents/skills/delegate-autoquant/SKILL.md',
      // per-CLI playbooks injected for every tool-bearing template
      '.claude/skills/alice/SKILL.md',
      '.claude/skills/alice-analysis/SKILL.md',
      '.claude/skills/alice-uta/SKILL.md',
      '.claude/skills/alice-workspace/SKILL.md',
      '.claude/skills/traderhub/SKILL.md',
    ]) {
      expect(existsSync(join(dir, rel)), rel).toBe(true);
    }

    // CLI-only injection: no MCP files are written at all
    expect(existsSync(join(dir, '.mcp.json'))).toBe(false);
    expect(existsSync(join(dir, '.pi/extensions/openalice-bridge.ts'))).toBe(false);

    // exactly one commit, launcher author, right message
    const log = await run('git', ['-C', dir, 'log', '--pretty=%an <%ae>%n%s']);
    expect(log.trim()).toBe('launcher <launcher@local>\nchat: testtag');

    // working tree is clean (injected files were committed, not left dangling)
    const status = await run('git', ['-C', dir, 'status', '--porcelain']);
    expect(status.trim()).toBe('');

    const excludes = await readFile(join(dir, '.git/info/exclude'), 'utf8');
    expect(excludes).toContain('.claude/openalice-provider.json\n');
    expect(excludes).toContain('.opencode/openalice-provider.json\n');
    expect(excludes).toContain('tui.json\n');
  });
});

describe('auto-quant workspace create: clone → branch → commit', () => {
  it('retains verified upstream ancestry and origin under the local research branch', async () => {
    // fake upstream: history + an origin pointing at the public repo
    const src = join(parent, 'fake-auto-quant');
    await run('git', ['init', '-q', '-b', 'main', src]);
    await writeFile(join(src, 'strategy.py'), 'print("hi")\n');
    await writeFile(join(src, 'AGENTS.md'), '# AutoQuant upstream instructions\n');
    await run('git', ['-C', src, 'add', '.']);
    await run('git', ['-C', src, '-c', 'user.email=u@x', '-c', 'user.name=u', 'commit', '-q', '-m', 'upstream history']);
    const sourceCommit = (await run('git', ['-C', src, 'rev-parse', 'HEAD'])).trim();
    await run('git', ['-C', src, 'tag', 'v0.8.27']);
    await run('git', ['-C', src, 'remote', 'add', 'origin', 'https://github.com/TraderAlice/Auto-Quant.git']);

    const aqDir = join(parent, 'aq-workspace');
    await runBootstrap(AQ_BOOTSTRAP, ['aqtag', aqDir], {
      AQ_TEMPLATE_DIR: src,
      AQ_LAUNCHER_ROOT: parent,
      OPENALICE_TEMPLATE_SOURCE_REPOSITORY: 'https://github.com/TraderAlice/Auto-Quant-V2.git',
      OPENALICE_TEMPLATE_SOURCE_VERSION: 'v0.8.27',
      OPENALICE_TEMPLATE_SOURCE_COMMIT: sourceCommit,
    });
    // Preserve AutoQuant's own instructions; inject only OpenAlice CLI skills.
    await injectWorkspaceContext({ template: autoQuantMeta(), wsId: 'ws-aq-1', dir: aqDir });
    await commitInitial(aqDir, 'auto-quant-v2: aqtag');

    // working tree carries the exact upstream content and a source receipt.
    expect(existsSync(join(aqDir, 'strategy.py'))).toBe(true);
    expect(await readFile(join(aqDir, 'AGENTS.md'), 'utf8')).toBe('# AutoQuant upstream instructions\n');
    expect(existsSync(join(aqDir, '.claude/skills/alice/SKILL.md'))).toBe(true);
    expect(JSON.parse(await readFile(join(aqDir, '.alice/harness-source.json'), 'utf8'))).toEqual({
      schemaVersion: 1,
      template: 'auto-quant-v2',
      repository: 'https://github.com/TraderAlice/Auto-Quant-V2.git',
      version: 'v0.8.27',
      commit: sourceCommit,
    });
    // The launcher commit sits directly on the verified upstream commit, and
    // origin remains the canonical repository for later Agent-managed updates.
    expect((await run('git', ['-C', aqDir, 'rev-parse', 'HEAD^'])).trim()).toBe(sourceCommit);
    expect((await run('git', ['-C', aqDir, 'remote', 'get-url', 'origin'])).trim()).toBe(
      'https://github.com/TraderAlice/Auto-Quant-V2.git',
    );
    expect((await run('git', ['-C', aqDir, 'log', '--pretty=%s'])).trim()).toBe(
      'auto-quant-v2: aqtag\nupstream history',
    );
    expect((await run('git', ['-C', aqDir, 'status', '--porcelain'])).trim()).toBe('');
    expect((await run('git', ['-C', aqDir, 'rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('research/aqtag');
  });
});

describe('auto-prediction workspace create: clone → branch → commit', () => {
  it('retains exact upstream ancestry, instructions, origin, and source receipt', async () => {
    const src = join(parent, 'fake-auto-prediction');
    await run('git', ['init', '-q', '-b', 'main', src]);
    await writeFile(join(src, 'package.json'), '{"name":"auto-prediction"}\n');
    await writeFile(join(src, 'AGENTS.md'), '# Auto Prediction upstream instructions\n');
    await run('git', ['-C', src, 'add', '.']);
    await run('git', ['-C', src, '-c', 'user.email=u@x', '-c', 'user.name=u', 'commit', '-q', '-m', 'upstream history']);
    const sourceCommit = (await run('git', ['-C', src, 'rev-parse', 'HEAD'])).trim();
    await run('git', ['-C', src, 'remote', 'add', 'origin', 'https://github.com/TraderAlice/Auto-Prediction.git']);

    const apDir = join(parent, 'prediction-workspace');
    await runBootstrap(AP_BOOTSTRAP, ['prediction', apDir], {
      AUTO_PREDICTION_TEMPLATE_DIR: src,
      AQ_LAUNCHER_ROOT: parent,
      OPENALICE_TEMPLATE_SOURCE_REPOSITORY: 'https://github.com/TraderAlice/Auto-Prediction.git',
      OPENALICE_TEMPLATE_SOURCE_VERSION: 'snapshot-test',
      OPENALICE_TEMPLATE_SOURCE_COMMIT: sourceCommit,
    });
    await injectWorkspaceContext({ template: autoPredictionMeta(), wsId: 'ws-ap-1', dir: apDir });
    await commitInitial(apDir, 'auto-prediction: prediction');

    expect(await readFile(join(apDir, 'AGENTS.md'), 'utf8')).toBe('# Auto Prediction upstream instructions\n');
    expect(existsSync(join(apDir, '.agents/skills/alice/SKILL.md'))).toBe(true);
    expect(JSON.parse(await readFile(join(apDir, '.alice/harness-source.json'), 'utf8'))).toEqual({
      schemaVersion: 1,
      template: 'auto-prediction',
      repository: 'https://github.com/TraderAlice/Auto-Prediction.git',
      version: 'snapshot-test',
      commit: sourceCommit,
    });
    expect((await run('git', ['-C', apDir, 'rev-parse', 'HEAD^'])).trim()).toBe(sourceCommit);
    expect((await run('git', ['-C', apDir, 'remote', 'get-url', 'origin'])).trim()).toBe(
      'https://github.com/TraderAlice/Auto-Prediction.git',
    );
    expect((await run('git', ['-C', apDir, 'status', '--porcelain'])).trim()).toBe('');
    expect((await run('git', ['-C', apDir, 'rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('research/prediction');
  });
});

describe('chat workspace create — CLI-only injection (no MCP)', () => {
  it('injects the per-CLI alice*/traderhub skills and writes no MCP files', async () => {
    await runBootstrap(CHAT_BOOTSTRAP, ['clitag', dir], { AQ_TEMPLATE_ROOT: CHAT_DIR });
    await injectWorkspaceContext({ template: chatMeta(), wsId: 'ws-cli-1', dir });
    await commitInitial(dir, 'chat: clitag');

    expect(existsSync(join(dir, '.mcp.json'))).toBe(false);                          // no MCP injected
    expect(existsSync(join(dir, '.pi/extensions/openalice-bridge.ts'))).toBe(false); // no Pi bridge
    expect(existsSync(join(dir, '.claude/skills/alice-uta/SKILL.md'))).toBe(true);   // trading skill discoverable
    expect(existsSync(join(dir, '.claude/skills/traderhub/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude/skills/scan-value-chain/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.agents/skills/alice-uta/SKILL.md'))).toBe(true); // Pi shares .agents/skills
    expect(existsSync(join(dir, '.pi/skills'))).toBe(false);                       // avoid duplicate discovery
    expect((await run('git', ['-C', dir, 'status', '--porcelain'])).trim()).toBe('');
  });
});
