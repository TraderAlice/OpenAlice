# Workspace Agent Guidance

This guide owns the instruction architecture injected into OpenAlice
Workspaces. It covers the boundary between the always-loaded Workspace
contract, discoverable skills, and the live CLI surface.

## The three layers

### 1. Always-loaded contract

`src/workspaces/templates/<template>/files/instruction.md` is composed with the
Alice persona and written to both `CLAUDE.md` and `AGENTS.md` by
`src/workspaces/context-injector.ts`.

Templates may opt out of this persona layer with `injectPersona: false`.
AutoQuant V2 does so to preserve the upstream `AGENTS.md`; OpenAlice adds only
discoverable collaboration/data/trading skills alongside it.

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
| Delegating quantitative research from Chat to AutoQuant | `delegate-autoquant` |
| Issue file shape, ownership, schedules, headless delivery | `self-scheduling` |
| Low-frequency market/fundamental/macro data | `traderhub` |
| Quantitative K-line panels and source choice | `alice-analysis` |
| Broker accounts/contracts/quotes and trading writes | `alice-uta` |

Other instructions may route to that owner but should not copy its manual.

### 3. Live CLI contract

The CLI manifest and tool results are the final authority for verbs, flags, and
validation. Durable Workspaces can carry old skill snapshots, so errors should
be self-correcting: say what boundary was crossed and name the next appropriate
command. Reject unknown flags and positional arguments before invocation, show
the accepted flags, and give a semantic recovery command for common old or
guessed routes. A bare validation failure that forces the agent to guess is a
product bug.

Use the real shim in the verification loop; direct tool calls do not exercise
argv parsing or manifest help.

The four public CLI names are deliberate authority boundaries rather than one
flat command bag:

| CLI | Boundary |
|---|---|
| `alice` | Workspace research data, subscribed-feed archive, symbols, and bounded K-line analysis |
| `traderhub` | Low-frequency boards, fundamentals, macro, and calendars |
| `alice-workspace` | Peer addressing, Agent conversation, human Inbox delivery, durable work, and provenance |
| `alice-uta` | Broker reads plus explicit trading mutations and approval flow |

Every export manifest supplies intent-first descriptions for its command
groups. Top-level and group help must explain which namespace owns an action
before listing verbs. Skills may teach workflows, but an old copied skill must
be able to recover from current live help.

`alice-workspace inbox read` projects each attached document with a directly
usable absolute path when its source Workspace is available. `peer path` is the
lower-level addressing primitive for inspecting that desk. In both cases,
native Coding Agent file, search, and Git capabilities own the read flow. Do
not grow a second Workspace file API merely to reproduce those capabilities;
adapter permission problems belong at the runtime boundary.

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
