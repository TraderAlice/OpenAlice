# Update Lifecycle

This guide owns shared release identity and selection policy. Transport discovery,
installation and project execution remain with their owners: [[docs/remote-access.md]],
[[docs/cli-installer.md]], [[docs/managed-workspace-runtime.md]],
[[docs/workspace-template-upgrade.md]] and [[docs/harness-web-surfaces.md]].
The pure planner and host adapters share one operation contract described below.

## Product identity

Root `package.json#version` is the authored product version. Backend, CLI and
Guardian use the shared Node identity reader: an injected build value takes
precedence, otherwise the known product manifest supplies source identity.
The reader never searches cwd or substitutes a private package's version.
The CLI workspace is private and has no authored product version. Existing
native/npm assembly generates distribution metadata from the root identity.

The desktop relay bundles this reader with the existing build-version injection;
leaving it external would make an installed package search for a source manifest.
The launcher declares its actual desktop mode before initializing readers. Desktop
provenance belongs to those app bytes, even if its parent shell carries a CLI receipt.
Native CLI launch clears inherited desktop mode and declares `cli-server` after
composing the child environment. Its existing installed receipt supplies the channel;
a raw binary without that receipt has no installed-update authority. Missing explicit
receipts and invalid receipts never fall back to source or stable provenance.

TUI, remote planning and backend adapters consume the shared provenance parser.
Source execution stays development; pinned/custom/unknown ownership is preserved
instead of being normalized to stable. Remote planning requires its caller's resolved
identity; no exported default provenance object can bypass that read.

Release preparation and candidate receipts import the same dependency-free
release policy source before installation; runtime consumers use the package's
built entry. Trusted-base workflow classification copies both the classifier and
that policy from the base revision. No generated policy copy is checked in.

## Shared release selection

`packages/update-lifecycle` exposes a pure TypeScript root with no React, filesystem,
network or process imports. Its separate `/node` export owns private atomic journals
and Guardian process-identity leases. Production backend version discovery, CLI update
checks, the frontend update indicator and the Dev Panel rehearsal consume it.
There is no UI-local discovery comparator or server/CLI comparator re-export.
Workspace source-tag ordering also uses the shared SemVer comparator. Qualified
`snapshot-*` catalog entries are opaque exact selections: they remain selectable
but cannot be ordered as release zero or auto-upgraded without a comparable
baseline. Managed-template release precedence uses the same shared ordering inside its
existing transaction owner; Skill content projection uses file fingerprints.

- A release identifies a channel and version, with a commit for development builds.
  An owner with same-platform payload evidence can additionally supply its artifact
  checksum. Release selection does not replace checksum/trust verification.
- `selectRelease` receives the accepted head of the requested feed. The adapter
  validates that feed's source and payload before invoking selection.
- Stable and beta use SemVer precedence; build metadata is not precedence.
  Invalid or missing identity is unknown, not version zero or proof of being current.
- Dev commits are identities, not sortable versions. Owners with artifact receipts
  compare payloads, including rebuilt commits; otherwise commit equality is used.
- Normal discovery blocks a lower SemVer candidate. Explicit `switch-channel`
  intent can select a different channel's older head; it is not installation
  approval. Same-channel downgrade is not an ordinary update.
- Selection says whether a candidate is available, current, blocked or unknown,
  with a reason. It does not prove client/backend protocol compatibility.

Backend HTTP, CLI, relay and native desktop adapters retain the selection status
and reason. The backend's shipped `hasUpdate` field is only a compatibility
projection of a fresh `available` decision. Missing decisions are unknown;
blocked and failed observations cannot be presented as current. Native transport
notifications do not authorize downloads: the shared policy accepts the candidate
before electron-updater downloads it. Installation rechecks the exact approved
version before handoff. Electron still owns payload validation and activation.
Native IPC and renderer consumers share one status type.

The Node CLI consumes the package's built ESM, while repository tests resolve its
source. Workspace dependencies and the build graph must build it before CLI/UI
consumers. Shared identity and selection tests live beside the package; network,
installer and native-update tests stay with their effect owners.

Release publication uses the same policy in the existing asset preparation
script. Stable/beta release intent must move forward; mirror repair targets the
exact active version. The publication workflow is serialized and records the
observed channel-head digest. After immutable uploads, it re-reads the object
store and validates both that digest and eligibility before writing any mutable
native feed, installer alias or manifest. A changed observation requires a fresh
run. Dev publication remains commit/payload-based in its existing owner.

## Exact activation evidence

