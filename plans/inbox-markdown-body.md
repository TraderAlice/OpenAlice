# Inbox Markdown body

Status: implementing. Related issues: none; maintainer-requested Inbox unification.
Owners: docs/connector-service.md, docs/workspace-agent-guidance.md,
docs/alice-harness.md, docs/ui-interaction-and-motion.md, docs/testing.md.

## Scope and decisions
- One immutable Markdown body, with live Workspace-relative `[[file.ext]]` references.
- Share the reference grammar with Connector replies. Literal code and unknown references stay literal.
- CLI body-file reads Markdown at publication; AI reads expose safe absolute paths, never file contents.
- Preserve origin/read state and published file hashes in a one-time JSONL migration.
- UI renders references in place with keyboard-accessible file previews; no separate attachment section.
- Connector and Office derive file projections from the body, not an independent attachment list.

## Checklist
- [ ] Shared parser, store, migration, push/read and CLI authoring
- [ ] UI, Office, Connector consumers and demo fixtures
- [ ] English Skills and owner documentation
- [ ] Tests, typechecks, real CLI and browser acceptance
- [ ] Serial dev PR and merge

## Verification and completion
Root/UI/protocol/Connector typechecks; full hermetic suite; idempotent migration,
source-Workspace path containment, body-file shim and real Inbox browser route.
No external messages or trades are part of acceptance. Complete when all affected
surfaces use the new contract, acceptance is recorded and the dev PR is merged.
