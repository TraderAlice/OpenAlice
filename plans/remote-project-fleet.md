# Remote Machine Fleet and AliceProject Transfer

Status: Active

Delivery mode: Serial / interactive. The maintainer selected the Machine →
AliceProject Supervisor model and requested goal-driven implementation on
2026-08-23. Each increment starts from current `dev`, receives proportional
local and isolated SSH/package verification, lands through one focused PR to
`dev`, and returns to updated `dev` before the next increment. A completed CI
failure from the previous increment blocks publication of the next one.

Goal: `01a02cd8-6ac4-7a72-b0c3-071c830dd1df`

Owner guides:

- [[docs/cli-supervisor.md]]
- [[docs/remote-access.md]]
- [[docs/alice-project.md]]
- [[docs/data-locations.md]]
- [[docs/workspace-lifecycle.md]]
- [[docs/conversation-provenance.md]]
- [[docs/managed-workspace-runtime.md]]
- [[docs/development-workflow.md]]

Related active plan:

- [[plans/shell-first-cli-supervisor.md]] owns the base local Supervisor,
  lifecycle core, installer-managed Runtime, update model, and terminal
  acceptance. This plan owns the new machine fleet, remote AliceProject
  inventory, transfer transaction, and the TUI flows built on those services.
- [[plans/bun-cli-distribution.md]] owns the Railway native host profile,
  release authority, and hosted deployment acceptance. This plan continues to
  own the AliceProject content/credential transaction used against that host.

## Objective

Make the Shell Supervisor a safe control plane for a small fleet of OpenAlice
machines:

- show the local computer and explicitly registered SSH machines;
- inspect the AliceProjects registered on each reachable machine without
  scanning arbitrary remote directories;
- distinguish machine reachability, tunnel attachment, and per-project Runtime
  state instead of collapsing them into one ambiguous “connected” state;
- connect to or open a selected remote AliceProject through the existing SSH
  loopback transport;
- copy a local AliceProject's portable configuration and Workspace estate to a
  new remote complete home through a reviewable, resumable transaction;
- deliberately exclude native Agent conversations and OpenAlice Session
  continuation state, so the remote AliceProject starts with zero resumable
  Sessions while retaining its Workspace repositories and Workspace ids.

The first transfer direction is local AliceProject → registered SSH machine.
The transport and manifest should not prevent a later remote → local or
remote → remote orchestrator, but those directions are not acceptance criteria
for this plan.

## Product Model

The Supervisor selection becomes a tuple rather than one local project key:

```text
Machine -> AliceProject -> Runtime / connection / transfer actions
```

Machine state and project state remain separate:

| Fact | Meaning |
|---|---|
| Registered | A non-secret SSH target exists in the local Supervisor registry. |
| Online | A bounded, recent SSH probe completed successfully. |
| Auth required | OpenSSH reached the host but could not authenticate non-interactively or needs user interaction. |
| Offline | The last bounded probe failed at transport or name resolution. |
| Tunnel active | This Supervisor process owns a loopback tunnel to one remote AliceProject. |
| Runtime running/stopped/etc. | The selected AliceProject's Guardian/Server state reported by that machine. |

Closing the TUI closes tunnels owned by that TUI process but never stops a
detached local or remote Runtime. Reconnection prefers the remembered local
port already owned by the managed-remote contract.

## Chosen TUI Interaction

At ordinary width, the root fleet screen uses a two-pane hierarchy:

```text
Machines                  AliceProjects · cloud-dev
----------------------    -------------------------------------
* This Mac           2    * default     Running    Trader
* cloud-dev          3      research    Stopped    Nano
  gpu-box      Offline      paper       Stopped    Trader
```

- Tab or horizontal arrows switch pane ownership.
- Vertical arrows select within the active pane.
- Enter opens/connects the selected running project, or presents the safe
  primary action for a stopped project.
- `m` starts transfer from the selected local AliceProject to a remote machine.
- `a` registers a machine; removal is a separate confirmed action and never
  deletes remote state.
- `r` refreshes the selected machine; a bounded background refresh may update
  stale rows without blocking local lifecycle actions.
- Project detail retains Doctor, logs, start, stop, restart, Setup, and update
  actions when the selected machine/project supports them.
- Narrow terminals use drill-down screens (Machines → AliceProjects → Detail)
  rather than compressing two unusable columns.
