# Model Semantics and Runtime Injection

This guide owns the boundary between AI resource credentials, model semantics,
Workspace model selection, and native Agent runtime configuration. Read it
before changing provider presets, Workspace AI defaults, model capability
fields, or the Claude Code, Codex, opencode, and Pi provider injectors.

Related guides: [[docs/project-structure.md]] and
[[docs/managed-workspace-runtime.md]].

## The Three-Layer Contract

OpenAlice does not run an in-process model loop. It prepares a native Agent CLI
to reach a selected model. That preparation has three distinct inputs:

```text
Credential access
  account/vendor + key/auth + region + supported wire endpoints
                         │
                         ▼
Model selection and semantic resolution
  model id + known limits/capabilities + explicit unknown-model overrides
                         │
                         ▼
Native runtime projection
  Claude Code / Codex / opencode / Pi configuration and reversible ownership
```

### Credential access

A credential answers **how the user may reach an AI resource**. It owns the
secret, authentication kind, vendor identity, and the wire-shape-to-endpoint
map accepted by that key. It does not own a model's capabilities.

`Credential.lastModel` is a remembered selection hint. It saves the user from
retyping the last model used with an account, but it does not make the model an
intrinsic property of the credential and must never store a copied capability
snapshot.

### Model selection and semantics

A selection answers **which model the Workspace should use**. The model
registry resolves a known `(vendor, model id)` into stable semantic facts such
as context/output limits and reasoning behavior. Agent adapters consume that
resolved result; UI forms must not ask users to rediscover known facts.

Model semantics are tri-state. A missing field means **unknown**, not false.
This matters for free-typed model ids and private gateways: writing a false
capability can disable a runtime's own model detection, while omitting an
unknown capability preserves the native fallback.

Reasoning is not one universal API field. The registry describes behavior:

- `none`: the model does not expose a reasoning mode;
- `optional`: reasoning is supported and may be enabled or disabled;
- `adaptive`: the model chooses whether/how much to reason, influenced by
  effort;
- `required`: the model rejects requests that disable or omit reasoning.

Effort levels, defaults, and interleaved reasoning are separate facts. The
registry must not collapse them back into one boolean merely because Pi and
opencode currently accept a coarse `reasoning` capability bit.

### Native runtime projection

An injector answers **how the selected resource and model preference are
expressed in one Agent runtime**. It maps a shared resolved binding into the
runtime's native format:

- Pi custom model metadata and native project selection;
- opencode model capabilities, limits, provider package, and variants;
- Claude Code endpoint/auth/model settings plus project-local `effortLevel`;
- Codex endpoint/auth/model, wire API, and `model_reasoning_effort` settings.

OpenAlice projects a registered provider default when the exact model contract
publishes one. This makes a Workspace binding deterministic across Agent
runtimes without inventing policy: an explicit Workspace preference wins, then
the registered model default, and only an unknown or undocumented value falls
back to the Agent's native behavior. A model that documents only a thinking
switch (for example LongCat 2.0) keeps `defaultEnabled` separate and never
receives a fabricated effort tier.

Wire selection normally follows the same rule: an explicit Workspace or
creation-default protocol wins. A registered runtime incompatibility is the
narrow exception. MiniMax's OpenAI Chat endpoint only separates thinking when
`reasoning_split` is set, then returns it through the array-shaped
`reasoning_details` extension. Pi and opencode's generic OpenAI transports do
not consume that extension losslessly. Their own native MiniMax registrations,
Models.dev, and MiniMax's AI SDK provider all choose the Anthropic-compatible
path instead. OpenAlice therefore exposes only the Anthropic MiniMax wire to Pi
and opencode; an old saved MiniMax OpenAI default is repaired to Anthropic on
the next apply/injection so native thinking blocks and multi-turn replay survive.

The native fields are deliberately runtime-owned projections of the same
resolved value:

