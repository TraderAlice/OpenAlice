import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SpawnContext } from '../cli-adapter.js';
import { parseHeadlessOutputText } from '../headless-output.js';
import {
  grokAdapter,
  grokSessionDir,
  grokSessionKeys,
  grokTrustDecision,
  isOfficialXaiBase,
  listGrokOnDisk,
  readGrokInteractiveSetupStatus,
  readGrokSessionTitleFromSummary,
} from './grok.js';

const PROMPT = 'what should I watch in semis today?';
const SECRET = 'xai-must-not-enter-argv';

function ctx(extra: Partial<SpawnContext> = {}): SpawnContext {
  return { cwd: '/tmp/ws', env: {}, ...extra };
}

describe('grok session layout', () => {
  it('encodes the absolute cwd the way Grok 1.0.4 stores sessions', () => {
    const cwd = resolve(tmpdir(), 'grok-project');
    const home = resolve(tmpdir(), 'grok-home');
    expect(grokSessionDir(cwd, home)).toBe(
      join(home, 'sessions', encodeURIComponent(cwd)),
    );
  });

  it('treats empty and api.x.ai bases as official', () => {
    expect(isOfficialXaiBase(null)).toBe(true);
    expect(isOfficialXaiBase('')).toBe(true);
    expect(isOfficialXaiBase('https://api.x.ai/v1')).toBe(true);
    expect(isOfficialXaiBase('https://api.x.ai/v1/')).toBe(true);
    expect(isOfficialXaiBase('https://api.openai.com/v1')).toBe(false);
  });
});

describe('grok composeCommand', () => {
  it('seeds a fresh TUI with a trailing `-- <prompt>` and never goes headless', () => {
    const argv = grokAdapter.composeCommand(['grok'], ctx({ initialPrompt: PROMPT }));
    expect(argv.slice(0, 2)).toEqual(['grok', '--no-leader']);
    expect(argv.slice(-2)).toEqual(['--', PROMPT]);
    expect(argv).not.toContain('-p');
    expect(argv).not.toContain('--worktree');
    expect(argv).not.toContain('--session-id');
  });

  it('resumes by id or last and drops a stale seed', () => {
    expect(grokAdapter.composeCommand(['grok'], ctx({
      resume: { sessionId: '019ff963-4d80-7650-a109-efd64717a05d' },
      initialPrompt: PROMPT,
    }))).toEqual([
      'grok', '--no-leader', '--resume', '019ff963-4d80-7650-a109-efd64717a05d',
    ]);
    expect(grokAdapter.composeCommand(['grok'], ctx({ resume: 'last', initialPrompt: PROMPT })))
      .toEqual(['grok', '--no-leader', '--continue']);
  });
});

describe('grok composeHeadlessCommand', () => {
  it('uses streaming-json and binds the prompt with --single=', () => {
    expect(grokAdapter.composeHeadlessCommand!(['grok'], ctx(), 'do x')).toEqual([
      'grok',
      '--no-leader',
      '--always-approve',
      '--output-format',
      'streaming-json',
      '--single=do x',
    ]);
  });

  it('resumes headless runs by native id', () => {
    expect(grokAdapter.composeHeadlessCommand!(
      ['grok'],
      ctx({ resume: { sessionId: 'native-session-1' } }),
      'next',
    )).toEqual([
      'grok',
      '--no-leader',
      '--always-approve',
      '--resume',
      'native-session-1',
      '--output-format',
      'streaming-json',
      '--single=next',
    ]);
  });

  it('keeps a dashed prompt inside --single= so clap does not eat it as a flag', () => {
    const argv = grokAdapter.composeHeadlessCommand!(['grok'], ctx(), '--looks-like-flag');
    expect(argv).toContain('--single=--looks-like-flag');
    expect(argv).not.toContain('-p');
    expect(argv).not.toContain('--');
  });

  it('uses the grok binary even when the workspace default command is claude', () => {
    expect(grokAdapter.composeCommand(['claude'], ctx())).toEqual(['grok', '--no-leader']);
    expect(grokAdapter.composeHeadlessCommand!(['claude'], ctx(), 'do x')[0]).toBe('grok');
  });

  it('resumes the last headless session with --continue', () => {
    expect(grokAdapter.composeHeadlessCommand!(['grok'], ctx({ resume: 'last' }), 'next')).toEqual([
      'grok',
      '--no-leader',
      '--always-approve',
      '--continue',
      '--output-format',
      'streaming-json',
      '--single=next',
    ]);
  });

  it('maps launcher-owned role guidance to --rules', () => {
    const seeded = grokAdapter.composeCommand(['grok'], ctx({
      appendSystemPrompt: 'Stay in the Workspace.',
      initialPrompt: PROMPT,
    }));
    expect(seeded).toEqual([
      'grok', '--no-leader', '--rules', 'Stay in the Workspace.', '--', PROMPT,
    ]);
    expect(grokAdapter.composeHeadlessCommand!(
      ['grok'],
      ctx({ appendSystemPrompt: 'Stay in the Workspace.' }),
      'do x',
    )).toEqual([
      'grok',
      '--no-leader',
      '--always-approve',
      '--rules',
      'Stay in the Workspace.',
      '--output-format',
      'streaming-json',
      '--single=do x',
    ]);
  });
});