- The minimum 80×24 route always keeps the selected entity, primary action,
  notice/error, and detach instruction visible. Long lists and detail panels
  scroll inside a fixed body rather than pushing the footer off-screen.

The TUI is a presenter over typed services. It does not parse human command
output, implement SSH quoting, walk homes, construct archives, decrypt secrets,
or decide transfer policy inside render/input components.

## Machine Registry

Add a versioned machine registry beneath the machine-wide Supervisor root,
outside every selectable AliceProject complete home. The initial shape is new
and therefore has no released migration boundary:

```json
{
  "schemaVersion": 1,
  "defaultMachine": "local",
  "machines": {
    "cloud-dev": {
      "displayName": "Cloud Dev",
      "sshTarget": "alice@cloud-dev",
      "sshPort": 22,
      "identityFile": "/Users/alice/.ssh/cloud-dev"
    }
  }
}
```

Rules:

- `local` is implicit and cannot be overwritten or removed.
- Machine keys use the same short lowercase selector discipline as
  AliceProject keys.
- The registry may store a target, port, display name, and local identity-file
  path. It never stores passwords, passphrases, private-key bytes, SSH agent
  material, host keys, provider credentials, or remote auth cookies.
- OpenSSH config, agent, ProxyJump, known-host verification, and interactive
  authentication remain authoritative.
- Unknown additive fields are preserved; invalid known fields fail visibly.
- Writes are owner-private and atomic.
- The existing `remote-targets.json` remains an ephemeral target/home → local
  port cache. Its hashed keys cannot enumerate machines and must not be
  reinterpreted as the registry. The machine registry may call the same port
  cache after resolving a concrete project home.
- Removing a registry row forgets only local connection metadata. It never
  invokes SSH or mutates a remote CLI, Runtime, project registry, or home.

Initial command surface:

```bash
openalice machine list [--json]
openalice machine add <key> --target <ssh-target> [--name <label>]
  [--ssh-port <port>] [--identity <local-path>] [--yes]
openalice machine remove <key> [--yes]
openalice machine inspect [<key>] [--json]
```

Interactive add/remove remains explicit; non-interactive mutation requires
complete flags plus `--yes`.

## Fleet Inventory Contract

Inventory is a presentation-neutral, versioned shape shared by CLI and TUI.
It contains only non-secret machine/project/runtime summaries:

- machine id, display name, target label, reachability class, last checked
  time, remote platform, CLI version, and compatibility;
- each registered AliceProject's stable project id, key, display name, product,
  complete home, configured/automatic Web port, and secret-free launch
  provenance needed for diagnosis;
- current Runtime class, owner surface, safe component health, uptime, and the
  advertised loopback Web endpoint when reachable;
- capability flags for inspect, start, stop, open/tunnel, transfer receive, and
  credential re-sealing.

The remote side exposes one aggregate JSON command that reads its own
Supervisor registry and probes only those registered homes. It does not scan
the filesystem. The local orchestrator executes that command through one SSH
session, validates a bounded response, and reports incompatible/older CLI
capabilities without falling back to human output.

Fleet refresh is bounded and cancellable. Local inventory is immediate;
multiple remote probes use a small concurrency limit. Cached inventory may be
shown as stale with its timestamp, but it is never mutation authority. Start,
stop, transfer, and open always re-probe the selected target.

## AliceProject Transfer Contract

### Command grammar

```bash
openalice project transfer \
  --from <source-project> \
  --to-machine <machine> \
  --to-project <remote-project> \
  --to-home <absolute-remote-home> \
  [--session-owner-policy keep-blocked|new-then-resume] \
  [--without-credentials] \
  [--plan] [--yes]
```

`--plan` is read-only. `--yes` approves only the fully displayed plan and does
not imply source stop, destination takeover, replacement, merge, deletion, or
post-transfer Runtime start unless separate flags explicitly name those
effects. Interactive TUI confirmation covers the same plan fields.

The first implementation accepts only a new/empty destination home and a
non-conflicting remote project key. It does not merge into an existing
AliceProject or overwrite an occupied directory.

### Identity

- The remote AliceProject receives a new project id derived from or explicitly
  owned by its remote complete home. The local AliceProject remains a usable,
  unchanged copy.
- Workspace ids, tags, Git repositories, active/departed lifecycle, dirty
  files, Issues, and Workspace-owned artifacts remain stable.
