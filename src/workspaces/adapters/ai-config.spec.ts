/**
 * Characterization / golden test for the per-workspace AI-config writers after
 * they moved out of the webui routes into the CLI adapters (Phase A). The
 * asserted bytes are exactly what the pre-move route-level writers produced —
 * this is the regression guard proving the move is behavior-preserving.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { opencodeAdapter } from './opencode.js';
import { piAdapter, syncPiProjectTrust, syncPiWindowsShellPath } from './pi.js';
import { migrateLegacyPiAgentDir, piWorkspaceProviderId } from './pi-config.js';
import { prepareAgentRuntimeWorkspace } from '../cli-adapter.js';
import { credentialToWorkspaceAiCred } from '../credential-injection.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aicfg-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const read = (rel: string): Promise<string> => readFile(join(dir, rel), 'utf8');

describe('claudeAdapter AI-config', () => {
  // Project-scoped `.mcp.json` servers park at "Pending approval" until the
  // user approves — and each workspace dir is a fresh project key, so every
  // spawn carries the auto-trust setting (see AUTOTRUST_SETTINGS in claude.ts).
  const SETTINGS_FLAG = ['--settings', '{"enableAllProjectMcpServers":true}'];

  it('composeCommand: fresh spawn injects the MCP auto-trust settings', () => {
    expect(claudeAdapter.composeCommand(['claude'], { cwd: dir, env: {} })).toEqual([
      'claude', ...SETTINGS_FLAG,
    ]);
  });

  it('composeCommand: by-id resume keeps the settings flag before --resume', () => {
    expect(claudeAdapter.composeCommand(['claude'], { cwd: dir, env: {}, resume: { sessionId: 'abc-123' } }))
      .toEqual(['claude', ...SETTINGS_FLAG, '--resume', 'abc-123']);
  });

  it('composeCommand: "last" resume throws (intentionally unsupported)', () => {
    expect(() => claudeAdapter.composeCommand(['claude'], { cwd: dir, env: {}, resume: 'last' }))
      .toThrow(/"last" resume not supported/);
  });

  it('writes full x-api-key config byte-exact', async () => {
    await claudeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://api.test/v1', apiKey: 'sk-123', model: 'claude-x', authMode: 'x-api-key',
    });
    expect(await read('.claude/settings.local.json')).toBe(
      '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "https://api.test/v1",\n    "ANTHROPIC_API_KEY": "sk-123"\n  },\n  "model": "claude-x"\n}\n',
    );
  });

  it('writes the key into ANTHROPIC_AUTH_TOKEN in bearer mode', async () => {
    await claudeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://g/v1', apiKey: 'k', model: 'm', authMode: 'bearer',
    });
    expect(await read('.claude/settings.local.json')).toBe(
      '{\n  "env": {\n    "ANTHROPIC_BASE_URL": "https://g/v1",\n    "ANTHROPIC_AUTH_TOKEN": "k"\n  },\n  "model": "m"\n}\n',
    );
  });

  it('writes a model-only config with no env block', async () => {
    await claudeAdapter.writeAiConfig!(dir, { model: 'm' });
    expect(await read('.claude/settings.local.json')).toBe('{\n  "model": "m"\n}\n');
  });

  it('reset (empty cred) deletes the settings file', async () => {
    await claudeAdapter.writeAiConfig!(dir, { model: 'm' });
    await claudeAdapter.writeAiConfig!(dir, {});
    expect(existsSync(join(dir, '.claude/settings.local.json'))).toBe(false);
  });

  it('preserves unrelated Claude settings and restores prior provider nodes on reset', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(join(dir, '.claude/settings.local.json'), JSON.stringify({
      permissions: { allow: ['Bash(git:*)'] },
      env: { USER_SETTING: 'keep', ANTHROPIC_BASE_URL: 'https://before.test' },
      model: 'before-model',
    }, null, 2));

    await claudeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://after.test', apiKey: 'after-key', model: 'after-model', authMode: 'bearer',
    });
    expect(JSON.parse(await read('.claude/settings.local.json'))).toMatchObject({
      permissions: { allow: ['Bash(git:*)'] },
      env: {
        USER_SETTING: 'keep',
        ANTHROPIC_BASE_URL: 'https://after.test',
        ANTHROPIC_AUTH_TOKEN: 'after-key',
      },
      model: 'after-model',
    });

    await claudeAdapter.writeAiConfig!(dir, {});
    expect(JSON.parse(await read('.claude/settings.local.json'))).toEqual({
      permissions: { allow: ['Bash(git:*)'] },
      env: { USER_SETTING: 'keep', ANTHROPIC_BASE_URL: 'https://before.test' },
      model: 'before-model',
    });
    expect(existsSync(join(dir, '.claude/openalice-provider.json'))).toBe(false);
  });

  it('does not undo a user edit made after Claude provider injection', async () => {
    await claudeAdapter.writeAiConfig!(dir, { model: 'injected-model' });
    const settings = JSON.parse(await read('.claude/settings.local.json'));
    settings.model = 'user-edited-model';
    settings.permissions = { deny: ['Read(.env)'] };
    await writeFile(join(dir, '.claude/settings.local.json'), JSON.stringify(settings, null, 2));

    await claudeAdapter.writeAiConfig!(dir, {});
    expect(JSON.parse(await read('.claude/settings.local.json'))).toEqual({
      model: 'user-edited-model',
      permissions: { deny: ['Read(.env)'] },
    });
  });

  it('does not recreate Claude config that the user deleted after injection', async () => {
    await claudeAdapter.writeAiConfig!(dir, { model: 'injected-model' });
    await rm(join(dir, '.claude/settings.local.json'));

    await claudeAdapter.writeAiConfig!(dir, {});
    expect(existsSync(join(dir, '.claude/settings.local.json'))).toBe(false);
    expect(existsSync(join(dir, '.claude/openalice-provider.json'))).toBe(false);
  });

  it('round-trips through readAiConfig', async () => {
    await claudeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://api.test/v1', apiKey: 'sk-123', model: 'claude-x', authMode: 'bearer',
    });
    expect(await claudeAdapter.readAiConfig!(dir)).toEqual({
      baseUrl: 'https://api.test/v1', apiKey: 'sk-123', model: 'claude-x', authMode: 'bearer', wireShape: 'anthropic',
    });
  });

  it('round-trips Claude Code effort and restores the prior project value on reset', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(join(dir, '.claude/settings.local.json'), JSON.stringify({ effortLevel: 'low' }));
    await claudeAdapter.writeAiConfig!(dir, { model: 'claude-x', reasoningEffort: 'high' });
    expect(JSON.parse(await read('.claude/settings.local.json'))).toMatchObject({
      model: 'claude-x',
      effortLevel: 'high',
    });
    expect(await claudeAdapter.readAiConfig!(dir)).toMatchObject({ reasoningEffort: 'high' });
    await claudeAdapter.writeAiConfig!(dir, {});
    expect(JSON.parse(await read('.claude/settings.local.json'))).toEqual({ effortLevel: 'low' });
  });

  it('persists an effort-only Claude native-login preference', async () => {
    await claudeAdapter.writeAiConfig!(dir, { reasoningEffort: 'high' });
    expect(JSON.parse(await read('.claude/settings.local.json'))).toEqual({
      effortLevel: 'high',
    });
    expect(await claudeAdapter.readAiConfig!(dir)).toMatchObject({
      model: null,
      reasoningEffort: 'high',
    });
  });

  it('rejects effort values Claude Code cannot persist in project settings', async () => {
    await expect(claudeAdapter.writeAiConfig!(dir, { model: 'claude-x', reasoningEffort: 'max' }))
      .rejects.toThrow(/cannot persist project effort max/);
  });

  it('does not claim a user effortLevel when resetting config from a pre-effort release', async () => {
    await mkdir(join(dir, '.claude'), { recursive: true });
    await writeFile(join(dir, '.claude/settings.local.json'), JSON.stringify({ effortLevel: 'xhigh' }));
    await claudeAdapter.writeAiConfig!(dir, {});
    expect(JSON.parse(await read('.claude/settings.local.json'))).toEqual({ effortLevel: 'xhigh' });
  });

  it('readAiConfig returns null when no file exists', async () => {
    expect(await claudeAdapter.readAiConfig!(dir)).toBeNull();
  });
});

describe('codexAdapter AI-config', () => {
  it('injects both global and workspace MCP servers into fresh commands', () => {
    expect(codexAdapter.composeCommand(['ignored'], {
      cwd: dir,
      env: {
        OPENALICE_MCP_URL: 'http://127.0.0.1:47332/mcp',
        AQ_WS_ID: 'ws-abc',
      },
    })).toEqual([
      'codex',
      '--sandbox',
      'danger-full-access',
      '--ask-for-approval',
      'never',
      '-c',
      'mcp_servers.openalice.url="http://127.0.0.1:47332/mcp"',
      '-c',
      'mcp_servers.openalice-workspace.url="http://127.0.0.1:47332/mcp/ws-abc"',
    ]);
  });

  it('preserves both MCP servers when resuming codex sessions', () => {
    const env = {
      OPENALICE_MCP_URL: 'http://127.0.0.1:47332/mcp',
      AQ_WS_ID: 'ws-abc',
    };
    expect(codexAdapter.composeCommand([], { cwd: dir, env, resume: 'last' })).toEqual([
      'codex',
      '--sandbox',
      'danger-full-access',
      '--ask-for-approval',
      'never',
      '-c',
      'mcp_servers.openalice.url="http://127.0.0.1:47332/mcp"',
      '-c',
      'mcp_servers.openalice-workspace.url="http://127.0.0.1:47332/mcp/ws-abc"',
      'resume',
      '--last',
    ]);
    expect(codexAdapter.composeCommand([], { cwd: dir, env, resume: { sessionId: 'rollout-id' } })).toEqual([
      'codex',
      '--sandbox',
      'danger-full-access',
      '--ask-for-approval',
      'never',
      '-c',
      'mcp_servers.openalice.url="http://127.0.0.1:47332/mcp"',
      '-c',
      'mcp_servers.openalice-workspace.url="http://127.0.0.1:47332/mcp/ws-abc"',
      'resume',
      'rollout-id',
    ]);
  });

  it('keeps explicit full access when interactive Codex runs without MCP', () => {
    expect(codexAdapter.composeCommand([], { cwd: dir, env: {} })).toEqual([
      'codex',
      '--sandbox',
      'danger-full-access',
      '--ask-for-approval',
      'never',
    ]);
  });

  it('writes full provider config byte-exact (config.toml + env.json)', async () => {
    await codexAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://oai.test/v1', apiKey: 'sk-c', model: 'gpt-x', wireApi: 'responses',
    });
    expect(await read('.codex/openalice-home/config.toml')).toBe(
      'model = "gpt-x"\nmodel_provider = "workspace"\n\n'
      + '[model_providers.workspace]\nname = "OpenAlice workspace provider"\n'
      + 'base_url = "https://oai.test/v1"\nenv_key = "OPENALICE_WORKSPACE_KEY"\nwire_api = "responses"\n',
    );
    expect(await read('.codex/openalice-home/env.json'))
      .toBe('{\n  "OPENALICE_WORKSPACE_KEY": "sk-c"\n}\n');
    expect(codexAdapter.composeEnv!({ cwd: dir, env: {} })).toEqual({
      CODEX_HOME: join(dir, '.codex/openalice-home'),
      OPENALICE_WORKSPACE_KEY: 'sk-c',
    });
    expect(codexAdapter.composeCommand([], { cwd: dir, env: {} })).toEqual(expect.arrayContaining([
      '--model',
      'gpt-x',
      '-c',
      'model_provider="workspace"',
    ]));
  });

  it('always writes wire_api = responses (codex is Responses-only)', async () => {
    await codexAdapter.writeAiConfig!(dir, { baseUrl: 'https://oai.test/v1', apiKey: 'sk-c', model: 'gpt-x' });
    expect(await read('.codex/openalice-home/config.toml')).toContain('wire_api = "responses"\n');
  });

  it('binds a managed API key without an explicit endpoint to the official provider', async () => {
    await codexAdapter.writeAiConfig!(dir, { apiKey: 'sk-c', model: 'gpt-x' });
    expect(await read('.codex/openalice-home/config.toml')).toContain(
      'base_url = "https://api.openai.com/v1"\n',
    );
    expect(await codexAdapter.readAiConfig!(dir)).toMatchObject({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-c',
      model: 'gpt-x',
    });
  });

  it('model-only uses native project config without redirecting CODEX_HOME', async () => {
    await codexAdapter.writeAiConfig!(dir, { model: 'gpt-y' });
    expect(await read('.codex/config.toml')).toBe('model = "gpt-y"\n');
    expect(existsSync(join(dir, '.codex/env.json'))).toBe(false);
    expect(existsSync(join(dir, '.codex/openalice-provider.json'))).toBe(true);
    expect(codexAdapter.composeEnv!({ cwd: dir, env: {} })).toEqual({});
  });

  it('reset removes only OpenAlice-owned Codex config and preserves siblings', async () => {
    await mkdir(join(dir, '.codex'), { recursive: true });
    await writeFile(join(dir, '.codex/config.toml'), 'notify = true\n');
    await codexAdapter.writeAiConfig!(dir, { baseUrl: 'u', model: 'm' });
    await codexAdapter.writeAiConfig!(dir, {});
    expect(await read('.codex/config.toml')).toBe('notify = true\n');
    expect(existsSync(join(dir, '.codex/openalice-home'))).toBe(false);
  });

  it('restores a user-owned project model after resetting a native preference', async () => {
    await mkdir(join(dir, '.codex'), { recursive: true });
    await writeFile(join(dir, '.codex/config.toml'), 'model = "user-model"\nnotify = true\n');

    await codexAdapter.writeAiConfig!(dir, { model: 'openalice-model', reasoningEffort: 'high' });
    expect(await read('.codex/config.toml')).toBe(
      'model = "openalice-model"\nnotify = true\nmodel_reasoning_effort = "high"\n',
    );
    await codexAdapter.writeAiConfig!(dir, {});
    expect(await read('.codex/config.toml')).toBe('model = "user-model"\nnotify = true\n');
  });

  it('does not restore over a user edit made after native injection', async () => {
    await codexAdapter.writeAiConfig!(dir, { model: 'openalice-model' });
    await writeFile(join(dir, '.codex/config.toml'), 'model = "user-edited"\n');

    await codexAdapter.writeAiConfig!(dir, {});
    expect(await read('.codex/config.toml')).toBe('model = "user-edited"\n');
  });

  it('round-trips through readAiConfig', async () => {
    await codexAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://oai.test/v1', apiKey: 'sk-c', model: 'gpt-x', wireApi: 'responses',
    });
    expect(await codexAdapter.readAiConfig!(dir)).toEqual({
      baseUrl: 'https://oai.test/v1', apiKey: 'sk-c', model: 'gpt-x', wireApi: 'responses', wireShape: 'openai-responses',
    });
  });

  it('writes and round-trips model_reasoning_effort', async () => {
    await codexAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://oai.test/v1', model: 'gpt-x', reasoningEffort: 'medium',
    });
    expect(await read('.codex/openalice-home/config.toml'))
      .toContain('model_reasoning_effort = "medium"\n');
    expect(await codexAdapter.readAiConfig!(dir)).toMatchObject({ reasoningEffort: 'medium' });
  });

  it('writes and round-trips an effort-only native-login preference', async () => {
    await codexAdapter.writeAiConfig!(dir, { reasoningEffort: 'high' });
    expect(await read('.codex/config.toml')).toBe('model_reasoning_effort = "high"\n');
    expect(codexAdapter.composeEnv!({ cwd: dir, env: {} })).toEqual({});
    expect(await codexAdapter.readAiConfig!(dir)).toMatchObject({
      model: null,
      reasoningEffort: 'high',
    });
  });

  it('readAiConfig returns null when no files exist', async () => {
    expect(await codexAdapter.readAiConfig!(dir)).toBeNull();
  });

  it('listOnDisk returns only rollouts whose session_meta cwd matches this workspace', async () => {
    await codexAdapter.writeAiConfig!(dir, { baseUrl: 'https://oai.test/v1', model: 'gpt-x' });
    // Only custom-provider mode reads sessions from its isolated CODEX_HOME.
    const leaf = join(dir, '.codex', 'openalice-home', 'sessions', '2026', '06', '05');
    await mkdir(leaf, { recursive: true });
    const mine = { type: 'session_meta', payload: { id: 'mine-uuid-0001', cwd: dir } };
    const other = { type: 'session_meta', payload: { id: 'other-uuid-0002', cwd: '/some/other/workspace' } };
    // line-1 is a (potentially huge) session_meta; subsequent lines are turns.
    await writeFile(join(leaf, 'rollout-2026-06-05T10-00-00-mine.jsonl'), JSON.stringify(mine) + '\n{"type":"turn"}\n');
    await writeFile(join(leaf, 'rollout-2026-06-05T11-00-00-other.jsonl'), JSON.stringify(other) + '\n');
    const found = await codexAdapter.listOnDisk!(dir);
    expect(found.map((s) => s.sessionId)).toEqual(['mine-uuid-0001']);
  });

  it('listOnDisk returns [] when there are no sessions', async () => {
    expect(await codexAdapter.listOnDisk!(dir)).toEqual([]);
  });
});

describe('opencodeAdapter AI-config', () => {
  const mcpEnv = { OPENALICE_MCP_URL: 'http://127.0.0.1:47332/mcp', AQ_WS_ID: 'ws-abc' };

  it('prepares OpenCode to derive its theme from the terminal palette', async () => {
    await mkdir(join(dir, '.git/info'), { recursive: true });
    await writeFile(join(dir, '.git/info/exclude'), 'existing.local\n');

    await prepareAgentRuntimeWorkspace(opencodeAdapter, {
      wsId: 'ws-abc',
      cwd: dir,
      launcherRepoRoot: '/repo',
    });
    await prepareAgentRuntimeWorkspace(opencodeAdapter, {
      wsId: 'ws-abc',
      cwd: dir,
      launcherRepoRoot: '/repo',
    });

    expect(JSON.parse(await read('tui.json'))).toEqual({
      $schema: 'https://opencode.ai/tui.json',
      theme: 'system',
    });
    expect((await read('.git/info/exclude')).split(/\r?\n/).filter((line) => line === 'tui.json'))
      .toEqual(['tui.json']);
  });

  it('preserves an explicit OpenCode project theme and sibling TUI settings', async () => {
    await writeFile(join(dir, 'tui.json'), JSON.stringify({ theme: 'catppuccin', scroll_speed: 2 }));

    await prepareAgentRuntimeWorkspace(opencodeAdapter, {
      wsId: 'ws-abc',
      cwd: dir,
      launcherRepoRoot: '/repo',
    });

    expect(JSON.parse(await read('tui.json'))).toEqual({ theme: 'catppuccin', scroll_speed: 2 });
  });

  it('adds the system theme without replacing sibling TUI settings', async () => {
    await writeFile(join(dir, 'tui.json'), JSON.stringify({ scroll_speed: 2 }));

    await prepareAgentRuntimeWorkspace(opencodeAdapter, {
      wsId: 'ws-abc',
      cwd: dir,
      launcherRepoRoot: '/repo',
    });

    expect(JSON.parse(await read('tui.json'))).toEqual({
      scroll_speed: 2,
      $schema: 'https://opencode.ai/tui.json',
      theme: 'system',
    });
  });

  it('leaves a legacy OpenCode theme in provider config for native migration', async () => {
    await writeFile(join(dir, 'opencode.json'), JSON.stringify({ theme: 'system', share: 'disabled' }));

    await prepareAgentRuntimeWorkspace(opencodeAdapter, {
      wsId: 'ws-abc',
      cwd: dir,
      launcherRepoRoot: '/repo',
    });

    expect(existsSync(join(dir, 'tui.json'))).toBe(false);
    expect(JSON.parse(await read('opencode.json'))).toEqual({ theme: 'system', share: 'disabled' });
  });

  it('leaves JSONC TUI configuration to OpenCode', async () => {
    await writeFile(join(dir, 'tui.jsonc'), '{ // user-owned\n  "scroll_speed": 2\n}\n');

    await prepareAgentRuntimeWorkspace(opencodeAdapter, {
      wsId: 'ws-abc',
      cwd: dir,
      launcherRepoRoot: '/repo',
    });

    expect(existsSync(join(dir, 'tui.json'))).toBe(false);
    expect(await read('tui.jsonc')).toBe('{ // user-owned\n  "scroll_speed": 2\n}\n');
  });

  it('keeps OpenAlice MCP out of opencode env even when an MCP URL is present', () => {
    const env = opencodeAdapter.composeEnv!({ cwd: dir, env: mcpEnv });
    expect(env['OPENCODE_DISABLE_MODELS_FETCH']).toBe('1');
    expect(env['OPENCODE_DISABLE_AUTOUPDATE']).toBe('1');
    expect(env['OPENCODE_DISABLE_LSP_DOWNLOAD']).toBe('1');
    expect(env['OPENCODE_CONFIG_CONTENT']).toBeUndefined();
  });

  it('composeCommand: fresh is the bare binary; resume uses top-level flags', () => {
    expect(opencodeAdapter.composeCommand(['ignored'], { cwd: dir, env: mcpEnv })).toEqual(['opencode']);
    expect(opencodeAdapter.composeCommand([], { cwd: dir, env: mcpEnv, resume: 'last' }))
      .toEqual(['opencode', '--continue']);
    expect(opencodeAdapter.composeCommand([], { cwd: dir, env: mcpEnv, resume: { sessionId: 'ses_123' } }))
      .toEqual(['opencode', '--session', 'ses_123']);
  });

  it('writes a custom OpenAI-compatible provider opencode.json', async () => {
    await opencodeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://cn.test/v1', apiKey: 'sk-o', model: 'deepseek-chat',
    });
    expect(JSON.parse(await read('opencode.json'))).toMatchObject({
      $schema: 'https://opencode.ai/config.json',
      provider: {
        workspace: {
          npm: '@ai-sdk/openai-compatible',
          name: 'OpenAlice workspace provider',
          options: { baseURL: 'https://cn.test/v1', apiKey: 'sk-o' },
          models: {
            'deepseek-chat': {
              name: 'deepseek-chat',
              variants: {
                none: { reasoningEffort: 'none' },
                high: { reasoningEffort: 'high' },
                max: { reasoningEffort: 'max' },
              },
            },
          },
        },
      },
      model: 'workspace/deepseek-chat',
    });
  });

  it('writes an explicit custom-model context window for opencode when provided', async () => {
    await opencodeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://cn.test/v1', apiKey: 'sk-o', model: 'deepseek-chat', contextWindow: 1_000_000,
    });
    expect(JSON.parse(await read('opencode.json')).provider.workspace.models['deepseek-chat']).toMatchObject({
      name: 'deepseek-chat',
      limit: { context: 1_000_000, output: 16_384 },
    });
  });

  it.each([true, false])('round-trips opencode reasoning=%s', async (reasoning) => {
    await opencodeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://cn.test/v1',
      model: 'reasoning-model',
      contextWindow: 256_000,
      reasoning,
    });
    expect(JSON.parse(await read('opencode.json')).provider.workspace.models['reasoning-model'])
      .toMatchObject({ reasoning });
    expect(await opencodeAdapter.readAiConfig!(dir)).toMatchObject({ reasoning });
  });

  it.each([
    ['openai-chat', 'medium', { reasoningEffort: 'medium' }],
    ['anthropic', 'high', { effort: 'high' }],
    ['google-generative-ai', 'low', { thinkingConfig: { includeThoughts: true, thinkingLevel: 'low' } }],
  ] as const)('projects %s effort into model options and round-trips it', async (wireShape, reasoningEffort, options) => {
    await opencodeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://provider.test', model: 'reasoning-model', wireShape, reasoningEffort,
    });
    expect(JSON.parse(await read('opencode.json')).provider.workspace.models['reasoning-model'].options)
      .toEqual(options);
    expect(await opencodeAdapter.readAiConfig!(dir)).toMatchObject({ reasoningEffort });
  });

  it('enables adaptive thinking when projecting effort for a current Claude model', async () => {
    await opencodeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
      wireShape: 'anthropic',
      reasoningEffort: 'high',
    });
    expect(JSON.parse(await read('opencode.json')).provider.workspace.models['claude-sonnet-4-6'].options)
      .toEqual({ thinking: { type: 'adaptive' }, effort: 'high' });
    expect(await opencodeAdapter.readAiConfig!(dir)).toMatchObject({ reasoningEffort: 'high' });
  });

  it('honors wireShape — Anthropic, Google, and OpenAI Responses use their native SDKs', async () => {
    await opencodeAdapter.writeAiConfig!(dir, { baseUrl: 'https://x/anthropic', apiKey: 'k', model: 'glm-5.1', wireShape: 'anthropic' });
    expect(JSON.parse(await read('opencode.json')).provider.workspace.npm).toBe('@ai-sdk/anthropic');
    await opencodeAdapter.writeAiConfig!(dir, { baseUrl: 'https://x/google', apiKey: 'AQ.k', model: 'gemini', wireShape: 'google-generative-ai' });
    expect(JSON.parse(await read('opencode.json')).provider.workspace.npm).toBe('@ai-sdk/google');
    expect((await opencodeAdapter.readAiConfig!(dir))?.wireShape).toBe('google-generative-ai');
    await opencodeAdapter.writeAiConfig!(dir, { baseUrl: 'https://x/v1', apiKey: 'k', model: 'gpt-5.5', wireShape: 'openai-responses' });
    expect(JSON.parse(await read('opencode.json')).provider.workspace.npm).toBe('@ai-sdk/openai');
  });

  it('writes Anthropic bearer auth without a conflicting x-api-key and round-trips it', async () => {
    await opencodeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://api.minimax.io/anthropic',
      apiKey: 'mm-key',
      model: 'MiniMax-M3',
      wireShape: 'anthropic',
      authMode: 'bearer',
    });
    const options = JSON.parse(await read('opencode.json')).provider.workspace.options;
    expect(options).toEqual({
      baseURL: 'https://api.minimax.io/anthropic',
      headers: { Authorization: 'Bearer mm-key' },
    });
    expect(await opencodeAdapter.readAiConfig!(dir)).toMatchObject({
      apiKey: 'mm-key',
      wireShape: 'anthropic',
      authMode: 'bearer',
    });
  });

  it('writes the automatic MiniMax opencode binding through native Anthropic thinking blocks', async () => {
    const cred = credentialToWorkspaceAiCred({
      vendor: 'minimax',
      apiKey: 'mm-key',
      wires: {
        anthropic: 'https://api.minimax.io/anthropic',
        'openai-chat': 'https://api.minimax.io/v1',
      },
    }, 'opencode', { model: 'MiniMax-M2.5' })!;

    await opencodeAdapter.writeAiConfig!(dir, cred);
    const config = JSON.parse(await read('opencode.json'));
    expect(config.provider.workspace).toMatchObject({
      npm: '@ai-sdk/anthropic',
      options: {
        baseURL: 'https://api.minimax.io/anthropic',
        headers: { Authorization: 'Bearer mm-key' },
      },
      models: {
        'MiniMax-M2.5': {
          name: 'MiniMax-M2.5',
          reasoning: true,
          limit: { context: 204_800, output: 16_384 },
        },
      },
    });
    expect(config.model).toBe('workspace/MiniMax-M2.5');
  });

  it('reset (empty cred) deletes opencode.json', async () => {
    await opencodeAdapter.writeAiConfig!(dir, { baseUrl: 'u', model: 'm' });
    await opencodeAdapter.writeAiConfig!(dir, {});
    expect(existsSync(join(dir, 'opencode.json'))).toBe(false);
  });

  it('preserves unrelated opencode config and restores the previous provider/model on reset', async () => {
    await writeFile(join(dir, 'opencode.json'), JSON.stringify({
      $schema: 'https://example.test/custom-schema.json',
      theme: 'system',
      provider: {
        other: { npm: '@ai-sdk/other' },
        workspace: { npm: '@ai-sdk/legacy', name: 'User workspace provider' },
      },
      model: 'other/old-model',
    }, null, 2));

    await opencodeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://provider.test/v1', apiKey: 'key', model: 'new-model', reasoning: true,
    });
    const injected = JSON.parse(await read('opencode.json'));
    expect(injected.theme).toBe('system');
    expect(injected.provider.other).toEqual({ npm: '@ai-sdk/other' });
    expect(injected.provider.workspace.models['new-model'].reasoning).toBe(true);

    await opencodeAdapter.writeAiConfig!(dir, {});
    expect(JSON.parse(await read('opencode.json'))).toEqual({
      $schema: 'https://example.test/custom-schema.json',
      theme: 'system',
      provider: {
        other: { npm: '@ai-sdk/other' },
        workspace: { npm: '@ai-sdk/legacy', name: 'User workspace provider' },
      },
      model: 'other/old-model',
    });
    expect(existsSync(join(dir, '.opencode/openalice-provider.json'))).toBe(false);
  });

  it('round-trips through readAiConfig (strips the provider/ prefix off model)', async () => {
    await opencodeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://cn.test/v1', apiKey: 'sk-o', model: 'deepseek-chat', contextWindow: 512_000,
    });
    expect(await opencodeAdapter.readAiConfig!(dir)).toEqual({
      baseUrl: 'https://cn.test/v1', apiKey: 'sk-o', model: 'deepseek-chat', wireShape: 'openai-chat', contextWindow: 512_000,
    });
  });

  it('readAiConfig returns null when no file exists', async () => {
    expect(await opencodeAdapter.readAiConfig!(dir)).toBeNull();
  });
});

describe('assignsSessionId capability (gates the launcher\'s assign-id-at-spawn path)', () => {
  it('only pi assigns its own session id; others harvest (fs-watch) or stay last-only', () => {
    // The spawn factory mints a uuid + persists resumeHint only when this is
    // true, and pi's composeCommand turns the synthesized {sessionId} into
    // `--session-id`. claude harvests via fs-watch; codex/opencode capture
    // post-spawn (subprocess/content-filter) — none assign.
    expect(piAdapter.capabilities.assignsSessionId).toBe(true);
    expect(claudeAdapter.capabilities.assignsSessionId ?? false).toBe(false);
    expect(codexAdapter.capabilities.assignsSessionId ?? false).toBe(false);
    expect(opencodeAdapter.capabilities.assignsSessionId ?? false).toBe(false);
  });
});

describe('composeHeadlessCommand (one-shot headless argv, prompt placed per-CLI)', () => {
  const ctx = (env: Record<string, string> = {}) => ({ cwd: '/ws', env });

  it('all four agent adapters declare the headless capability', () => {
    expect(claudeAdapter.capabilities.headless).toBe(true);
    expect(codexAdapter.capabilities.headless).toBe(true);
    expect(opencodeAdapter.capabilities.headless).toBe(true);
    expect(piAdapter.capabilities.headless).toBe(true);
  });

  it('claude: -p stream-json --verbose -- <prompt> (prompt after -- terminator, never --bare)', () => {
    // stream-json REQUIRES --verbose in -p mode (claude errors without it);
    // every event carries session_id, which is how the launcher captures the
    // run's identity for "open as session".
    expect(claudeAdapter.composeHeadlessCommand!(['claude'], ctx(), 'do x')).toEqual([
      'claude',
      '--settings',
      '{"enableAllProjectMcpServers":true}',
      '--allowedTools',
      'Bash(alice:*),Bash(alice-workspace:*),Bash(alice-uta:*),Bash(traderhub:*)',
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--',
      'do x',
    ]);
  });

  it('codex: CLI-mode headless (no MCP) — approval/sandbox/network -c + exec --json -- <prompt>', () => {
    expect(codexAdapter.composeHeadlessCommand!(['codex'], ctx(), 'do x')).toEqual([
      'codex',
      '-c',
      'approval_policy="never"',
      '-c',
      'sandbox_mode="workspace-write"',
      '-c',
      'sandbox_workspace_write.network_access=true',
      'exec',
      '--json',
      '--',
      'do x',
    ]);
  });

  it('opencode: run --format json -- <prompt> (tools via CLI shims)', () => {
    expect(opencodeAdapter.composeHeadlessCommand!(['opencode'], ctx(), 'do x')).toEqual([
      'opencode',
      'run',
      '--format',
      'json',
      '--',
      'do x',
    ]);
  });

  it('pi: -p --mode json <prompt> (bare trailing positional — pi rejects --)', () => {
    expect(piAdapter.composeHeadlessCommand!(['pi'], ctx(), 'do x')).toEqual([
      'pi',
      '-p',
      '--mode',
      'json',
      'do x',
    ]);
  });

  it('pi: Docker headless explicitly approves the image-pinned runtime', () => {
    expect(piAdapter.composeHeadlessCommand!(['pi'], ctx({ OPENALICE_LAUNCHER: 'docker' }), 'do x')).toEqual([
      'pi', '--approve', '-p', '--mode', 'json', 'do x',
    ]);
  });

  it('projects one-run model and effort overrides into every native CLI', () => {
    expect(claudeAdapter.composeHeadlessCommand!(
      ['claude'],
      ctx(),
      'do x',
      { model: 'claude-opus-4-8', reasoningEffort: 'high' },
    )).toEqual(expect.arrayContaining([
      '--model', 'claude-opus-4-8', '--effort', 'high',
    ]));
    expect(codexAdapter.composeHeadlessCommand!(
      ['codex'],
      ctx(),
      'do x',
      { model: 'gpt-5.6', reasoningEffort: 'xhigh' },
    )).toEqual(expect.arrayContaining([
      '--model', 'gpt-5.6', '-c', 'model_reasoning_effort="xhigh"',
    ]));
    expect(opencodeAdapter.composeHeadlessCommand!(
      ['opencode'],
      ctx(),
      'do x',
      { model: 'openai/gpt-5.6', reasoningEffort: 'high' },
    )).toEqual(expect.arrayContaining([
      '--model', 'openai/gpt-5.6', '--variant', 'high',
    ]));
    expect(piAdapter.composeHeadlessCommand!(
      ['pi'],
      ctx(),
      'do x',
      { model: 'gpt-5.6', reasoningEffort: 'none' },
    )).toEqual(expect.arrayContaining([
      '--model', 'gpt-5.6', '--thinking', 'off',
    ]));
  });

  it('rejects a one-run effort Claude Code does not expose', () => {
    expect(() => claudeAdapter.composeHeadlessCommand!(
      ['claude'],
      ctx(),
      'do x',
      { reasoningEffort: 'xhigh' },
    )).toThrow(/cannot use one-run effort xhigh/);
  });

  it('keeps custom-provider model overrides inside registered opencode/Pi models', async () => {
    await opencodeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://provider.test/v1',
      model: 'registered-model',
    });
    expect(opencodeAdapter.composeHeadlessCommand!(
      ['opencode'],
      { cwd: dir, env: {} },
      'do x',
      { model: 'registered-model', reasoningEffort: 'high' },
    )).toEqual(expect.arrayContaining([
      '--model', 'workspace/registered-model', '--variant', 'high',
    ]));
    expect(() => opencodeAdapter.composeHeadlessCommand!(
      ['opencode'],
      { cwd: dir, env: {} },
      'do x',
      { model: 'unregistered-model' },
    )).toThrow(/not registered by this Workspace provider/);

    await mkdir(join(dir, '.pi'), { recursive: true });
    await writeFile(join(dir, '.pi/settings.json'), JSON.stringify({
      defaultProvider: 'openalice-workspace-test',
      defaultModel: 'registered-model',
    }));
    expect(() => piAdapter.composeHeadlessCommand!(
      ['pi'],
      { cwd: dir, env: {} },
      'do x',
      { model: 'unregistered-model' },
    )).toThrow(/not registered by this Workspace provider/);
  });

  it('resumes headless conversations by backend-resolved native id for all runtimes', () => {
    const resume = { sessionId: 'native-session-1' } as const;
    expect(claudeAdapter.composeHeadlessCommand!(['claude'], { ...ctx(), resume }, 'next')).toContain('native-session-1');
    expect(codexAdapter.composeHeadlessCommand!(['codex'], { ...ctx(), resume }, 'next')).toEqual(expect.arrayContaining([
      'exec', 'resume', '--json', 'native-session-1', 'next',
    ]));
    expect(opencodeAdapter.composeHeadlessCommand!(['opencode'], { ...ctx(), resume }, 'next')).toEqual([
      'opencode', 'run', '--format', 'json', '--session', 'native-session-1', '--', 'next',
    ]);
    expect(piAdapter.composeHeadlessCommand!(['pi'], { ...ctx(), resume }, 'next')).toEqual([
      'pi', '--session-id', 'native-session-1', '-p', '--mode', 'json', 'next',
    ]);
  });

  it('claude/codex/opencode place a -leading prompt after a -- terminator', () => {
    const dashy = '--help me by explaining X';
    for (const a of [claudeAdapter, codexAdapter, opencodeAdapter]) {
      const argv = a.composeHeadlessCommand!(['bin'], ctx({ OPENALICE_MCP_URL: 'http://x/mcp', AQ_WS_ID: 'w' }), dashy);
      expect(argv[argv.length - 1]).toBe(dashy); // prompt is the last token
      expect(argv[argv.length - 2]).toBe('--'); // immediately after the terminator
    }
  });

  it('pi takes the prompt as a bare trailing positional (no -- terminator available)', () => {
    const argv = piAdapter.composeHeadlessCommand!(['pi'], ctx(), 'hello');
    expect(argv[argv.length - 1]).toBe('hello');
    expect(argv).not.toContain('--');
  });
});

describe('piAdapter AI-config', () => {
  const mcpEnv = { OPENALICE_MCP_URL: 'http://127.0.0.1:47332/mcp', AQ_WS_ID: 'ws-abc' };
  let previousPiAgentDir: string | undefined;

  beforeEach(() => {
    previousPiAgentDir = process.env['PI_CODING_AGENT_DIR'];
    process.env['PI_CODING_AGENT_DIR'] = join(dir, 'pi-user-agent');
  });

  afterEach(() => {
    if (previousPiAgentDir === undefined) delete process.env['PI_CODING_AGENT_DIR'];
    else process.env['PI_CODING_AGENT_DIR'] = previousPiAgentDir;
  });

  const readGlobalModels = async (): Promise<Record<string, any>> =>
    JSON.parse(await readFile(join(dir, 'pi-user-agent', 'models.json'), 'utf8')) as Record<string, any>;

  const readWorkspaceProvider = async (): Promise<Record<string, any>> => {
    const models = await readGlobalModels();
    return models['providers'][piWorkspaceProviderId(dir)] as Record<string, any>;
  };

  it('prepares Pi to follow the terminal light/dark mode by default', async () => {
    await mkdir(join(dir, '.pi'), { recursive: true });
    await writeFile(join(dir, '.pi/settings.json'), JSON.stringify({ quietStartup: true }));

    await prepareAgentRuntimeWorkspace(piAdapter, {
      wsId: 'ws-abc',
      cwd: dir,
      launcherRepoRoot: '/repo',
    });

    expect(JSON.parse(await read('.pi/settings.json'))).toEqual({
      quietStartup: true,
      theme: 'light/dark',
    });
  });

  it('preserves an explicit Pi project theme on later lifecycle runs', async () => {
    await mkdir(join(dir, '.pi'), { recursive: true });
    await writeFile(join(dir, '.pi/settings.json'), JSON.stringify({ theme: 'dark' }));

    await prepareAgentRuntimeWorkspace(piAdapter, {
      wsId: 'ws-abc',
      cwd: dir,
      launcherRepoRoot: '/repo',
    });

    expect(JSON.parse(await read('.pi/settings.json'))).toEqual({ theme: 'dark' });
  });

  it('records a new OpenAlice workspace in Pi global trust without forcing agent-dir redirection', async () => {
    const home = join(dir, 'home');
    await syncPiProjectTrust(dir, { HOME: home });
    const canonicalDir = await realpath(dir);

    expect(JSON.parse(await readFile(join(home, '.pi/agent/trust.json'), 'utf8'))).toEqual({
      [canonicalDir]: true,
    });
    expect(piAdapter.composeEnv!({ cwd: dir, env: { HOME: home } })).toEqual({});
  });

  it('ignores a legacy workspace agent dir for trust and preserves an explicit parent refusal', async () => {
    await mkdir(join(dir, '.pi-agent'), { recursive: true });
    const providerHome = join(dir, 'provider-home');
    await syncPiProjectTrust(dir, { HOME: providerHome });
    const canonicalDir = await realpath(dir);
    expect(JSON.parse(await readFile(join(providerHome, '.pi/agent/trust.json'), 'utf8'))).toEqual({
      [canonicalDir]: true,
    });
    expect(existsSync(join(dir, '.pi-agent/trust.json'))).toBe(false);

    const parent = dirname(canonicalDir);
    const refused = join(dir, 'refused');
    await mkdir(refused, { recursive: true });
    const home = join(dir, 'refused-home');
    await mkdir(join(home, '.pi/agent'), { recursive: true });
    await writeFile(join(home, '.pi/agent/trust.json'), JSON.stringify({ [parent]: false }));
    await syncPiProjectTrust(refused, { HOME: home });
    expect(JSON.parse(await readFile(join(home, '.pi/agent/trust.json'), 'utf8'))).toEqual({
      [parent]: false,
    });
  });

  it('preserves a malformed Pi-owned trust store instead of blocking launch or overwriting it', async () => {
    const home = join(dir, 'malformed-home');
    const trustPath = join(home, '.pi/agent/trust.json');
    await mkdir(dirname(trustPath), { recursive: true });
    await writeFile(trustPath, '{ user is repairing this');

    await expect(syncPiProjectTrust(dir, { HOME: home })).resolves.toBeUndefined();
    expect(await readFile(trustPath, 'utf8')).toBe('{ user is repairing this');
  });

  it('composeCommand leaves project trust to Pi and the user', () => {
    expect(piAdapter.composeCommand(['ignored'], { cwd: dir, env: mcpEnv })).toEqual(['pi']);
    expect(piAdapter.composeCommand([], { cwd: dir, env: mcpEnv, resume: 'last' }))
      .toEqual(['pi', '--continue']);
    expect(piAdapter.composeCommand([], { cwd: dir, env: mcpEnv, resume: { sessionId: 'sess-1' } }))
      .toEqual(['pi', '--session-id', 'sess-1']);
  });

  it('composeWebCommand is opt-in RPC and does not alter the TUI command', () => {
    const spawn = { cwd: dir, env: mcpEnv, resume: { sessionId: 'sess-web' } } as const;
    expect(piAdapter.composeCommand([], spawn)).toEqual(['pi', '--session-id', 'sess-web']);
    expect(piAdapter.composeWebCommand?.([], spawn)).toEqual([
      'pi', '--session-id', 'sess-web', '--mode', 'rpc',
    ]);
  });

  it('composeWebCommand can explicitly load the launcher manager contract', () => {
    const spawn = {
      cwd: dir,
      env: mcpEnv,
      resume: { sessionId: 'sess-manager' },
      approveProject: true,
      appendSystemPrompt: 'Manage the office floor.',
      skills: ['/repo/default/skills/workspace-manager'],
    } as const;
    expect(piAdapter.composeWebCommand?.([], spawn)).toEqual([
      'pi',
      '--approve',
      '--append-system-prompt', 'Manage the office floor.',
      '--skill', '/repo/default/skills/workspace-manager',
      '--session-id', 'sess-manager',
      '--mode', 'rpc',
    ]);
  });

  it('composeWebCommand uses the packaged managed Pi trust flag only on the RPC surface', () => {
    const env = { ...mcpEnv, OPENALICE_MANAGED_PI_PATH: '/app/vendor/pi/pi' };
    const spawn = { cwd: dir, env, resume: { sessionId: 'sess-web' } } as const;
    expect(piAdapter.composeCommand([], spawn)).toEqual([
      '/app/vendor/pi/pi', '--session-id', 'sess-web',
    ]);
    expect(piAdapter.composeWebCommand?.([], spawn)).toEqual([
      '/app/vendor/pi/pi', '--approve', '--session-id', 'sess-web', '--mode', 'rpc',
    ]);
  });

  it('composeCommand uses managed Pi binary path when the spawn env provides one', () => {
    const env = { ...mcpEnv, OPENALICE_MANAGED_PI_PATH: '/app/vendor/pi/pi' };
    expect(piAdapter.composeCommand(['ignored'], { cwd: dir, env })).toEqual(['/app/vendor/pi/pi']);
    expect(piAdapter.composeHeadlessCommand!([], { cwd: dir, env }, 'hello')).toEqual([
      '/app/vendor/pi/pi', '--approve', '-p', '--mode', 'json', 'hello',
    ]);
  });

  it('composeCommand runs managed Pi npm runtime through the injected Node path', () => {
    const env = {
      ...mcpEnv,
      OPENALICE_MANAGED_PI_PATH: '/app/vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
      OPENALICE_MANAGED_PI_NODE_PATH: '/Applications/OpenAlice.app/Contents/MacOS/OpenAlice',
    };
    expect(piAdapter.composeCommand(['ignored'], { cwd: dir, env })).toEqual([
      '/Applications/OpenAlice.app/Contents/MacOS/OpenAlice',
      '/app/vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
    ]);
    expect(piAdapter.composeHeadlessCommand!([], { cwd: dir, env }, 'hello')).toEqual([
      '/Applications/OpenAlice.app/Contents/MacOS/OpenAlice',
      '/app/vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
      '--approve',
      '-p',
      '--mode',
      'json',
      'hello',
    ]);
  });

  it('composeEnv leaves Pi startup networking and the native agent-dir fallback untouched', async () => {
    const before = piAdapter.composeEnv!({ cwd: dir, env: mcpEnv });
    expect(before['PI_OFFLINE']).toBeUndefined();
    expect(before['PI_CODING_AGENT_DIR']).toBeUndefined();
    await piAdapter.writeAiConfig!(dir, { baseUrl: 'https://cn.test/v1', apiKey: 'sk-p', model: 'deepseek-chat' });
    expect(piAdapter.composeEnv!({ cwd: dir, env: mcpEnv })).toEqual({});
  });

  it('writes the provider globally and selects it through native project settings', async () => {
    await piAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://cn.test/v1', apiKey: 'sk-p', model: 'deepseek-chat',
    });
    expect(await readWorkspaceProvider()).toEqual({
      name: `OpenAlice workspace provider (${basename(dir)})`,
      api: 'openai-completions',
      baseUrl: 'https://cn.test/v1',
      apiKey: 'sk-p',
      models: [{ id: 'deepseek-chat' }],
    });
    const settings = JSON.parse(await read('.pi/settings.json'));
    expect(settings.defaultProvider).toBe(piWorkspaceProviderId(dir));
    expect(settings.defaultModel).toBe('deepseek-chat');
    if (process.platform === 'win32') expect(settings.shellPath).toMatch(/bash\.exe$/i);
    else expect(settings.shellPath).toBeUndefined();
    expect(existsSync(join(dir, '.pi-agent'))).toBe(false);
  });

  it('serializes concurrent Workspace providers without dropping either global entry', async () => {
    const other = join(dir, 'second-workspace');
    await mkdir(other, { recursive: true });
    await Promise.all([
      piAdapter.writeAiConfig!(dir, { baseUrl: 'https://one/v1', model: 'one' }),
      piAdapter.writeAiConfig!(other, { baseUrl: 'https://two/v1', model: 'two' }),
    ]);
    const providers = (await readGlobalModels())['providers'];
    expect(providers[piWorkspaceProviderId(dir)].models).toEqual([{ id: 'one' }]);
    expect(providers[piWorkspaceProviderId(other)].models).toEqual([{ id: 'two' }]);
  });

  it('writes managed shellPath into Pi settings when the runtime profile provides one', async () => {
    const shellPath = join(dir, 'managed-bash');
    await writeFile(shellPath, '');
    const before = process.env['OPENALICE_MANAGED_SHELL_PATH'];
    process.env['OPENALICE_MANAGED_SHELL_PATH'] = shellPath;
    try {
      await piAdapter.writeAiConfig!(dir, {
        baseUrl: 'https://cn.test/v1', apiKey: 'sk-p', model: 'deepseek-chat',
      });
      expect(JSON.parse(await read('.pi/settings.json'))).toEqual({
        defaultProvider: piWorkspaceProviderId(dir),
        defaultModel: 'deepseek-chat',
        shellPath,
      });
    } finally {
      if (before === undefined) delete process.env['OPENALICE_MANAGED_SHELL_PATH'];
      else process.env['OPENALICE_MANAGED_SHELL_PATH'] = before;
    }
  });

  it('backfills the Windows shell path without overwriting Pi-owned settings', async () => {
    await piAdapter.writeAiConfig!(dir, { baseUrl: 'https://x/v1', model: 'm' });
    const settingsPath = join(dir, '.pi', 'settings.json');
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, unknown>;
    delete settings['shellPath'];
    settings['theme'] = 'light';
    await writeFile(settingsPath, JSON.stringify(settings));
    const customPath = 'D:\\PortableGit\\bin\\bash.exe';
    const before = process.env['OPENALICE_WORKSPACE_SHELL_PATH'];
    process.env['OPENALICE_WORKSPACE_SHELL_PATH'] = customPath;
    try {
      await syncPiWindowsShellPath(dir, 'win32');
      expect(JSON.parse(await read('.pi/settings.json'))).toEqual({
        defaultProvider: piWorkspaceProviderId(dir),
        defaultModel: 'm',
        theme: 'light',
        shellPath: customPath,
      });
    } finally {
      if (before === undefined) delete process.env['OPENALICE_WORKSPACE_SHELL_PATH'];
      else process.env['OPENALICE_WORKSPACE_SHELL_PATH'] = before;
    }
  });

  it('writes an explicit custom-model context window for Pi when provided', async () => {
    await piAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://cn.test/v1', apiKey: 'sk-p', model: 'deepseek-chat', contextWindow: 1_000_000,
    });
    expect((await readWorkspaceProvider())['models']).toEqual([
      { id: 'deepseek-chat', contextWindow: 1_000_000 },
    ]);
  });

  it.each([true, false])('round-trips Pi reasoning=%s without changing global Pi defaults', async (reasoning) => {
    const globalSettingsPath = join(dir, 'pi-user-agent', 'settings.json');
    await mkdir(dirname(globalSettingsPath), { recursive: true });
    await writeFile(globalSettingsPath, JSON.stringify({ defaultProvider: 'user', thinkingLevel: 'high' }));
    await piAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://cn.test/v1', model: 'reasoning-model', reasoning,
    });
    expect((await readWorkspaceProvider())['models']).toEqual([{ id: 'reasoning-model', reasoning }]);
    expect(await piAdapter.readAiConfig!(dir)).toMatchObject({ reasoning });
    expect(JSON.parse(await readFile(globalSettingsPath, 'utf8'))).toEqual({
      defaultProvider: 'user',
      thinkingLevel: 'high',
    });
  });

  it('round-trips Pi effort through project defaultThinkingLevel and restores the prior value', async () => {
    await mkdir(join(dir, '.pi'), { recursive: true });
    await writeFile(join(dir, '.pi/settings.json'), JSON.stringify({ defaultThinkingLevel: 'low', theme: 'dark' }));
    await piAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://cn.test/v1', model: 'reasoning-model', reasoningEffort: 'high',
    });
    expect(JSON.parse(await read('.pi/settings.json'))).toMatchObject({ defaultThinkingLevel: 'high' });
    expect(await piAdapter.readAiConfig!(dir)).toMatchObject({ reasoningEffort: 'high' });
    await piAdapter.writeAiConfig!(dir, {});
    expect(JSON.parse(await read('.pi/settings.json'))).toEqual({ defaultThinkingLevel: 'low', theme: 'dark' });
  });

  it('maps registry effort none to Pi\'s native off level', async () => {
    await piAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://cn.test/v1', model: 'reasoning-model', reasoningEffort: 'none',
    });
    expect(JSON.parse(await read('.pi/settings.json')).defaultThinkingLevel).toBe('off');
    expect(await piAdapter.readAiConfig!(dir)).toMatchObject({ reasoningEffort: 'none' });
  });

  it('honors wireShape — Anthropic, Google, and OpenAI Responses use native Pi APIs', async () => {
    await piAdapter.writeAiConfig!(dir, { baseUrl: 'https://x/anthropic', apiKey: 'k', model: 'glm-5.1', wireShape: 'anthropic' });
    expect((await readWorkspaceProvider())['api']).toBe('anthropic-messages');
    await piAdapter.writeAiConfig!(dir, { baseUrl: 'https://x/google', apiKey: 'AQ.k', model: 'gemini', wireShape: 'google-generative-ai' });
    expect((await readWorkspaceProvider())['api']).toBe('google-generative-ai');
    expect((await piAdapter.readAiConfig!(dir))?.wireShape).toBe('google-generative-ai');
    await piAdapter.writeAiConfig!(dir, { baseUrl: 'https://x/v1', apiKey: 'k', model: 'gpt-5.5', wireShape: 'openai-responses' });
    expect((await readWorkspaceProvider())['api']).toBe('openai-responses');
  });

  it('writes Anthropic bearer auth without a conflicting apiKey and round-trips it', async () => {
    await piAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'mm-key',
      model: 'MiniMax-M3',
      wireShape: 'anthropic',
      authMode: 'bearer',
    });
    const provider = await readWorkspaceProvider();
    expect(provider.apiKey).toBeUndefined();
    expect(provider.headers).toEqual({ Authorization: 'Bearer mm-key' });
    expect(await piAdapter.readAiConfig!(dir)).toMatchObject({
      apiKey: 'mm-key',
      wireShape: 'anthropic',
      authMode: 'bearer',
    });
  });

  it('reset restores prior project defaults and removes only the OpenAlice provider', async () => {
    await mkdir(join(dir, '.pi'), { recursive: true });
    await writeFile(join(dir, '.pi/settings.json'), JSON.stringify({
      defaultProvider: 'user-provider',
      defaultModel: 'user-model',
      theme: 'dark',
    }));
    const globalModelsPath = join(dir, 'pi-user-agent', 'models.json');
    await mkdir(dirname(globalModelsPath), { recursive: true });
    await writeFile(globalModelsPath, JSON.stringify({
      providers: { user: { name: 'User provider', api: 'openai-completions' } },
      customField: true,
    }));
    await piAdapter.writeAiConfig!(dir, { baseUrl: 'u', model: 'm' });
    await piAdapter.writeAiConfig!(dir, {});
    expect(JSON.parse(await read('.pi/settings.json'))).toEqual({
      defaultProvider: 'user-provider',
      defaultModel: 'user-model',
      theme: 'dark',
    });
    expect(await readGlobalModels()).toEqual({
      providers: { user: { name: 'User provider', api: 'openai-completions' } },
      customField: true,
    });
    expect(existsSync(join(dir, '.pi/openalice-provider.json'))).toBe(false);
  });

  it('Pi reset leaves project selections edited after injection in place', async () => {
    await piAdapter.writeAiConfig!(dir, { baseUrl: 'u', model: 'injected-model' });
    const settingsPath = join(dir, '.pi/settings.json');
    const settings = JSON.parse(await read('.pi/settings.json'));
    settings.defaultProvider = 'user-provider';
    settings.defaultModel = 'user-model';
    await writeFile(settingsPath, JSON.stringify(settings));

    await piAdapter.writeAiConfig!(dir, {});
    expect(JSON.parse(await read('.pi/settings.json'))).toEqual({
      defaultProvider: 'user-provider',
      defaultModel: 'user-model',
    });
    expect(existsSync(join(dir, '.pi/openalice-provider.json'))).toBe(false);
  });

  it('round-trips through readAiConfig', async () => {
    await piAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://cn.test/v1', apiKey: 'sk-p', model: 'deepseek-chat', contextWindow: 256_000,
    });
    expect(await piAdapter.readAiConfig!(dir)).toEqual({
      baseUrl: 'https://cn.test/v1', apiKey: 'sk-p', model: 'deepseek-chat', wireShape: 'openai-chat', contextWindow: 256_000,
    });
  });

  it('readAiConfig returns null when no file exists', async () => {
    expect(await piAdapter.readAiConfig!(dir)).toBeNull();
  });

  it('preserves malformed Pi-owned global models instead of overwriting it', async () => {
    const modelsPath = join(dir, 'pi-user-agent', 'models.json');
    await mkdir(dirname(modelsPath), { recursive: true });
    await writeFile(modelsPath, '{ user is repairing this');
    await expect(piAdapter.writeAiConfig!(dir, { baseUrl: 'u', model: 'm' }))
      .rejects.toThrow(/not valid JSON/);
    expect(await readFile(modelsPath, 'utf8')).toBe('{ user is repairing this');
  });

  it('migrates legacy provider, settings, auth, trust, packages, and sessions without hiding user state', async () => {
    const legacy = join(dir, '.pi-agent');
    await mkdir(join(legacy, 'sessions', 'workspace-session'), { recursive: true });
    await mkdir(join(legacy, 'packages', 'legacy-package'), { recursive: true });
    await writeFile(join(legacy, 'models.json'), JSON.stringify({
      providers: {
        workspace: {
          name: 'OpenAlice workspace provider',
          api: 'openai-completions',
          baseUrl: 'https://legacy/v1',
          apiKey: 'legacy-key',
          models: [{ id: 'legacy-model', reasoning: true }],
        },
        legacyUser: { name: 'Legacy user provider', api: 'openai-completions' },
      },
    }));
    await writeFile(join(legacy, 'settings.json'), JSON.stringify({ defaultProvider: 'workspace', theme: 'legacy' }));
    await writeFile(join(legacy, 'auth.json'), JSON.stringify({ legacyUser: { type: 'api_key', key: 'legacy-auth' } }));
    await writeFile(join(legacy, 'trust.json'), JSON.stringify({ '/legacy': false }));
    await writeFile(join(legacy, 'sessions', 'workspace-session', 'turn.jsonl'), '{}\n');
    await writeFile(join(legacy, 'packages', 'legacy-package', 'package.json'), '{}\n');

    const globalDir = join(dir, 'pi-user-agent');
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(globalDir, 'settings.json'), JSON.stringify({ theme: 'user', thinkingLevel: 'high' }));
    await writeFile(join(globalDir, 'auth.json'), JSON.stringify({ existing: { type: 'api_key', key: 'keep' } }));

    await expect(migrateLegacyPiAgentDir(dir)).resolves.toBe(true);
    expect(existsSync(legacy)).toBe(false);
    expect(await readFile(join(globalDir, 'sessions', 'workspace-session', 'turn.jsonl'), 'utf8')).toBe('{}\n');
    expect(await readFile(join(globalDir, 'packages', 'legacy-package', 'package.json'), 'utf8')).toBe('{}\n');
    expect(JSON.parse(await readFile(join(globalDir, 'settings.json'), 'utf8'))).toEqual({
      theme: 'user', thinkingLevel: 'high',
    });
    expect(JSON.parse(await readFile(join(globalDir, 'auth.json'), 'utf8'))).toEqual({
      legacyUser: { type: 'api_key', key: 'legacy-auth' },
      existing: { type: 'api_key', key: 'keep' },
    });
    expect(JSON.parse(await readFile(join(globalDir, 'trust.json'), 'utf8'))).toEqual({ '/legacy': false });
    expect(await piAdapter.readAiConfig!(dir)).toMatchObject({
      baseUrl: 'https://legacy/v1',
      apiKey: 'legacy-key',
      model: 'legacy-model',
      reasoning: true,
    });
  });
});