`verifyReleaseEvidence` compares the approved target with an installed or active
receipt. A different newer version is a mismatch, not success. Missing/invalid
versions, full commits or payload hashes remain unknown; an adapter cannot drop
required target evidence to manufacture success. Build metadata is identity here,
not SemVer precedence. Compare artifact hashes only for the same installation
unit/platform. Installer provenance is not release identity.

Electron's existing restart marker and rehearsal activation verification consume
this rule. The native marker currently supplies version evidence only; native
payload validation remains with electron-updater. The desktop journal additionally verifies renderer readiness and the required local
Alice version before completing integrated startup. Separated startup verifies
the local shell; the remote owner independently proves backend readiness.

## Shared discovery resource

`DiscoveryStore` in the same pure package owns read-only probe single-flight,
success/error TTLs, timestamps, subscriptions and invalidation. Adapters supply
the reader and TTL policy; they retain feed parsing, transport timeouts and
installation authority. Forced checks bypass settled cache entries but join an
already-running probe. TTL begins when the probe finishes.

A failed refresh preserves the last successful observation and its timestamp,
and records the new error/check time separately. A failed `check()` returns null,
not the cached observation: commands cannot mistake stale data for freshly
verified approval. This store neither authorizes nor executes an installation.

The backend owns one resource per supported release channel (a bounded two-entry
inventory). The frontend provider and rehearsal use the internal React snapshot
binding with one resource per current target/channel generation. Switching away
and back does not revive old responses or callbacks. React no longer implements
its own discovery request state machine; `useVersionDiscovery` is removed.
Project status and preference responses are also fenced by connection generation.
Native client status is independent of the selected backend.

The client version enters through the existing compiled `CLI_VERSION` product
version. `ClientUpdateService` owns that value; discovery adapters report release
observations, not replacement current identities. Electron uses the same value
for native discovery, journals, restart verification and integrated readiness.
Electron's engine version is never a product version. Source desktop discovery
reports the dev channel and has no native installation authority.

Each desktop window owns one client update service. Both relay creation paths
receive that instance, so HTTP and preload IPC share policy, observation, timer
and version. Demo also uses the service with an unsupported discovery adapter.
The overview does not substitute the renderer bundle version when client status
is unavailable. Existing startup acceptance compares the actual IPC/HTTP
identity and policy; integrated PTY acceptance also compares the backend version
with the product package, without mocking Electron's version API.

## Project commands and UI entry

`WorkspaceUpdateService.check()` is the status owner for the persisted default
Chat, Quant and Prediction Workspaces. It reads the three existing default
preferences and ignores non-default instances. Chat compares its applied template
baseline with the available template using shared version ordering; AQ/AP observe
stable upstream releases even when automatic merging is disabled. It never creates a source plan or applies
content. `applyPolicy()` is a separate serialized command: it re-reads policy,
plans the exact observed target, checks policy again after planning, and invokes
the authoritative source manager with its digest. Activation, the background
timer and a saved policy change explicitly call `refreshAndApplyPolicy()`.
`POST /api/updates/check` only checks; saving preferences no longer depends on a
browser follow-up request to start approved automatic work. Failed discovery
retains the previous observation but cannot trigger an automatic apply. Failures
identify check, review or apply stage. Automatic execution rechecks both policy
and default selection before applying; Chat remains explicitly reviewed. AQ/AP
manual source review exposes the same stable upstream candidates regardless of
auto-apply policy; candidate visibility is not permission to merge.

The sole public React hook is `useUpdateLifecycle`. Its provider owns the
native status subscription, client install command and Machine plan/progress
state. App-only and coordinated installation both enter the existing control
service through review, approve and resume. There is no direct native-install
IPC or preload method. Settings, desktop prompt and Machine controls subscribe
to it; there is
no `useMachineManagement` or nullable companion lifecycle hook. Shared chrome
can request the same hook's optional preview mode. Connection/fleet CRUD still
belongs to the connection owner. Source repository discovery also uses the
shared cache primitive rather than an independent promise/expiry implementation.

### Shared review plans

The provider consumes `/api/updates` observations for overview status and global
guidance. It never generates plans to discover whether updates exist, and neither
cached previews nor the Workspace list's legacy hints override those observations.
A missing observation is unknown, not proof of being current. Older remote
Runtimes that omit Chat discovery show unknown until their backend is updated.

The provider also owns the separate review-plan cache. Opening a project review
requests plans only for observed candidates, keyed by the exact target version.
Source previews request that exact version; template previews must match it.
Reopening a review reuses its plan. A changed observation or explicit check
invalidates affected reviews without prefetching them; mounted review consumers
reload when needed. Discovery returning current removes the candidate and cannot
become an error merely because there is no upgrade plan. The source plan command
retains `no_update` for explicit requests without a candidate; the overview never
uses that command as discovery. Demo preserves this real API behavior instead of
manufacturing a current source plan.