- Workspace registry and Catalog absolute paths are rebased to the remote
  launcher root during import; local absolute paths are never retained as live
  remote paths.
- The source AliceProject is never deleted, tombstoned, stopped permanently,
  or marked transferred. A later identity-preserving handoff is a distinct
  product operation and is outside this plan.

### Included portable state

The default transfer includes:

- AliceProject product birth (`trader` or `nano`);
- portable product configuration and preferences under `data/`, subject to the
  exclusions and credential rules below;
- active Workspace repositories, departed Workspace repositories, portable Git
  object/ref/index state, tracked files, and nonignored untracked files.
  Ignored generated dependencies are omitted; linked worktrees, initialized
  submodules/nested repositories, alternates, and promisor/partial-clone state
  block transfer until the Workspace is materialized independently;
- `.alice/settings.json`, Issues, comments, Harness receipts, handoff artifacts,
  and other portable Workspace-owned files;
- active Workspace registry and lifecycle Catalog semantics, reconstructed
  with remote absolute paths;
- Inbox, trading history/snapshots, schedules, UI layout, and other portable
  business data whose schemas do not require a live native Session.

The planner reports counts and byte estimates by category. It never prints file
bodies, credential values, prompts, account ids, or arbitrary Git remotes.

### Deliberately excluded Session plane

The destination starts with zero resumable product Sessions. Do not traverse or
copy user-global native Agent homes such as `~/.codex`, `~/.claude`, Cursor,
Grok, OpenCode, or an external Pi directory.

Exclude or regenerate:

- `workspaces/state/sessions/`;
- `workspaces/state/resume-identities.json` native continuation mappings;
- `workspaces/state/headless-tasks.json` and `headless-logs/`;
- `workspaces/state/agent-conversations.jsonl`;
- `workspaces/state/agent-runtime.jsonl`;
- `workspaces/state/scrollback/`;
- `workspaces/state/workspace-manager-sessions/`;
- `<OPENALICE_HOME>/runtime/pi/sessions` and every other managed Runtime
  session/cache path;
- live PTYs, PIDs, process state, Runtime locks, browser sessions, and auth
  cookies;
- Workspace-local native provider/session bridges that are regenerated from
  the imported project vault and Workspace settings.

`.alice/sessions/<resumeId>.json` is an OpenAlice Session dossier, not the
native conversation. Untracked/runtime-owned dossiers are excluded. If a user
has deliberately committed one, the transfer preserves repository bytes for
Git fidelity but does not import a corresponding Session roster/native
mapping; the file remains inert until the user deliberately changes it.

Historical business records may retain a `resumeId` string as attribution, but
the remote product must report that the author is unavailable rather than
claiming it can resume the original conversation. If preserving a known
unavailable author requires a small retired/tombstone projection, that
projection must contain no native locator, prompt, reply, credential, model
payload, or schedulable Session record.

### Scheduled Issue ownership

Workspace Issues travel with their repositories. A scheduled Issue assigned to
an exact old `@resumeId` cannot run on the destination without Session
continuity. The transfer planner lists every such Issue by Workspace and Issue
id without exposing prompt bodies.

- `keep-blocked` preserves the file and responsibility semantics. The remote
  product reports the owner as unavailable and does not silently recruit a new
  worker.
- `new-then-resume` explicitly rewrites only affected scheduled Issue
  assignees to `@new-then-resume`; the first remote fire creates a new remote
  Session and persists its new exact owner through the existing Issue contract.
- No default or `--yes` path silently rewrites ownership. Non-interactive apply
  with affected Issues requires an explicit policy.

### Credentials and sealing

SSH encrypts transport, but that does not make every secret portable.

- AI provider credentials owned by the selected complete home may transfer
  after the plan reports only their count/vendors and obtains confirmation.
  This includes the current credential records and supported legacy flat API
  keys. Values are read once into the consented process-private snapshot,
  travel only over the SSH process pipe, and are never printed.
- An `OPENALICE_GLOBAL_DIR` outside the complete home remains user-global and
  is never traversed implicitly. The plan reports that those credentials stay
  on the source machine.
- Broker account and Connector credentials are decrypted in source-process
  memory, sent through the authenticated SSH stdin channel, and sealed on the
  remote machine with a newly generated destination `sealing.key`.
