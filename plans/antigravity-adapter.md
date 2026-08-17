# Plan: Antigravity (`agy`) CliAdapter

**Status:** active — serial PR to `dev` from `feat/agy-adapter`. Do not merge until Ame says so.
**Owner guides:** [[docs/model-semantics-and-runtime-injection.md]], [[docs/project-structure.md]]
**Delivery:** serial PR to `dev` from `feat/agy-adapter` (`area:workspace`). Open PR, do not merge. Do not pile this onto other topic branches.

## Goal

Add Google Antigravity as a peer `CliAdapter` (`id: 'agy'`, binary `agy`), same completeness as Claude / Codex / Cursor Agent / Grok Build / Oh My Pi / opencode / Pi. Keep every existing runtime. Do not invent a plugin SDK, do not add WebAntigravity / ACP, do not vendor the binary.

## Why this is not `antigravity` or `gemini`

Live 1.1.13 on this machine is PATH `/opt/homebrew/bin/agy` (Homebrew) and the official installer writes `~/.local/bin/agy`. Commands `antigravity` and `gemini` are not on PATH. Detection and argv start with `agy` only.

## Research (pinned to `agy` 1.1.13)

Sources: [install/auth](https://www.antigravity.google/docs/cli/install/), [headless](https://www.antigravity.google/docs/cli/headless/), [conversations](https://www.antigravity.google/docs/cli/conversations), [resume](https://www.antigravity.google/docs/cli/commands/resume/), live `agy -h` / `agy models` / isolated-HOME print on 2026-08-17.

| Topic | Truth |
|---|---|
| Binary | PATH `agy`. Not vendored. Not Docker-pinned. Never detect or spawn `antigravity` / `gemini`. |
| Home | `~/.gemini/antigravity-cli/` (`conversations/`, `cache/last_conversations.json`, `conversation_summaries.db`, `settings.json`). Alice must not set a fake `HOME` or invent `ANTIGRAVITY_*` isolation. |
| Auth | Native: OS keyring / browser (`agy` with no args). `GEMINI_API_KEY` **alone has no effect** — official docs require `modelProvider: "gemini"` in `settings.json`. Custom host: `GOOGLE_GEMINI_BASE_URL`. Do not write `settings.json`. |
| Create-or-reopen | **None.** No `--session-id`. `assignsSessionId` stays false. |
| Resume | `--continue` / `-c` = last for this cwd via `cache/last_conversations.json`. `--conversation <id>` = by id. `--resume` is not a flag. |
| `--` | Unsigned-in isolated print with `-- <prompt>` entered print mode (auth URL). On the Gemini key path, `--` exits immediately with `Agent execution terminated due to error`. Bind the prompt as `-p <prompt>`. |
| Interactive seed | Documented `--prompt-interactive` / `-i <prompt>`. `--print` and `--prompt-interactive` are mutually exclusive. |
| Headless | `agy --output-format stream-json --dangerously-skip-permissions -p <prompt>`. Without that skip flag, shell tools are soft-denied and the run can still exit 0. Pin `--model` on the Gemini key path — the CLI default is not in that catalog. |
| JSON | `json` is one envelope with `conversation_id` + `response`. `stream-json` is NDJSON: `event: init` (has `conversation_id`), `step_update` (`agent_response` / `tool` / …), terminal `event: result` (same envelope). |
| No auth | Isolated HOME print with a TTY prints an OAuth URL and exits 1, or waits on the browser. Docs say a non-interactive CI run exits `authentication required` instead of hanging. |
| Sessions on disk | `--continue` looks up cwd in `~/.gemini/antigravity-cli/cache/last_conversations.json`. `conversations/` exists but was empty on this unsigned-in machine — do not invent a file layout. |
| Model / effort | `--model <slug>` and `--effort low\|medium\|high` are independent. Some Gemini slugs already end in `-high` / `-medium`. Do not invent a suffix mapper. Reject `ultra` / `xhigh` / `max` / `none` / `minimal`. |
| Skills | Ignore `ctx.skills`. `--agent` is an Antigravity custom-agent name, not Alice `AgentId`. |
| Role prompt | No `--append-system-prompt`. Ignore `ctx.appendSystemPrompt`. |
| Approval | Headless: `--dangerously-skip-permissions`. Interactive: do not pass it. No `--trust` / `--force`. |
| Worktree | No `--worktree`. Do not pass `--add-dir`, `--new-project`, `--project`, `--sandbox`, `--json-schema`. |

Google-account login on this machine is region-locked. The working path is a Gemini API key plus `modelProvider: "gemini"` in `settings.json`. Live `agy models` on a free-tier key (2026-08-17): `gemini-3.1-pro-preview`, `gemini-3.5-flash`, `gemini-3.6-flash`. That is Antigravity's key-path allowlist (auth type + tier), not the whole Gemini API and not the documented account catalog. Picker suggestions are the union.

Documented `stream-json` `init` (from official docs, not a live authenticated run):

```json
{"event":"init","conversation_id":"c3b66b04-872b-4fbe-a3a4-058a026ef20a","init":{"cwd":"/home/user/project","tools":["ask_permission","run_command"],"permission_mode":"request-review"}}
```

## Design (picker, not a visual redesign)

Alternatives:

1. **Same PATH-detected picker rows as the other agents**, first-party Gemini slug suggestions, native `--effort` `low|medium|high`.
2. Hide the effort picker (Cursor-style) because many Gemini slugs already encode effort.
3. Dump the full `agy models` zoo (Claude and other third-party) after login.

Chose **1**. Antigravity has a real `--effort` flag independent of `--model`; hiding it would block `agy --effort high` with the default model. Live `agy models` is the first-party pool; Claude/other ids stay free-typed. Not a vault vendor. Not a new settings surface.

## Decisions

1. **New adapter.** `id: 'agy'`, `displayName: 'Antigravity'`, `binary: 'agy'`, `namePrefix: 'agy'`.
2. **PATH-detected `agy` only.** Install hint: `curl -fsSL https://antigravity.google/cli/install.sh | bash`, docs `https://www.antigravity.google/docs/cli/install/`.
3. **Do not isolate `~/.gemini/antigravity-cli`.** Do not set `HOME` / `ANTIGRAVITY_*` / `AGY_CLI_*`.
4. **No `writeAiConfig` / `settings.json` writes.** Optional vault Gemini keys go to `GEMINI_API_KEY`; a non-default `baseUrl` goes to `GOOGLE_GEMINI_BASE_URL`. Secrets never enter argv. Native login is enough. A vault key is ignored by the CLI unless the user already set `modelProvider: "gemini"`.
5. **`inferCredentialVendor('agy')` stays `custom`.** Do not add an `agy` / `antigravity` vendor. `wirePreference: ['google-generative-ai']` is the form default for an optional Gemini-compatible endpoint. No `modelRegistration`.
6. **Probe the native id; do not assign it.** `assignsSessionId` false. Headless: `extractHeadlessSessionId` from `conversation_id`. Interactive: `transcriptDiscovery: 'subprocess'` polls `listOnDisk` (cwd keys in `last_conversations.json`, plus `realpath` aliases).
7. **Project `--effort` only for `low|medium|high`.** Throw on other Alice effort tokens. Pass `--model` unchanged.
8. **No Web / ACP / `--agent` / `--add-dir` / `--sandbox` / `--json-schema` / `--mode`.**
9. **`deprecatedExportTab` stays closed** (Launch tab).
10. **First-party picker suggestions, not a vendor.** Issue / launch suggest the union of the Gemini key-path allowlist and the documented account slugs (`agy-models.ts`). Not the third-party zoo. Free-typed ids still win. A short `agy models` on one auth/tier is not a deletion.

### Alternatives rejected

1. **Detect `antigravity` or `gemini`** — those names are not the installed CLI.
2. **Write `settings.json` so a vault Gemini key works** — Alice does not own that file; same rule as Cursor/Grok.
3. **`--output-format json` as the headless wire** — one object at the end, no tool events.
4. **Reuse the Cursor or Grok adapter** — resume flag, JSON event names, auth, and home layout all disagree.
5. **Add an Antigravity vendor preset** — native login is the real path.

## Adapter contract

```text
id: agy
displayName: Antigravity
binary: agy
namePrefix: agy
assignsSessionId: false
transcriptDiscovery: subprocess
headless: true
resumeLast / resumeById / parallelPerCwd: true
```

`composeCommand` ignores workspace `base` (do not launch `claude`).

Interactive:

```text
agy
  [--model <slug>]
  [--effort low|medium|high]
  [--conversation <id> | --continue]
  [--prompt-interactive <initialPrompt>]   # fresh seed only
```

Headless:

```text
agy
  --output-format stream-json
  --dangerously-skip-permissions
  [--model <slug>]
  [--effort low|medium|high]
  [--conversation <id> | --continue]
  -p <prompt>
```

## Wiring

Registry (`index.ts` after `cursor`, before `grok`), `AgentId`, install hint, issue efforts (`low|medium|high`), first-party Gemini suggestions, demo `/agents` + launch-plan, Workspace Manager specs, credential-inference (`agy` → `custom`), AI Provider runtime card + i18n, model-semantics table, `DEFAULT_WIRE_BY_AGENT`, `WORKSPACE_AI_AGENT_IDS`, `CONFIGURABLE_AGENTS`, shared extractor / interactive-seed specs. Not Docker-pinned (same as Oh My Pi).

## Live-verify (Gemini API key path)

Do not use `~/.openalice` or port 5174. Isolated `/tmp` cwds only. Google-account TUI is region-locked on this machine; do not try to bypass it.

1. [x] Authenticated `stream-json` one-liner with `-p <prompt>` and `--model gemini-3.5-flash`: `ALICE_AGY_OK`. `-- <prompt>` fails.
2. [x] `--conversation <that id>`: same id comes back; `last_conversations.json` has the `/tmp` cwd key.
3. [ ] Interactive TUI in a fresh cwd: new UUID appears in `last_conversations.json`. `listOnDisk` on the logical `/tmp` path must see it. (TUI still region-locked on the Google account.)
4. [x] `--effort low` with a live key-path slug is **rejected by the CLI** (`--effort is not supported for model "gemini-3.5-flash"`). Alice still rejects `ultra` / `xhigh` before spawn. Issue picker hides effort when the model is a known first-party slug.
5. [x] Headless `--dangerously-skip-permissions` did run `run_command` (`echo ALICE_AGY_TOOL`). The run then exited `ERROR` / "Agent execution terminated due to error."
6. [x] `agy models` on a free-tier Gemini key path is a short API-id allowlist. `agy-models.ts` keeps that unioned with the documented account slugs; a short live list is not treated as deletions.
7. [ ] `alice-workspace inbox push` via an injected shim (isolated Alice home).

## Progress

- [x] `src/workspaces/adapters/agy.ts` + `agy.spec.ts` + `agy-models.ts`
- [x] Registry after `cursor`, before `grok`; `assignsSessionId` false; `transcriptDiscovery: subprocess`
- [x] Enumeration sweep
- [x] `npx tsc --noEmit`, `cd ui && npx tsc -b`, targeted Vitest + full `pnpm test`
- [x] Isolated compose-argv replay against `agy --help` (1.1.13)
- [x] Gemini key-path `agy models` + `stream-json` `-p` one-liner + `--conversation` resume
- [ ] Remaining live checks: TUI harvest, inbox shim

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- Targeted Vitest: adapter + index + interactive-seed + headless extractors + issue-runtime-options + credential-inference + workspace-creator
- Isolated compose-argv replay against `agy --help` / the documented `stream-json` fixture
- Authenticated live checks above after login

## Out of scope

WebAntigravity, ACP, Docker pin, writing `settings.json`, detecting `antigravity` / `gemini`, `HOME` isolation, `--agent` custom agents, an Antigravity vendor preset.

## Completion

Adapter is registered, tests cover the live `1.1.13` help + documented `stream-json` contract, docs table lists Antigravity, PR is open to `dev`. Delete this plan when the PR is accepted.
