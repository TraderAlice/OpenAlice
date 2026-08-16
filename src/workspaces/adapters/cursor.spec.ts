import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SpawnContext } from '../cli-adapter.js';
import { parseHeadlessOutputText } from '../headless-output.js';
import {
  cursorAdapter,
  cursorChatBucket,
  cursorChatsDir,
  cursorDataDir,
  cursorModelArg,
  listCursorOnDisk,
} from './cursor.js';

const PROMPT = 'what should I watch in semis today?';
const SECRET = 'cursor-must-not-enter-argv';
const LIVE_SESSION_ID = 'c6b62c6f-7ead-4fd6-9922-e952131177ff';

function ctx(extra: Partial<SpawnContext> = {}): SpawnContext {
  return { cwd: '/tmp/ws', env: {}, ...extra };
}

describe('cursor session layout', () => {
  it('hashes path.resolve(cwd) the way 2026.08.11-e8db854 stores chats', () => {
    const cwd = resolve(tmpdir(), 'cursor-project');
    const dataDir = resolve(tmpdir(), 'cursor-home');
    expect(cursorChatBucket(cwd)).toBe(createHash('md5').update(cwd).digest('hex'));
    expect(cursorChatsDir(cwd, dataDir)).toBe(
      join(dataDir, 'chats', cursorChatBucket(cwd)),
    );
  });

  it('honors an isolated HOME and an already-set CURSOR_DATA_DIR', () => {
    expect(cursorDataDir({ HOME: '/tmp/home' })).toBe(resolve('/tmp/home/.cursor'));
    expect(cursorDataDir({ CURSOR_DATA_DIR: '~/isolated', HOME: '/tmp/home' }))
      .toBe(resolve('/tmp/home/isolated'));
  });
});

describe('cursor composeCommand', () => {
  it('seeds a fresh TUI with a trailing `-- <prompt>` and never goes headless', () => {
    const argv = cursorAdapter.composeCommand(['claude'], ctx({ initialPrompt: PROMPT }));
    expect(argv[0]).toBe('cursor-agent');
    expect(argv.slice(-2)).toEqual(['--', PROMPT]);
    expect(argv).not.toContain('-p');
    expect(argv).not.toContain('--worktree');
    expect(argv).not.toContain('--workspace');
    expect(argv).not.toContain('--session-id');
    expect(argv).not.toContain('--new-session-id');
    expect(argv).not.toContain('--plugin-dir');
    expect(argv).not.toContain('--api-key');
    expect(argv).not.toContain('agent');
  });

  it('resumes by id or last and drops a stale seed', () => {
    expect(cursorAdapter.composeCommand(['cursor-agent'], ctx({
      resume: { sessionId: LIVE_SESSION_ID },
      initialPrompt: PROMPT,
    }))).toEqual(['cursor-agent', '--resume', LIVE_SESSION_ID]);
    expect(cursorAdapter.composeCommand(['cursor-agent'], ctx({
      resume: 'last',
      initialPrompt: PROMPT,
    }))).toEqual(['cursor-agent', '--continue']);
  });

  it('passes --trust only after an explicit project approval', () => {
    expect(cursorAdapter.composeCommand(['cursor-agent'], ctx({ approveProject: true })))
      .toEqual(['cursor-agent', '--trust']);
    expect(cursorAdapter.composeCommand(['cursor-agent'], ctx())).toEqual(['cursor-agent']);
  });

  it('ignores Alice skills and role prompts (no native flags)', () => {
    expect(cursorAdapter.composeCommand(['cursor-agent'], ctx({
      appendSystemPrompt: 'Stay in the Workspace.',
      skills: ['/tmp/skill'],
    }))).toEqual(['cursor-agent']);
  });
});