- Plaintext credential material never enters the portable file frames, argv, environment,
  logs, progress events, plan JSON, staging files, or test snapshots.
- The source `sealing.key` is never copied. The destination key is mode `0600`
  and is created only by the remote importer.
- `--without-credentials` omits AI, broker, and Connector secrets while
  retaining secret-free configuration. The result explicitly names which
  integrations require setup on the remote machine.
- Tests use synthetic credentials in isolated homes. No live broker or
  external connector action is part of acceptance.

### Host-specific and unsafe exclusions

Do not transfer:

- `state/` Guardian/control locks and sockets;
- `runtime/` Broker Packs, managed Pi payloads, caches, and platform artifacts;
- configured/pinned Web ports and loopback endpoints;
- local Supervisor registry/default selection or source `appDir`;
- local machine logs, migration scratch files, update state, or installer
  content;
- user-owned Agent Runtime executables, login/session stores, native config,
  caches, and plugin state; shared portable Workspace skills remain eligible;
- web/admin login sessions;
- symlinks or archive entries that escape the declared source roots;
- an externally overridden `AQ_LAUNCHER_ROOT` without a future explicit
  split-root transfer contract.

The remote Runtime reinstalls platform Broker Packs and managed Pi through its
normal installer/Runtime path. Workspace-local generated Agent provider files
are regenerated from destination configuration before first launch.

### Plan/apply transaction

1. Resolve the source from the local Supervisor registry and canonicalize its
   complete home.
2. Inspect source Runtime ownership and all active Workspace/headless activity.
3. Require a quiescent source. Stopping a self-owned Runtime is a separate
   disclosed confirmation; foreign/Electron/development owners block.
4. Probe the registered machine through normal OpenSSH and verify/install a
   compatible remote CLI using the existing managed-remote plan/apply
   boundary.
5. Read the remote project inventory; reject an occupied key/home, running
   destination owner, nested/equal homes, or unsupported platform/capability.
6. Inventory included/excluded paths, dangerous symlinks, Workspace Git state,
   credentials, exact-Session Issue owners, byte estimates, and free-space
   requirements. Freeze this as a versioned transfer manifest.
7. Obtain consent for the exact manifest and any credential/session-owner
   policy. Re-probe before mutation so stale plans cannot overwrite new state.
8. Create an owner-private sibling staging directory on the remote host and a
  durable transaction receipt containing no secrets.
9. Stream a versioned, bounded file protocol through SSH stdin without a host
   `tar` dependency. Validate entry order/type, normalized relative path,
   declared root, size bounds, per-file checksum, and symlink containment
   during receive.
10. Stream credential frames separately from portable file frames and re-seal directly
    into destination files without plaintext staging.
11. Verify file count, byte count, per-entry or content-tree SHA-256, product
    stamp, Workspace registry/catalog reconstruction, permissions, and the
    absence of forbidden Session/runtime paths.
12. Publish the complete home atomically from its staging sibling, then
    atomically register the remote AliceProject. If registration fails, retain
    a recoverable unpublished/published receipt and never select an unrelated
    project silently.
13. Run read-only destination Doctor/inventory checks. Runtime start and tunnel
    open are separate post-transfer actions offered by CLI/TUI.
14. On interruption, leave a bounded staging receipt. A retry with the same
    manifest safely replaces only that transaction's staging directory. If
    publish succeeded but registry registration failed, retry verifies the
    exact published tree and credential bundle before idempotently repairing
    registration. Cleanup never targets an unresolved path or another
    transaction.

The local source remains byte-for-byte untouched except for an explicitly
approved graceful stop. A successful transfer report includes the remote
machine/project, included categories, excluded Session count, credential
result, rewritten/blocked Issue count, verification receipt, and next connect
command.

## Architecture and Ownership

Keep the implementation split into presentation-neutral modules under
`packages/cli/src/`:

- machine config parser/store;
- fleet inventory types and local/SSH probes;
- transfer inventory and policy planner;
- versioned manifest and framed-stream filter;
- source exporter and secret-frame producer;
- remote staging/import transaction and secret re-sealer;
- connection/tunnel service that reuses existing `remote.mjs` behavior;
- thin human/JSON command presenters;
- TUI fleet state/reducer, screen components, and transfer wizard.

