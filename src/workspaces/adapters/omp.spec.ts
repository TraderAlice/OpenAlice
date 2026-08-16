import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SpawnContext } from '../cli-adapter.js';
import { parseHeadlessOutputText } from '../headless-output.js';
import {
  encodeOmpAbsoluteSessionDirName,
  encodeOmpSessionDirName,
  listOmpOnDisk,
  ompAdapter,
  ompAgentDir,
  ompSessionBucketNames,
  ompThinkingArg,
  readOmpSessionTitleFromJsonl,
} from './omp.js';

const PROMPT = 'what should I watch in semis today?';
const SECRET = 'sk-must-not-enter-argv';
const LIVE_SESSION_ID = '01a00adc-0884-7000-b507-017949683107';

function ctx(extra: Partial<SpawnContext> = {}): SpawnContext {
  return { cwd: '/tmp/ws', env: {}, ...extra };
}

describe('omp session layout', () => {
  it('encodes a home-relative cwd the way 17.3.4 stores sessions', () => {
    expect(encodeOmpSessionDirName(
      '/Users/ame/.cursor/worktrees/OpenAlice/grok',
      '/Users/ame',
      '/var/folders/xx/tmp',
    )).toBe('-.cursor-worktrees-OpenAlice-grok');
  });

  it('encodes a temp-root child as -tmp-<rel>', () => {
    expect(encodeOmpSessionDirName(
      '/var/folders/xx/tmp/probe/ws',
      '/Users/ame',
      '/var/folders/xx/tmp',
    )).toBe('-tmp-probe-ws');
  });

  it('encodes paths outside home and tmp as --<abs>--', () => {
    const cwd = resolve('/private/tmp/omp-alice-probe.d2iMY8/ws2');
    const encoded = encodeOmpAbsoluteSessionDirName(cwd);

    expect(encodeOmpSessionDirName(
      cwd,
      '/Users/ame',
      '/var/folders/xx/tmp',
    )).toBe(encoded);
    expect(encoded).toBe(`--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`);
  });

  it('lists both the canonical bucket and the legacy abs spelling', () => {
    const names = ompSessionBucketNames(
      '/private/tmp/omp-alice-probe.d2iMY8/ws2',
      '/Users/ame',
      '/var/folders/xx/tmp',
    );
    expect(names).toContain(
      encodeOmpAbsoluteSessionDirName('/private/tmp/omp-alice-probe.d2iMY8/ws2'),
    );
  });

  it('resolves the default agent dir and honors PI_CODING_AGENT_DIR', () => {
    expect(ompAgentDir({ HOME: '/tmp/home' })).toBe(resolve('/tmp/home/.omp/agent'));
    expect(ompAgentDir({
      HOME: '/tmp/home',
      PI_CODING_AGENT_DIR: '/tmp/isolated/agent',
    })).toBe(resolve('/tmp/isolated/agent'));
    expect(ompAgentDir({
      HOME: '/tmp/home',
      OMP_PROFILE: 'work',
    })).toBe(resolve('/tmp/home/.omp/profiles/work/agent'));
  });
});

describe('omp composeCommand', () => {
  it('seeds a fresh TUI with a trailing `-- <prompt>` and never goes headless', () => {
    const argv = ompAdapter.composeCommand(['claude'], ctx({ initialPrompt: PROMPT }));
    expect(argv[0]).toBe('omp');
    expect(argv.slice(-2)).toEqual(['--', PROMPT]);
    expect(argv).not.toContain('-p');
    expect(argv).not.toContain('--session-id');
    expect(argv).not.toContain('--skill');
    expect(argv).not.toContain('--no-session');
  });

  it('resumes by id or last and drops a stale seed', () => {
    expect(ompAdapter.composeCommand(['omp'], ctx({
      resume: { sessionId: LIVE_SESSION_ID },
      initialPrompt: PROMPT,
    }))).toEqual(['omp', '--resume', LIVE_SESSION_ID]);
    expect(ompAdapter.composeCommand(['omp'], ctx({ resume: 'last', initialPrompt: PROMPT })))
      .toEqual(['omp', '--continue']);
  });

  it('maps launcher-owned role guidance to --append-system-prompt', () => {
    expect(ompAdapter.composeCommand(['omp'], ctx({
      appendSystemPrompt: 'You are the desk closer.',
    }))).toEqual(['omp', '--append-system-prompt', 'You are the desk closer.']);
  });
});