Each backend recovery generation owns a fresh inventory. Workspace identity,
template versus source versus Alice Harness layer, and skill/action projection
form separate keys. A changed template baseline, source receipt or candidate,
removal, successful apply, and backend retirement invalidate affected entries.
An already-open review observes invalidation. A retired response cannot restore
an old plan, including when switching away and back. Relay target switches
already reload the renderer; no module-global plan survives that boundary.

Failed reads retain the last successful preview alongside the error and disable
application. Reopening retains the error instead of silently retrying. A
backend apply rejection containing a revised plan replaces the shared digest;
template conflict choices reset when that digest or scope changes. Existing
backend digest, activity, transaction and exact-target checks remain approval
authority. Scoped Alice Harness/skill plans do not become whole-template update
evidence. Source identity includes its commit even when version labels match.

Remote Machine review likewise shares its pending or settled target/project
plan. Automatic discovery and explicit retries refresh it; closing the overview
review keeps it. Refreshing or failed discovery blocks approval synchronously,
even before React commits the new loading state. The native owner still enforces
plan expiry and single use. A fresh review also retries operation-status reads.

Settings presents exactly three update objects: App, Backend and Alice Project.
Project content stays in a collapsed disclosure: Chat, Quant and Prediction each
resolve only their persisted default Workspace (Chat's recent/default pointer,
and the Quant/Prediction preference IDs). Missing defaults remain unconfigured;
there is no name or activity fallback. Only these defaults get automatic preview
reads or contribute to the project badge, which counts once regardless of how
many default contents can update. The general Workspace registry remains owned
by the app shell, but Settings no longer requests a project-wide update inventory.

Each object's View update opens its actionable review directly. Alice Project
prepares one exact project plan automatically, with no checkboxes or chooser.
It compares the owner proposals with the displayed preview digests and targets
before enabling Update Alice Project. Existing coordinated journals own execution
and recovery; only file conflicts hand off to the Workspace merge review. Project
planning reads only requested units, without probing unrelated Workspaces or
Broker Packs. Failed or retired previews cannot authorize application. Dialogs,
buttons and project disclosures use shared primitives, including keyboard/focus,
reduced-motion and narrow-screen behavior.

## Remote owner and installation boundaries

Native SSH Runtime updates and rehearsal release stages now use the same
`planRuntimeUpdate` and `transitionRuntimeOperation` contract. The planner
separates installed, active and target identity, retains newer installations,
and plans activation without installation when bytes are already present.
The SSH adapter validates target-local provenance, control compatibility and
owner identity; the rehearsal supplies explicit fixture evidence. Its publication,
client restart presentation and Workspace-content scenarios remain adapters,
not production compatibility evidence.

Native remote execution records its approved target, selected project home,
original owner and stage receipts in `<remote-targets.json>.updates/` on the
controlling client. The existing process-identity lock serializes controllers on
that client per SSH profile. A new controller probes actual state, preserves the
recorded target, requires fresh plan consent for remaining mutations, and only
performs unfinished installation/activation/reconnect work. An unrelated owner
or changed installed target blocks recovery. Remote Guardian ownership and the
installer transaction remain their own authorities; this is not a distributed
fleet lock. Receipt writes are atomic, private, and contain no credentials.
The version-1 journal is new state, not a migration of an existing shipped shape.

## Coordinated operations and recovery

`createUpdatePlan` builds a dependency graph from owner proposals and declared
capabilities. Unknown capability and proven incompatibility remain distinct.
Version ordering never invents a protocol prerequisite. `approveUpdate` freezes
installation/project scope, exact target, owner digest and prerequisites. The
review fingerprint is SHA-256 over canonical evidence, so nested child plans do
not expand fingerprints into oversized approval requests.

`UpdateCoordinator` owns stage ordering, transitions, reconciliation and event
traces. It saves the in-flight stage before each effect. Lost outcomes are
reconciled with owner receipts; unknown outcomes cannot be blindly replayed.
`FileUpdateJournal` serializes each host scope using the existing Guardian lock,
validates its saved graph, and writes private atomic receipts. Explicitly ending
a plan archives its coordination record; it does not roll back files. Native
child receipts linked to that parent are archived with it; unrelated and remote
owner receipts remain intact. These journals are new state, not a migration of a shipped
persisted format.