describe('grok sessionRuntime', () => {
  const runtimeCtx = { cwd: '/workspace', env: {} };

  it('projects vault secrets into env only and keeps official xAI off GROK_MODELS_BASE_URL', () => {
    const projected = grokAdapter.sessionRuntime!.project(runtimeCtx, {
      binding: {
        version: 1,
        credential: { source: 'vault', credentialSlug: 'xai-1', wireShape: 'openai-chat' },
        model: 'grok-4.6',
        reasoningEffort: 'high',
      },
      ai: {
        apiKey: SECRET,
        baseUrl: 'https://api.x.ai/v1',
        model: 'grok-4.6',
        wireShape: 'openai-chat',
        reasoningEffort: 'high',
      },
    });
    expect(projected.env).toEqual({ XAI_API_KEY: SECRET });
    expect(projected.interactiveArgs).toEqual(['--model', 'grok-4.6', '--effort', 'high']);
    const argv = grokAdapter.composeCommand(['grok'], {
      ...runtimeCtx,
      sessionRuntime: projected,
    });
    expect(argv.join(' ')).not.toContain(SECRET);
    expect(argv).toEqual(['grok', '--no-leader', '--model', 'grok-4.6', '--effort', 'high']);
  });

  it('points custom OpenAI-compatible endpoints at GROK_MODELS_BASE_URL', () => {
    const projected = grokAdapter.sessionRuntime!.project(runtimeCtx, {
      binding: {
        version: 1,
        credential: { source: 'vault', credentialSlug: 'gw', wireShape: 'openai-chat' },
        model: 'local-model',
      },
      ai: {
        apiKey: SECRET,
        baseUrl: 'https://gw.example.com/v1',
        model: 'local-model',
        wireShape: 'openai-chat',
      },
    });
    expect(projected.env).toEqual({
      XAI_API_KEY: SECRET,
      GROK_MODELS_BASE_URL: 'https://gw.example.com/v1',
    });
  });

  it('rejects ultra effort and leaves native login env empty', () => {
    expect(() => grokAdapter.sessionRuntime!.project(runtimeCtx, {
      binding: {
        version: 1,
        credential: { source: 'native' },
        reasoningEffort: 'ultra',
      },
      ai: { model: 'grok-4.6', reasoningEffort: 'ultra' },
    })).toThrow(/ultra/);

    const native = grokAdapter.sessionRuntime!.project(runtimeCtx, {
      binding: {
        version: 1,
        credential: { source: 'native' },
        model: 'grok-4.6',
      },
      ai: { model: 'grok-4.6' },
    });
    expect(native.env).toEqual({});
    expect(native.interactiveArgs).toEqual(['--model', 'grok-4.6']);
  });
});

