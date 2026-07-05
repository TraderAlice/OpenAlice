/**
 * Characterization / golden test for the per-workspace AI-config writers after
 * they moved out of the webui routes into the CLI adapters (Phase A). The
 * asserted bytes are exactly what the pre-move route-level writers produced —
 * this is the regression guard proving the move is behavior-preserving.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { opencodeAdapter } from './opencode.js';
import { piAdapter } from './pi.js';

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

  it('round-trips through readAiConfig', async () => {
    await claudeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://api.test/v1', apiKey: 'sk-123', model: 'claude-x', authMode: 'bearer',
    });
    expect(await claudeAdapter.readAiConfig!(dir)).toEqual({
      baseUrl: 'https://api.test/v1', apiKey: 'sk-123', model: 'claude-x', authMode: 'bearer', wireShape: 'anthropic',
    });
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
      '-c',
      'mcp_servers.openalice.url="http://127.0.0.1:47332/mcp"',
      '-c',
      'mcp_servers.openalice-workspace.url="http://127.0.0.1:47332/mcp/ws-abc"',
      'resume',
      '--last',
    ]);
    expect(codexAdapter.composeCommand([], { cwd: dir, env, resume: { sessionId: 'rollout-id' } })).toEqual([
      'codex',
      '-c',
      'mcp_servers.openalice.url="http://127.0.0.1:47332/mcp"',
      '-c',
      'mcp_servers.openalice-workspace.url="http://127.0.0.1:47332/mcp/ws-abc"',
      'resume',
      'rollout-id',
    ]);
  });

  it('writes full provider config byte-exact (config.toml + env.json)', async () => {
    await codexAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://oai.test/v1', apiKey: 'sk-c', model: 'gpt-x', wireApi: 'responses',
    });
    expect(await read('.codex/config.toml')).toBe(
      'model = "gpt-x"\nmodel_provider = "workspace"\n\n'
      + '[model_providers.workspace]\nname = "OpenAlice workspace provider"\n'
      + 'base_url = "https://oai.test/v1"\nenv_key = "OPENALICE_WORKSPACE_KEY"\nwire_api = "responses"\n',
    );
    expect(await read('.codex/env.json')).toBe('{\n  "OPENALICE_WORKSPACE_KEY": "sk-c"\n}\n');
  });

  it('always writes wire_api = responses (codex is Responses-only)', async () => {
    await codexAdapter.writeAiConfig!(dir, { baseUrl: 'https://oai.test/v1', apiKey: 'sk-c', model: 'gpt-x' });
    expect(await read('.codex/config.toml')).toContain('wire_api = "responses"\n');
  });

  it('model-only writes no provider block and an empty env.json', async () => {
    await codexAdapter.writeAiConfig!(dir, { model: 'gpt-y' });
    expect(await read('.codex/config.toml')).toBe('model = "gpt-y"\n');
    expect(await read('.codex/env.json')).toBe('{}\n');
  });

  it('reset (empty cred) tears down the entire .codex/ directory', async () => {
    await codexAdapter.writeAiConfig!(dir, { baseUrl: 'u', model: 'm' });
    await codexAdapter.writeAiConfig!(dir, {});
    expect(existsSync(join(dir, '.codex'))).toBe(false);
  });

  it('round-trips through readAiConfig', async () => {
    await codexAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://oai.test/v1', apiKey: 'sk-c', model: 'gpt-x', wireApi: 'responses',
    });
    expect(await codexAdapter.readAiConfig!(dir)).toEqual({
      baseUrl: 'https://oai.test/v1', apiKey: 'sk-c', model: 'gpt-x', wireApi: 'responses', wireShape: 'openai-responses',
    });
  });

  it('readAiConfig returns null when no files exist', async () => {
    expect(await codexAdapter.readAiConfig!(dir)).toBeNull();
  });

  it('listOnDisk returns only rollouts whose session_meta cwd matches this workspace', async () => {
    // Workspace has its own .codex → adapter reads <cwd>/.codex/sessions (not ~).
    const leaf = join(dir, '.codex', 'sessions', '2026', '06', '05');
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
    expect(JSON.parse(await read('opencode.json'))).toEqual({
      $schema: 'https://opencode.ai/config.json',
      provider: {
        workspace: {
          npm: '@ai-sdk/openai-compatible',
          name: 'OpenAlice workspace provider',
          options: { baseURL: 'https://cn.test/v1', apiKey: 'sk-o' },
          models: { 'deepseek-chat': { name: 'deepseek-chat' } },
        },
      },
      model: 'workspace/deepseek-chat',
    });
  });

  it('writes an explicit custom-model context window for opencode when provided', async () => {
    await opencodeAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://cn.test/v1', apiKey: 'sk-o', model: 'deepseek-chat', contextWindow: 1_000_000,
    });
    expect(JSON.parse(await read('opencode.json')).provider.workspace.models['deepseek-chat']).toEqual({
      name: 'deepseek-chat',
      limit: { context: 1_000_000, output: 16_384 },
    });
  });

  it('honors wireShape — anthropic → @ai-sdk/anthropic, responses → @ai-sdk/openai', async () => {
    await opencodeAdapter.writeAiConfig!(dir, { baseUrl: 'https://x/anthropic', apiKey: 'k', model: 'glm-5.1', wireShape: 'anthropic' });
    expect(JSON.parse(await read('opencode.json')).provider.workspace.npm).toBe('@ai-sdk/anthropic');
    await opencodeAdapter.writeAiConfig!(dir, { baseUrl: 'https://x/v1', apiKey: 'k', model: 'gpt-5.5', wireShape: 'openai-responses' });
    expect(JSON.parse(await read('opencode.json')).provider.workspace.npm).toBe('@ai-sdk/openai');
  });

  it('reset (empty cred) deletes opencode.json', async () => {
    await opencodeAdapter.writeAiConfig!(dir, { baseUrl: 'u', model: 'm' });
    await opencodeAdapter.writeAiConfig!(dir, {});
    expect(existsSync(join(dir, 'opencode.json'))).toBe(false);
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

  it('composeCommand: fresh is bare; resume uses top-level --continue / --session-id', () => {
    expect(piAdapter.composeCommand(['ignored'], { cwd: dir, env: mcpEnv })).toEqual(['pi']);
    expect(piAdapter.composeCommand([], { cwd: dir, env: mcpEnv, resume: 'last' }))
      .toEqual(['pi', '--continue']);
    expect(piAdapter.composeCommand([], { cwd: dir, env: mcpEnv, resume: { sessionId: 'sess-1' } }))
      .toEqual(['pi', '--session-id', 'sess-1']);
  });

  it('composeEnv sets PI_OFFLINE always; PI_CODING_AGENT_DIR only in override mode', async () => {
    // No .pi-agent yet → no redirect.
    const before = piAdapter.composeEnv!({ cwd: dir, env: mcpEnv });
    expect(before['PI_OFFLINE']).toBe('1');
    expect(before['PI_CODING_AGENT_DIR']).toBeUndefined();
    // After writing a provider override, the agent dir is redirected.
    await piAdapter.writeAiConfig!(dir, { baseUrl: 'https://cn.test/v1', apiKey: 'sk-p', model: 'deepseek-chat' });
    const after = piAdapter.composeEnv!({ cwd: dir, env: mcpEnv });
    expect(after['PI_CODING_AGENT_DIR']).toBe(join(dir, '.pi-agent'));
  });

  it('writes a custom openai-completions provider to .pi-agent/{models,settings}.json', async () => {
    await piAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://cn.test/v1', apiKey: 'sk-p', model: 'deepseek-chat',
    });
    expect(JSON.parse(await read('.pi-agent/models.json'))).toEqual({
      providers: {
        workspace: {
          name: 'OpenAlice workspace provider',
          api: 'openai-completions',
          baseUrl: 'https://cn.test/v1',
          apiKey: 'sk-p',
          models: [{ id: 'deepseek-chat' }],
        },
      },
    });
    expect(JSON.parse(await read('.pi-agent/settings.json'))).toEqual({
      defaultProvider: 'workspace',
      defaultModel: 'deepseek-chat',
    });
  });

  it('writes an explicit custom-model context window for Pi when provided', async () => {
    await piAdapter.writeAiConfig!(dir, {
      baseUrl: 'https://cn.test/v1', apiKey: 'sk-p', model: 'deepseek-chat', contextWindow: 1_000_000,
    });
    expect(JSON.parse(await read('.pi-agent/models.json')).providers.workspace.models).toEqual([
      { id: 'deepseek-chat', contextWindow: 1_000_000 },
    ]);
  });

  it('honors wireShape — anthropic → anthropic-messages, responses → openai-responses', async () => {
    await piAdapter.writeAiConfig!(dir, { baseUrl: 'https://x/anthropic', apiKey: 'k', model: 'glm-5.1', wireShape: 'anthropic' });
    expect(JSON.parse(await read('.pi-agent/models.json')).providers.workspace.api).toBe('anthropic-messages');
    await piAdapter.writeAiConfig!(dir, { baseUrl: 'https://x/v1', apiKey: 'k', model: 'gpt-5.5', wireShape: 'openai-responses' });
    expect(JSON.parse(await read('.pi-agent/models.json')).providers.workspace.api).toBe('openai-responses');
  });

  it('reset (empty cred) tears down the entire .pi-agent/ directory', async () => {
    await piAdapter.writeAiConfig!(dir, { baseUrl: 'u', model: 'm' });
    await piAdapter.writeAiConfig!(dir, {});
    expect(existsSync(join(dir, '.pi-agent'))).toBe(false);
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
});
