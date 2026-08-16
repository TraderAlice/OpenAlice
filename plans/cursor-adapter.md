# Plan: Cursor Agent (`cursor-agent`) CliAdapter

**Status:** active — implementation in progress on `feat/cursor-adapter`.
**Owner guides:** [[docs/model-semantics-and-runtime-injection.md]], [[docs/project-structure.md]]
**Delivery:** serial PR to `dev` from `feat/cursor-adapter` (`area:workspace`). Open PR, do not merge. Do not pile this onto other topic branches.

## Goal

Add Cursor Agent as a peer `CliAdapter` (`id: 'cursor'`, binary `cursor-agent`), same completeness as Claude / Codex / Grok Build / Oh My Pi / opencode / Pi. Keep every existing runtime. Do not invent a plugin SDK, do not add WebCursor / ACP, do not vendor the binary.

## Why this is not `agent`

On this machine, Grok Build's official installer (`https://x.ai/cli/install.sh`) links the **same** Grok binary to `~/.grok/bin/grok` **and** `~/.grok/bin/agent`, then prepends `export PATH="$HOME/.grok/bin:$PATH"` in `.zshrc`. Interactive `agent --version` is `grok 1.0.4`. Cursor's installer also claims `~/.local/bin/agent` (primary) plus `~/.local/bin/cursor-agent` (installer comment: **legacy**). Grok wins in a login shell.

Alice spawn PATH preserves the parent PATH order, then appends `~/.local/bin`. Spawning the bare name `agent` from a Guardian started in that shell would launch Grok. The adapter therefore **never** uses `agent`. Detection and argv start with `cursor-agent` only.

## Research (pinned to `2026.08.11-e8db854`)

