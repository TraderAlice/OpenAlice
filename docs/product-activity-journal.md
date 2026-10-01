# Product Activity Journal

This guide owns the append-only product activity facts and their read
projections. Workspace dispatch belongs to
[[docs/workspace-issues-and-scheduling.md]]; the retired event-bus architecture
is described separately in [[docs/event-system.md]].

## Boundary

The journal answers “what did OpenAlice do for the user?” It is not an event
bus, scheduler, prompt archive, or diagnostic log:

- Producers record facts after their own durable domain writes succeed.
- Recording failure never rolls back domain work or starts another operation.
- Office, Sonner, and occupancy are independent read projections over ordered
  facts; only Agent lifecycle events participate in Office occupancy.
- Process/current-state truth stays with the Session roster and execution
  registry. A journal entry does not authorize dispatch or replay.

Product modules register an activity family and receive a scoped recorder. The
journal core does not import or start optional products. Workspace startup
installs Agent/dev and Inbox families; enabled News collection registers
per-item News facts. Other product families can use the same registration
boundary without adding a second polling or dispatch path.

## Persistence and reads

The physical journal remains `<launcherRoot>/state/agent-runtime.jsonl`, normally
`<OPENALICE_HOME>/workspaces/state/agent-runtime.jsonl`. The read API remains
`/api/agent-runtime` for released compatibility; these names do not limit the
journal to Agent events. Any physical rename requires the normal persisted-state
migration. See [[docs/data-locations.md]] for complete-home ownership.

Paged reads support event-type or family selection. Family-aware pagination
keeps sparse Inbox or News facts available even when Agent tool traffic is
dense; the unfiltered page remains the newest-first view of all facts. The
`afterSeq` cursor path returns ordered entries and `lastSeq`, with an optional
single-type filter; it does not apply the paged family filter.

Workspace occupancy and turn records are the Agent subset of this shared
journal, not a separate dispatch authority. Prompt/reply history remains a
separate conversation stream described in [[docs/conversation-provenance.md]].

## Load-bearing paths

- `src/workspaces/agent-runtime-log.ts` — family registration, append-only
  records, occupancy projection, and filtered pagination.
- `src/workspaces/service.ts` — journal location and Workspace/Inbox producers.
- `src/main.ts` and `src/domain/news/activity.ts` — optional News registration
  and bounded post-ingest payloads.
- `src/webui/routes/agent-runtime.ts` — paged and cursor HTTP reads.
- `ui/src/office/useOfficeProductActivity.ts` — Office read projection.

Regression coverage lives beside those owners, including
`src/workspaces/agent-runtime-log.spec.ts`,
`src/webui/routes/agent-runtime.spec.ts`, and
`ui/src/office/useOfficeProductActivity.spec.ts`. Test selection and side-effect
rules belong to [[docs/testing.md]].