describe('grok headless extractors', () => {
  it('reads sessionId and text from the documented json object', () => {
    const line = JSON.stringify({
      text: 'ok',
      stopReason: 'EndTurn',
      sessionId: '019ff963-4d80-7650-a109-efd64717a05d',
    });
    expect(grokAdapter.extractHeadlessSessionId?.(line)).toBe(
      '019ff963-4d80-7650-a109-efd64717a05d',
    );
    expect(grokAdapter.extractHeadlessAssistantText?.(line)).toBe('ok');
    expect(grokAdapter.extractHeadlessOutputEvents?.(line)).toEqual([{ type: 'text', text: 'ok' }]);
  });

  it('reads live 1.0.4 streaming-json lines and ignores pretty-printed json fragments', () => {
    const text = '{"type":"text","data":"STREAM"}';
    const end = JSON.stringify({
      type: 'end',
      stopReason: 'end_turn',
      sessionId: '01a009c7-769a-79b2-8a28-0dc2da5e7e21',
    });
    expect(grokAdapter.extractHeadlessAssistantText?.(text)).toBeNull();
    expect(grokAdapter.extractHeadlessOutputEvents?.(text)).toEqual([{ type: 'text', text: 'STREAM', delta: true }]);
    expect(parseHeadlessOutputText({
      text: ['{"type":"text","data":"AL"}', '{"type":"text","data":"ICE_GROK_OK"}', end].join('\n'),
      extractEvents: grokAdapter.extractHeadlessOutputEvents!.bind(grokAdapter),
    }).assistantText).toBe('ALICE_GROK_OK');
    expect(grokAdapter.extractHeadlessSessionId?.(end)).toBe(
      '01a009c7-769a-79b2-8a28-0dc2da5e7e21',
    );
    expect(grokAdapter.extractHeadlessSessionId?.('  "sessionId": "01a009c6-658f-77e0-9c6f-b498f0c07486",')).toBeNull();
    expect(grokAdapter.extractHeadlessAssistantText?.('  "text": "PONG",')).toBeNull();
  });

  it('preserves standalone whitespace deltas used by Markdown layout', () => {
    const chunks = ['#', ' ', 'Heading', '\n\n', '-', ' ', 'item'];
    for (const chunk of chunks) {
      expect(grokAdapter.extractHeadlessOutputEvents?.(JSON.stringify({
        type: 'text',
        data: chunk,
      }))).toEqual([{ type: 'text', text: chunk, delta: true }]);
    }

    expect(parseHeadlessOutputText({
      text: chunks.map((data) => JSON.stringify({ type: 'text', data })).join('\n'),
      extractEvents: grokAdapter.extractHeadlessOutputEvents!.bind(grokAdapter),
    }).assistantText).toBe('# Heading\n\n- item');
  });

  it('reads live 1.0.4 flattened tool_call / tool_call_update lines', () => {
    const started = JSON.stringify({
      type: 'tool_call',
      toolCallId: 'call-d1588596-788c-40bd-960c-ef0170aa5a06-0',
      title: 'run_terminal_command',
      kind: 'execute',
      status: 'pending',
      toolName: 'run_terminal_command',
      rawInput: { command: 'echo PING', description: 'Print PING' },
      content: [],
      locations: [],
    });
    const pending = JSON.stringify({
      type: 'tool_call_update',
      toolCallId: 'call-d1588596-788c-40bd-960c-ef0170aa5a06-0',
      status: null,
      content: [{ type: 'content', content: { type: 'text', text: 'Print PING' } }],
      rawOutput: null,
    });
    const progress = JSON.stringify({
      type: 'tool_call_update',
      toolCallId: 'call-d1588596-788c-40bd-960c-ef0170aa5a06-0',
      status: 'in_progress',
      content: [{ type: 'content', content: { type: 'text', text: 'PING\n' } }],
      rawOutput: {
        type: 'Bash',
        output: [80, 73, 78, 71, 10],
        output_for_prompt: 'PING\n',
        exit_code: 0,
      },
    });
    const finished = JSON.stringify({
      type: 'tool_call_update',
      toolCallId: 'call-d1588596-788c-40bd-960c-ef0170aa5a06-0',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'PING\n' } }],
      rawOutput: {
        type: 'Bash',
        output: [80, 73, 78, 71, 10],
        output_for_prompt: 'exit: 0\nPING\n',
        exit_code: 0,
        command: 'echo PING',
      },
    });
    expect(grokAdapter.extractHeadlessOutputEvents?.(started)).toEqual([{
      type: 'tool-start',
      id: 'call-d1588596-788c-40bd-960c-ef0170aa5a06-0',
      name: 'run_terminal_command',
      input: { command: 'echo PING', description: 'Print PING' },
    }]);
    expect(grokAdapter.extractHeadlessOutputEvents?.(pending)).toEqual([]);
    expect(grokAdapter.extractHeadlessOutputEvents?.(progress)).toEqual([]);
    expect(grokAdapter.extractHeadlessOutputEvents?.(finished)).toEqual([{
      type: 'tool-finish',
      id: 'call-d1588596-788c-40bd-960c-ef0170aa5a06-0',
      output: 'exit: 0\nPING\n',
    }]);
    expect(parseHeadlessOutputText({
      text: [
        '{"type":"thought","data":"ignore"}',
        '{"type":"text","data":"I will run it."}',
        started,
        pending,
        progress,
        finished,
        '{"type":"text","data":"DONE"}',
      ].join('\n'),
      extractEvents: grokAdapter.extractHeadlessOutputEvents!.bind(grokAdapter),
      extractAssistantText: grokAdapter.extractHeadlessAssistantText!.bind(grokAdapter),
    })).toEqual({
      schemaVersion: 1,
      assistantText: 'DONE',
      blocks: [
        { type: 'text', text: 'I will run it.' },
        {
          type: 'tool',
          id: 'call-d1588596-788c-40bd-960c-ef0170aa5a06-0',
          name: 'run_terminal_command',
          status: 'completed',
          input: { command: 'echo PING', description: 'Print PING' },
          output: 'exit: 0\nPING\n',
        },
        { type: 'text', text: 'DONE' },
      ],
      metrics: { textBlocks: 2, toolCalls: 1, toolFailures: 0 },
      truncated: false,
    });
  });

  it('reads live 1.0.4 list_dir rawOutput and ACP tool names from _meta', () => {
    const listed = JSON.stringify({
      type: 'tool_call_update',
      toolCallId: 'call-list-1',
      status: 'completed',
      content: [],
      rawOutput: {
        type: 'ListDir',
        Content: { content: '- /workspace/\n', absolute_root_path: '/workspace/.' },
      },
    });
    expect(grokAdapter.extractHeadlessOutputEvents?.(listed)).toEqual([{
      type: 'tool-finish',
      id: 'call-list-1',
      output: '- /workspace/\n',
    }]);
    const acpStart = JSON.stringify({
      method: 'session/update',
      params: {
        sessionId: '01a00086-eb58-7340-aa1a-172a36152128',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'call-1',
          title: 'Execute `alice --help`',
          rawInput: { command: 'alice --help' },
          _meta: { 'x.ai/tool': { name: 'run_terminal_command', kind: 'execute' } },
        },
      },
    });
    expect(grokAdapter.extractHeadlessOutputEvents?.(acpStart)).toEqual([{
      type: 'tool-start',
      id: 'call-1',
      name: 'run_terminal_command',
      input: { command: 'alice --help' },
    }]);
  });

  it('also accepts ACP session-update lines', () => {
    const started = JSON.stringify({
      method: 'session/update',
      params: {
        sessionId: '01a00086-eb58-7340-aa1a-172a36152128',
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'call-1',
          title: 'run_terminal_command',
          rawInput: { command: 'alice --help' },
        },
      },
    });
    const chunk = JSON.stringify({
      method: 'session/update',
      params: {
        sessionId: '01a00086-eb58-7340-aa1a-172a36152128',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello' },
        },
      },
    });
    expect(grokAdapter.extractHeadlessSessionId?.(started)).toBe(
      '01a00086-eb58-7340-aa1a-172a36152128',
    );
    expect(grokAdapter.extractHeadlessAssistantText?.(chunk)).toBeNull();
    expect(grokAdapter.extractHeadlessOutputEvents?.(chunk)).toEqual([
      { type: 'text', text: 'Hello', delta: true },
    ]);
    expect(grokAdapter.extractHeadlessOutputEvents?.(started)).toEqual([{
      type: 'tool-start',
      id: 'call-1',
      name: 'run_terminal_command',
      input: { command: 'alice --help' },
    }]);
  });

  it('returns null for noise', () => {
    expect(grokAdapter.extractHeadlessSessionId?.('plain text')).toBeNull();
    expect(grokAdapter.extractHeadlessAssistantText?.('{"type":"system"}')).toBeNull();
  });

  it('keeps terminal tool/text lines and drops thought/usage/progress noise', () => {
    expect(grokAdapter.keepHeadlessDiagnosticLine?.('{"type":"text","data":"DONE"}')).toBe(true);
    expect(grokAdapter.keepHeadlessDiagnosticLine?.('{"type":"tool_call","toolCallId":"c1"}')).toBe(true);
    expect(grokAdapter.keepHeadlessDiagnosticLine?.(
      '{"type":"tool_call_update","toolCallId":"c1","status":"completed"}',
    )).toBe(true);
    expect(grokAdapter.keepHeadlessDiagnosticLine?.('{"type":"thought","data":"hmm"}')).toBe(false);
    expect(grokAdapter.keepHeadlessDiagnosticLine?.('{"type":"available_commands","tools":[]}')).toBe(false);
    expect(grokAdapter.keepHeadlessDiagnosticLine?.('{"type":"usage","usage":{}}')).toBe(false);
    expect(grokAdapter.keepHeadlessDiagnosticLine?.(
      '{"type":"tool_call_update","toolCallId":"c1","status":"in_progress"}',
    )).toBe(false);
    expect(grokAdapter.keepHeadlessDiagnosticLine?.(
      '{"type":"end","stopReason":"end_turn","sessionId":"01a009ff-50a1-7550-a80f-f5144d904634"}',
    )).toBe(true);
  });

  it('marks failed tools and aborted ends as errors', () => {
    expect(grokAdapter.extractHeadlessOutputEvents?.(JSON.stringify({
      type: 'tool_call_update',
      toolCallId: 'call-fail',
      status: 'failed',
      rawOutput: { output_for_prompt: 'exit: 1\nnope\n' },
    }))).toEqual([{
      type: 'tool-finish',
      id: 'call-fail',
      output: 'exit: 1\nnope\n',
      isError: true,
    }]);
    expect(grokAdapter.extractHeadlessOutputEvents?.(JSON.stringify({
      type: 'end',
      stopReason: 'aborted',
      sessionId: '01a009ff-50a1-7550-a80f-f5144d904634',
    }))).toEqual([{ type: 'error', message: 'Grok stopped: aborted' }]);
  });
});

