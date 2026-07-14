# Workspace Agent Guidance

This guide owns the instruction architecture injected into OpenAlice
Workspaces. It covers the boundary between the always-loaded Workspace
contract, discoverable skills, and the live CLI surface.

## The three layers

### 1. Always-loaded contract

`src/workspaces/templates/<template>/files/instruction.md` is composed with the
Alice persona and written to both `CLAUDE.md` and `AGENTS.md` by
`src/workspaces/context-injector.ts`.

This layer may define only durable behavior:

- how to distinguish chat, durable work, Inbox delivery, and trading;
- evidence and freshness requirements;
- when to ask an attributable Session instead of guessing;
- which skill owns a domain.

It must not duplicate flag manuals, Issue schemas, long examples, or provider
inventories. Those details change too often and crowd out the actual request.

### 2. Discoverable skills

`default/skills/*/SKILL.md` owns domain procedures and command examples. A skill
description should answer only “when should I load this?”; the body teaches the
workflow after it is selected.

One concept has one primary owner:

| Concept | Owner |
|---|---|
| Inbox, Issue collaboration, provenance, peer questions | `alice-workspace` |
| Issue file shape, ownership, schedules, headless delivery | `self-scheduling` |
| Low-frequency market/fundamental/macro data | `traderhub` |
| Quantitative K-line panels and source choice | `alice-analysis` |
| Broker state and trading writes | `alice-uta` |

Other instructions may route to that owner but should not copy its manual.

### 3. Live CLI contract

The CLI manifest and tool results are the final authority for verbs, flags, and
validation. Durable Workspaces can carry old skill snapshots, so errors should
be self-correcting: say what boundary was crossed and name the next appropriate
command. A bare validation failure that forces the agent to guess is a product
bug.

Use the real shim in the verification loop; direct tool calls do not exercise
argv parsing or manifest help.

## Snapshot and upgrade semantics

Guidance is copied into a Workspace at creation and committed as part of its
initial desk state. It is not silently replaced later: agents and users may have
edited those files, and an automatic overwrite would mutate a durable work log.

The template README version records guidance changes. Bump it when the injected
contract or bundled skill set changes materially. Existing Workspaces then show
an upgrade-available signal. Templates that opt into `managed-context` use the
explicit three-way review in [[docs/workspace-template-upgrade.md]]: launcher
changes apply, Workspace-only changes stay, and dual edits require a choice.
Live CLI help and self-correcting errors remain the compatibility layer for old
skills that a user deliberately preserves.

## Review checklist

- Is the rule durable enough to be always loaded, or does it belong in a skill?
- Does another skill already own the concept?
- Does the skill description route clearly without becoming a mini-manual?
- Can every market fact the prompt asks for be traced to a tool result or named
  artifact, with its `asOf` meaning preserved?
- If a stale agent chooses the wrong verb, does the live error lead it to the
  correct one?
- Was the template version bumped for a material injected-guidance change?
- Were context injection, the affected tool, the CLI gateway, and the real shim
  tested together?
