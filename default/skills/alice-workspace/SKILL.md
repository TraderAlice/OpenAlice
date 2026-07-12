---
name: alice-workspace
description: >
  Use the `alice-workspace` CLI for collaboration and provenance: Inbox
  delivery, the global Issue board, tracked entities, peer files, and asking an
  attributable product Session. Use it when work must be surfaced, remembered,
  assigned, or followed back to the Agent that produced it. Read live help;
  never guess flags or use `issue comment` as a substitute for `issue ask`.
---

# Collaboration — `alice-workspace`

Choose the verb from the intent, not from whichever object you happen to have:

| Intent | Command family |
|---|---|
| Tell the human about finished/asynchronous work | `inbox push` |
| Read what desks already surfaced | `inbox read` |
| Ask why one Inbox entry was produced | `inbox ask` |
| Inspect the shared work board | `issue list` / `issue show` |
| Ask an Issue's creator, owner, or selected run | `issue ask` |
| Record a note on this Workspace's own Issue | `issue comment` |
| Ask by a known product Session/Workspace only when no business object exists | `conversation ask` |

`issue comment` is a structured note for the human-visible board. It is a
local write and **does not message or resume another agent**. When the goal is
to obtain an answer, use `inbox ask` or `issue ask`, normally with `--await`.

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
  --prompt 'Reconstruct why this artifact was produced.' --await
alice-workspace conversation await --task-id <taskId>
alice-workspace conversation collect --task-id <taskA> --task-id <taskB>
alice-workspace conversation read --task-id <taskId>
```

Prefer the Inbox/Issue commands: they resolve provenance without making you
extract `resumeId` or `wsId`. `issue ask` defaults to `--creator`; `--owner`
requires a stable resume owner, while `--run-id` selects one exact run Session.
Use the lower-level conversation command only when no business object already
identifies whom to ask. Never construct or pass an internal target JSON object.

For one question, start with `ask --await`: OpenAlice waits server-side and
returns the final reply without making you guess a sleep duration. For several
independent peers, issue every `ask` first without `--await` so all tasks run
concurrently, then pass every short task id to one `conversation collect` call.
If collect reports a task still `running`, do other useful work and collect
again later or use one-shot `conversation read`; never build a shell `sleep`
polling loop.

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
alice-workspace issue comment --id <id> --text "progress note / finding"
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
skill. `assignee` is the single ownership and dispatch contract: `@workspace`
recruits a new Session each fire, `@me` resolves to the caller, and an exact
`@resumeId` keeps one accountable product Session. Issue/Inbox CLI actions are
signed automatically. End standalone reports with `Signed-by: @resumeId`
(copy it from `signature show`) so another Agent can return to the author.