Sources: [CLI overview](https://cursor.com/docs/cli/overview), [using](https://cursor.com/docs/cli/using), [headless](https://cursor.com/docs/cli/headless), [parameters](https://cursor.com/docs/cli/reference/parameters), [output-format](https://cursor.com/docs/cli/reference/output-format), [authentication](https://cursor.com/docs/cli/reference/authentication), live `cursor-agent` (`/Users/ame/.local/bin/cursor-agent` → `~/.local/share/cursor-agent/versions/2026.08.11-e8db854/cursor-agent`), and isolated-HOME print / create-chat probes on 2026-08-16. Official docs still say `agent`; live help is the same binary.

| Topic | Truth |
|---|---|
| Binary | PATH `cursor-agent`. Installer also writes `agent` (primary name). Alice must not spawn `agent`. Not vendored. Not Docker-pinned. |
| Home | `~/.cursor/` (`cli-config.json`, Statsig cache, IDE `projects/` / `chats/`). `CURSOR_DATA_DIR` exists in the binary. Alice must not set it. |
| Auth | Native: `cursor-agent login` (browser; `NO_OPEN_BROWSER=1` prints URL). Automation: `CURSOR_API_KEY` env, or `--api-key` (secrets never in argv). Custom host: `CURSOR_API_ENDPOINT` (default `https://api2.cursor.sh`). Isolated print with no key: `Authentication required… agent login… or set CURSOR_API_KEY` (exit 1, no JSON). Dummy key: invalid-key warning (exit 1, no JSON). |
| Create-or-reopen | **None.** `--session-id` is `unknown option`. `create-chat` prints a UUID then **hangs** (with and without a dummy key). `assignsSessionId` stays false. Do not call `create-chat`. |
| Resume | `--resume <chatId>` / `--continue` (docs: alias of `--resume=-1`). Bare `--resume` opens an Ink TUI picker (raw-mode; unusable headless). `cursor-agent resume` is latest-only. `cursor-agent ls` is a TUI picker. |
| `--` | POSIX end-of-options. Live: `-p --output-format text -- --help` treated `--help` as the prompt (then auth-failed). Use `--`. |
| Interactive | `cursor-agent [--model …] [--trust?] [--resume id\|--continue] -- [prompt]` |
| Headless | `cursor-agent -p --output-format stream-json --force --trust … -- <prompt>`. Docs: without `--force` / `--yolo`, print mode proposes edits and does not apply them. `--trust` is the documented headless workspace-trust skip. |
| JSON | `json` is one terminal object with `session_id` + `result` (no tool stream). `stream-json` is NDJSON: `system/init` (has `session_id`), `user`, `assistant`, `tool_call` started/completed, terminal `result`. Do **not** pass `--stream-partial-output` (duplicate assistant flushes). Thinking events are suppressed in print mode. |
| No auth | Print exits 1 with a text error. No `system/init`. |
| Sessions on disk | CLI chats are `~/.cursor/chats/<md5(path.resolve(cwd))>/<uuid>/store.db` (`create-chat.ts` + `state/index.ts` + `chat-session-list.ts` in 2026.08.11-e8db854). `create-chat` mints a UUID, prints it, then `dispose()` **deletes** an empty store — that is why isolated create-chat left no files and is not a spawn flag. `--continue` / `--resume=-1` calls `getLatestChatId` → cwd-scoped list sorted by `updatedAtMs`. `~/.cursor/projects/` is the IDE cache; do not watch it. |
| Model / effort | `--model` (e.g. `gpt-5`, `sonnet-4-thinking`). Help: parameterized models accept `'claude-opus-4-8[context=1m,effort=high,fast=false]'`. No `--thinking` / `--effort` flags (`unknown option`). |
| Skills | `--plugin-dir` loads Cursor plugins, not Alice skill paths. Ignore `ctx.skills`. CLI already reads `.cursor/rules`, `AGENTS.md`, `CLAUDE.md`. |
| Role prompt | No `--append-system-prompt`. Ignore `ctx.appendSystemPrompt`. |
| Approval | Headless: `--force` + `--trust`. Interactive: `--trust` only when `approveProject`. Do not write trust files. |
| Worktree | `-w/--worktree` leaves the managed Workspace (`~/.cursor/worktrees/…`). Never pass it. Do not pass `--workspace` (spawn cwd is enough). |
| Web / ACP / worker | `cursor-agent acp` (hidden), Cloud Agent `&`, `worker`. Out of scope. |
| Setup hook | No safe `auth.json` seam (`agent status` is a spawn; login is browser/keychain). Omit `readInteractiveSetupStatus`. |

Live no-auth fixture (secret-free, isolated HOME):

```text
Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.
```

Documented `stream-json` `system/init` (from Cursor docs, not a live authenticated run):

```json
{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/Users/user/project","session_id":"c6b62c6f-7ead-4fd6-9922-e952131177ff","model":"Claude 4 Sonnet","permissionMode":"default"}
```

## Decisions

1. **New adapter.** `id: 'cursor'`, `displayName: 'Cursor Agent'`, `binary: 'cursor-agent'`, `namePrefix: 'ca'` (`c` is Claude).
2. **PATH-detected `cursor-agent` only.** Install hint: `curl https://cursor.com/install -fsS | bash`, docs `https://cursor.com/docs/cli/overview`. Do not detect or spawn `agent`. Do not infer install dirs. Custom roots stay on `OPENALICE_EXTRA_AGENT_PATH`.
3. **Do not isolate `~/.cursor`.** Do not set `CURSOR_DATA_DIR` / `CURSOR_INVOKED_AS`. Listing/auth honor whatever the user already set.
4. **No `writeAiConfig` / project `.cursor` writes.** Vault keys go to `CURSOR_API_KEY`; a non-default `baseUrl` goes to `CURSOR_API_ENDPOINT`. Secrets never enter argv (`--api-key` is forbidden).
5. **Cursor keys are not generic LLM keys.** Native login is enough. A Workspace vault binding is a Cursor Dashboard API key (or a custom Cursor-compatible endpoint), not Anthropic/OpenAI. `inferCredentialVendor('cursor')` stays `custom`. Do not add a `cursor` vendor to the catalog in this PR.
6. **Probe the native id; do not assign it.** Same split as Codex / Grok / opencode: `assignsSessionId` stays false, but Alice still harvests `agentSessionId` into `ResumeRegistry`. Headless: `extractHeadlessSessionId` from `stream-json` `session_id`. Interactive: `transcriptDiscovery: 'subprocess'` polls `listOnDisk` for a **new** UUID directory under the cwd chat bucket (Codex/opencode watcher, 90s). `resumeLast` emits `--continue` (native, cwd-scoped in this build). `--resume id` once Alice has the id. Do not call `create-chat`. Do not watch IDE `projects/`.
7. **Effort via documented model brackets.** `--model <id>` when only a model is set. When both model and effort are set, `--model '<id>[effort=<effort>]'`. Reject `ultra`. If only effort is set, omit it (no model to hang a bracket on). Live-verify the bracket against a real key; if it fails, drop effort projection rather than invent `--effort`.
8. **No Web / ACP / worker / `--worktree` / `--workspace` / `--plugin-dir` / `--api-key` / `create-chat` / `ls`.**
9. **`deprecatedExportTab` stays closed** (Launch tab), same as Grok Build.
10. **`credentialSource: 'runtime-or-workspace'`.** `wirePreference: ['openai-chat']` is only a form default for an optional custom endpoint. No `modelRegistration` (Cursor owns its model list after login).

### Alternatives rejected

1. **Spawn `agent` and hope PATH is Cursor** — Grok's installer occupies that name on purpose.
2. **Detect `agent` if `--version` is not grok** — spawn-time identity checks are fragile; `cursor-agent` is the stable name Cursor still installs.
3. **`assignsSessionId` via `create-chat`** — prints an id then hangs; not a create-or-reopen spawn flag.
4. **`fs-watch` `~/.cursor/projects`** — IDE cache, not the CLI chat store. CLI chats are SQLite under `~/.cursor/chats/<md5>/`; poll `listOnDisk` like Codex/opencode instead of watching.
5. **`--output-format json` as the headless wire** — one object at the end, no tool events. `stream-json` matches Alice's line scanner (same reason Grok uses `streaming-json`).
6. **`--stream-partial-output`** — official docs warn about duplicate assistant flushes.
7. **Reuse Claude / Grok adapters** — auth, session minting, JSON event names, and the `agent` PATH collision all disagree.
8. **Add a Cursor vendor preset / WebCursor in the same PR** — product expansion; login + `CURSOR_API_KEY` is enough.

## Adapter contract

```text
id: cursor
displayName: Cursor Agent
binary: cursor-agent
namePrefix: ca
assignsSessionId: false
transcriptDiscovery: subprocess
headless: true
resumeLast / resumeById / parallelPerCwd: true
```

`composeCommand` ignores workspace `base` (do not launch `claude`).

Interactive:

```text
cursor-agent
  [--model <id or id[effort=…]>]
  [--trust]                         # only when approveProject
  [--resume <id> | --continue]
  -- [<initialPrompt>]              # fresh seed only
```

Headless:

```text
cursor-agent
  -p --output-format stream-json
  --force --trust
  [--model <id or id[effort=…]>]
  [--resume <id> | --continue]
  -- <prompt>
```

Native-id harvest (same launcher channels as the other adapters):

- Headless: `extractHeadlessSessionId` reads `session_id` from any `stream-json` object; `onSessionId` → `ResumeRegistry.bindAgentSessionId`.
- Interactive: `listOnDisk` reads UUID directories under `cursorChatsDir()/md5(resolve(cwd))` (also try `realpath` aliases, honor an already-set `CURSOR_DATA_DIR`). `TranscriptWatcher` polls for a **new** id (90s) and binds it. Empty `create-chat` stores are deleted on dispose and must not be spawned.
- `extractHeadlessAssistantText`: terminal `type:result` `result` string only (not incremental `assistant` lines).
- `extractHeadlessOutputEvents`: `assistant` → text; `tool_call` + `subtype:started|completed` → tool-start/finish; `result` + `is_error` → error.
- `keepHeadlessDiagnosticLine`: drop empty / unknown chatter; keep tool completed + result.

## Wiring (same sweep as Grok Build / Oh My Pi)

Registry (`index.ts` after `codex`, before `grok`), `AgentId`, install hint, issue efforts (no `ultra`), demo `/agents` + launch-plan, Workspace Manager specs, credential-inference (`cursor` → `custom`), AI Provider runtime card + i18n, model-semantics table, `DEFAULT_WIRE_BY_AGENT`, `WORKSPACE_AI_AGENT_IDS`, `CONFIGURABLE_AGENTS`, shared extractor / interactive-seed specs.

## Open live-verify (needs a real Cursor login or `CURSOR_API_KEY`)

Do this in an isolated Alice home, not `~/.openalice`, not port 5174.

1. Authenticated `stream-json` one-liner: confirm `system/init.session_id` equals the new `~/.cursor/chats/<md5>/<id>/` directory.
2. `--resume <that id>` then another print: confirm the same id comes back.
3. Interactive TUI: watcher captures the new UUID via `listOnDisk` (not `--continue`).
4. `--model '…[effort=low]'` against a thinking model: accept or reject?
5. Headless `--force` can run `alice-workspace inbox push` via the injected shim.

`--continue` is cwd-scoped in this build (`getLatestChatId` → `chat-session-list` `scope:"cwd"`). Still prefer harvested `--resume <id>` once the watcher or headless extractor has one.

## Progress

- [x] `src/workspaces/adapters/cursor.ts` + `cursor.spec.ts`
- [x] Registry after `codex`, before `grok`; `assignsSessionId` false; `transcriptDiscovery: subprocess`
- [x] Enumeration sweep: `AgentId`, install hint, issue efforts (no `ultra`), demo `/agents` + launch-plan, Workspace Manager specs, credential-inference (`cursor` → `custom`), AI Provider card + i18n, model-semantics table, `DEFAULT_WIRE_BY_AGENT`, `WORKSPACE_AI_AGENT_IDS`, `CONFIGURABLE_AGENTS`, shared extractor / interactive-seed specs
- [x] `npx tsc --noEmit`, `cd ui && npx tsc -b`, targeted Vitest + full `pnpm test`
- [x] Isolated compose-argv replay against `cursor-agent --help` (`2026.08.11-e8db854`)
- [ ] Authenticated live checks (needs a real Cursor login or `CURSOR_API_KEY`)

Discovery during implementation: 2026.08.11-e8db854 also has hidden `--new-session-id` (create-only UUIDv4; cannot combine with `--resume` / `--continue`). That is still not create-or-reopen, so `assignsSessionId` stays false. Do not spawn it.

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- Targeted Vitest: adapter + index + interactive-seed + headless extractors + issue-runtime-options + credential-inference + workspace-creator
- Isolated compose-argv replay against `cursor-agent --help` / the documented `stream-json` fixture (no `~/.openalice`, no port 5174)
- Authenticated live checks above when a key is available; state the gap if not

## Out of scope

WebCursor, ACP, Cloud Agent / `worker`, Docker pin, writing `cli-config.json` / `.cursor/rules`, detecting `agent`, `CURSOR_DATA_DIR` isolation, `--worktree`, a Cursor vendor preset, hanging Alice on Grok's `agent` alias.

## Completion

Adapter is registered, tests cover the live `2026.08.11-e8db854` + documented `stream-json` contract, docs table lists Cursor Agent, PR is open to `dev`. Delete this plan when the PR is accepted.