`supervisor-tui.ts` currently combines launch resolution, effects, overlays,
key routing, and string rendering in one large module. Fleet work should first
extract reusable state/effect seams and new screens into focused files instead
of adding another nested overlay implementation. Render remains pure; reducers
return effects; effects call the same services as explicit commands.

The remote importer is the only writer for a transfer staging home. Guardian
remains the only Runtime writer. Transfer never invents another Runtime lock,
signals a guessed PID, exposes the Guardian socket, or performs trading writes.

## Ordered Delivery

### Increment 0 — contract and plan

- [x] Audit current Supervisor TUI, managed remote, AliceProject registry,
  complete-home layout, Workspace lifecycle, native Agent Session storage, and
  credential sealing boundaries.
- [x] Align on Machine → AliceProject TUI hierarchy and local → SSH transfer.
- [x] Record the selected interaction, Session exclusion, credential,
  transaction, safety, and verification contracts in this plan.
- [x] Add this plan to [[PLANS.md]] and publish it with the first implemented
  increment rather than as an isolated planning-only PR.

### Increment 1 — machine registry and fleet inventory

- [x] Add the versioned machine registry with atomic owner-private writes,
  unknown-field preservation, validation, and collision rules.
- [x] Add `openalice machine list|add|remove|inspect` with concise human output
  and stable JSON envelopes.
- [x] Add one remote aggregate AliceProject inventory command and bounded SSH
  parser; never parse human output or scan arbitrary directories.
- [x] Represent local and remote inventory through the same typed model and
  capability flags.
- [x] Keep existing raw-target `openalice remote <target>` behavior compatible;
  registered-selector connection is owned by Increment 2 after fleet selection
  exists.
- [x] Add parser/store/inventory/compatibility/security unit tests and an
  isolated SSH fixture for one machine with several AliceProjects.
- [x] Update `docs/remote-access.md`, `docs/cli-supervisor.md`, and
  `docs/data-locations.md` with shipped Increment 1 truth.
- [x] Open and merge the first serial PR to `dev`; inspect its checks and the
  post-merge `dev` run before publishing Increment 2.

### Increment 2 — read-only fleet TUI and connection actions

- [x] Extract fleet reducer/effects and focused list/detail components from the
  current monolithic TUI path.
- [x] Render local plus registered machines, reachability, stale timestamps,
  remote AliceProjects, Runtime/component health, and compatibility.
- [x] Implement wide two-pane and narrow drill-down layouts with fixed footer,
  scrolling, resize, monochrome, Unicode-width, and terminal restoration.
- [x] Connect/open a selected remote project through the existing loopback
  tunnel service. Detach closes only TUI-owned tunnels.
- [x] Preserve local start/open/stop/restart/logs/Doctor/Setup behavior and
  refuse unsupported remote mutations by capability.
- [x] Add deterministic state/screen/tunnel-ownership tests for local, online,
  auth-required, incompatible, and detach, plus real PTY journeys for local,
  offline, wide/narrow resize, drill-down, and terminal restoration.
- [x] Update the base Supervisor plan where its original local-only
  information architecture is superseded.
- [x] Open and merge the second serial PR to `dev`; inspect trailing CI before
  Increment 3.

### Increment 3 — transfer planner, exporter, and remote importer

- [x] Add the versioned transfer manifest, content inventory, exclusion
  policy, dangerous-path checks, byte/free-space estimates, and stable JSON
  plan.
- [x] Add source/destination quiescence and ownership checks with isolated
  consent for source stop; refuse foreign owners and occupied destinations.
- [x] Stream configuration and Workspace trees into owner-private remote
  staging with bounded framed input, normalized paths, checksums, safe
  symlinks, and durable receipts.
- [x] Rebase active/departed Workspace registry and Catalog paths while
  preserving Workspace ids, tags, lifecycle, Git state, and files.
- [x] Exclude the complete Session/runtime/auth plane and verify the destination
  starts with zero resumable Sessions.
- [x] Detect exact-Session scheduled Issues and implement explicit
  `keep-blocked` / `new-then-resume` policy without silent rewrites.
- [x] Transfer home-owned AI credentials and re-seal broker/Connector secrets
  with a new destination key; prove plaintext never reaches archive, argv,
  env, logs, progress, or fixture snapshots.
- [x] Atomically publish and register the destination project; implement safe
  retry/cancel/cleanup for only the resolved transaction staging path, plus
  exact-tree verification before repairing a post-publish registration retry.
