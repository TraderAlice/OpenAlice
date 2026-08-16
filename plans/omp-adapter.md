# Plan: Oh My Pi (`omp`) CliAdapter

**Status:** active — adapter and wiring are on `feat/omp-adapter`; PR not opened yet.
**Owner guides:** [[docs/model-semantics-and-runtime-injection.md]], [[docs/project-structure.md]]  
**Delivery:** serial PR to `dev` (`area:workspace`, `area:ui`). Open PR, do not merge.

## Goal

Add Oh My Pi as a peer `CliAdapter` (`id: 'omp'`, binary `omp`), same completeness as Claude / Codex / Grok Build / opencode / Pi. Keep Pi. Do not invent a plugin SDK, do not replace managed Pi, do not add WebOmp.

## Why one shot

Grok showed that a thin adapter still dies if argv, resume, and JSONL are guessed incrementally. `omp` looks like Pi and is not Pi. The contract below is from official docs plus a live `omp/17.3.4` probe on 2026-08-16, not from the first workable patch.

## Research (pinned to 17.3.4)

Sources: [omp.sh/docs/cli](https://omp.sh/docs/cli), [session.md](https://github.com/can1357/oh-my-pi/blob/main/docs/session.md), [session-switching](https://github.com/can1357/oh-my-pi/blob/main/docs/session-switching-and-recent-listing.md), [rpc.md](https://github.com/can1357/oh-my-pi/blob/main/docs/rpc.md), [approval-mode.md](https://github.com/can1357/oh-my-pi/blob/main/docs/approval-mode.md), installed `@oh-my-pi/pi-coding-agent@17.3.4` (`flag-tables.ts`, `args.ts`, `print-mode.ts`, `session-paths.ts`), and isolated-HOME print runs.

| Topic | Truth |
|---|---|
| Binary | PATH `omp` only. Not vendored. Not Docker-pinned. Local install may live in `~/.bun/bin` off login PATH. |
| Home | `~/.omp/agent/` (`PI_CODING_AGENT_DIR` / `PI_CONFIG_DIR` / `OMP_PROFILE`). Alice must not set these. `PI_CODING_AGENT_DIR` does **not** isolate `~/.omp/run/daemons`. |
| Create-or-reopen | **None.** `--session-id` is a hard error: `unknown flag: --session-id` (exit 2). `assignsSessionId` stays false. |
| Resume | `--resume` / `-r` / `--session` (alias). Bare `--resume` opens a TUI picker. `--continue` / `-c` is TTY-breadcrumb-first, then cwd bucket. Cross-project id match can chdir; missing cwd prompts in TTY and throws in non-TTY. |
| `--` | POSIX end-of-options. Use it. Pi rejects `--`; omp does not. |
| Interactive | `omp [--model] [--thinking] [--append-system-prompt] [--resume id\|--continue] -- [prompt]` |
| Headless | `omp -p --mode json --auto-approve … -- <prompt>`. `--mode json` alone is already non-interactive (`main.ts` `isInteractive`). Keep both `-p` and `--mode json`. |
| JSON line 1 | `{"type":"session","version":3,"id":"<uuidv7>","timestamp":…,"cwd":…}` then `agent_start` / `turn_start` / `message_start` / `message_end` / `turn_end` / `agent_end`. Tool wire is still `tool_execution_start` / `update` / `end` (same AgentSessionEvent family as Pi). `message_update` is delta-only in print mode. |
| No auth | Print exits 1 with `No models available` and **no** session header. |
| Sessions | `~/.omp/agent/sessions/<encoded-cwd>/<ISO-with-dashes>_<uuid>.jsonl`. File starts with a 256-byte `type:"title"` slot, then `type:"session"` header. Persistence is lazy until assistant output exists. |
| Cwd encoding | realpath first. Under home → `-<rel>`. Under `os.tmpdir()` → `-tmp-<rel>`. Else `--<abs-stripped-slashes-to-dashes>--`. Live: `/tmp/…/ws2` realpaths to `/private/tmp/…/ws2` and is **abs** (`--private-tmp-…--`) because macOS `tmpdir()` is `/var/folders/…`. |
| Thinking | Live help: `off, minimal, low, medium, high, xhigh, max, auto`. Alice `none` → `off`. Reject `ultra`. Do not send `auto`. |
| Skills | `--skills` is a glob filter, not Pi's `--skill <path>`. Do not pass launcher skill paths. Discovery still sees `.agents/skills`. |
| Approval | Default `yolo`. Headless always `--auto-approve`. Do not write trust files. |
| Web / ACP / RPC | Exist. Out of scope. Do not reuse WebPi. |
| `--no-session` | Ephemeral. Alice must not use it (no harvestable durable transcript). |
| Setup hook | No `auth.json`. Auth lives in `agent.db` / `/login`. Omit `readInteractiveSetupStatus` (same as Pi). |

Live error fixture (secret-free, isolated HOME, dummy `OPENAI_API_KEY`):

```json
{"type":"session","version":3,"id":"01a00adc-0884-7000-b507-017949683107","timestamp":"2026-08-16T13:56:27.396Z","cwd":"/tmp/omp-alice-probe.d2iMY8/ws"}
{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"403 …"}}
```

## Decisions

1. **New adapter, keep Pi.** Do not subclass or import `pi.ts`. Duplicate the small JSON extractors; the wire matches Pi today and can drift.
2. **PATH-detected only.** Install hint: `curl -fsSL https://omp.sh/install | sh`, docs `https://omp.sh/`. Do not hardcode or infer `~/.bun/bin` in Alice spawn PATH. Hang `omp` on a real PATH dir (for example `~/.local/bin`). Deep custom install roots stay on the existing `OPENALICE_EXTRA_AGENT_PATH` hook.
3. **Do not isolate `~/.omp`.** Do not set `PI_CODING_AGENT_DIR` / `OMP_PROFILE` / `PI_CODING_AGENT_SESSION_DIR`. Listing honors them if the user already set them.
4. **No `writeAiConfig` / project `.omp` writes.** Vault keys go to env (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` + matching `*_BASE_URL` when custom). Secrets never enter argv.
5. **Headless harvests identity. Interactive TUI does not.** Fresh spawn has no resume flag. Headless harvests `type:session` from print JSON. The TUI has no stable run stream, so `transcriptDiscovery` is `none` — do not fs-watch or poll for a PTY announcement. `listOnDisk` is after-the-fact listing/titles once a JSONL exists. `resumeLast` still emits `--continue` (native). `--resume id` is only reliable when Alice already has an id from headless.
6. **No Web / ACP / `--profile` / `--session-dir` / `--no-session` / `--api-key`.**
7. **`namePrefix: 'om'`** (`o` is opencode, `p` is Pi).
8. **`deprecatedExportTab` stays closed** for omp (Launch tab), same as Grok Build.
9. **`credentialSource: 'runtime-or-workspace'`**, same multi-provider wires as Pi, including the MiniMax Anthropic vendor policy.

### Alternatives rejected

1. **Reuse / alias the Pi adapter** — `--session-id`, session encoding, `--continue` breadcrumbs, trust writes, `--skill`, and `--` all disagree.
2. **Replace Pi with omp** — Electron still ships managed Pi.
3. **WebOmp in the same PR** — product expansion; RPC v2 chunking is a second surface.
4. **Assign a launcher UUID** — omp cannot create-or-reopen that id.

## Adapter contract

```text
id: omp
displayName: Oh My Pi
binary: omp
namePrefix: om
assignsSessionId: false
transcriptDiscovery: none
headless: true
resumeLast / resumeById / parallelPerCwd: true
```

Interactive / headless argv as in the table. `composeCommand` ignores workspace `base` (do not launch `claude`).

## Wiring (same sweep as Grok Build)

Registry, AgentId, install hint, issue efforts (no `ultra`), demo `/agents` + launch-plan, Workspace Manager specs, credential-inference (omp → `custom` like opencode/pi), AI Provider runtime card + i18n, model-semantics table, shared extractor specs.

## Verification

- `npx tsc --noEmit`
- `cd ui && npx tsc -b`
- Targeted Vitest: adapter + index + interactive-seed + headless extractors + issue-runtime-options + credential-inference + workspace-creator
- Isolated live replay of compose argv against `omp --help` / the 17.3.4 print fixture (no `~/.openalice`, no port 5174)

## Out of scope

WebOmp, ACP, Docker pin, managed Electron binary, writing `config.yml` / `SYSTEM.md`, bun PATH injection, `--from-claude` / `--from-codex` import.

## Completion

Adapter is registered, tests cover the live 17.3.4 contract, docs table lists Oh My Pi, PR is open to `dev`. Delete this plan when the PR is accepted.
