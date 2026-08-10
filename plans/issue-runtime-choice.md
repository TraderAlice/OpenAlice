# Issue Runtime Choice

Status: Completed (refinement delivered after Workspace runtime settings v3)

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

## 2026-08 Refinement

Workspace runtime settings v3 made the original Issue editor's inheritance
model stale. Runtime inheritance reads `.alice/settings.json`, but the
credential/model/effort labels still inspect deprecated native project files.
An Issue with no explicit launch tuple can therefore advertise one provider
while the scheduler creates its Session from a different headless preference.
The flat rail also cannot distinguish “inherit the Workspace” from “explicitly
use this Agent runtime's own login”.

### Design alternatives

1. **Runtime plus one AI configuration disclosure (selected with the
   maintainer).** Keep runtime visible, summarize the resolved access/model/
   effort in one row, and edit the dependency chain in a shared Dialog. This
   keeps the Work Item scannable while making inheritance provenance explicit.
2. **Progressive inline rows.** Keep Access, Model, and Effort in the rail and
   reveal dependent rows after each choice. This is cheaper to implement but
   leaves operational metadata visually dominant and makes narrow rails busy.
3. **Raw four-field editor.** Repair only the source and labels. This preserves
   the current UI but continues to expose implementation structure as four
   unrelated defaults, so it is rejected.

### Refinement decisions

1. The Issue UI and dispatch path resolve defaults from the same headless
   Workspace runtime settings: fixed preference, then matching recent
   preference, then native Agent state. Deprecated compatibility-export files
   never participate in the primary Issue editor.
2. A fresh-Session Issue has three AI access intentions: inherit the Workspace,
   explicitly use native Agent login, or explicitly use one vault credential.
   Existing `credential: <slug>` remains the vault form; a new secret-free
   native-source marker represents the explicit native choice. Omission remains
   inheritance so existing Issue files keep their meaning.
3. Runtime is a separate execution choice. Access, model, and effort form one
   dependent AI choice edited in a Dialog through shared shadcn/Base UI
   primitives. Switching runtime or access clears incompatible dependent
   overrides atomically.
4. The collapsed summary shows both the resolved tuple and its provenance:
   Workspace headless preference, Agent login, or saved access. “Default” is
   not used without naming the owner of that default.
5. `@new-each-run` and an unclaimed `@new-then-resume` edit the next fresh
   Session seed. An exact `@resumeId` owns an immutable Session binding and the
   Issue surface shows that binding read-only instead of showing editable
   creation defaults.
6. Model suggestions remain provider-aware and custom ids remain available.
   Effort remains independently selectable and comes from registered model
   semantics or the Agent runtime's declared fallback range.

### Refinement work

- [x] Add explicit native-access semantics to Issue parsing, mutation, tools,
      projections, audit records, and scheduled fresh-Session selection.
- [x] Introduce one shared resolver for Issue inherited runtime/AI presentation
      based on Workspace headless fixed/recent preferences.
- [x] Replace the rail's Credential/Model/Effort selects with a source-aware AI
      summary and responsive Dialog; preserve the separate runtime row.
- [x] Project exact Session bindings into the read-only Issue state.
- [x] Cover inherit/native/vault transitions, incompatible dependent-field
      cleanup, scheduler selection, exact-Session immutability, i18n, and demo
      behavior.
- [x] Run source and UI typechecks, focused and full tests, the real Issue route,
      and proportional Electron/package acceptance; then deliver serially to
      `dev`.

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
- `pnpm test` (497 files passed, 4,087 tests passed; one file skipped)
- `pnpm test:e2e -- --reporter=dot` (4 files and 30 tests passed; one file skipped)
- Real dev Issue routes for inherited and exact-Session ownership, including
  credential-to-model/effort narrowing and responsive Dialog presentation
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