describe('grok on-disk sessions', () => {
  it('lists sessions from the physical cwd Grok actually writes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'grok-home-'));
    const cwd = await mkdtemp(join(tmpdir(), 'grok-cwd-'));
    const sessionId = '01a009c6-658f-77e0-9c6f-b498f0c07486';
    const keys = grokSessionKeys(cwd);
    expect(keys.length).toBeGreaterThan(0);
    const sessionDir = join(home, 'sessions', encodeURIComponent(keys[keys.length - 1]!), sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'summary.json'), JSON.stringify({
      generated_title: 'smoke',
    }));
    const listed = await listGrokOnDisk(cwd, home);
    expect(listed.map((row) => row.sessionId)).toEqual([sessionId]);
  });

  it('lists UUID session directories and reads generated titles', async () => {
    const home = await mkdtemp(join(tmpdir(), 'grok-home-'));
    const cwd = '/Users/ame/proj';
    const sessionId = '019ff963-4d80-7650-a109-efd64717a05d';
    const sessionDir = join(grokSessionDir(cwd, home), sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'summary.json'), JSON.stringify({
      generated_title: 'NVDA event study',
      session_summary: 'fallback',
    }));

    const listed = await listGrokOnDisk(cwd, home);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.sessionId).toBe(sessionId);
    expect(readGrokSessionTitleFromSummary({
      generated_title: 'NVDA event study',
      session_summary: 'fallback',
    })).toBe('NVDA event study');
  });
});

