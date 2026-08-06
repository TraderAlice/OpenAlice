# Durable Session Runtime Bindings

Status: Completed

Owner guides:

- [[../docs/model-semantics-and-runtime-injection.md]]
- [[../docs/conversation-provenance.md]]
- [[../docs/workspace-lifecycle.md]]
- [[../docs/managed-workspace-runtime.md]]

## Problem

OpenAlice currently chooses a native Agent runtime per product Session, but
credential/provider, model, and effort are split between mutable Workspace
files and headless-only one-run flags. A later interactive or headless resume
can therefore inherit different ambient configuration from the launch that
created the native conversation. The adapter interface also makes launch-time
model projection optional and headless-specific instead of requiring every
Agent runtime to implement one Session contract.

## Decisions

1. `resumeId` owns one immutable, secret-free Session runtime binding:
   Agent runtime, credential source/reference, model, and reasoning effort.
2. Every Agent adapter must implement the Session runtime projection contract.
   Utility adapters such as Shell are outside it. Unsupported selections fail
   explicitly; omission is not interpreted as missing adapter behavior.
3. The same resolved binding is supplied to interactive TUI, structured Web,
   fresh headless, and resumed headless launches.
4. Vault credentials are persisted only by slug and selected wire. Secrets are
   resolved immediately before process launch and are never written to Session
   records, logs, command arguments, or fixtures.
5. Native runtime login is a first-class explicit source. A missing override
   does not cause OpenAlice to pick or inject an arbitrary vault credential.
6. Legacy identities without a binding upgrade to explicit native-runtime
   ownership on their next activation; they never adopt mutable Workspace
   provider state that appeared after the Session was created. All newly-created
   Sessions persist an explicit binding before spawn.
7. Exact Session resumes replay their stored binding and reject conflicting
   runtime/model/effort/credential input instead of silently changing it.

## Work

### 1. Contract and persistence

- [x] Add the secret-free Session binding schema and resolved launch shape.
- [x] Persist and validate the binding in `ResumeRegistry` with backward
      compatibility and an idempotent state migration.
- [x] Make every built-in Agent adapter implement the projection interface.

### 2. Unified launch and resume

- [x] Resolve a new binding once from explicit launch input, Workspace state,
      or native runtime state.
- [x] Pass the same adapter projection through TUI, WebPi, and headless spawn.
- [x] Resolve vault secrets just in time and fail clearly when a referenced
      credential or Workspace binding is no longer available.
- [x] Replace headless-only model/effort overrides with fresh-Session binding
      creation; exact resumes replay the stored binding.

### 3. Product/API integration

- [x] Let launch APIs carry optional credential/model/effort selection without
      mutating Workspace defaults.
- [x] Preserve Issue declarations as Session-creation preferences and expose
      safe effective binding metadata on Session/run projections.
- [x] Update UI/demo contracts where launch selection already exists.
- [x] Keep credential, model, and effort independently optional; make both
      Quick Chat and Workspace Manager submit the visible selection atomically.

### 4. Verification and delivery

- [x] Add adapter contract tests for all built-in Agent runtimes.
- [x] Add fresh/resume/restart tests proving binding replay and secret safety.
- [x] Run source/UI typechecks, the monorepo suite, real browser/dev launch
      checks, and proportional Electron/PTY/package smoke.
- [x] Update owner guides, complete this plan, and ship through the serial
      `dev` PR flow.

## Result

Delivered one mandatory adapter contract across Claude Code, Codex, OpenCode,
and Pi; persisted versioned bindings on `resumeId`; removed the headless-only
override seam; and verified the same binding in browser/dev and an isolated
packaged Electron scheduled-Pi run. Utility Shell Sessions remain explicitly
outside the Agent runtime binding contract. A follow-up hardening pass made
legacy binding absence mean native runtime ownership, fixed login-backed
credential/model selection as one Session launch, and carried the same optional
model/effort values through Workspace Manager.

## Completion Criteria

- A product Session launched with an explicit credential, model, or effort
  resumes with the same selection from both TUI and headless surfaces.
- Every Agent adapter has a compile-time-required projection implementation.
- Changing Workspace defaults after Session creation cannot silently change a
  persisted Session binding.
- No secret appears in Session state, public API payloads, command arguments,
  logs, docs, tests, or Git history.