describe('omp composeHeadlessCommand', () => {
  it('uses print JSON and binds the prompt after --', () => {
    expect(ompAdapter.composeHeadlessCommand!(['claude'], ctx(), 'do x')).toEqual([
      'omp',
      '-p',
      '--mode',
      'json',
      '--auto-approve',
      '--',
      'do x',
    ]);
  });

  it('resumes headless runs by native id and keeps a dashed prompt after --', () => {
    expect(ompAdapter.composeHeadlessCommand!(
      ['omp'],
      ctx({ resume: { sessionId: 'native-session-1' } }),
      '--looks-like-flag',
    )).toEqual([
      'omp',
      '-p',
      '--mode',
      'json',
      '--auto-approve',
      '--resume',
      'native-session-1',
      '--',
      '--looks-like-flag',
    ]);
  });

  it('resumes the last headless session with --continue', () => {
    expect(ompAdapter.composeHeadlessCommand!(['omp'], ctx({ resume: 'last' }), 'next')).toEqual([
      'omp',
      '-p',
      '--mode',
      'json',
      '--auto-approve',
      '--continue',
      '--',
      'next',
    ]);
  });
});

describe('omp identity harvest', () => {
  it('polls on-disk JSONL for a native id and does not assign one at spawn', () => {
    expect(ompAdapter.capabilities.transcriptDiscovery).toBe('subprocess');
    expect(ompAdapter.capabilities.assignsSessionId ?? false).toBe(false);
    expect(ompAdapter.listOnDisk).toEqual(expect.any(Function));
    expect(ompAdapter.transcriptDir).toBeUndefined();
    expect(ompAdapter.transcriptFileRe).toBeUndefined();
    expect(ompAdapter.extractSessionId).toBeUndefined();
  });

  it('harvests headless identity from the print-mode session header', () => {
    expect(ompAdapter.extractHeadlessSessionId?.(
      `{"type":"session","version":3,"id":"${LIVE_SESSION_ID}","cwd":"/tmp/ws"}`,
    )).toBe(LIVE_SESSION_ID);
  });
});

describe('omp sessionRuntime', () => {
  it('projects model and thinking, maps none to off, and keeps secrets in env', () => {
    const projected = ompAdapter.sessionRuntime!.project(ctx(), {
      binding: {
        version: 1,
        credential: { source: 'vault', credentialSlug: 'oa', wireShape: 'openai-chat' },
        model: 'gpt-4o-mini',
        reasoningEffort: 'none',
      },
      ai: {
        apiKey: SECRET,
        baseUrl: 'https://proxy.example/v1',
        model: 'gpt-4o-mini',
        wireShape: 'openai-chat',
        reasoningEffort: 'none',
      },
    });
    expect(projected.interactiveArgs).toEqual(['--model', 'gpt-4o-mini', '--thinking', 'off']);
    expect(projected.env['OPENAI_API_KEY']).toBe(SECRET);
    expect(projected.env['OPENAI_BASE_URL']).toBe('https://proxy.example/v1');
    expect(JSON.stringify(projected.interactiveArgs)).not.toContain(SECRET);
  });

  it('rejects ultra and maps the remaining Alice efforts', () => {
    expect(ompThinkingArg('high')).toBe('high');
    expect(ompThinkingArg('none')).toBe('off');
    expect(() => ompThinkingArg('ultra')).toThrow(/ultra/);
    expect(() => ompAdapter.sessionRuntime!.project(ctx(), {
      binding: {
        version: 1,
        credential: { source: 'native' },
        reasoningEffort: 'ultra',
      },
      ai: null,
    })).toThrow(/ultra/);
  });
});

