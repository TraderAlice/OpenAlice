# Alice Harness, Model Semantics, and Managed Web Surfaces

This guide owns everything OpenAlice injects into or supervises around a
Workspace: the three-layer AI credential/model/adapter projection, always-loaded
instructions and CLI shims, versioned Alice Harness Skills, Sticker Packs, and
managed Harness Studio web surfaces (AutoQuant and Auto Prediction).

---

## 1. Model Semantics and Runtime Injection

OpenAlice does not run an in-process model loop. Native coding-agent CLIs own
inference, transcripts, login, and native configuration. Runtime injection
crosses three strict layers:

```text
Credential access (Vault account/vendor + auth + wire-to-endpoint map)
  ↓
Model selection & semantics (exact model ID + limits/reasoning + unknown-model overrides)
  ↓
Per-process adapter projection (CliAdapter.sessionRuntime.project → child argv/env)
```

- **Credential access & catalogs**: `CredentialAIProvider` projects Vault records
  and caches read-only discovery snapshots under
  `<OPENALICE_HOME>/data/model-catalog/providers/` without storing keys or raw
  responses. `NativeAIProvider` runs bounded runtime-owned discovery without
  reading tokens or creating Vault records. Catalog membership is advisory,
  never a launch gate.
- **Model semantics (`src/ai-providers/model-semantics.ts`)**: Offline resolution
  of limits and reasoning (`none`, `optional`, `adaptive`, `required`), effort
  tiers, and thinking switches. Unknown free-typed model IDs remain valid;
  unknown-model overrides bind to one exact model ID.
- **Adapter projection (`src/workspaces/cli-adapter.ts`)**: Every
  provider-capable adapter implements `sessionRuntime.project(...)` and declares
  `capabilities.aiProvider`. Secrets resolve just in time into the child
  environment and never appear in argv or Workspace files. Omitted effort stays
  omitted.
- **Workspace preferences & frozen Session bindings**: `.alice/settings.json`
  stores secret-free `interactive` and `headless` creation defaults (fixed vs
  recent Agent + credential slug/model/effort tuple). At Session birth, the
  resolved `SessionRuntimeBinding` freezes into `.alice/sessions/<resumeId>.json`
  (or `workspaces/state/workspace-manager-sessions/` for Workspace Manager) and
  replays across every surface; later Workspace preference changes never mutate
  an existing Session's binding.
- **Native auth & permissions**: Absence of a managed credential defaults to
  native runtime auth (never picking an arbitrary Vault key). Alice-managed
  Sessions configure full host access and automatic tool approval through
  process-local adapter flags on both fresh launch and resume, never by
  rewriting global user config.

---

## 2. Workspace Agent Guidance and Live CLI Shims

Guidance is organized into three layers so always-loaded prompts stay compact:

1. **Always-loaded contract (`CLAUDE.md` & `AGENTS.md`)**: Copied from
   `src/workspaces/templates/<template>/files/instruction.md` at Workspace
   creation. Holds durable behavioral rules and Skill routing only.
2. **Discoverable Skills (`default/skills/*/SKILL.md`)**: Projected into
   `.agents/skills/` (primary) and `.claude/skills/` (mirror):
   - `alice`: Inbox, Issues, provenance, peers, Session nametags
   - `file-delivery`: Connector reply attachments
   - `delegate-autoquant`: Chat → AutoQuant delegation
   - `self-scheduling`: Issue frontmatter, schedules, headless delivery
   - `traderhub`: Low-frequency market/fundamental/macro data
   - `market-data`: K-line discovery, OHLCV, chart references
   - `alice-analysis`: Quantitative formulas and technical snapshots
   - `alice-uta`: Broker reads and trading writes/approvals
3. **Live CLI authority (`alice`, `traderhub`, `alice-uta`)**: The live CLI
   manifest and tool gateway own exact command syntax and validation;
   `alice-workspace` is a legacy alias only. Adapters must preserve Alice's
   composed `PATH` across login shells so global binaries never shadow Workspace
   shims.

---

## 3. Alice Harness Skill Distribution and Preferences

`default/alice-harness.json` and `ALICE_HARNESS_SKILLS`
(`src/workspaces/alice-harness-policy.ts`) version Project-owned Skill trees
independently of Workspace templates.

