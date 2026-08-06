# Issue Runtime Choice

Status: Completed

Owner guides:

- [[../docs/model-semantics-and-runtime-injection.md]]
- [[../docs/workspace-issues-and-scheduling.md]]

## Problem

The Issue detail still exposes the pre-binding editor: model is either the
Workspace default or a free-typed string, while effort is a frontend-hardcoded
list keyed only by Agent runtime. A user cannot choose one compatible vault
credential and then see that provider's known models and reasoning semantics.
Choosing a model name without credential ownership can also pair one provider's
model with another provider's endpoint at dispatch.

## Decisions

1. A Workspace-owned scheduled Issue may persist a secret-free vault credential
   slug beside its optional Agent, model, and effort creation preferences.
2. The Issue editor orders the choice as Runtime -> credential source -> model
   -> effort. Runtime/Workspace default remains a valid credential source.
3. A vault choice narrows model suggestions to that credential's provider
   catalog. Unknown/private model ids remain available through explicit custom
   entry.
4. Registered model semantics own effort options. Unknown models fall back to
   the selected Agent runtime's declared launch range.
5. The scheduler passes the complete optional tuple into fresh Session binding
   creation. Exact Session owners remain immutable and reject the tuple.
6. Issue files and public projections may contain the vault slug but never the
   credential secret, endpoint, or resolved secret-bearing runtime payload.

## Work

- [x] Extend Issue declaration, mutation, projection, tools, audit, and docs
      with an optional credential slug.
- [x] Carry credential/model/effort atomically through scheduled fresh-Session
      dispatch and first-Session claim cleanup.
- [x] Replace the Issue editor's legacy model/effort controls with provider-aware
      credential, model, and semantic effort choices.
- [x] Cover parsing, mutation, scheduler selection, route payloads, and UI
      interaction with regression tests and demo fixtures.
- [x] Run source/UI typechecks, focused Issue/scheduler/UI suites, full tests,
      real browser validation, and proportional packaged runtime smoke.
- [x] Update durable owner guides, complete this plan, and ship through the
      serial `dev` PR flow.

## Verification

- `npx tsc --noEmit`
- `pnpm -C ui exec tsc -b`
- Focused Issue, scheduler, route, tool, UI, and demo-handler Vitest suites
- `pnpm test` (476 files and 3,950 tests passed; one file skipped)
- Real dev and demo Issue routes, including credential-to-model/effort switching
- `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace`

## Completion Criteria

- A scheduled `@new-then-resume` or `@new-each-run` Issue can choose a compatible vault
  credential, one of its suggested/custom models, and only valid effort levels.
- The first dispatched Session persists exactly that credential/model/effort
  binding and resumes independently of later Workspace changes.
- Runtime/Workspace default remains selectable without any OpenAlice credential.
- Exact `@resumeId` Issues cannot rewrite the Session's existing binding.
- No credential secret or endpoint appears in Issue state, API payloads, logs,
  tests, or documentation.