- Pi: project `defaultThinkingLevel` (`none` maps to Pi's native `off`);
- opencode: model-level `options` in the provider SDK's native shape;
- Claude Code: project `effortLevel` (only values Claude can persist);
- Codex: project `model_reasoning_effort`.

### Workspace defaults and durable Session bindings

A Workspace-local file is a default for creating a product Session. A fresh
Session resolves that default together with any explicit credential, model, or
effort choice into one immutable, secret-free `SessionRuntimeBinding` owned by
its `resumeId`. The binding is then projected on every launch of that Session:
interactive TUI, structured Web surface, headless Issue turn, and exact resume.
It is not a headless-only override.

Fresh Session runtime selection follows the same ownership rule. The optional
`.alice/workspace.json` `defaultAgent` is the durable default for one Workspace.
It wins over the legacy installation-wide `workspaceDefaultAgent`; an explicit
Quick Chat, sidebar, CLI, or API runtime choice wins for that one Session without
rewriting either default. If neither default resolves to a registered agent
runtime, Alice falls back to the first registered runtime.

| Runtime | Workspace-local preference | Per-process Session projection |
|---|---|---|
| Claude Code | `.claude/settings.local.json`: `model`, `effortLevel` | `--model`, `--effort` |
| Codex | `.codex/config.toml`: `model`, `model_reasoning_effort` | `--model`, `-c model_reasoning_effort=...` |
| opencode | `opencode.json` provider/model binding | `--model`, `--variant` |
| Pi | project settings plus registered provider | `--model`, `--thinking` |

An Issue's agent/credential/model/effort fields seed a new Session binding when
its owner is `@new-then-resume` or `@new-each-run`. The credential field is only an
OpenAlice-vault slug; it never contains a key or endpoint. Once an exact
`@resumeId` exists, those fields cannot replace its credential source, model, or
effort. Follow-up turns replay the stored binding instead of consulting newly
changed Workspace defaults.

The persisted credential component records only an ownership reference:
native runtime state, an OpenAlice-vault slug plus wire shape, or a fingerprint
of an explicitly configured Workspace provider. Vault secrets are resolved
just in time and enter only the child environment. Workspace fingerprints make
replacement visible instead of silently resuming through a different key.

Credential, model, and effort are independent optional launch dimensions. A
native credential binding means OpenAlice injects no managed key or endpoint;
the Agent runtime owns authentication and provider discovery through its normal
login/config chain. That native binding may still carry a process-level model
or effort override. A native binding with neither override is also valid and
must still traverse the adapter projection seam, even when the resulting
projection is empty.

Legacy resume identities that predate this binding contract are upgraded to an
explicit native binding on their next activation. They must not inspect and
adopt a provider that was added to the Workspace after the Session was created.
Fresh Sessions may still resolve an existing Workspace-local provider as their
creation default and persist that choice before the first process starts.

Every Agent adapter must implement `sessionRuntime.project(...)`. Registration
rejects an Agent adapter without that contract; utility adapters such as Shell
explicitly opt out. The adapter maps the same resolved binding to its native
arguments and environment for every supported surface. Adapter argv must never
contain credential material.

Codex project configuration must not be confused with `CODEX_HOME`; the latter
owns global auth, sessions, skills, and user configuration. Provider definitions
are not a supported Codex project layer, so OpenAlice-managed custom providers
use an explicit `.codex/openalice-home/`, while model/effort-only login-backed
preferences leave `CODEX_HOME` unset.

Context-window and output limits follow the same ownership boundary. Registered
model semantics provide known limits; an explicit Workspace preference may
override the context registration for runtimes that support it; otherwise the
native Agent fallback wins. Alice must not add a global context/output ceiling
or run a parallel automatic compactor. Creation defaults may keep an explicit
context preference only inside the selected agent/model binding; there is no
cross-model context default. The retired `compaction.json` contract and
`workspaceDefaultContextWindow` field are removed by migration
`0025_retire_global_compaction_config`. Native Agent compaction events remain
observable UI state, not an Alice policy layer.

## Registry Ownership

`src/ai-providers/model-semantics.ts` is the curated, offline semantic registry.
`src/ai-providers/preset-catalog.ts` owns the provider/model suggestions and
attaches exact registry matches to those model records. Model lists remain
suggestions rather than allowlists: every model field keeps free-text entry.

The serialized preset contract exposes model records directly to the UI.
JSON Schema continues to describe form validation, but it is not the semantic
database. A single resolver owns exact-id/alias matching and the unknown-model
fallback so the UI, Workspace defaults, and injectors cannot drift.

The registry is repository data, not persisted user state. Updating a known
model changes future resolution but must not silently rewrite existing
Workspace files. Existing configurations change only through their normal
explicit apply/create paths.

Runtime compatibility belongs to the runtime adapter, not to the shared
credential or route layers. Every provider-capable adapter declares
`capabilities.aiProvider` with:

- whether native/global login is sufficient or a Workspace credential is
  required;
- accepted wire shapes in native preference order and the blank-form default;
- any vendor-specific wire narrowing and narrowly scoped legacy repair;
- which custom-model facts it registers (`contextWindow`, `reasoning`, and
  effort variants).

`src/workspaces/adapters/index.ts` is the single built-in registration point.
The Workspace `/agents` contract serializes these declarations for UI launch,
credential, and model controls. Adding a provider-capable runtime therefore
means implementing its adapter, declaring these capabilities, and registering
it once. Shared injection, readiness, config routes, and UI helpers must not
add a second adapter-id matrix. Runtime-exclusive behavior such as a structured
surface, transcript parser, native config format, or CLI argument spelling
remains in the adapter or its explicitly runtime-owned UI.

An upstream catalog such as Models.dev may later generate part of this table at
build time. OpenAlice-specific overrides still own protocol quirks and runtime
compatibility, and Workspace launch must not depend on a live catalog fetch.

## User Experience

For a registered model, the normal flow asks for account/region/key/model and
derives capability fields automatically. The UI shows the resolved effort and
marks the registered default instead of hiding it behind “runtime default.” It
must not require a reasoning checkbox or context-window guess for known facts.
When the provider publishes no effort tiers, the UI shows the actual thinking
policy (on/off/required/unknown) rather than rendering an empty effort control.

For an unknown free-typed model, the runtime fallback is the default. Advanced
overrides remain available for facts OpenAlice cannot discover. An override is
bound to the selected model id (`reasoningModel` in creation defaults); changing
models must not carry an old model's capability assertion forward invisibly.

Issue launch controls follow the same ownership chain as Session creation. The
user first chooses Workspace/native auth or one compatible vault credential,
then sees model suggestions from that credential's provider catalog, then sees
only the registered effort tiers for the selected model. Free-typed model ids
remain available; because their semantics are unknown, their effort picker
falls back to the selected Agent runtime's native range.

Connection probes verify that a key, endpoint, wire shape, and model can answer.
They do not prove the complete capability set. Error-guided retries (for
example, a model that mandates thinking) are useful diagnostics but do not
replace the curated registry.

The UI must disclose configuration ownership instead of presenting every
resolved launch value as if it were already on disk. A launch surface
distinguishes a Workspace-local default from a credential that will be bound
only to the next Session. Selecting the latter must not rewrite the Workspace.
Creation defaults are also explicitly creation-time policy: changing one never
rewrites an existing Workspace.
Stable Workspace ownership stays implicit so provenance does not displace the
effective model, reasoning, and context values. When Send will apply a
Session-only provider/model override, that ownership is disclosed on its own
line; successful explicit Workspace saves use transient confirmation instead
of a permanent success state.
This disclosure applies to all four supported Agent runtimes. Claude Code and
Codex use their native global login and global runtime configuration by default.
Merely storing a compatible credential in Alice never selects or injects it;
only an explicit Session selection, Workspace binding, or new-Workspace
creation default overrides the native fallback. When a Workspace-local override
exists its real model must be shown instead of a generic “runtime managed” label. Their native
project files do not declare a context limit, so the UI omits that field rather
than borrowing the Pi/opencode injection default.

Headless provider readiness does not prove that an interactive TUI can consume
its first queued prompt immediately. A native runtime may still own global
onboarding or per-project trust gates. OpenAlice may expose those gates as
read-only, best-effort launch guidance, but it must not mark private global
state complete or accept trust on the user's behalf. Unknown native state is
advisory and fail-open; it never becomes a fabricated ready/not-ready fact.

The test-before-save gate follows the same boundary as the probe. Changes to a
managed key, endpoint, wire shape, authentication mode, or its model require a
fresh probe. A Codex/Claude native-login binding with no OpenAlice-managed key
or endpoint has no HTTP credential for the modal to probe: model/effort-only
changes save directly and are validated by the native runtime at launch.
Context-window, reasoning capability, and reasoning effort are also local
runtime registration fields and save without an unrelated provider request.
Official endpoints may be omitted because the probe resolves their default from
the wire shape. Both automatic creation-default saves and explicit Workspace
saves must acknowledge completion in the UI.

## Native Authentication and Explicit Overrides

Claude Code, Codex, OpenCode, and Pi all own native login or provider state.
OpenAlice launches them against that state by default and must not require an
OpenAlice-vault credential merely because a Workspace has no managed provider
binding. Runtime readiness probes exercise the effective native or existing
Workspace configuration; they never inject the first compatible vault entry as
a fallback and never mutate provider ownership while diagnosing readiness.
Readiness is diagnostic rather than a synchronous preflight: ordinary Chat,
Manager, Session spawn, and Session resume proceed through the selected native
runtime without waiting for a probe. Onboarding, explicit Retry, and background
health surfaces may probe and cache the result without becoming a launch gate.

Choosing an OpenAlice credential is an explicit override. A fresh Session may
bind that vault reference without writing it into the Workspace or changing the
runtime's global state. An absent choice means
“use the runtime default”; it does not mean “pick any compatible credential.”
Existing Workspace bindings remain authoritative until the user resets or
replaces them, and OpenAlice never imports a runtime-global secret into its
vault or a Workspace.

Native “global” state follows the runtime actually launched. A source or
user-installed Pi uses its own normal global agent directory. Packaged managed
Pi uses the instance-scoped `PI_CODING_AGENT_DIR` under the complete OpenAlice
home, so `/login` persists for that managed runtime without reading or changing
a separately installed shell Pi. Authentication/provider failures from either
path must settle launch UI state and point users to native CLI login first;
OpenAlice provider setup remains an optional explicit alternative.

## Configuration Ownership and Reset

Agent configuration files may also contain user- or runtime-owned settings.
Injectors must update only OpenAlice-owned keys/nodes, preserve unknown data,
and restore the prior value on reset where a shared scalar is overridden.

Pi uses one generic OpenAlice-managed project extension plus local provider and
binding/rollback state. The extension registers only the provider stored in
that Workspace's sensitive `.pi/openalice-provider.json`; Pi's global
`models.json` remains user-owned. Claude Code and opencode use the same
lifecycle rule with
`.claude/openalice-provider.json` and `.opencode/openalice-provider.json`:
the first write snapshots only the nodes OpenAlice will replace, later writes
retain that original snapshot, and reset restores a node only if it still equals
the last injected value. A user edit or whole-file deletion made after injection
wins.

Codex applies the same reversible ownership rule to top-level `model` and
`model_reasoning_effort` assignments in the shared project
`.codex/config.toml`; comments, sections, and unknown keys remain untouched.
Only `.codex/openalice-home/` is an exclusive `CODEX_HOME`, and only while an
OpenAlice-managed custom provider is active. Reset removes that dedicated home
and restores owned project scalars without deleting the user's `.codex/`
directory or global login state.

The rollback sidecars can contain prior or injected secrets and are therefore
sensitive Workspace state. Templates must exclude both sidecars and native
provider config files from git. They must never be logged or copied into test
snapshots.

Secrets remain excluded from git and logs. Semantic registry entries never
contain credentials.

## Load-Bearing Paths

- `src/ai-providers/preset-catalog.ts` — built-in providers and model records.
- `src/ai-providers/model-semantics.ts` — exact semantic resolution and runtime-neutral binding inputs.
- `src/ai-providers/presets.ts` — backend-to-UI preset serialization.
- `src/core/config.ts` — credential access and creation-time Workspace defaults.
- `src/workspaces/cli-adapter.ts` — mandatory Agent Session projection contract and persisted binding shape.
- `src/workspaces/session-runtime-binding.ts` — fresh binding creation and just-in-time resume resolution.
- `src/workspaces/credential-injection.ts` — credential + selection + semantics composition.
- `src/workspaces/adapters/index.ts` — built-in adapter registration.
- `src/workspaces/adapters/` — declared runtime compatibility, native projection, and round-trip parsing.
- `src/workspaces/adapters/owned-toml-config.ts` — reversible Codex project-scalar ownership.
- `src/workspaces/resume-registry.ts` — durable product Session identity and immutable runtime binding.
- `src/workspaces/schedule/scanner.ts` — Issue selection to fresh Session creation.
- `src/workspaces/headless-task-registry.ts` — per-turn execution provenance.
- `ui/src/components/credentials/` — credential/account setup.
- `ui/src/components/workspace/WorkspaceAIConfigModal.tsx` — per-Workspace selection and unknown-model overrides.

## Verification Invariants

Tests for this subsystem must cover:

- every built-in vendor default resolves to a registered model;
- exact ids and declared aliases resolve, while unknown ids remain unknown;
- omitted semantic fields do not become false during serialization;
- registered reasoning models reach Pi and opencode without a manual toggle;
- registered effort defaults round-trip through all four native runtimes;
- provider-only thinking switches never become fabricated effort values;
- non-reasoning and unknown models do not receive fabricated capabilities;
- model changes cannot retain a capability override for the previous id;
- a synthetic unknown adapter works from its capability declaration without a
  shared-layer id branch;
- adapter write/read/write round trips preserve semantic fields;
- reset removes only OpenAlice-owned configuration and restores prior values;
- credential secrets never appear in logs, docs, committed fixtures, or test snapshots;
- sensitive rollback sidecars remain excluded from git alongside native provider config.
- readiness probes never create or replace a Workspace provider binding;
- diagnostic readiness failures never block an ordinary native launch or resume;
- missing OpenAlice credentials never block a native-login-capable runtime;
- failed interactive resumes return a visible error and remain retryable.

## Registry Maintenance

Add a semantic fact only when provider documentation or a reproducible live
compatibility check supports it. Record the source beside the registry data.
If public surfaces disagree, omit that field and preserve the unknown state;
for example, GLM 5.2 reasoning is registered while its disputed context limit
is deliberately absent.

When a provider changes a model in place, update the registry and its unit
tests together. Existing Workspace files are not rewritten in the background;
the new facts apply on the next explicit provider apply or Workspace creation.
