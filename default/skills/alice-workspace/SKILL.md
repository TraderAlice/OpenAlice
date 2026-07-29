---
name: alice-workspace
description: >
  Use the `alice-workspace` CLI for collaboration and provenance: Inbox
  delivery, the global Issue board, tracked entities, peer files, and asking an
  attributable product Session. Use it when work must be surfaced, remembered,
  assigned, or followed back to the Agent that produced it. Read live help and
  choose comments for durable Issue discussion versus asks for historical inquiry.
---

# Collaboration — `alice-workspace`

Choose the verb from the intent, not from whichever object you happen to have:

| Intent | Command family |
|---|---|
| Tell the human about finished/asynchronous work | `inbox push` |
| Read what desks already surfaced | `inbox read` |
| Ask why one Inbox entry was produced | `inbox ask` |
| Inspect the shared work board | `issue list` / `issue show` |
| Ask an Issue's creator or selected historical run | `issue ask` |
| Discuss this Workspace's own Issue; notify its fixed owner | `issue comment` |
| Ask or delegate by product Session/Workspace when no business object exists | `conversation ask` |
| Bring this desk's managed instructions and skills up to date | `template upgrade` |
| Inventory every active desk before coordinating the floor | `peer list` |

`issue comment` is the durable conversation entry for this Workspace's own
Issue. If the Issue has an exact `@resumeId` assignee, a comment from somebody
else resumes that owner in the background and records the final reply in the
Activity timeline. A human comment without a fixed owner asks the creator or a
reconstructed Workspace Agent without changing assignee. Agent-authored
comments without a fixed owner remain notes. Use `issue ask` when interrogating
the creator or a specific historical run without adding a comment.

**Hand finished work back to the user** — this is the outbound channel. It posts
to the user's Inbox tab:

```bash
alice-workspace inbox push --doc research/tsla.md --comments "Done — TSLA looks extended; details in the doc."
```

(Attach files with repeatable `--doc <path>` — workspace-relative; each renders
live in the inbox UI. OpenAlice records the exact published content hash even
though later edits remain visible. `--comments` is your markdown note. At
least one of `--doc` / `--comments` must be present.)

> **Commit before you push.** The inbox renders your files live, not a snapshot —
> a `git commit` is the only durable record of what you actually sent. Skip it and
> a later edit changes what the entry shows. The publication hash proves which
> revision was sent, while the commit preserves content you can recover.

**Look back at the inbox** — recall what's been surfaced, newest first:

```bash
alice-workspace inbox read --self            # only your own pushes
alice-workspace inbox read --limit 5         # latest 5 across all workspaces
```

(`--self` narrows to entries THIS workspace pushed — their `docs` paths are
relative to your own workspace root, so you can open them straight from the
shell. Each entry also carries a `workspaceId`; for entries from OTHER
workspaces, that's the handle to locate their files — see below. Agent-produced
entries also carry safe `origin` provenance: `runId` / `sessionId`, `resumeId`,
`issueId`, and `agent` when available. Native runtime session ids stay hidden.
`--limit` caps the window, default 20.)

**Read & edit a peer's files** — workspaces collaborate; another workspace's docs
are reachable. Resolve the peer's absolute dir by its `workspaceId`, then use your
own file tools:

```bash
# active office-floor inventory (ids, templates, agents, live workload counts)
alice-workspace peer list
# --id is the `workspaceId` from an inbox_read entry (a uuid), e.g.:
alice-workspace peer path --id 550e8400-e29b-41d4-a716-446655440000
alice-workspace peer sessions --id 550e8400-e29b-41d4-a716-446655440000
# -> { path: "/…/workspaces/550e8400-…", tag, id }
# then read <path>/<the doc path from the inbox entry> with your native tools
```

(Reading a peer's files is fine. For your OWN entries you don't need this at all;
their doc paths are already relative to your cwd.)

**Trace an artifact back to a Session** — query the immutable attribution trail
without exposing a runtime-native session id:

