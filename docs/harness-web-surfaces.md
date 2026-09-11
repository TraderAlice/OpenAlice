# Harness Web Surfaces

This guide owns the contract between OpenAlice and Harness-owned web
applications such as AutoQuant Studio and Auto Prediction Studio. It covers
manifest discovery, managed launch, ports, readiness, routing, transport,
process lifetime, security, and presentation. Harness business APIs and state
remain repository-owned.

Related guides: [[docs/project-structure.md]],
[[docs/managed-workspace-runtime.md]], [[docs/remote-access.md]], and
[[docs/workspace-lifecycle.md]]. This guide also owns the source-release
lifecycle for Harness repositories that expose these surfaces.

## Ownership

OpenAlice validates `harness.json`, allocates loopback ports, supervises one
foreground process per Workspace/capability generation, waits for readiness,
retains bounded diagnostic tails, and owns restart/stop, route identity, proxy
security, and product chrome. The Harness owns its command, listeners, health
semantics, frontend, APIs, application state, and standalone developer mode.

OpenAlice does not install Harness dependencies on Studio start, infer a
business API, or reproduce a Harness's projects, campaigns, runs, evidence,
workers, or database lifecycle.

## Source releases and trust

Source-backed Harness templates declare a canonical repository plus exact
version/commit tuples. This catalog is OpenAlice's verified allowlist. A
Workspace records the tuple used to create or last upgrade it in tracked
`.alice/harness-source.json`; verification is derived from an exact catalog
match and is never a mutable flag in the receipt.

By default, version notices and upgrades use verified catalog entries only. An
installation-level Harness preference may additionally discover the newest
stable SemVer tag directly from the canonical repository. Pre-releases are
excluded. Such a tag remains **not verified by OpenAlice** even when its
immutable commit contains a valid manifest. The UI keeps that distinction
visible and requires an explicit unverified apply action. Discovery never
checks out code, installs dependencies, launches a capability, or silently
upgrades a Workspace.

AutoQuant and Auto Prediction share one upgrade workflow. Preview fetches the
exact target commit, validates its `harness.json` without checking it out,
computes upstream changed paths, and asks Git to preview the merge into the
Workspace branch. Apply requires the reviewed digest, no tracked working-tree
changes or untracked files that the target would overwrite, no merge conflicts,
a compatible manifest, and no active Session, headless run, or Studio. Ordinary
untracked research artifacts remain in place. Apply then creates a normal
no-fast-forward Git merge commit and
updates the source receipt in that commit. Committed Workspace history is
preserved; unresolved source conflicts go back to a Coding Agent instead of
being hidden behind per-file overwrite choices.

The source transaction uses the same checkout operation lease as Template
Upgrade, Absorb, and offboarding. A journal under `.alice/transactions/`
allows startup recovery to abort an interrupted merge and restore the previous
receipt. A completed merge remains ordinary Git history and therefore stays
usable when AQ/AP are opened outside OpenAlice.

## Manifest v1

The repository root contains:

```json
{
  "manifestVersion": 1,
  "version": "0.1.0",
  "capabilities": {
    "studio": {
      "command": ["pnpm", "studio"],
      "ports": ["http", "controlPlane"],
      "entryPort": "http",
      "readinessPath": "/health"
    }
  }
}
```

Commands are argv arrays executed without a shell from the Workspace root.
Port names are unique stable identifiers; `entryPort` names one of them.
`readinessPath` is absolute on the entry listener and HTTP 2xx means the
surface may be shown. v1 deliberately excludes public URLs, UI layout,
business APIs, secrets, package managers, and an OpenAlice path prefix.

OpenAlice injects:

```text
HARNESS_CAPABILITY=studio
HARNESS_HOST=127.0.0.1
HARNESS_PORTS={"http":49321,"controlPlane":49322}
HARNESS_NO_OPEN=1
```

Managed mode requires those exact values and fails instead of scanning or
falling back. Outside exact capability mode, standalone defaults remain. The
vendor-neutral `HARNESS_*` namespace lets another compatible supervisor adopt
the same launch contract without pretending to be OpenAlice. The loopback host
is the child bind address on local and remote Runtime hosts; it is never the
browser-visible address.

## Routing and transport

A ready generation receives `oa-surface-<opaque>.localhost`. The route table
maps only that identity to its supervised entry port; no `/proxy/<port>` or
arbitrary user target exists. The route is published after readiness and
removed before termination. Generation checks make stale exits harmless.

- Browser/server reuses Alice's loopback HTTP listener.
- `pnpm dev` connects Studio to the Guardian-injected Alice backend port; Vite
  owns no route table.
- SSH browser uses the same Alice tunnel. The opaque Host header crosses it, so
  no second `ssh -L` is needed.
- Electron keeps `app://openalice` for the product UI. Alice opens an ephemeral
  loopback-only Surface Gateway containing Harness routes only. Studio
  HTTP/SSE/WebSockets bypass buffered web IPC without exposing Alice APIs,
  `/cli`, auth, or static UI on that listener.

The proxy strips OpenAlice cookies, Authorization, CSRF/internal headers, and
hop-by-hop headers. It rewrites upstream-local redirects to the opaque public
origin. Harness frontends use current-origin relative assets, APIs, SSE, and
WebSocket URLs and must explicitly permit the restricted OpenAlice iframe.

## Product interaction

AutoQuant and Prediction expose Studio beside New research after a default
Workspace exists. Opening Studio starts idempotently and presents an announced
starting state until readiness. Failure preserves bounded logs and offers
retry; ready state embeds the Harness and offers Refresh, Restart, Logs, and
Open separately. A failed launch presents the bounded, redacted child output
inline. When the output indicates an unprepared source checkout, the recovery
action opens that Harness's Quick Start with a setup task prefilled. The user
reviews the Agent, credential, model, and effort before sending it to inspect
repository instructions, install declared dependencies, and verify Studio.
OpenAlice does not guess or run a package-manager install itself.

The iframe fills the Harness content pane. Its toolbar wraps instead of causing
horizontal overflow, uses shared Button primitives and visible focus, announces
state with `aria-live`, and disables forced spinner motion for reduced-motion
users. Studio is a separate origin and cannot read OpenAlice application state.

## Lifecycle

Restart removes the route and old process tree before allocating a new
generation. Offboarding stops that Workspace's surfaces before moving its
directory. Alice shutdown removes all routes and terminates every child tree.
Termination snapshots descendants before signaling the package-manager wrapper;
the wrapper exiting is not proof that detached listeners have stopped, so any
surviving descendants receive the force phase as well. Startup failure is
first-error-wins: a readiness timeout remains the operator-facing error even if
termination subsequently makes the wrapper exit non-zero. Structured
`harness_surface.failed` logs carry that same retained error.
Runtime state is process-local and intentionally not persisted; after a crash,
the next open starts a fresh generation.

## Load-bearing paths

- `src/workspaces/harness-manifest.ts`
- `src/workspaces/harness-surface-manager.ts`
- `src/workspaces/harness-source-upgrade.ts`
- `src/webui/harness-surface-proxy.ts`
- `src/webui/routes/harness-surfaces.ts`
- `ui/src/api/harness-surfaces.ts`
- `ui/src/pages/HarnessSurfacePage.tsx`
