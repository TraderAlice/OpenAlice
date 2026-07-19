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

Connection probes verify that a key, endpoint, wire shape, and model can answer.
They do not prove the complete capability set. Error-guided retries (for
example, a model that mandates thinking) are useful diagnostics but do not
replace the curated registry.

The UI must disclose configuration ownership instead of presenting every
resolved launch value as if it were already on disk. A launch surface
distinguishes a Workspace-local binding from a credential that will be written
only when the next session starts. Creation defaults are also explicitly
creation-time policy: changing one never rewrites an existing Workspace.
This disclosure applies to all four supported Agent runtimes. Claude Code and
Codex use their native global login and global runtime configuration by default.
Merely storing a compatible credential in Alice never selects or injects it;
only an explicit Workspace binding or explicit new-Workspace creation default
overrides the native fallback. When a Workspace-local override exists its real
model must be shown instead of a generic “runtime managed” label. Their native
project files do not declare a context limit, so the UI omits that field rather
than borrowing the Pi/opencode injection default.

Headless provider readiness does not prove that an interactive TUI can consume
its first queued prompt immediately. A native runtime may still own global
onboarding or per-project trust gates. OpenAlice may expose those gates as
read-only, best-effort launch guidance, but it must not mark private global
state complete or accept trust on the user's behalf. Unknown native state is
advisory and fail-open; it never becomes a fabricated ready/not-ready fact.

The test-before-save gate follows the same boundary as the probe. Changes to
the key, endpoint, wire shape, authentication mode, or model require a fresh
probe. Context-window, reasoning capability, and reasoning effort are local
runtime registration fields; changing only those fields saves directly without
making an unrelated provider request. Both automatic creation-default saves
and explicit Workspace saves must acknowledge completion in the UI.

## Configuration Ownership and Reset

Agent configuration files may also contain user- or runtime-owned settings.
Injectors must update only OpenAlice-owned keys/nodes, preserve unknown data,
and restore the prior value on reset where a shared scalar is overridden.

Pi uses a namespaced global provider plus project binding/rollback state.
Claude Code and opencode use the same lifecycle rule with
`.claude/openalice-provider.json` and `.opencode/openalice-provider.json`:
the first write snapshots only the nodes OpenAlice will replace, later writes
retain that original snapshot, and reset restores a node only if it still equals
the last injected value. A user edit or whole-file deletion made after injection
wins. Codex is the
exception because its Workspace `.codex/` is an intentionally exclusive
`CODEX_HOME`, not a shared project-config layer.

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
- `src/workspaces/credential-injection.ts` — credential + selection + semantics composition.
- `src/workspaces/adapters/` — native runtime projection and round-trip parsing.
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
- adapter write/read/write round trips preserve semantic fields;
- reset removes only OpenAlice-owned configuration and restores prior values;
- credential secrets never appear in logs, docs, committed fixtures, or test snapshots;
- sensitive rollback sidecars remain excluded from git alongside native provider config.

## Registry Maintenance

Add a semantic fact only when provider documentation or a reproducible live
compatibility check supports it. Record the source beside the registry data.
If public surfaces disagree, omit that field and preserve the unknown state;
for example, GLM 5.2 reasoning is registered while its disputed context limit
is deliberately absent.

When a provider changes a model in place, update the registry and its unit
tests together. Existing Workspace files are not rewritten in the background;
the new facts apply on the next explicit provider apply or Workspace creation.