```bash
alice-workspace provenance show --kind issue --issue-id <id>
alice-workspace provenance show --kind report --path research/report.md --revision <sha256:...>
alice-workspace provenance show --kind trade-decision --account-id <account> --decision-id <uta-commit-hash>
alice-workspace provenance show --resume-id <resumeId>  # reverse lookup: artifacts attributed to one Session
```

For Issue/report keys, `--workspace-id` defaults to your current Workspace.
`resumeId` is the follow-up handle; `taskId` is only execution evidence. A
missing origin is not permission to pick an arbitrary old Session.

**Ask who was responsible** — resolve the business target, then dispatch a
headless follow-up without leaving the embedded Workspace CLI:

```bash
alice-workspace inbox ask --id <entryId> \
  --prompt 'Why did you send this result?' --await
alice-workspace issue ask --id <issueName> --creator \
  --prompt 'Why did you create this Issue?' --await
alice-workspace issue ask --id <issueName> --owner \
  --prompt 'What is the current state and next decision?' --await
alice-workspace issue ask --id <issueName> --run-id <taskId> \
  --prompt 'What happened in this run?' --await

# Lower-level escape hatches when there is no Inbox/Issue business object:
alice-workspace conversation ask --resume-id <resumeId> \
  --prompt 'Explain the missing context.' --await
alice-workspace conversation ask --ws-id <ws> \
  --prompt 'Please investigate this bounded question and report back.'
alice-workspace conversation ask --ws-id <ws> \
  --prompt 'Reconstruct why this unattributed artifact was produced.' --reconstruct --await
alice-workspace conversation await --task-id <taskId>
alice-workspace conversation collect --task-id <taskA> --task-id <taskB>
alice-workspace conversation read --task-id <taskId>
```

Prefer the Inbox/Issue commands: they resolve provenance without making you
extract `resumeId` or `wsId`. `issue ask` defaults to `--creator`; `--owner`
requires a stable resume owner, while `--run-id` selects one exact run Session.
Use the lower-level conversation command only when no business object already
identifies whom to ask. Never construct or pass an internal target JSON object.

Choose the waiting rhythm from the work:

- **Short consultation needed for the current answer:** use `ask --await`.
  OpenAlice waits server-side and returns the final reply without a guessed
  sleep duration.
- **Delegation that may take a while:** omit `--await`. Keep the returned
  `taskId`/`resumeId`, continue useful work, and later use `conversation read`
  or `conversation await`. The peer can create its own local Issue/schedule and
  push a finished report to Inbox.
- **Several independent peers:** dispatch every ask first without `--await`,
  then pass the task ids to one `conversation collect` call.
- **Human-facing completion:** ask the worker to use `inbox push` when the
  result should surface in the user's Inbox.

There is not yet an unsolicited Agent-to-Agent completion notification bus.
Inbox reaches the human; `read`/`await`/`collect` retrieves a dispatched Agent
reply. If collect reports a task still `running`, do other useful work and
collect again later or use one-shot `conversation read`; never build a shell
`sleep` polling loop.

Prompts are delivered as ordinary coworker messages by default. Add
`--reconstruct` only when the request explicitly asks a fresh fallback worker
to reconstruct an artifact or decision whose author cannot be resumed. The
`resolution.mode` may still say `reconstructed` for honest provenance even when
that optional prompt guidance was not requested.

Inspect `resolution.mode` on the ask result:

- `exact` continues the attributable product Session;
- `reconstructed` starts a fresh worker only in the target's known Workspace,
  records it against the artifact, and reuses it on later questions without
  letting it impersonate the original author;
- `unavailable` means an attributed Session cannot resume, or no safe
  Workspace target exists. Do not work around it by picking another old
Session. Poll `conversation read` until `status` leaves `running`; its default
output keeps the final `assistantText` and a compact error when needed. Prefer
the server-side await flow above; use `read` as the fallback snapshot. Use
`--mode detailed` only for diagnostics that genuinely need tool/message blocks.

