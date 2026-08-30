import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SpawnContext } from '../cli-adapter.js';
import { parseHeadlessOutputText } from '../headless-output.js';
import {
  agyAdapter,
  agyCwdKeys,
  agyEffortArg,
  agyHomeDir,
  isOfficialGeminiBase,
  listAgyOnDisk,
} from './agy.js';

const PROMPT = 'what should I watch in semis today?';
const SECRET = 'agy-must-not-enter-argv';
const LIVE_CONVERSATION_ID = 'c3b66b04-872b-4fbe-a3a4-058a026ef20a';

function ctx(extra: Partial<SpawnContext> = {}): SpawnContext {
  return { cwd: '/tmp/ws', env: {}, ...extra };
}

describe('agy session layout', () => {
  it('lists the last cwd conversation from last_conversations.json', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agy-home-'));
    const cwd = resolve(tmpdir(), 'agy-project');
    await mkdir(join(home, 'cache'), { recursive: true });
    await writeFile(join(home, 'cache', 'last_conversations.json'), JSON.stringify({
      [cwd]: LIVE_CONVERSATION_ID,
      '/other/repo': 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    }));
    const listed = await listAgyOnDisk(cwd, home);
    expect(listed.map((session) => session.sessionId)).toEqual([LIVE_CONVERSATION_ID]);
    expect(agyCwdKeys(cwd)).toContain(cwd);
  });

  it('honors HOME for the Antigravity store and treats official Gemini hosts as default', () => {
    const home = resolve('/tmp/home');
    expect(agyHomeDir({ HOME: home })).toBe(join(home, '.gemini', 'antigravity-cli'));
    expect(isOfficialGeminiBase(null)).toBe(true);
    expect(isOfficialGeminiBase('')).toBe(true);
    expect(isOfficialGeminiBase('https://generativelanguage.googleapis.com')).toBe(true);
    expect(isOfficialGeminiBase('https://generativelanguage.googleapis.com/v1beta')).toBe(true);
    expect(isOfficialGeminiBase('https://proxy.example/v1')).toBe(false);
  });
});

describe('agy composeCommand', () => {
  it('seeds a fresh TUI with --prompt-interactive and never goes headless', () => {
    const argv = agyAdapter.composeCommand(['claude'], ctx({ initialPrompt: PROMPT }));
    expect(argv).toEqual(['agy', '--prompt-interactive', PROMPT]);
    expect(argv).not.toContain('-p');
    expect(argv).not.toContain('--print');
    expect(argv).not.toContain('--dangerously-skip-permissions');
    expect(argv).not.toContain('--agent');
    expect(argv).not.toContain('--resume');
    expect(argv).not.toContain('--session-id');
    expect(argv).not.toContain('antigravity');
    expect(argv).not.toContain('gemini');
  });

  it('resumes by id or last and drops a stale seed', () => {
    expect(agyAdapter.composeCommand(['agy'], ctx({
      resume: { sessionId: LIVE_CONVERSATION_ID },
      initialPrompt: PROMPT,
    }))).toEqual(['agy', '--conversation', LIVE_CONVERSATION_ID]);
    expect(agyAdapter.composeCommand(['agy'], ctx({
      resume: 'last',
      initialPrompt: PROMPT,
    }))).toEqual(['agy', '--continue']);
  });

  it('ignores Alice skills and role prompts (no native flags)', () => {
    expect(agyAdapter.composeCommand(['agy'], ctx({
      appendSystemPrompt: 'Stay in the Workspace.',
      skills: ['/tmp/skill'],
    }))).toEqual(['agy']);
  });
});

describe('agy composeHeadlessCommand', () => {
  it('uses stream-json with --dangerously-skip-permissions and binds the prompt to -p', () => {
    expect(agyAdapter.composeHeadlessCommand!(['claude'], ctx(), 'do x')).toEqual([
      'agy',
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions',
      '-p',
      'do x',
    ]);
  });

  it('resumes headless runs by native id and keeps a dashed prompt as the -p value', () => {
    expect(agyAdapter.composeHeadlessCommand!(
      ['gemini'],
      ctx({ resume: { sessionId: 'native-session-1' } }),
      '--looks-like-flag',
    )).toEqual([
      'agy',
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions',
      '--conversation',
      'native-session-1',
      '-p',
      '--looks-like-flag',
    ]);
  });

  it('resumes the last headless session with --continue', () => {
    expect(agyAdapter.composeHeadlessCommand!(['agy'], ctx({ resume: 'last' }), 'next'))
      .toEqual([
        'agy',
        '--output-format',
        'stream-json',
        '--dangerously-skip-permissions',
        '--continue',
        '-p',
        'next',
      ]);
  });

  it('never enables json-only output or Antigravity custom agents', () => {
    const argv = agyAdapter.composeHeadlessCommand!(['agy'], ctx(), 'do x');
    expect(argv).not.toContain('json');
    expect(argv).not.toContain('--');
    expect(argv).not.toContain('--json-schema');
    expect(argv).not.toContain('--agent');
    expect(argv).not.toContain('--resume');
    expect(argv).not.toContain('--force');
    expect(argv).not.toContain('--trust');
  });
});