describe('omp headless JSON (live 17.3.4)', () => {
  const header =
    `{"type":"session","version":3,"id":"${LIVE_SESSION_ID}","timestamp":"2026-08-16T13:56:27.396Z","cwd":"/tmp/omp-alice-probe.d2iMY8/ws"}`;
  const userEnd = '{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"Reply with the single word pong."}]}}';
  const assistantError =
    '{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"403 Blocked by sandbox network policy"}}';
  const assistantText =
    '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"pong"}]}}';

  it('harvests the session header and ignores later events', () => {
    expect(ompAdapter.extractHeadlessSessionId?.(header)).toBe(LIVE_SESSION_ID);
    expect(ompAdapter.extractHeadlessSessionId?.(assistantText)).toBeNull();
  });

  it('reads assistant message_end text and skips the echoed user line', () => {
    expect(ompAdapter.extractHeadlessAssistantText?.(userEnd)).toBeNull();
    expect(ompAdapter.extractHeadlessAssistantText?.(assistantText)).toBe('pong');
    expect(ompAdapter.extractHeadlessAssistantText?.(assistantError)).toBeNull();
  });

  it('emits tool and error events and drops print-mode deltas from diagnostics', () => {
    expect(ompAdapter.extractHeadlessOutputEvents?.(
      '{"type":"tool_execution_start","toolCallId":"t1","toolName":"read","args":{"path":"a.ts"}}',
    )).toEqual([{ type: 'tool-start', id: 't1', name: 'read', input: { path: 'a.ts' } }]);
    expect(ompAdapter.extractHeadlessOutputEvents?.(
      '{"type":"tool_execution_end","toolCallId":"t1","toolName":"read","result":"ok"}',
    )).toEqual([{ type: 'tool-finish', id: 't1', name: 'read', output: 'ok' }]);
    expect(ompAdapter.extractHeadlessOutputEvents?.(assistantError)).toEqual([
      { type: 'error', message: '403 Blocked by sandbox network policy' },
    ]);
    expect(ompAdapter.keepHeadlessDiagnosticLine?.('{"type":"message_update","assistantMessageEvent":{"type":"text_delta"}}'))
      .toBe(false);
    expect(ompAdapter.keepHeadlessDiagnosticLine?.(header)).toBe(true);
  });

  it('joins assistant text through the shared accumulator', () => {
    expect(parseHeadlessOutputText({
      text: assistantText,
      extractEvents: (line) => ompAdapter.extractHeadlessOutputEvents?.(line) ?? [],
    }).assistantText).toBe('pong');
  });
});

describe('omp on-disk sessions', () => {
  it('reads the title slot then the session header', () => {
    const raw = [
      '{"type":"title","v":1,"title":"probe pong","updatedAt":"2026-08-16T13:56:58.826Z","pad":"   "}',
      `{"type":"session","version":3,"id":"${LIVE_SESSION_ID}","title":"ignored","timestamp":"2026-08-16T13:56:58.826Z","cwd":"/tmp/ws"}`,
    ].join('\n');
    expect(readOmpSessionTitleFromJsonl(raw)).toBe('probe pong');
    expect(readOmpSessionTitleFromJsonl(
      `{"type":"session","version":3,"id":"${LIVE_SESSION_ID}","title":"from header","cwd":"/tmp/ws"}`,
    )).toBe('from header');
  });

  it('lists timestamp_uuid.jsonl files from the encoded bucket', async () => {
    const home = await mkdtemp(join(tmpdir(), 'omp-home-'));
    const cwd = resolve(home, 'proj');
    const env = { HOME: home };
    const bucket = encodeOmpSessionDirName(cwd, homedir(), tmpdir());
    const dir = join(ompAgentDir(env), 'sessions', bucket);
    await mkdir(dir, { recursive: true });
    const file = join(dir, `2026-08-16T13-56-58-826Z_${LIVE_SESSION_ID}.jsonl`);
    await writeFile(file, `{"type":"session","version":3,"id":"${LIVE_SESSION_ID}","title":"listed"}\n`);
    const listed = await listOmpOnDisk(cwd, env);
    expect(listed).toEqual([expect.objectContaining({
      sessionId: LIVE_SESSION_ID,
      file,
    })]);
    expect(readOmpSessionTitleFromJsonl(await readFile(file, 'utf8'))).toBe('listed');
  });
});
