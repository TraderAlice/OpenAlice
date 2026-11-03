# Update Lifecycle

This guide owns shared release identity and selection policy. Transport
discovery, installation, and project execution remain with their owners:
[[docs/remote-access.md]], [[docs/cli-installer.md]],
[[docs/managed-workspace-runtime.md]],
[[docs/workspace-template-upgrade.md]], and
[[docs/harness-web-surfaces.md]]. The pure planner and host adapters share
one operation contract.

## Product identity

Root `package.json#version` is the authored product version. Backend, CLI,
and Guardian use the shared Node identity reader (injected build value
first, else the known product manifest); it never searches cwd or
substitutes a private package's version. Desktop provenance belongs to the
app bytes even if the parent shell carries a CLI receipt; native CLI launch
clears inherited desktop mode and declares `cli-server`. Missing or invalid
receipts never fall back to source or stable provenance, and pinned/custom/
unknown ownership is preserved instead of normalized to stable. Release
preparation and candidate receipts import the same dependency-free release
policy source before installation; no generated policy copy is checked in.

## Shared release selection

`packages/update-lifecycle` is a pure TypeScript root (no React, fs, network,
or process imports); its separate `/node` export owns private atomic journals
and Guardian process-identity leases. Backend version discovery, CLI update
checks, the frontend update indicator, and the Dev Panel rehearsal all
consume it — there is no UI-local or per-surface comparator. Workspace
source-tag ordering and managed-template release precedence use the same
SemVer comparator.

- A release identifies channel + version (+ commit for dev); payload
  checksums supplement but never replace trust verification.
- Stable/beta use SemVer precedence (build metadata excluded); invalid or
  missing identity is unknown, not version zero or proof of being current.
- Dev commits are identities, not sortable versions: owners with artifact
  receipts compare payloads; otherwise commit equality.
- Normal discovery blocks a lower SemVer candidate; explicit
  `switch-channel` intent may select another channel's older head (it is not
  installation approval); same-channel downgrade is not an ordinary update.
- Selection reports available/current/blocked/unknown with a reason and does
  not prove protocol compatibility. `hasUpdate` is only a compatibility
  projection of a fresh `available` decision; blocked/failed observations
  cannot be presented as current. Native transport notifications do not
  authorize downloads — the shared policy accepts the candidate before
  electron-updater downloads, and installation rechecks the exact approved
  version before handoff.

`verifyReleaseEvidence` compares the approved target with an installed or
active receipt: a different newer version is a mismatch, missing evidence
stays unknown, and an adapter cannot drop required evidence to manufacture
success. Compare artifact hashes only for the same installation
unit/platform; installer provenance is not release identity. The desktop
journal additionally verifies renderer readiness and the required local
Alice version before completing integrated startup.

Publication uses the same policy: stable/beta intent moves forward; mirror
repair targets the exact active version. The serialized workflow records the
observed channel-head digest and re-validates the object store after
immutable uploads before writing any mutable feed, alias, or manifest.

## Shared discovery resource

`DiscoveryStore` (same pure package) owns read-only probe single-flight,
success/error TTLs, timestamps, subscriptions, and invalidation; adapters
supply the reader and TTL policy and retain feed parsing, transport
timeouts, and installation authority. A failed refresh preserves the last
successful observation separately from the new error; a failed `check()`
returns null, not cached data — commands cannot mistake stale data for
freshly verified approval. The backend owns one resource per release channel
(bounded two-entry inventory); the frontend provider uses one resource per
target/channel generation (switching away and back never revives old
responses; `useVersionDiscovery` is removed). The client version comes from
the compiled `CLI_VERSION`; `ClientUpdateService` owns it and each desktop
window owns one service shared by HTTP and preload IPC. Electron's engine
version is never a product version; source desktop discovery reports dev
with no native installation authority.

## Project commands and UI entry

`WorkspaceUpdateService.check()` is the status owner for the persisted
default Chat/Quant/Prediction Workspaces (non-default instances ignored;
Chat compares applied template baselines; AQ/AP observe stable upstream
releases even with auto-merge disabled). It never creates a source plan or
applies content. `applyPolicy()` is a separate serialized command that
re-reads policy, plans the exact observed target, re-checks policy, and
invokes the authoritative source manager with its digest. Failed discovery
retains the previous observation but cannot trigger an automatic apply;
failures identify check/review/apply stage; candidate visibility is never
permission to merge.

The sole public React hook is `useUpdateLifecycle`; its provider owns native
status subscription, the client install command, and Machine plan/progress
— there is no direct native-install IPC. The provider consumes
`/api/updates` observations for overview status (never generated plans; a
missing observation is unknown), and owns the review-plan cache keyed by the
exact target version: reopening a review reuses its plan; changed
observations or explicit checks invalidate affected reviews without
prefetching; discovery returning current removes the candidate rather than
erroring for lack of an upgrade plan. Each backend recovery generation owns
a fresh inventory (Workspace identity, template/source/harness layer, and
skill projection are separate keys; a retired response cannot restore an old
plan). Failed reads retain the last successful preview, disable application,
and keep the error on reopen. Existing backend digest, activity,
transaction, and exact-target checks remain approval authority; scoped
harness/skill plans never become whole-template evidence; source identity
includes its commit even when version labels match. Remote Machine review
shares its pending/settled plan and blocks approval synchronously while
refreshing.