describe('agy sessionRuntime', () => {
  const runtimeCtx = { cwd: '/workspace', env: {} };

  it('projects vault secrets into env only and keeps official Gemini off GOOGLE_GEMINI_BASE_URL', () => {
    const projected = agyAdapter.sessionRuntime!.project(runtimeCtx, {
      binding: {
        version: 1,
        credential: { source: 'vault', credentialSlug: 'gemini-1', wireShape: 'google-generative-ai' },
        model: 'gemini-3.5-flash',
        reasoningEffort: 'high',
      },
      ai: {
        apiKey: SECRET,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'gemini-3.5-flash',
        wireShape: 'google-generative-ai',
        reasoningEffort: 'high',
      },
    });
    expect(projected.env).toEqual({ GEMINI_API_KEY: SECRET });
    expect(projected.interactiveArgs).toEqual([
      '--model', 'gemini-3.5-flash', '--effort', 'high',
    ]);
    const argv = agyAdapter.composeCommand(['agy'], {
      ...runtimeCtx,
      sessionRuntime: projected,
    });
    expect(argv.join(' ')).not.toContain(SECRET);
    expect(argv[0]).toBe('agy');
  });

  it('points a custom host at GOOGLE_GEMINI_BASE_URL', () => {
    const projected = agyAdapter.sessionRuntime!.project(runtimeCtx, {
      binding: {
        version: 1,
        credential: { source: 'vault', credentialSlug: 'gw', wireShape: 'google-generative-ai' },
        model: 'local-model',
      },
      ai: {
        apiKey: SECRET,
        baseUrl: 'https://gw.example.com/v1',
        model: 'local-model',
        wireShape: 'google-generative-ai',
      },
    });
    expect(projected.env).toEqual({
      GEMINI_API_KEY: SECRET,
      GOOGLE_GEMINI_BASE_URL: 'https://gw.example.com/v1',
    });
  });

  it('rejects unsupported effort tokens and leaves native login env empty', () => {
    expect(agyEffortArg('low')).toBe('low');
    expect(() => agyEffortArg('ultra')).toThrow(/cannot use Session effort ultra/);
    expect(() => agyEffortArg('xhigh')).toThrow(/cannot use Session effort xhigh/);
    expect(() => agyAdapter.sessionRuntime!.project(runtimeCtx, {
      binding: {
        version: 1,
        credential: { source: 'native' },
        reasoningEffort: 'max',
      },
      ai: { reasoningEffort: 'max' },
    })).toThrow(/cannot use Session effort max/);

    const native = agyAdapter.sessionRuntime!.project(runtimeCtx, {
      binding: {
        version: 1,
        credential: { source: 'native' },
        model: 'gemini-3.1-pro-preview',
      },
      ai: { model: 'gemini-3.1-pro-preview' },
    });
    expect(native.env).toEqual({});
    expect(native.interactiveArgs).toEqual(['--model', 'gemini-3.1-pro-preview']);
  });
});

describe('agy identity harvest', () => {
  it('does not assign a launcher session id and watches last_conversations.json', () => {
    expect(agyAdapter.capabilities.transcriptDiscovery).toBe('subprocess');
    expect(agyAdapter.capabilities.assignsSessionId ?? false).toBe(false);
    expect(agyAdapter.binary).toBe('agy');
    expect(agyAdapter.writeAiConfig).toBeUndefined();
  });

  it('reads conversation_id from the documented stream-json init', () => {
    const line = JSON.stringify({
      event: 'init',
      conversation_id: LIVE_CONVERSATION_ID,
      init: {
        cwd: '/home/user/project',
        tools: ['ask_permission', 'run_command'],
        permission_mode: 'request-review',
      },
    });
    expect(agyAdapter.extractHeadlessSessionId?.(line)).toBe(LIVE_CONVERSATION_ID);
    expect(agyAdapter.extractHeadlessAssistantText?.(line)).toBeNull();
  });
});