- **State & preferences**: `.alice/alice-harness-version.json` records accepted
  bundle and per-Skill revisions (local bookkeeping, git-excluded).
  `.alice/alice-harness-config.json` is tracked Workspace config controlling CLI
  enablement (disabled tools return `403`; malformed config fails closed) and
  independent per-Skill inclusion booleans (`self-scheduling` is always
  included).
- **Scoped and bundle updates**: Settings → Workspace injection and
  `alice harness upgrade [--apply] [--skill <name> --action install|update|remove|restore]`
  use the shared three-way managed-file transaction engine, checkout lease, and
  preview digest verification.

---

## 4. Sticker Packs (`default/stickers/`)

AliceProjects supply optional Sticker Pack prototypes (`Alice Color`, `Alice Ink`,
plus custom imports under `data/stickers/packs/<id>/` capped at 512 KiB/image,
100 images, 32 MiB total).

- Enabled by default for new Chat Workspaces only (excluded from ordinary
  Harness/template updates). Projects selected images to flat
  `sticker/<name>.png|.webp` paths and generates
  `.agents/skills/alice-stickers/SKILL.md` (plus `.claude/skills/` mirror),
  tracked in `.alice/stickers.json` with rollback journals at
  `.alice/sticker-transaction.json`.
- **Ownership & safety**: Projection rejects symlinked `sticker/` or Skill paths
  and conflicting unmanaged filenames, never deletes personal files or
  intervening user edits, and leaves modified managed files in place until an
  explicit `restore` action.
- Connector resolves `[[sticker/wave.png]]` through the generic Workspace file
  boundary to send native stickers.

---

## 5. Managed Harness Web Surfaces (Studio)

OpenAlice supervises Harness-owned web applications (AutoQuant Studio and Auto
Prediction Studio) declared via root `harness.json` (`manifestVersion: 1`,
`capabilities.studio: { command, ports, entryPort, readinessPath }`):

- **Ownership & teardown boundary**: The Harness repository owns its own
  business state, APIs, and dependencies; OpenAlice never reproduces Harness
  business routes/state and Studio launch never runs dependency installers.
  Stopping or replacing a generation removes its route before termination and
  kills the full descendant process group even if a wrapper script already
  exited.
- **Managed launch**: OpenAlice allocates loopback ports, injects
  `HARNESS_CAPABILITY=studio`, `HARNESS_HOST=127.0.0.1`, `HARNESS_PORTS`, and
  `HARNESS_NO_OPEN=1`, supervises one foreground process tree per Workspace
  generation, and waits for HTTP 2xx on `readinessPath`.
- **Opaque routing & security**: A ready generation receives
  `oa-surface-<opaque>.localhost` (no arbitrary `/proxy/<port>` route). Browser,
  `pnpm dev` Web relay, and SSH tunnels route by `Host` header; Electron uses an
  ephemeral loopback-only Surface Gateway exposing Harness routes only. The
  proxy strips OpenAlice auth/cookie/CSRF headers.
- **Source-backed Harness upgrades (`src/workspaces/harness-source-upgrade.ts`)**:
  Source-pinned templates record their commit in tracked
  `.alice/harness-source.json`. Preview fetches the target commit, validates
  `harness.json`, and checks Git mergeability; apply requires idle Sessions/Studio,
  a clean working tree for touched paths, and creates a no-fast-forward Git merge
  commit under the shared checkout lease.

---

## 6. Load-Bearing Paths and Verification

- `src/ai-providers/{preset-catalog,model-semantics,presets,provider,model-catalog}.ts`
  — provider presets, model semantics, and catalog caching.
- `src/workspaces/{cli-adapter,session-runtime-binding,workspace-runtime-settings,session-runtime-store,credential-injection}.ts`
  & `src/workspaces/adapters/` — binding resolution and process projection.
- `src/workspaces/{context-injector,alice-harness-policy,template-upgrade}.ts` —
  prompt/Skill/sticker injection and three-way updates.
- `src/workspaces/{harness-manifest,harness-surface-manager,harness-source-upgrade}.ts`
  & `src/webui/harness-surface-proxy.ts` — Studio supervision, proxy routing,
  and source merges.

Verify changes with owning root/UI typechecks, adapter/binding/harness unit and
integration suites, and a real Workspace CLI/Studio execution check (`command -v alice`
in headless shell plus real adapter launch/resume).