describe('cursor composeHeadlessCommand', () => {
  it('uses stream-json with --force --trust and binds the prompt after --', () => {
    expect(cursorAdapter.composeHeadlessCommand!(['claude'], ctx(), 'do x')).toEqual([
      'cursor-agent',
      '-p',
      '--output-format',
      'stream-json',
      '--force',
      '--trust',
      '--',
      'do x',
    ]);
  });

  it('resumes headless runs by native id and keeps a dashed prompt after --', () => {
    expect(cursorAdapter.composeHeadlessCommand!(
      ['agent'],
      ctx({ resume: { sessionId: 'native-session-1' } }),
      '--looks-like-flag',
    )).toEqual([
      'cursor-agent',
      '-p',
      '--output-format',
      'stream-json',
      '--force',
      '--trust',
      '--resume',
      'native-session-1',
      '--',
      '--looks-like-flag',
    ]);
  });

  it('resumes the last headless session with --continue', () => {
    expect(cursorAdapter.composeHeadlessCommand!(['cursor-agent'], ctx({ resume: 'last' }), 'next'))
      .toEqual([
        'cursor-agent',
        '-p',
        '--output-format',
        'stream-json',
        '--force',
        '--trust',
        '--continue',
        '--',
        'next',
      ]);
  });

  it('never enables json or stream-partial-output', () => {
    const argv = cursorAdapter.composeHeadlessCommand!(['cursor-agent'], ctx(), 'do x');
    expect(argv).not.toContain('json');
    expect(argv).not.toContain('--stream-partial-output');
    expect(argv).not.toContain('--api-key');
  });
});

describe('cursor sessionRuntime', () => {
  const runtimeCtx = { cwd: '/workspace', env: {} };

  it('projects a Cursor Dashboard provider credential only through environment variables', () => {
    const projected = cursorAdapter.sessionRuntime!.project(runtimeCtx, {
      binding: {
        version: 1,
        credential: { source: 'vault', credentialSlug: 'cursor-1' },
        model: 'gpt-5',
        reasoningEffort: 'high',
      },
      ai: {
        apiKey: SECRET,
        baseUrl: 'https://api2.cursor.sh',
        model: 'gpt-5',
        reasoningEffort: 'high',
      },
    });
    expect(projected.env).toEqual({
      CURSOR_API_KEY: SECRET,
      CURSOR_API_ENDPOINT: 'https://api2.cursor.sh',
    });
    expect(projected.interactiveArgs).toEqual(['--model', 'gpt-5']);
    const argv = cursorAdapter.composeCommand(['cursor-agent'], {
      ...runtimeCtx,
      sessionRuntime: projected,
    });
    expect(argv.join(' ')).not.toContain(SECRET);
    expect(argv.join(' ')).not.toContain('[effort=');
    expect(argv).toEqual(['cursor-agent', '--model', 'gpt-5']);
  });

  it('ignores Session effort, including ultra, and leaves native login env empty', () => {
    expect(cursorModelArg('gpt-5')).toBe('gpt-5');
    expect(cursorModelArg('  gpt-5.2-low  ')).toBe('gpt-5.2-low');
    expect(cursorModelArg(undefined)).toBeUndefined();
    expect(cursorModelArg('')).toBeUndefined();

    const withEffort = cursorAdapter.sessionRuntime!.project(runtimeCtx, {
      binding: {
        version: 1,
        credential: { source: 'native' },
        model: 'gpt-5.2',
        reasoningEffort: 'ultra',
      },
      ai: { model: 'gpt-5.2', reasoningEffort: 'ultra' },
    });
    expect(withEffort.interactiveArgs).toEqual(['--model', 'gpt-5.2']);
    expect(withEffort.interactiveArgs.join(' ')).not.toContain('[effort=');

    const effortOnly = cursorAdapter.sessionRuntime!.project(runtimeCtx, {
      binding: {
        version: 1,
        credential: { source: 'native' },
        reasoningEffort: 'high',
      },
      ai: { reasoningEffort: 'high' },
    });
    expect(effortOnly.interactiveArgs).toEqual([]);

    const native = cursorAdapter.sessionRuntime!.project(runtimeCtx, {
      binding: {
        version: 1,
        credential: { source: 'native' },
        model: 'sonnet-4-thinking',
      },
      ai: { model: 'sonnet-4-thinking' },
    });
    expect(native.env).toEqual({});
    expect(native.interactiveArgs).toEqual(['--model', 'sonnet-4-thinking']);
  });
});

describe('cursor identity harvest', () => {
  it('does not assign a launcher session id and watches on-disk UUID dirs', () => {
    expect(cursorAdapter.capabilities.transcriptDiscovery).toBe('subprocess');
    expect(cursorAdapter.capabilities.assignsSessionId ?? false).toBe(false);
    expect(cursorAdapter.binary).toBe('cursor-agent');
  });

  it('reads session_id from the documented stream-json system/init', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      apiKeySource: 'login',
      cwd: '/Users/user/project',
      session_id: LIVE_SESSION_ID,
      model: 'Claude 4 Sonnet',
      permissionMode: 'default',
    });
    expect(cursorAdapter.extractHeadlessSessionId?.(line)).toBe(LIVE_SESSION_ID);
    expect(cursorAdapter.extractHeadlessAssistantText?.(line)).toBeNull();
  });
});