Settings presents exactly three update objects (App, Backend, Alice
Project); only persisted defaults get automatic preview reads or contribute
to the project badge (counted once). Alice Project prepares one exact plan
automatically and compares owner proposals with preview digests before
enabling Update; coordinated journals own execution and recovery, with only
file conflicts handing off to the Workspace merge review. Project planning
reads only requested units.

## Remote owner and installation boundaries

Native SSH updates and the rehearsal share `planRuntimeUpdate` /
`transitionRuntimeOperation`: the planner separates installed, active, and
target identity, retains newer installations, and plans activation without
installation when bytes are present. The SSH adapter validates target-local
provenance, control compatibility, and owner identity. Approved target,
selected project home, original owner, and stage receipts are recorded in
`<remote-targets.json>.updates/` on the controlling client; the
process-identity lock serializes controllers per SSH profile. A new
controller probes actual state, preserves the recorded target, requires
fresh consent for remaining mutations, and performs only unfinished work; an
unrelated owner or changed installed target blocks recovery. Receipt writes
are atomic, private, credential-free. This is not a distributed fleet lock —
remote Guardian ownership and the installer transaction remain their own
authorities.

## Coordinated operations and recovery

`createUpdatePlan` builds a dependency graph from owner proposals and
declared capabilities (unknown capability and proven incompatibility stay
distinct; version ordering never invents a protocol prerequisite).
`approveUpdate` freezes scope, exact target, owner digest, and prerequisites
(review fingerprint is SHA-256 over canonical evidence). `UpdateCoordinator`
owns stage ordering, transitions, and reconciliation: it saves the in-flight
stage before each effect, reconciles lost outcomes with owner receipts, and
never blindly replays unknown outcomes. `FileUpdateJournal` serializes each
host scope using the Guardian lock; explicitly ending a plan archives its
coordination record without rolling back files.

The local `UpdateControlService` composes backend, project, and native
owners (relay HTTP and Electron IPC expose review/approve/status/resume/
abandon). The local receipt survives restarts; switching Machine or
AliceProject blocks pending project effects and resuming never retargets
them; authenticated project commands use the current target session in
memory only (cookie namespaces prevent cross-target reuse); a newer
publication cannot replace an approved artifact. Recovery selection: an
unfinished native receipt takes precedence over completed coordinated
history; native children record the exact parent operation ID (matching
versions alone do not establish parentage); unrelated unfinished receipts
prevent new approval or native activation from replacing them.

`WorkspaceUpdateService.coordinator` owns project inventory (managed
templates, source tags, injected Skills, optional Broker Packs with separate
installed/active/desired evidence); approval re-reads authoritative owner
plans, never the discovery cache. Template/source/Skills engines keep their
existing leases, digests, Git baselines, conflict review, and rollback
transactions; the coordinator cannot accept or resolve file conflicts
itself. Broker Pack receipts separate installation, UTA activation, and
actual module loading — reading a newer pointer cannot pretend a cached old
module was reloaded; the read-only probe creates no broker account or
trading connection; disabled UTA leaves activation pending without blocking
Chat. The rehearsal uses the same coordinator with an in-memory journal;
production and rehearsal event traces are compared for identical activation
evidence.

## Overview surface and local client policy

Settings Overview separates App, Backend, and AliceProject cards (project
content shows individual Workspace versions, never an invented aggregate).
One guidance path projects the same available target set (avatar indicator,
Settings menu, Overview navigation, owner card, Workspace row); work blocked
only by an active runtime stays waiting rather than raising an actionable
count. `ClientUpdateService`'s `client-updates.json` belongs to the local
supervisor root or Electron userData — never the selected AliceProject;
construction/status reads start no network work (GUI schedules it after
paint); `/relay/v1/updates` and the narrow Electron bridge expose the same
snapshot/commands. The shipped project field `autoCheckApp` remains the
backend automatic-check preference. Remote progress uses stages without a
fabricated percentage; cross-app-restart multi-target continuation is still
pending and the UI says so.

## Acceptance scope

Local acceptance covers the hermetic suite and critical gate, owner
typechecks, real browser Relay review/apply/reload with a disposable Chat
Git transaction, unsigned macOS ARM64 packaged integrated readiness and
Workspace acceptance plus separated startup/connection, Guardian takeover,
clean installer Docker, and real disposable SSH beta→stable
activation/reconnect recovery. The packaged handoff fixture proves receipt
recovery in a new real app process; it does not replace a signed native
installer. Signing, notarization, Windows native replacement, and public
feed publication retain the release lane gates in
[[docs/development-workflow.md]]. No live trading state is used.
