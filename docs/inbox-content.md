# Inbox content

Inbox is an outward-facing notification/report to the human. It is not a file
store or peer messaging bus. Its only authored content is Markdown `body`.

`alice inbox push --body 'See [[reports/close.pdf]]'` publishes a message with a
live file reference. `alice inbox push --body-file reports/close.md` reads that
Markdown into the immutable body. All references use the publishing Workspace
root, including references inside a body-file; the Markdown file's parent is
not a separate base directory.

File references preserve body order. Code spans/fences, escaped brackets,
unknown references, and unavailable files remain literal. Files stay owned by
the Workspace; publication records optional `fileRevisions` hashes, not file
copies. Deleting a Workspace never removes the published body. Migration 0043
converts shipped comments/docs records once and leaves the read-state sidecar
untouched. There is no legacy authoring or dual-read contract.

## Shared ownership

- `content-references.ts` in Connector Protocol owns the pure bracket grammar
  and `inboxFiles` derived index. It does not read files or send messages.
- Alice `core/inbox-files.ts` resolves existing readable files within the source
  Workspace, including realpath containment. CLI reads return absolute paths
  and published revisions without expanding file contents.
- `/api/inbox/:id/files` resolves the derived index. File delivery by index
  rechecks the authoritative entry and source Workspace; callers cannot select
  a different Workspace or arbitrary path. Downloads are bounded and active
  content is never served as same-origin HTML.
- `useInboxContent(entry)` owns UI derivation, availability, errors/retry and
  lazy preview. It discards responses from an earlier selection. Summary-only
  consumers use `resolveFiles: false`. Inbox and Office share this projection.
- `MarkdownContent` renders available file references in their original position
  using exact-case paths. The shared Dialog owns focus, keyboard dismissal and
  responsive previews. There is no separate Inbox attachment section.
- Connector notifications carry the body unchanged. The existing bounded
  adapter upload / Telegram on-demand file controls derive their files from it.
  Connector alone decides channel delivery and automation `[[no-reply]]` rules;
  Inbox publication never treats that marker as a command to discard a report.