describe('cursor headless extractors', () => {
  const started = JSON.stringify({
    type: 'tool_call',
    subtype: 'started',
    call_id: 'toolu_vrtx_01NnjaR886UcE8whekg2MGJd',
    tool_call: { readToolCall: { args: { path: 'README.md' } } },
    session_id: LIVE_SESSION_ID,
  });
  const completed = JSON.stringify({
    type: 'tool_call',
    subtype: 'completed',
    call_id: 'toolu_vrtx_01NnjaR886UcE8whekg2MGJd',
    tool_call: {
      readToolCall: {
        args: { path: 'README.md' },
        result: {
          success: {
            content: '# Project\n',
            isEmpty: false,
            exceededLimit: false,
            totalLines: 54,
            totalChars: 1254,
          },
        },
      },
    },
    session_id: LIVE_SESSION_ID,
  });
  const assistant = JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: "I'll read the README.md file" }] },
    session_id: LIVE_SESSION_ID,
  });
  const result = JSON.stringify({
    type: 'result',
    subtype: 'success',
    duration_ms: 5234,
    duration_api_ms: 5234,
    is_error: false,
    result: "I'll read the README.md fileBased on the README, I'll create a summary",
    session_id: LIVE_SESSION_ID,
    request_id: '10e11780-df2f-45dc-a1ff-4540af32e9c0',
  });

  it('reads assistant text only from the terminal result', () => {
    expect(cursorAdapter.extractHeadlessAssistantText?.(assistant)).toBeNull();
    expect(cursorAdapter.extractHeadlessAssistantText?.(result)).toBe(
      "I'll read the README.md fileBased on the README, I'll create a summary",
    );
    expect(cursorAdapter.extractHeadlessOutputEvents?.(assistant)).toEqual([
      { type: 'text', text: "I'll read the README.md file" },
    ]);
  });

  it('reads documented tool_call started/completed events', () => {
    expect(cursorAdapter.extractHeadlessOutputEvents?.(started)).toEqual([{
      type: 'tool-start',
      id: 'toolu_vrtx_01NnjaR886UcE8whekg2MGJd',
      name: 'read',
      input: { path: 'README.md' },
    }]);
    expect(cursorAdapter.extractHeadlessOutputEvents?.(completed)).toEqual([{
      type: 'tool-finish',
      id: 'toolu_vrtx_01NnjaR886UcE8whekg2MGJd',
      name: 'read',
      output: {
        content: '# Project\n',
        isEmpty: false,
        exceededLimit: false,
        totalLines: 54,
        totalChars: 1254,
      },
    }]);
  });

  it('normalizes the documented stream-json sequence', () => {
    expect(parseHeadlessOutputText({
      text: [assistant, started, completed, result].join('\n'),
      extractEvents: cursorAdapter.extractHeadlessOutputEvents!.bind(cursorAdapter),
      extractAssistantText: cursorAdapter.extractHeadlessAssistantText!.bind(cursorAdapter),
    })).toEqual({
      schemaVersion: 1,
      assistantText: "I'll read the README.md fileBased on the README, I'll create a summary",
      blocks: [
        { type: 'text', text: "I'll read the README.md file" },
        {
          type: 'tool',
          id: 'toolu_vrtx_01NnjaR886UcE8whekg2MGJd',
          name: 'read',
          status: 'completed',
          input: { path: 'README.md' },
          output: {
            content: '# Project\n',
            isEmpty: false,
            exceededLimit: false,
            totalLines: 54,
            totalChars: 1254,
          },
        },
      ],
      metrics: { textBlocks: 1, toolCalls: 1, toolFailures: 0 },
      truncated: false,
    });
  });

  it('marks failed tools and error results', () => {
    expect(cursorAdapter.extractHeadlessOutputEvents?.(JSON.stringify({
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'call-fail',
      tool_call: {
        function: { name: 'shell', arguments: 'false', result: { error: 'exit 1' } },
      },
    }))).toEqual([{
      type: 'tool-finish',
      id: 'call-fail',
      name: 'shell',
      output: 'exit 1',
      isError: true,
    }]);
    expect(cursorAdapter.extractHeadlessOutputEvents?.(JSON.stringify({
      type: 'result',
      subtype: 'error',
      is_error: true,
      result: 'Authentication required.',
      session_id: LIVE_SESSION_ID,
    }))).toEqual([{ type: 'error', message: 'Authentication required.' }]);
  });

  it('reads live 2026.08.11-e8db854 shellToolCall events and ignores extra keys', () => {
    const liveStarted = JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
      call_id: 'call-live-shell-0',
      tool_call: {
        shellToolCall: {
          args: { command: 'echo ALICE_CURSOR_TOOL_OK' },
          description: 'Echo ALICE_CURSOR_TOOL_OK marker',
        },
        hookAdditionalContexts: [],
        toolCallId: 'call-live-shell-0',
        startedAtMs: 1,
      },
      session_id: LIVE_SESSION_ID,
    });
    const liveCompleted = JSON.stringify({
      type: 'tool_call',
      subtype: 'completed',
      call_id: 'call-live-shell-0',
      tool_call: {
        shellToolCall: {
          args: { command: 'echo ALICE_CURSOR_TOOL_OK' },
          result: {
            success: {
              command: 'echo ALICE_CURSOR_TOOL_OK',
              exitCode: 0,
              stdout: 'ALICE_CURSOR_TOOL_OK\n',
            },
            isBackground: false,
          },
          description: 'Echo ALICE_CURSOR_TOOL_OK marker',
        },
        hookAdditionalContexts: [],
        toolCallId: 'call-live-shell-0',
        startedAtMs: 1,
        completedAtMs: 2,
      },
      session_id: LIVE_SESSION_ID,
    });
    expect(cursorAdapter.extractHeadlessOutputEvents?.(liveStarted)).toEqual([{
      type: 'tool-start',
      id: 'call-live-shell-0',
      name: 'shell',
      input: { command: 'echo ALICE_CURSOR_TOOL_OK' },
    }]);
    expect(cursorAdapter.extractHeadlessOutputEvents?.(liveCompleted)).toEqual([{
      type: 'tool-finish',
      id: 'call-live-shell-0',
      name: 'shell',
      output: {
        command: 'echo ALICE_CURSOR_TOOL_OK',
        exitCode: 0,
        stdout: 'ALICE_CURSOR_TOOL_OK\n',
      },
    }]);
  });

  it('keeps tool/result lines and drops system/user/thinking chatter', () => {
    const thinking = JSON.stringify({
      type: 'thinking',
      subtype: 'delta',
      text: 'The response will be exactly ALICE_CURSOR_OK',
      session_id: LIVE_SESSION_ID,
    });
    expect(cursorAdapter.keepHeadlessDiagnosticLine?.(started)).toBe(true);
    expect(cursorAdapter.keepHeadlessDiagnosticLine?.(completed)).toBe(true);
    expect(cursorAdapter.keepHeadlessDiagnosticLine?.(result)).toBe(true);
    expect(cursorAdapter.keepHeadlessDiagnosticLine?.(
      '{"type":"system","subtype":"init","session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff"}',
    )).toBe(false);
    expect(cursorAdapter.keepHeadlessDiagnosticLine?.(
      '{"type":"user","session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff"}',
    )).toBe(false);
    expect(cursorAdapter.keepHeadlessDiagnosticLine?.(thinking)).toBe(false);
    expect(cursorAdapter.extractHeadlessOutputEvents?.(thinking)).toEqual([]);
    expect(cursorAdapter.extractHeadlessAssistantText?.(thinking)).toBeNull();
    expect(cursorAdapter.keepHeadlessDiagnosticLine?.('plain text')).toBe(false);
  });
});

describe('cursor on-disk sessions', () => {
  it('lists UUID chat directories that grew a store.db', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'cursor-home-'));
    const cwd = '/Users/ame/proj';
    const sessionDir = join(cursorChatsDir(cwd, dataDir), LIVE_SESSION_ID);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, 'store.db'), 'sqlite');

    const listed = await listCursorOnDisk(cwd, dataDir);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.sessionId).toBe(LIVE_SESSION_ID);
    expect(listed[0]?.file).toBe(join(sessionDir, 'store.db'));
    expect(await cursorAdapter.readSessionTitle!(cwd, LIVE_SESSION_ID)).toBeNull();
  });

  it('skips empty chat dirs that never grew a store', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'cursor-empty-'));
    const cwd = '/Users/ame/proj';
    await mkdir(join(cursorChatsDir(cwd, dataDir), LIVE_SESSION_ID), { recursive: true });
    expect(await listCursorOnDisk(cwd, dataDir)).toEqual([]);
  });
});
