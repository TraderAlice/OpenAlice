# Plan: Issue comment prompt template

**Status:** active  
**Owner guides:** [[docs/workspace-issues-and-scheduling.md]], [[docs/conversation-provenance.md]]  
**Delivery:** serial PR to `dev` (`area:collaboration`).

## Goal

The comment-reply wrapper is a per-Issue template string, not a Connector
special case. Omission keeps today’s default. Chat desks set `{comment}`.

## Decisions

- Field: `commentPrompt`. Generic create/update/CLI/MCP may set it.
- Tokens: `{comment}`, `{title}`, `{id}`, `{workspaceId}`, `{author}`, `{what}`.
  Unknown tokens are invalid. `{comment}` is required.
- Phone desk only seeds `{comment}` on create / missing revive. Settings does
  not grow a second editor.

## Work

- [x] Domain parser/renderer, schema, mutate, dispatch
- [x] HTTP, tools, change tracker, skill, owner guides
- [x] Issue detail editor + i18n + demo
- [x] Telegram desk seed
- [ ] Typecheck + tests + PR

## Completion

Delete this file and its [[PLANS.md]] bullet when accepted.
