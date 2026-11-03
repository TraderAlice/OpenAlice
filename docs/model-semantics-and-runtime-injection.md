# Model Semantics and Runtime Injection

This guide owns the boundary between AI resource credentials, model semantics,
Workspace selection, durable Session bindings, and native Agent process
projection. Read it before changing provider presets, model capabilities,
Workspace runtime defaults, or Agent adapters.

OpenAlice does not run an in-process model loop. Native coding-agent CLIs own
inference, transcripts, login, and their native configuration.

## Three-layer contract

```text
Credential access
  account/vendor + auth + region + supported wire endpoints
                         ↓
Model selection and semantics
  exact model id + known limits/reasoning + explicit unknown-model overrides
                         ↓
Per-process runtime projection
  one adapter maps the resolved Session binding to native argv/environment
```

These layers must not absorb one another's responsibilities. Credentials do not
own model capabilities; semantic registries do not own runtime flags; adapters
do not own account discovery or persisted Workspace policy.

### Credential access and catalogs

A credential describes how the user reaches an AI resource: secret, auth kind,
vendor, and accepted wire-to-endpoint map. `Credential.lastModel` is only a
selection hint, never a copied capability snapshot. Gateway credentials remain
distinct from first-party model vendors.

`CredentialAIProvider` projects an existing Vault record through the shared
`AIProvider` catalog boundary. There is no second account/provider registry.
Provider implementations own optional read-only discovery; presets supply
suggestions and manual model ids remain valid. Discovery never sends a
generation prompt or proves inference permission.

Saved provider catalogs live under
`OPENALICE_HOME/data/model-catalog/providers/`. Reads return a snapshot or
bundled suggestions and share background refresh. Failed/incomplete refresh
preserves prior data; a successful empty list stays empty. Cache identity covers
credential, vendor, endpoint, wire, and key without storing the key or raw
provider response. Refresh replaces membership and never rewrites `lastModel`
or Session bindings. Catalog membership is advisory, not a launch gate.

`AIProvider.resolveModel(id)` is the local, network-free semantic resolution
boundary for runtime injection. Explicit false and empty effort lists are
authoritative; absent fields remain unknown. UI account changes discard stale
responses and capabilities, while model-only changes do not refetch the account
catalog.

`NativeAIProvider` exposes runtime-owned discovery through the same catalog
shape. It creates no Vault record, reads no tokens, performs no OAuth, and
injects no credentials. Native discovery is scoped by runtime and Workspace,
bounded in lifetime/output, and returns only normalized allowlisted metadata.
Successful empty lists remain empty; parser failure is an error. Runtime login
and provider configuration stay native.

### Model semantics

A selection identifies which model to use. `model-semantics.ts` resolves exact
ids and aliases to stable runtime-neutral facts such as limits and reasoning.
Model lists are suggestions, not allowlists; unknown free-typed ids remain
valid and unknown fields remain absent rather than becoming false.

Reasoning behavior is `none`, `optional`, `adaptive`, or `required`. Effort
levels, defaults, thinking switches, and interleaved reasoning are separate
facts. Do not collapse them into one boolean or infer effort tiers from request
parameters.

Unknown-model overrides attach to one exact model id. Changing model cannot
carry forward the previous id's capability assertion. Provider documentation or
a reproducible compatibility check must support registry facts; disputed facts
remain unknown. Registry changes do not rewrite existing Workspace files in the
background.

### Adapter projection

Every provider-capable Agent adapter implements `sessionRuntime.project(...)`
and declares `capabilities.aiProvider`: native-login sufficiency, accepted wire
shapes and preference, vendor-specific narrowing, and supported custom-model
facts. Registration rejects a provider-capable adapter without projection;
utility adapters such as Shell explicitly opt out.

The adapter maps one resolved binding to process-local argv and environment for
TUI, Web, headless, and exact resume. Adapter argv never contains credential
material. Runtime-specific flag spelling, native aliases, model-encoded effort,
and protocol parsing stay in the adapter; shared layers must not grow an
adapter-id matrix.

Omitted effort stays omitted even when registry metadata advertises a default.
Explicit wire choice wins except for a narrowly declared runtime
incompatibility. Registered provider defaults are descriptive, not implicit
Session input. A native binding may contain model/effort without any managed
credential and must still traverse projection even when the result is empty.

Headless adapters preserve incremental assistant text exactly, including
whitespace-only deltas. Trim only complete final/display text, never streaming
Markdown structure.

## Workspace preferences and Session bindings

`.alice/settings.json` is versioned, secret-free creation policy with separate
`interactive` and `headless` modes. Each mode has optional fixed Agent and
credential/model/effort tuple per Agent, plus separate remembered recent values.
Successful launches update only recent values and never overwrite fixed ones.
Fixed tuples are atomic: changing credential cannot invisibly inherit model or
effort from another credential.

