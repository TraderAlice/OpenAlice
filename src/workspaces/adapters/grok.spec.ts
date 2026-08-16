import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SpawnContext } from '../cli-adapter.js';
import {
  grokAdapter,
  grokSessionDir,
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
    expect(grokSessionDir('/Users/ame/proj', '/Users/ame/.grok')).toBe(
      '/Users/ame/.grok/sessions/%2FUsers%2Fame%2Fproj',
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
  it('uses json output, always-approve, and a `--` prompt terminator', () => {
    expect(grokAdapter.composeHeadlessCommand!(['grok'], ctx(), 'do x')).toEqual([
      'grok',
      '--no-leader',
      '--always-approve',
      '-p',
      '--output-format',
      'json',
      '--',
      'do x',
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
      '-p',
      '--output-format',
      'json',
      '--',
      'next',
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
    expect(grokAdapter.extractHeadlessAssistantText?.(chunk)).toBe('Hello');
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
});

describe('grok on-disk sessions', () => {
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
    expect(grokTrustDecision('not toml', ['/Users/ame/proj'])).toBe('unknown');
  });

  it('reports missing login versus missing folder trust', async () => {
    const home = await mkdtemp(join(tmpdir(), 'grok-setup-'));
    expect(await readGrokInteractiveSetupStatus('/tmp/ws', home)).toBe('runtime-onboarding-required');
    await writeFile(join(home, 'auth.json'), '{}\n');
    expect(await readGrokInteractiveSetupStatus('/tmp/ws', home)).toBe('workspace-trust-required');
    await writeFile(join(home, 'trusted_folders.toml'), [
      '[folders."/tmp/ws"]',
      'trusted = true',
    ].join('\n'));
    expect(await readGrokInteractiveSetupStatus('/tmp/ws', home)).toBe('ready');
  });
});