describe('agy headless extractors', () => {
  const init = JSON.stringify({
    event: 'init',
    conversation_id: LIVE_CONVERSATION_ID,
    init: { cwd: '/home/user/project', tools: ['run_command'], permission_mode: 'always-proceed' },
  });
  const assistant = JSON.stringify({
    event: 'step_update',
    step_update: {
      conversation_id: LIVE_CONVERSATION_ID,
      step_index: 3,
      state: 'DONE',
      step_type: 'agent_response',
      text_delta: 'Git rebase rewrites history.\n',
    },
  });
  const toolDone = JSON.stringify({
    event: 'step_update',
    step_update: {
      conversation_id: LIVE_CONVERSATION_ID,
      step_index: 4,
      state: 'DONE',
      step_type: 'tool',
      tool_name: 'run_command',
      tool_info: {
        name: 'run_command',
        parameters: { CommandLine: 'echo hello_headless_demo' },
        output: 'hello_headless_demo\r\n',
      },
    },
  });
  const result = JSON.stringify({
    event: 'result',
    result: {
      conversation_id: LIVE_CONVERSATION_ID,
      status: 'SUCCESS',
      response: 'Git rebase rewrites history.\n',
      duration_seconds: 6.88,
      num_turns: 1,
    },
  });

  it('reads assistant text only from the terminal result', () => {
    expect(agyAdapter.extractHeadlessAssistantText?.(assistant)).toBeNull();
    expect(agyAdapter.extractHeadlessAssistantText?.(result)).toBe('Git rebase rewrites history.\n');
    expect(agyAdapter.extractHeadlessOutputEvents?.(assistant)).toEqual([
      { type: 'text', text: 'Git rebase rewrites history.\n', delta: true },
    ]);
  });

  it('preserves and joins standalone whitespace text deltas', () => {
    const chunks = ['#', ' ', 'Heading', '\n\n', '-', ' ', 'item'];
    for (const chunk of chunks) {
      expect(agyAdapter.extractHeadlessOutputEvents?.(JSON.stringify({
        event: 'step_update',
        step_update: { step_type: 'agent_response', text_delta: chunk },
      }))).toEqual([{ type: 'text', text: chunk, delta: true }]);
    }

    expect(parseHeadlessOutputText({
      text: chunks.map((text_delta) => JSON.stringify({
        event: 'step_update',
        step_update: { step_type: 'agent_response', text_delta },
      })).join('\n'),
      extractEvents: agyAdapter.extractHeadlessOutputEvents!.bind(agyAdapter),
    }).assistantText).toBe('# Heading\n\n- item');
  });

  it('reads documented tool step_update events', () => {
    expect(agyAdapter.extractHeadlessOutputEvents?.(JSON.stringify({
      event: 'step_update',
      step_update: {
        conversation_id: LIVE_CONVERSATION_ID,
        step_index: 4,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: { name: 'run_command', parameters: { CommandLine: 'echo hello_headless_demo' } },
      },
    }))).toEqual([{
      type: 'tool-start',
      id: 'step-4',
      name: 'run_command',
      input: { CommandLine: 'echo hello_headless_demo' },
    }]);
    expect(agyAdapter.extractHeadlessOutputEvents?.(toolDone)).toEqual([{
      type: 'tool-finish',
      id: 'step-4',
      name: 'run_command',
      output: 'hello_headless_demo\r\n',
    }]);
  });

  it('normalizes the documented stream-json sequence', () => {
    const toolStarted = JSON.stringify({
      event: 'step_update',
      step_update: {
        conversation_id: LIVE_CONVERSATION_ID,
        step_index: 4,
        state: 'ACTIVE',
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: { name: 'run_command', parameters: { CommandLine: 'echo hello_headless_demo' } },
      },
    });
    expect(parseHeadlessOutputText({
      text: [init, assistant, toolStarted, toolDone, result].join('\n'),
      extractEvents: agyAdapter.extractHeadlessOutputEvents!.bind(agyAdapter),
      extractAssistantText: agyAdapter.extractHeadlessAssistantText!.bind(agyAdapter),
    })).toEqual({
      schemaVersion: 1,
      assistantText: 'Git rebase rewrites history.',
      blocks: [
        { type: 'text', text: 'Git rebase rewrites history.\n' },
        {
          type: 'tool',
          id: 'step-4',
          name: 'run_command',
          status: 'completed',
          input: { CommandLine: 'echo hello_headless_demo' },
          output: 'hello_headless_demo\r\n',
        },
      ],
      metrics: { textBlocks: 1, toolCalls: 1, toolFailures: 0 },
      truncated: false,
    });
  });

  it('marks failed tools and error results', () => {
    expect(agyAdapter.extractHeadlessOutputEvents?.(JSON.stringify({
      event: 'step_update',
      step_update: {
        conversation_id: LIVE_CONVERSATION_ID,
        step_index: 2,
        state: 'DONE',
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: {
          name: 'run_command',
          parameters: { CommandLine: 'false' },
          error: { type: 'denied', message: 'soft-denied' },
        },
      },
    }))).toEqual([{
      type: 'tool-finish',
      id: 'step-2',
      name: 'run_command',
      output: 'soft-denied',
      isError: true,
    }]);
    expect(agyAdapter.extractHeadlessOutputEvents?.(JSON.stringify({
      event: 'result',
      result: {
        conversation_id: '',
        status: 'ERROR',
        response: '',
        error: 'authentication required',
      },
    }))).toEqual([{ type: 'error', message: 'authentication required' }]);
  });
});
