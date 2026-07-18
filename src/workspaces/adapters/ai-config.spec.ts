/**
 * Characterization / golden test for the per-workspace AI-config writers after
 * they moved out of the webui routes into the CLI adapters (Phase A). The
 * asserted bytes are exactly what the pre-move route-level writers produced —
 * this is the regression guard proving the move is behavior-preserving.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { opencodeAdapter } from './opencode.js';
import { piAdapter, syncPiProjectTrust, syncPiWindowsShellPath } from './pi.js';
import { migrateLegacyPiAgentDir, piWorkspaceProviderId } from './pi-config.js';

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
      name: 'OpenAlice workspace provider ('.concat(dir.split('/').at(-1)!, ')'),
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
