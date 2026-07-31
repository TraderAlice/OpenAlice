---
name: alice-workspace
description: >
  Use the `alice-workspace` CLI for collaboration between durable OpenAlice
  Workspaces: find peers, send ordinary Agent messages, deliver reports to the
  human Inbox, coordinate Issues, and trace artifacts to attributable product
  Sessions. Load it when work must cross a Workspace boundary or remain
  recoverable. Read live help instead of guessing flags.
---

# Workspace collaboration — `alice-workspace`

OpenAlice owns addresses, delivery, durable work, and provenance. Coding Agents
keep using their native file, search, and Git tools inside any resolved path.

## The command model

| Group | Owns | Does not own |
|---|---|---|
| `peer` | Active Workspace discovery, absolute paths, Session directory | File reading or research |
| `conversation` | Ordinary Agent-to-Agent requests and replies | Human notification |
| `inbox` | Human-facing report delivery and follow-up | General peer chat |
| `issue` | Durable work, ownership, scheduling, Activity | Ad-hoc questions |
| `provenance` | Artifact-to-Session attribution | Guessing intent |
| `signature` | The current Session's safe `@resumeId` | Runtime-native ids |
| `track` | Shared durable asset/topic index | Work status |
| `template` | Managed Workspace guidance upgrades | Harness research lifecycle |

Start with live intent help whenever the route is unclear:

```bash
alice-workspace
alice-workspace <group>
alice-workspace <group> <verb> --help
```

## Talk to another Agent

Use `conversation`, not Inbox, for ordinary coworker communication.

```bash
# Discover the active office floor and choose a desk.
alice-workspace peer list

# Recruit a fresh Session at that Workspace for new work.
alice-workspace conversation ask --ws-id <workspaceId> \
  --prompt 'Investigate this bounded question and report back.'

# Continue one exact attributable product Session.
alice-workspace conversation ask --resume-id <resumeId> \
  --prompt 'Explain the missing context.' --await

# Ask the attributable sender of one Inbox delivery.
alice-workspace conversation ask --inbox-id <entryId> \
  --prompt 'What did you send, and what should I inspect first?' --await

# Recruit a fresh Session in a Harness default Workspace.
alice-workspace conversation ask --harness autoquant \
  --prompt 'Start a new quantitative research assignment.'
```

`--harness chat` follows the recent/default Chat desk policy and creates the
stable starter Chat Workspace only when none exists. `--harness autoquant`
requires the explicitly initialized AutoQuant default Workspace and never
creates or guesses one. Both launch a fresh product Session in the resolved
desk; use the returned `resumeId` for later continuation.

Prompts are ordinary coworker messages. Add `--reconstruct` only when the task
explicitly requires a fresh worker to reconstruct missing historical intent.
Provenance may still report `resolution.mode: reconstructed` without changing
the prompt when no original author is available.

Choose the waiting rhythm from the work:

- A short answer needed now: add `--await`.
- A longer delegation: omit `--await`, retain `taskId`, then retrieve it later.
- Several independent peers: dispatch first, then collect the task ids together.

```bash
alice-workspace conversation await --task-id <taskId>
alice-workspace conversation read --task-id <taskId>
alice-workspace conversation collect --task-id <taskA> --task-id <taskB>
```

Conversation work has no implicit execution deadline. `--await`, `conversation
await`, and `conversation collect` also wait for terminal task state when no
limit is supplied. Add `--timeout-ms <milliseconds>` only when the caller
deliberately wants a hard execution watchdog (for `conversation ask`) or a
bounded server-side wait (for `await`/`collect`). A bounded wait returning does
not stop a task unless that same explicit timeout was attached at dispatch.

There is no unsolicited Agent-to-Agent completion notification bus. Inbox
notifies the human; `await`, `read`, and `collect` retrieve direct Agent replies.
Do not build shell sleep loops.

## Deliver and read reports

Inbox is the outbound human delivery surface. A normal attended Chat reply
already reaches the user; scheduled/headless work must push explicitly when its
result deserves human attention.

