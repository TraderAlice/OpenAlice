---
name: alice-workspace
description: >
  Agent collaboration on your shell PATH via the `alice-workspace` CLI: push
  finished work to the user's Inbox (`inbox push`, with repeatable `--doc`
  file attachments), read the inbox back (`inbox read`, `--self` for your own
  pushes), locate a peer workspace's files to read/edit them (`peer path`),
  track entities across workspaces (`track`), and read & manage the
  cross-workspace issue board (`issue list`/`show`/`create`/`update`/`comment`).
  Use for: "push my findings to the inbox", "surface this report to the user",
  "what did I already report?", "read the file another workspace sent", "track
  this ticker", "what's on the issue board?", "what was I working on?", "add or
  update an issue". Workspaces collaborate through git — commit before you push,
  and commit after you edit a peer's files. Discover flags with
  `alice-workspace --help` — do NOT guess.
---

# Collaboration — `alice-workspace`

**Hand finished work back to the user** — this is the outbound channel. It posts
to the user's Inbox tab:

```bash
alice-workspace inbox push --doc research/tsla.md --comments "Done — TSLA looks extended; details in the doc."
```

(Attach files with repeatable `--doc <path>` — workspace-relative; each renders
live in the inbox UI, not snapshotted. `--comments` is your markdown note. At
least one of `--doc` / `--comments` must be present.)

> **Commit before you push.** The inbox renders your files live, not a snapshot —
> a `git commit` is the only durable record of what you actually sent. Skip it and
> a later edit (yours or a collaborator's) silently rewrites what the entry shows,
> with nothing to recover.

**Look back at the inbox** — recall what's been surfaced, newest first:

```bash
alice-workspace inbox read --self            # only your own pushes
alice-workspace inbox read --limit 5         # latest 5 across all workspaces
```

(`--self` narrows to entries THIS workspace pushed — their `docs` paths are
relative to your own workspace root, so you can open them straight from the
shell. Each entry also carries a `workspaceId`; for entries from OTHER
workspaces, that's the handle to locate their files — see below. `--limit` caps
the window, default 20.)

**Read & edit a peer's files** — workspaces collaborate; another workspace's docs
are reachable. Resolve the peer's absolute dir by its `workspaceId`, then use your
own file tools:

```bash
# --id is the `workspaceId` from an inbox_read entry (a uuid), e.g.:
alice-workspace peer path --id 550e8400-e29b-41d4-a716-446655440000
# -> { path: "/…/workspaces/550e8400-…", tag, id }
# then read <path>/<the doc path from the inbox entry> with your native tools
```

(Reading a peer's files is fine. For your OWN entries you don't need this at all;
their doc paths are already relative to your cwd.)

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
alice-workspace issue show --id <name>      # one issue in full — body + run history + inbox reports (resolves the name across the board)
alice-workspace issue create --title "…"    # a new issue on THIS workspace's board
alice-workspace issue update --id <id> --status in_progress
alice-workspace issue comment --id <id> --text "progress note / finding"
```

Work it like a human board: start with plain `list`, decide which focus rows
matter, then `show --id <name>` to read those in full. Plain `list` is deliberately
curated for startup so old low-priority scheduled items do not distract you; use
`--mode detailed` only when you are auditing the full board. `list` / `show` span
the whole board (all workspaces); `create` / `update` / `comment` write **this**
workspace's own `.alice/issues/` files (changing a peer's board is the
human-approved peer-edit path). The full on-disk file model + self-scheduling
(an issue with a `when` fires a headless run) lives in the **`self-scheduling`**
skill.