The local `UpdateControlService` composes backend, project and native owners.
Relay HTTP and Electron IPC expose review, approve, status, resume and abandon.
The local receipt survives browser/relay/desktop restart independently of the
backend. Switching Machine or AliceProject blocks pending project effects;
resuming never retargets them. Authenticated project commands use the current
target session in memory only; after a host restart, the browser must supply
its authenticated session again. Cookie namespaces prevent cross-target reuse.
A newer publication cannot replace an approved
artifact. The native updater retains signature/download/handoff ownership.

The same local control service selects recovery for status, resume and abandon.
An unfinished native receipt takes precedence over completed coordinated history.
A native child records the exact parent operation ID in its existing proposal
reference; matching versions alone do not establish parentage. Linked native
recovery runs before parent reconciliation. Unrelated unfinished receipts remain
independent and prevent a new approval or native activation from replacing them.
Startup uses this same selector. Recovery observes exact activation and readiness;
it does not repeat an uncertain installer handoff.

`WorkspaceUpdateService.coordinator` owns project inventory and child operations.
Inventory includes managed templates, independent source tags, injected Alice
Skills and optional Broker Packs with separate installed/active/desired evidence.
Checks are bounded and cached; forced checks refresh settled caches. Failed
refreshes preserve the old inventory and expose error/check/success timestamps.
Approval re-reads authoritative owner plans, never trusts the discovery cache.

Template, source and Skills engines preserve their existing activity leases,
review digests, Git baselines, conflict review and rollback transactions. Their
manual, automatic and coordinated paths all emit common apply receipts inside
those owner guards. Exact Git commit trailers recover a lost completion response.
The coordinator cannot accept or resolve file conflicts itself.

Broker Packs keep checksum/ABI/pointer protections. Their receipt separates
installation, UTA activation and actual module loading. UTA records the identity
when loading a module; reading a newer active pointer cannot pretend a cached old
module was reloaded. The read-only module probe creates no broker account or
trading connection. Disabled UTA leaves activation pending without blocking Chat.

The rehearsal uses the same `UpdateCoordinator` with an in-memory journal,
virtual timestamps and fake owner effects. Single-stage stepping is presentation,
not a separate transition engine. Production and rehearsal event traces are
compared for identical activation evidence; release publication remains a fixture.
CLI passive notices also enter scoped shared discovery. External package managers,
source checkouts, agent CLIs and Docker keep their own installation authority.

## Acceptance scope

Local acceptance covers the hermetic suite and critical gate, owner typechecks,
real browser Relay review/apply/reload with a disposable Chat Git transaction,
unsigned macOS ARM64 packaged integrated readiness/Workspace acceptance and
separated startup/connection, Guardian takeover, clean installer Docker, and
real disposable SSH `0.94.1-beta.2 -> 0.94.1` activation/reconnect recovery.
The packaged handoff fixture proves receipt recovery in a new real app process;
it does not replace a signed native installer. Signing, notarization, Windows
native replacement and public feed publication retain the release lane gates in
[[docs/development-workflow.md]]. No live trading state is used.

## Overview surface and local client policy

Settings Overview separates App, Backend and AliceProject cards. Project content
has individual Workspace versions, not an invented aggregate project version.
The shared `useUpdateLifecycle` observation also projects one guidance path:
avatar indicator, Settings menu, Overview navigation, owner card and exact
Workspace row all use the same available target set. Automatic AQ/AP work
blocked only by an active runtime stays on its row as waiting, without raising
an actionable blue count; manual blockers and failed target updates use a
separate needs-attention count. The Overview summary links directly to each
target while ordinary `/settings` navigation retains its own scroll position.
The old About component and duplicate status summary are retired. Details and
update scope selection share one dialog; actual commands retain the authoritative
native, Machine and Workspace merge approvals. The current UI explains that
cross-app-restart multi-target continuation is still pending rather than promising
it. Unknown installed identity is shown as unreported; read failures do not imply
that the running service is unhealthy. Remote progress uses stages without a
fabricated percentage.

`ClientUpdateService` provides local relay/Electron discovery and preferences.
Its `client-updates.json` belongs to the local supervisor root or Electron userData,
never the selected AliceProject. Construction/status reads do not start network
work; GUI activation schedules it after paint. Discovery is single-flight and
retains the last observation after failure. `/relay/v1/updates` and the narrow
Electron bridge expose the same snapshot/commands. The old native check IPC is
removed. The shipped project field `autoCheckApp` remains the backend automatic
check preference; it is not migrated into a local client preference. Terminal
passive notices and the full execution coordinator still need consolidation.
