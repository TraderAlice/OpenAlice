import { describe, expect, it } from 'vitest';

import type { SpawnContext } from '../cli-adapter.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { opencodeAdapter } from './opencode.js';
import { piAdapter } from './pi.js';
import { shellAdapter } from './shell.js';

/**
 * Quick-chat seed at the ADAPTER level: `ctx.initialPrompt` is placed at each
 * CLI's interactive-seed position (positions verified empirically against the
 * installed CLIs 2026-06-15):
 *   claude   → … -- <prompt>        (`--` terminator; claude accepts it interactive)
 *   codex    → … -- <prompt>        (`--` terminator; codex accepts it top-level)
 *   opencode → … --prompt <prompt>  (flag value; no terminator needed)
 *   pi       → … <prompt>           (bare trailing positional; pi REJECTS `--`)
 *   shell    → ignored              (no agent to receive a prompt)
 *
 * Scope note: this exercises `composeCommand` in isolation, NOT the launcher
 * integration (the pool factory / `composeSpawnInputs`) nor platform resolution
 * (`win-command.ts`). Two contracts live UPSTREAM of composeCommand and are NOT
 * covered here:
 *   - FRESH-ONLY gating: the route + factory only ever set `initialPrompt` on a
 *     fresh spawn. claude/codex/opencode ALSO self-gate on `resume === undefined`
 *     (asserted below); pi does NOT (it appends the seed alongside its assigned
 *     `--session-id`, because pi mints its id at spawn — see the pi case below).
 *   - win32 shim safety: opencode/pi are `.cmd` shims, so `composeSpawnInputs`
 *     drops the seed on win32 to avoid a cmd.exe injection surface.
 */

const PROMPT = 'what should I watch in semis today?';

function ctx(extra: Partial<SpawnContext> = {}): SpawnContext {
  return {
    cwd: '/tmp/ws',
    // codex/opencode read these from env when composing their MCP head.
    env: { OPENALICE_MCP_URL: 'http://127.0.0.1:47331/mcp', AQ_WS_ID: 'ws-abc' },
    ...extra,
  };
}

describe('interactive seed — composeCommand initialPrompt', () => {
  describe('fresh spawn appends the prompt at the CLI-correct position', () => {
    it('claude: trailing `-- <prompt>`', () => {
      const argv = claudeAdapter.composeCommand(['claude'], ctx({ initialPrompt: PROMPT }));
      expect(argv.slice(-2)).toEqual(['--', PROMPT]);
      expect(argv).toContain('--settings'); // base flags preserved
      expect(argv).not.toContain('-p'); // interactive, NOT headless
    });

    it('codex: trailing `-- <prompt>` after the mcp head', () => {
      const argv = codexAdapter.composeCommand([], ctx({ initialPrompt: PROMPT }));
      expect(argv.slice(-2)).toEqual(['--', PROMPT]);
      expect(argv[0]).toBe('codex');
      expect(argv).not.toContain('exec'); // interactive, NOT headless
    });

    it('opencode: `--prompt <prompt>` flag', () => {
      const argv = opencodeAdapter.composeCommand([], ctx({ initialPrompt: PROMPT }));
      expect(argv).toEqual(['opencode', '--prompt', PROMPT]);
    });

    it('pi: bare trailing positional, NO `--` terminator', () => {
      const argv = piAdapter.composeCommand([], ctx({ initialPrompt: PROMPT }));
      expect(argv).toEqual(['pi', PROMPT]);
      expect(argv).not.toContain('--');
    });
  });

  describe('no prompt → no seed argument', () => {
    it('claude', () => {
      expect(claudeAdapter.composeCommand(['claude'], ctx())).not.toContain(PROMPT);
    });
    it('opencode', () => {
      expect(opencodeAdapter.composeCommand([], ctx())).toEqual(['opencode']);
    });
    it('pi', () => {
      expect(piAdapter.composeCommand([], ctx())).toEqual(['pi']);
    });
  });

  // claude/codex/opencode self-gate: they never assign their own id, so a
  // resume intent at composeCommand always means a genuine resume → drop the
  // seed. (The launcher also never sets initialPrompt on a real resume, so this
  // is belt-and-suspenders.)
  describe('self-gating adapters drop the prompt when resuming', () => {
    const RESUME = { sessionId: 'sess-1234abcd' } as const;
    it('claude resume-by-id ignores the prompt', () => {
      const argv = claudeAdapter.composeCommand(['claude'], ctx({ resume: RESUME, initialPrompt: PROMPT }));
      expect(argv).toContain('--resume');
      expect(argv).not.toContain(PROMPT);
    });
    it('codex resume ignores the prompt', () => {
      const argv = codexAdapter.composeCommand([], ctx({ resume: RESUME, initialPrompt: PROMPT }));
      expect(argv).toContain('resume');
      expect(argv).not.toContain(PROMPT);
    });
    it('opencode resume ignores the prompt', () => {
      const argv = opencodeAdapter.composeCommand([], ctx({ resume: RESUME, initialPrompt: PROMPT }));
      expect(argv).toContain('--session');
      expect(argv).not.toContain(PROMPT);
    });
  });

  // pi is the exception: it mints its session id at spawn (`assignsSessionId`),
  // so a FRESH seeded spawn reaches composeCommand with BOTH a launcher-assigned
  // `{ sessionId }` AND initialPrompt. pi must append the seed alongside its
  // `--session-id` — THIS is the production argv (the bare-positional fresh case
  // above never occurs for pi). The launcher guarantees initialPrompt is only
  // present on a fresh spawn, so pi appending whenever it's set is safe.
  it('pi appends the seed alongside its assigned --session-id (fresh assigned-id spawn)', () => {
    const argv = piAdapter.composeCommand(
      [],
      ctx({ resume: { sessionId: 'assigned-uuid-1234' }, initialPrompt: PROMPT }),
    );
    expect(argv).toEqual(['pi', '--session-id', 'assigned-uuid-1234', PROMPT]);
  });

  it('shell ignores initialPrompt entirely (no agent to receive it)', () => {
    const argv = shellAdapter.composeCommand([], ctx({ initialPrompt: PROMPT }));
    expect(argv).not.toContain(PROMPT);
    expect(argv).not.toContain('--prompt');
  });
});
