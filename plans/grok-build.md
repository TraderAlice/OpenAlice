# Plan: Grok Build CliAdapter

**Status:** active  
**Owner guides:** [[docs/model-semantics-and-runtime-injection.md]], [[docs/workspace-issues-and-scheduling.md]]  
**Delivery:** autonomous topic Draft PR #1108 to `dev` (`workflow:parallel`, `theme:reliability`, `area:workspace`, `area:settings`, `review:deep`). Do not merge until accepted.

## Goal

Grok Build is a first-class PATH-detected Agent runtime on the existing
`CliAdapter` contract, at the same completeness as Claude / Codex / OpenCode /
Pi for launch, resume, headless structured output, Session projection, and
on-disk discovery.

## Non-goals

- No RuntimeEngine / plugin SDK.
- Do not isolate `GROK_HOME` or write `~/.grok/config.toml`.
- Do not write `trusted_folders.toml` (read-only advisory setup status).
- Do not pass `--worktree` or treat `-s/--session-id` as resume.
- Do not vendor or pin `grok` in the Docker image.
- No deprecated `writeAiConfig` / `readAiConfig` — Grok has no workspace-local
  project file. Managed Sessions use `sessionRuntime` env only.

## Decisions

- Every launch uses `--no-leader`. Headless adds `--always-approve`.
- Headless prompt is `--single=<prompt>` plus `--output-format streaming-json`.
  Live 1.0.4 stdout is a flattened `{type,...}` stream, not ACP-wrapped
  `session/update`. On-disk `updates.jsonl` stays ACP.
- Official `https://api.x.ai/v1` does not set `GROK_MODELS_BASE_URL`.
- `ultra` effort is rejected. `xhigh` is accepted.
- Launcher-owned role guidance maps to `--rules`.

## Increments

- [x] Thin adapter + official `xai-api` preset + PATH detection
- [x] Live 1.0.4 argv (`--single=`) and realpath session keys
- [x] Ignore workspace default `claude` command; join `text` deltas
- [x] Parse flattened `tool_call` / `tool_call_update`; normalize Bash bytes
      and ListDir `Content.content`; keep last reply after a tool
- [x] Diagnostic-line filter, failed-tool / aborted-end events, `--continue`,
      `--rules`, Issue effort/preset wiring, remaining four-runtime lists

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- Targeted Vitest: grok adapter, headless-output, issue-runtime-options,
  workspace-creator, interactive-seed
- Replay captured 1.0.4 `streaming-json` files (secret-free) through extractors

## Remaining / residual

- Interactive TUI and Issue/headless dispatch still need a human with `grok`
  on PATH and an xAI login or vault key.
- Docker image will keep reporting grok as not installed unless the host
  PATH-detects it inside the container.
- Legacy workspace-export modal stays four-runtime; grok is sessionRuntime-only.