describe('grok interactive setup', () => {
  it('parses trusted_folders.toml without guessing unknown shapes', () => {
    const raw = [
      '[folders."/Users/ame/proj"]',
      'trusted = true',
      'decided_at = 1',
      '',
      '[folders."/Users/ame/other"]',
      'trusted = false',
    ].join('\n');
    expect(grokTrustDecision(raw, ['/Users/ame/proj'])).toBe(true);
    expect(grokTrustDecision(raw, ['/Users/ame/other'])).toBe(false);
    expect(grokTrustDecision(raw, ['/Users/ame/missing'])).toBeNull();
    expect(grokTrustDecision('[folders."C:\\\\Users\\\\ame\\\\proj"]\ntrusted = true', [
      'C:\\Users\\ame\\proj',
    ])).toBe(true);
    expect(grokTrustDecision('not toml', ['/Users/ame/proj'])).toBe('unknown');
  });

  it('reports missing login versus missing folder trust', async () => {
    const home = await mkdtemp(join(tmpdir(), 'grok-setup-'));
    const cwd = join(home, 'workspace');
    await mkdir(cwd);
    expect(await readGrokInteractiveSetupStatus(cwd, home)).toBe('runtime-onboarding-required');
    await writeFile(join(home, 'auth.json'), '{}\n');
    expect(await readGrokInteractiveSetupStatus(cwd, home)).toBe('workspace-trust-required');
    await writeFile(join(home, 'trusted_folders.toml'), [
      `[folders.${JSON.stringify(cwd)}]`,
      'trusted = true',
    ].join('\n'));
    expect(await readGrokInteractiveSetupStatus(cwd, home)).toBe('ready');
  });
});