Fresh Session selection resolves explicit one-launch choices, then fixed mode
preferences, then recent mode preferences, then native runtime state. Headless
mode has its declared fallback order and must resolve to a headless-capable
Agent. Registry `defaultEffort` is not another resolution layer.

The resulting `SessionRuntimeBinding` is durable at
`.alice/sessions/<resumeId>.json` in the `ai` object. Manager bindings live under
`<launcherRoot>/state/workspace-manager-sessions/` instead of creating control
plane files on the active floor. The binding replays on every launch surface;
follow-ups do not consult changed Workspace defaults. Runtime identity is fixed.

Vault components store only credential slug and applicable wire shape. Native
components store only runtime ownership and any required safe fingerprint.
Keys, endpoints, and resolved provider payloads never enter Workspace files.
Vault secrets resolve just in time into child environment. Paused edits replace
the secret-free binding while idle and affect the next launch only.

Issue launch fields seed fresh Sessions for `@new-then-resume` and
`@new-each-run`. Once an exact `resumeId` exists, Issue frontmatter cannot
replace its credential, model, effort, or runtime. `credentialSource: native`
explicitly selects runtime-managed access; `credential` is a Vault slug, never
secret material.

Legacy Sessions without a binding become explicit native bindings on next
activation. They must not adopt provider configuration added after Session
birth. Native project files are not a source of fresh managed Session defaults.

Context/output limits follow the same rule: known semantics, an explicit
model-bound Workspace override where supported, then native fallback. Alice has
no global context ceiling or parallel automatic compactor. Native compaction
remains observable runtime state.

## Native authentication and compatibility export

Native authentication is the default when no managed credential is selected.
Absence of an OpenAlice credential never means “pick any compatible Vault key.”
Readiness probes diagnose the selected executable/binding, never mutate provider
configuration, block ordinary launch, or accept native trust/onboarding for the
user. Cached readiness is scoped to executable identity and invalidated when
installation changes.

Managed custom providers use process-local configuration and trust; never
rewrite global user config. Codex global `CODEX_HOME` remains distinct from
project config, and other runtimes retain native global auth/provider state.

The deprecated native-file compatibility export is only for intentionally
launching outside OpenAlice. It is not a launch fallback or readiness gate. It
updates only OpenAlice-owned nodes, preserves unknown settings, and restores a
shared scalar on reset only if it still equals the last injected value. User
edits and deletion win. Sensitive provider files and rollback sidecars stay out
of Git, logs, docs, and test snapshots.

Alice-managed Sessions use full host filesystem/network access and automatic
tool approval through each adapter's process-local policy, equally on fresh
launch and resume. Approval `never` alone does not disable a native sandbox.
OS permissions, enterprise policy, and UTA trading permissions remain
authoritative; never implement execution policy by rewriting global config.

## Registry and UI boundaries

`model-semantics.ts` owns offline semantics; `preset-catalog.ts` owns suggestions.
One resolver handles exact ids, aliases, and unknown fallback. JSON Schema
validates forms but is not the semantic database. `adapters/index.ts` is the sole
built-in registration point and `/agents` serializes declared capabilities.

Credential → model → effort dependency order applies everywhere. Changing
credential clears inherited model/effort; changing model clears incompatible
effort. Free-typed ids remain valid. Probes verify access, not capabilities;
local model/effort-only changes need no provider request.

## Load-bearing paths

- `src/ai-providers/{preset-catalog,model-semantics,presets,provider,model-catalog}.ts`
  — suggestions, semantics, serialization, discovery, and snapshots.
- `src/core/config.ts` — credential access and creation seeds.
- `src/workspaces/cli-adapter.ts` — mandatory projection and binding contract.
- `src/workspaces/session-runtime-binding.ts` — fresh binding and resume resolution.
- `src/workspaces/workspace-runtime-settings.ts` — Workspace preference schema and merges.
- `src/workspaces/session-runtime-store.ts` — durable Session AI configuration.
- `src/workspaces/credential-injection.ts` — shared projection and deprecated export.
- `src/workspaces/adapters/` and `adapters/index.ts` — runtime ownership and registration.
- `src/workspaces/adapters/owned-toml-config.ts` — reversible owned scalar updates.
- `src/workspaces/resume-registry.ts` — identity and binding hydration.
- `ui/src/components/credentials/` and
  `ui/src/components/workspace/WorkspaceAIConfigModal.tsx` — account and Workspace controls.

## Verification gates

Tests cover exact/alias/unknown resolution, tri-state serialization, omitted
effort, model-scoped overrides, synthetic adapters, changed projections, secret
exclusion, reversible export/reset, and probe non-interference with bindings or
native launch. Exercise changed behavior on a real installed runtime: fresh and
exact resume, applicable access modes, explicit model/effort, streaming, and
failure recovery. Fake argv is insufficient for a new wire or runtime. Expand
shared binding/cross-surface acceptance through [[docs/development-workflow.md]].