```bash
alice-workspace inbox push \
  --doc research/report.md \
  --comments 'Finished — the report contains the evidence and conclusion.'
```

`--doc` is repeatable and Workspace-relative. The Inbox renders the live file
and records the exact published content hash. Commit before pushing so Git can
recover what was sent even if the path later changes.

Read recent deliveries with:

```bash
alice-workspace inbox read --limit 5
alice-workspace inbox read --self
```

Each attachment is returned in `files[]` with a directly usable `absolutePath`,
its original `relativePath`, and the published `revision` when available. The
legacy `docs` relative-path list remains for compatibility.

If `absolutePath` is null because the Workspace is unavailable or the stored
path is unsafe, do not guess it. For broader inspection of an available peer
desk, resolve its root explicitly:

```bash
alice-workspace peer path --id <workspaceId>
# Then use the Coding Agent's native Read/Search/Glob/Git capabilities.
```

There is deliberately no Workspace-level file-read command. `peer path` owns
addressing; the Coding Agent owns file operations. Reading another Workspace is
normal. Autonomous/headless work writes only its own Workspace. An attended
cross-Workspace edit requires explicit human approval and must be committed in
the peer repository so its owner can review or revert it.

For AutoQuant, a lane Report is the focused handoff and a Dossier is the
cross-lane deliverable. AutoQuant owns their contents and evidence; OpenAlice
only delivers the exact committed files and stamps their origin.

## Follow up on an existing object

Prefer the business object when one already identifies the responsible work:

```bash
alice-workspace inbox ask --id <entryId> \
  --prompt 'Why did you send this result?' --await

alice-workspace issue ask --id <issueName> --creator \
  --prompt 'Why was this Issue created?' --await
alice-workspace issue ask --id <issueName> --owner \
  --prompt 'What is the current state and next decision?' --await
alice-workspace issue ask --id <issueName> --run-id <taskId> \
  --prompt 'What happened in this execution?' --await
```

These wrappers resolve provenance without making you extract a `resumeId`.
Never choose an arbitrary old Session when an artifact lacks an exact author.

Resolution means:

- `exact`: the attributable product Session continued;
- `reconstructed`: a fresh worker was recruited only in the known Workspace;
- `unavailable`: the attributed Session or safe Workspace target cannot resume.

## Trace provenance

```bash
alice-workspace provenance show --kind inbox --inbox-entry-id <entryId>
alice-workspace provenance show --kind issue --issue-id <id>
alice-workspace provenance show --kind report --workspace-id <workspaceId> \
  --path research/report.md --revision <sha256:...>
alice-workspace provenance show --resume-id <resumeId>
alice-workspace signature show
```

`resumeId` is the product follow-up handle; `taskId` is one execution. Native
runtime Session ids remain backend-only. `inbox ask` identifies the sender of a
delivery, which may differ from whoever last edited its live document.

## Coordinate durable work

Issue reads span the shared board; writes belong to this Workspace:

```bash
alice-workspace issue list
alice-workspace issue list --mode detailed
alice-workspace issue show --id <name>
alice-workspace issue create --title 'Investigate the anomaly'
alice-workspace issue update --id <id> --status in_progress
alice-workspace issue comment --id <id> --text 'Evidence collected; review next.'
```

Use `issue comment` for durable discussion on this Workspace's Issue. Use
`issue ask` to interrogate a creator, fixed owner, or selected historical run.
Scheduling and the complete Issue file/assignee contract belong to the
`self-scheduling` skill.

Tracked entities are the durable cross-Workspace subject index, not tasks:

```bash
alice-workspace track search --query uranium
alice-workspace track add --name uranium-ccj --description 'Cameco — uranium miner'
```

## Upgrade managed Workspace guidance

Preview first; apply only after reviewing the plan:

```bash
alice-workspace template upgrade
alice-workspace template upgrade --mode detailed
alice-workspace template upgrade --apply
alice-workspace template upgrade --id <workspaceId>
```

Applying to a live current Workspace is blocked. A headless run may preview a
peer but cannot apply a cross-Workspace upgrade. Conflict resolution, lifecycle
guards, and managed-file boundaries are reported by the live command.
