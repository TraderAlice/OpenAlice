# Windows Headless Launch Hardening

Status: Completed

Related report: Discord scheduled-Issue Windows startup failures (`exitCode: -1`)

Delivered by: #719

Owner guides: [[docs/managed-workspace-runtime.md]],
[[docs/workspace-issues-and-scheduling.md]],
[[docs/development-workflow.md]]

## Outcome

Windows scheduled Issues can launch npm-installed Agent runtimes without routing
their user-controlled prompt through `cmd.exe`. Launch failures retain explicit
startup diagnostics in the run record and log files, while one failed dispatch
still advances only its own scheduled occurrence.

## Decisions

1. Native executables and verified npm/pnpm JavaScript entrypoints remain direct
   child processes.
2. An unrecognized `.cmd` or `.bat` may use its same-directory extensionless
   POSIX sibling through the resolved Workspace Bash, with every runtime
   argument passed separately and `shell: false`.
3. Batch-only runtimes remain blocked for untrusted headless prompts. Readiness
   probes may keep their launcher-owned `cmd.exe` compatibility path.
4. A durable task record distinguishes process startup from process exit.
   Launch diagnostics never persist prompts, complete argv, credentials, or
   environment values.
5. Once dispatch creates a durable run, the schedule marker advances even when
   launch later fails. Admission failures that create no run stay due.

## Work

### 1. Safe Windows launch resolution

- [x] Resolve explicit and PATH-discovered batch shims through one policy.
- [x] Add same-directory Bash-shim fallback without command-string evaluation.
- [x] Preserve the restricted `cmd.exe` readiness-probe compatibility path.

### 2. Durable launch diagnostics

- [x] Record `processStarted`, a typed launch error code, and a human error.
- [x] Open diagnostic logs before launch resolution can fail.
- [x] Attach process activity only after the child emits `spawn`.
- [x] Project launch failures as Issue `launch_error` rather than `process_exit`.

### 3. Scheduling and packaged acceptance

- [x] Cover one-record-per-occurrence and admission-retry marker semantics.
- [x] Exercise scanner-owned scheduled dispatch in packaged Workspace smoke.
- [x] Add a Windows-native Git Bash shim argv/injection integration test.
- [x] Update runtime and scheduling owner guides.

### 4. Verification and delivery

- [x] Run focused Windows command, headless, Issue, scanner, and desktop tests.
- [x] Run `npx tsc --noEmit`, desktop TypeScript, and `pnpm test`.
- [x] Run `pnpm electron:smoke:workspace`.
- [x] Publish and merge a serial PR to `dev`; inspect trailing Windows package
  smoke and repair any completed failure.

## Completion Criteria

- Scheduled Agent prompts containing Windows shell metacharacters reach a safe
  runtime argv unchanged and cannot be interpreted by `cmd.exe`.
- Unsupported or missing runtimes show an actionable launch error in both the
  durable run and stderr diagnostics.
- A spawned runtime that later exits non-zero remains a process-exit failure.
- The packaged Workspace acceptance reaches managed Pi through the real
  ScheduleScanner path.