- [x] Add `openalice project transfer ... --plan|--yes`, concise human progress,
  and a stable machine-readable result.
- [x] Extend the disposable Docker SSH acceptance through plan, default-no,
  interrupted transfer, retry, publish, remote Doctor/start, tunnel, stop, and
  source-unchanged assertions.
- [x] Update owner guides with the shipped transfer and Session boundary.
- [x] Open and merge the third serial PR to `dev`; inspect trailing CI before
  Increment 4.

### Increment 4 — transfer TUI wizard and recovery UX

- [x] Add source project, destination machine, destination key/home,
  credential, and Session-owner-policy steps backed by the same planner.
- [x] Render the complete plan before mutation with included/excluded data,
  Workspace/byte counts, credentials by non-secret category, affected Issues,
  source/destination ownership, and exact destination.
- [x] Render named transfer phases, byte/file progress, cancellation intent,
  resumable/cleanup state, failure remediation, and final verification.
- [x] After success, select the remote project and offer separate Start,
  Connect/Open, or Done actions. Do not auto-start merely because transfer was
  approved.
- [x] Add wide/narrow screen and real PTY journeys for default-no, success,
  auth loss, checksum failure, occupied destination, cancellation, retry, and
  terminal cleanup.
- [x] Walk the real TUI against an isolated Docker SSH host; no user Home,
  provider account, broker, or connector may be used.
- [x] Open and merge the fourth serial PR to `dev`; inspect trailing CI.

### Increment 5 — completion and release evidence

- [x] Run repository TypeScript and full unit suites plus CLI package
  typecheck/tests after every code increment.
- [x] Run `pnpm test:remote:docker` for inventory/connection/transfer changes
  and `pnpm test:install:docker` when the distributed CLI payload changes.
- [x] Run the real local browser route for transferred Workspace discovery and
  first fresh Session creation.
- [x] Run unsigned Electron/package Workspace smoke because the shared
  complete-home, managed-Pi, and installed CLI boundaries changed; do not use
  signing/notarization credentials.
- [x] Verify Linux plus macOS locally/CI and retain Windows/Git Bash archive and
  path behavior as an explicit release residual risk until its platform lane
  passes.
- [x] Update all owner guides and command help; identify but do not rewrite
  public README positioning without maintainer framing.
- [ ] Delete this plan and its [[PLANS.md]] bullet only after every acceptance
  criterion is repository truth and the maintainer accepts the completed
  product behavior.

### Increment 6 — Railway-backed transfer hardening

- [x] Make Workspace inclusion Git-aware: preserve tracked and nonignored
  untracked content plus self-contained Git state, exclude ignored generated
  dependencies, and fail closed on linked/nested/alternate/promisor layouts.
- [x] Freeze Alice-owned AI/broker/Connector/provider credentials once at plan
  consent, keep them out of plan JSON and portable file frames, and re-seal
  them under a new destination key.
- [x] Validate the complete receipt and exact published entry set before an
  idempotent registration retry, including receiver-created credential files.
- [x] Apply the reviewed transfer to the retained Railway Volume, select the
  imported Project, and verify portable Workspace/configuration state plus a
  new user-owned Agent Runtime turn without importing native Session state.

## Verification Matrix

Increment 1 progress (2026-08-23): the focused Machine specs (16 tests), CLI
dispatch/completion specs (29 tests including related command coverage), CLI
typecheck/build, and an isolated real-command add/list/inspect/remove walk pass.
The Docker SSH fixture now creates two remote AliceProjects and asserts one
aggregate registered-Machine response. `pnpm test:remote:docker` passes the
full install/start/inventory/tunnel/reconnect/stop route, and
`pnpm test:install:docker` passes the distributed payload route. Both fixtures
removed their temporary containers and images. The final repository suite
passes 4,887 tests with 9 skipped, alongside root TypeScript and CLI build.

Increment 2 progress (2026-08-23): 101 focused Fleet/TUI/inventory/SSH/install
tests and the CLI build pass, including real PTY resize, narrow drill-down,
offline Machine, terminal restoration, and TUI-owned tunnel cancellation. The
complete CLI package passes 251 tests; the repository passes 4,896 tests with
9 skipped alongside root TypeScript. Both `pnpm test:remote:docker` and
`pnpm test:install:docker` pass and remove their temporary Docker resources.
The unsigned `pnpm electron:smoke:workspace` packaged acceptance also passes
the installed CLI manifest, Electron PTY, scheduled managed-Pi run, and cleanup
contract; its temporary expanded application is removed on exit.