> **Editing a peer is interactive-only.** Reading another workspace is always OK.
> *Editing* one means reaching outside your own workspace — only do that in an
> interactive session where a person is present to approve it. An autonomous /
> headless run reads peers but writes ONLY its own workspace. If you do edit a
> peer (with approval), leave your change as a clear `git commit` in that repo so
> the owner can review or revert it — never edit-and-walk-away. (Your workspace's
> git identity is set automatically, so the author is honest.)

**Track entities** — the durable cross-workspace tracked index (`[[name]]`):

```bash
alice-workspace track search --query "uranium"
alice-workspace track add --name uranium-ccj --description "Cameco — uranium miner"
```

**The issue board** — the cross-workspace work list, shared by you and the user.
It's *what's on the plate* when you've lost the thread — scan it when you start.
**Reads are global, writes are local:**

```bash
alice-workspace issue list                  # startup-safe summary: local + active urgent/high/medium rows
alice-workspace issue list --mode detailed  # full global board, including low-priority scheduled noise
alice-workspace issue show --id <name>      # compact issue + provenance/resumeId run/report references
alice-workspace issue show --id <name> --mode detailed  # every execution prompt + full reports
alice-workspace issue create --title "…"    # a new issue on THIS workspace's board
alice-workspace issue create --title "…" --when '{"kind":"every","every":"1h"}' --assignee @me
alice-workspace issue update --id <id> --status in_progress
alice-workspace issue comment --id <id> --text "question / progress note / finding"
alice-workspace signature show               # your @resumeId for standalone Markdown
```

Work it like a human board: start with plain `list`, decide which focus rows
matter, then `show --id <name>` to read those in full. Plain `list` is deliberately
curated for startup so old low-priority scheduled items do not distract you; use
`--mode detailed` only when you are auditing the full board. `list` / `show` span
the whole board (all workspaces); `create` / `update` / `comment` write **this**
workspace's own `.alice/issues/` files (changing a peer's board is the
human-approved peer-edit path). The full on-disk file model + self-scheduling
(an issue with a `when` fires a headless run) lives in the **`self-scheduling`**
skill. `assignee` is the single ownership and dispatch contract: `@new`
recruits once and then keeps that first Session, `@workspace` recruits a new
Session each fire, `@me` resolves to the caller, and an exact `@resumeId` keeps
one accountable product Session. Omitted scheduled ownership defaults to
`@new` unless an attributable resumable caller owns it as `@me`; use
`@workspace` explicitly for fresh-every-fire work. Commit intentional
Issue-file changes as a focused Git change; Activity remains an audit fallback,
while Git is the exact rollback history. Issue/Inbox CLI actions are signed
automatically. End standalone reports with `Signed-by: @resumeId`
(copy it from `signature show`) so another Agent can return to the author.

**Upgrade this Workspace's managed template assets** — preview first, then
apply explicitly:

```bash
alice-workspace template upgrade
alice-workspace template upgrade --apply
alice-workspace template upgrade --id <workspaceId>       # manage a paused peer
alice-workspace template upgrade --id <workspaceId> --apply
```

The default call is read-only. It compares this Workspace with the current
template and lists ready changes, protected local customizations, blockers, and
conflicts. `--apply` re-plans and runs the launcher's transactional upgrade;
there is no HTTP endpoint or plan digest to copy by hand. Omit `--id` for this
Workspace, or pass a peer Workspace id when interactively managing another
desk. Applying to the current Workspace from one of its own live Sessions will
correctly remain blocked; pause it or use a separate manager Workspace. A
headless run may preview a peer but cannot apply a cross-Workspace upgrade.

If a managed file changed both locally and in the template, resolve every
conflict explicitly before applying:

```bash
alice-workspace template upgrade --mode detailed
alice-workspace template upgrade --id <workspaceId> --apply \
  --keep-workspace AGENTS.md \
  --use-template .agents/skills/alice-workspace/SKILL.md
```

Both resolution flags are repeatable. Upgrade never adopts research, reports,
Issues, credentials, runtime state, or other user files. It also refuses to run
while Sessions/headless work are active or unrelated changes are staged.
