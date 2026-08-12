# Session birth metadata

Status: completed (accepted and delivered in PR #1064)

Owner guides: [[docs/conversation-provenance.md]]

## Goal

Stamp immutable `metadata.createdBy` on product Sessions (`resumeId`) at
allocation so operators can tell how a coworker was hired: interactive spawn /
quick-chat / Issue recruit / agent conversation / manual headless.

## Decisions

- Hang birth on `ResumeIdentityRecord.metadata`, not `SessionRecord`.
- First-write-wins inside `ResumeRegistry.ensure`.
- Server-stamped only; agents cannot claim birth via tool args.
- Historical identities without metadata remain valid (unknown birth).
- No UI badge in this topic; Session Directory projects `createdBy`.

## Checklist

- [x] `session-metadata.ts` types + parse
- [x] ResumeRegistry persist / ignore rewrite
- [x] Interactive spawn hooks
- [x] Headless dispatch + Issue scanner + conversation control
- [x] Session Directory + owner-guide note
- [x] Session Directory projection regression coverage
- [x] Verification (`tsc` + targeted tests)
- [x] Topic accepted and delivered — #1064

## Residual risk

Pre-ship Sessions have no birth bag. Exact continues never rewrite birth.