Increment 3 core progress (2026-08-23): the planner, bounded SSH stream,
credential re-sealing, sibling staging, checksum/free-space gates, atomic
publish, idempotent registration retry, CLI plan/apply surface, and cancellation
signal are implemented. The real Docker SSH route transfers synthetic portable
configuration and a Git Workspace, excludes untracked Session/runtime/auth
state, re-seals credentials with a distinct remote key, preserves the remote
default, and starts/stops the received Runtime successfully. Focused planner,
stream, transport, command, and Supervisor registration tests pass. The Docker
fixture also proves truncated-stream failure markers and same-transaction retry.
CLI 275 tests, the repository's 4,920 tests with 9 skipped, root TypeScript,
install Docker, and unsigned Electron package/Workspace acceptance pass. Only
publication remains before Increment 3 is complete.

Increment 4 local progress (2026-08-23): Fleet `m` opens a focused overlay
for destination Machine, key/Home, credential handling, exact-Session owner
policy, plan review, live file/byte progress, cancellation, failure recovery,
and separate Start/Connect/Done success actions. Pure wide/narrow presentation,
screen routing, real widget default-No, and PTY regression journeys pass. An
injected real-PTY matrix now covers narrow default-No, success, authentication
loss, an occupied destination race, checksum failure with same-transaction
retry, cancellation acknowledgement with retry, and terminal cleanup. The
Docker SSH fixture drives the real TUI through default-No and approved
success, proving no default-No destination, registered result, portable
Workspace content, and no resume ledger. Publication remains.

Increment 4 publication follow-up (2026-08-23): the feature PR merged as
PR #1164. Its trailing Installer Smoke exposed that the dependency-free
managed-remote job loaded `node-pty` before reaching its non-TUI path. The
fixture now loads PTY support only for the local interactive journey, while CI
and release installer jobs explicitly retain the dependency-free remote path;
both variants pass the full disposable Docker acceptance locally.

Final local gate refresh (2026-08-23): the complete CLI package passes 291
tests and the repository passes 4,936 tests with 9 skipped, alongside root,
UI, and CLI TypeScript/build checks. Installer Docker, the expanded real SSH/TUI
transfer Docker route, and unsigned Electron packaged Workspace acceptance all
pass. Every fixture removed its container, image, temporary package, and
isolated AliceProject Home.

Completion acceptance progress (2026-08-23): a disposable source Workspace was
created as a real Git repository, transferred through the production planner,
stream, receiver, and path transforms, and started from its new complete Home
in lite mode. The real browser showed one migrated Workspace, its preserved
`acceptance fixture` commit, and zero Sessions. Creating a Shell Session from
the page then showed `1 running`, `sh1`, and a new PID; the new session and
resume ledgers contained only newly generated remote identities and no source
`must-not-transfer` continuation. The Runtime stopped cleanly and all five
disposable Homes were moved to Trash. The TUI now also re-probes before
starting a stopped compatible remote project, offers an actual same-transaction
retry after transfer failure, and proves Escape cancellation aborts the active
sender. README already links the remote quickstart, so no public positioning
rewrite is needed.

Increment 6 local progress (2026-08-31): the planner now preserves tracked and
nonignored untracked Workspace content while rejecting Git layouts that depend
on machine-local worktree, nested repository, alternate-object, or promisor
state. Alice-owned credentials are frozen in a process-private consent
snapshot, streamed separately from portable files, and re-sealed at the
destination; native Agent login/config/session state remains excluded. Receipt
validation covers the exact manifest, credentials policy, and published entry
set, including idempotent recovery when the receiver created an AI vault before
registry registration failed. Hosted Railway apply and real Project selection
were the acceptance step shared with the Bun CLI distribution plan.

Increment 6 hosted acceptance (2026-09-01): the stopped local Default
AliceProject transferred through the production SSH path into
`/data/projects/main-cloud` on the retained Railway Volume. The destination
published 10,702 files and 222,635,304 bytes, registered and selected its new
AliceProject identity, retained portable Workspace/configuration state, copied
no native Sessions, and left transfer staging clean. OpenCode 1.18.25 was then
installed as user-owned persistent state outside the OpenAlice release, and
Workspace `chat-solid-coral-ridge` completed a real headless turn returning
`OPENALICE_REMOTE_OK`. The local source remains stopped to avoid divergent
writes. Restart/resume and hard-kill persistence are owned by the Bun CLI
distribution plan's still-open Railway acceptance, not by this transfer
increment.

Always:

```bash
npx tsc --noEmit
cd ui && npx tsc -b
pnpm test
pnpm -F @traderalice/openalice-cli typecheck
pnpm -F @traderalice/openalice-cli test
```

Machine/fleet increment:

```bash
pnpm vitest run packages/cli/src/<machine-and-inventory-specs>
pnpm test:remote:docker
```

TUI increments:

```bash
pnpm vitest run \
  packages/cli/src/supervisor-tui.spec.ts \
  packages/cli/src/supervisor-tui.pty.spec.ts \
  packages/cli/src/<fleet-tui-specs>
```

Distributed transfer increment:

```bash
pnpm test:remote:docker
pnpm test:install:docker
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm electron:smoke:workspace
```

Targeted security/transaction tests cover:

- malformed/unknown/newer machine registry schemas and atomic-write failure;
- SSH host-key/auth/timeout/connection-loss classes without disabling
  verification;
- hostile machine keys, targets, remote homes, manifest paths, control bytes,
  oversized entries, symlink escapes, and destination collisions;
- source/destination Runtime races between plan and apply;
- dirty Git repositories, submodules, executable files, Unicode names, empty
  files, large files, and interrupted streams;
- Session paths and global Agent homes absent from the stream/destination;
- exact-Session Issues under both explicit policies;
- synthetic AI/broker/Connector secrets absent from every stdout/stderr/log,
  manifest, portable file frames, receipt, error, and snapshot while destination unsealing
  succeeds with a distinct key;
- checksum mismatch, publish/register failure, retry, cancellation, bounded
  cleanup, and source byte-for-byte preservation.

No routine test runs `OPENALICE_UTA_LIVE_PAPER=1`, submits orders, contacts a
real Connector account, reads a user's native Agent home, or uses the user's
normal `~/.openalice`.

## Acceptance Criteria

- Bare `openalice` shows the local computer and registered SSH machines with
  truthful reachability/tunnel/Runtime distinctions.
- Selecting a reachable machine shows only its explicitly registered
  AliceProjects through one validated aggregate inventory response.
- A selected remote project can start/connect/open through existing managed
  remote and SSH loopback contracts without exposing private services.
- A local AliceProject can be planned and transferred to a new remote home from
  CLI and TUI; default-no leaves both machines unchanged.
- The remote result contains the expected portable configuration, business
  data, active/departed Workspace repositories, stable Workspace ids, rebased
  paths, preserved Git state, and correct product birth.
- The destination contains no live locks, platform Runtime payload, browser
  sessions, resumable product Session roster, native continuation mapping,
  headless/PTY history, or copied user-global Agent state.
- Credential transfer is explicit, secret-free in observability, and re-seals
  machine-bound data with a distinct remote key.
- Exact-Session scheduled Issues are never silently reassigned; the chosen
  policy is visible in plan and result.
- Interrupted or failed transfer never publishes a partial home, overwrites an
  existing project, mutates an unrelated path, or changes source project data.
- TUI narrow/wide layouts, scrolling, cancellation, disconnect, resize, and
  terminal restoration pass real PTY acceptance.
- Durable owner guides describe shipped behavior, the active plan reflects
  repository truth throughout execution, and every serial increment is merged
  into `dev` with its required verification recorded.

## Non-Goals

- live migration of PTYs or native Agent conversations;
- copying arbitrary global Agent configuration or session directories;
- identity-preserving move/handoff or automatic source deletion;
- bidirectional sync, conflict resolution, or merge into an occupied project;
- public TCP exposure, relay, NAT traversal, hosted fleet service, or SSH
  replacement;
- remote filesystem discovery outside the remote Supervisor registry;
- simultaneous multi-controller terminal ownership;
- migrating platform Broker Pack binaries or installer/Runtime payloads;
- validating real broker credentials by connecting or trading during transfer;
- rewriting OpenAlice public positioning without maintainer direction.
