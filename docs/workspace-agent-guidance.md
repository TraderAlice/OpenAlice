# Workspace Agent Guidance

This guide owns instruction architecture injected into Workspaces: the
always-loaded contract, discoverable Skills, and live CLI authority. It does not
duplicate command manuals, Issue schemas, provider inventories, or UI behavior.

## Three layers

### Always-loaded contract

`src/workspaces/templates/<template>/files/instruction.md` is written to
`CLAUDE.md` and `AGENTS.md` by `src/workspaces/context-injector.ts`. Chat owns its
baseline identity in this file; there is no mutable installation-wide persona
source. Templates may opt out to preserve upstream instructions.

This layer contains only durable behavior: chat versus durable work versus
Inbox/trading, evidence and freshness, attributable follow-up, and domain-skill
routing. Flag manuals, schemas, long examples, and volatile catalogs belong
elsewhere.

### Discoverable Skills

`default/skills/*/SKILL.md` owns domain procedures and examples. Descriptions
answer when to load the Skill; bodies teach the selected workflow. One concept
has one primary owner and other guidance routes rather than copying its manual.

| Concept | Primary Skill |
|---|---|
| Inbox, Issue collaboration, provenance, peers, Session nametags | `alice` |
| Connector reply attachments | `file-delivery` |
| Chat → AutoQuant delegation | `delegate-autoquant` |
| Issue shape, schedules, headless delivery | `self-scheduling` |
| Low-frequency market/fundamental/macro data | `traderhub` |
| K-line discovery, OHLCV, chart references | `market-data` |
| Optional quantitative formulas/snapshots | `alice-analysis` |
| Broker reads and trading writes | `alice-uta` |

`alice-analysis` is a Skill name, not a fourth public CLI shim.

### Live CLI contract

The CLI manifest and tool results are final authority for verbs, flags, and
validation. Durable Workspaces may carry old Skills, so errors must identify the
crossed boundary and suggest a current semantic recovery command. Unknown flags
and positionals fail before invocation with accepted shape; bare failures that
force guessing are product bugs.

The three public CLI names are authority boundaries:

| CLI | Boundary |
|---|---|
| `alice` | Research/feed data, K-lines, Workspace collaboration, Inbox, Issues, Sessions, tracked assets |
| `traderhub` | Low-frequency boards, fundamentals, macro, calendars |
| `alice-uta` | Broker reads and explicit trading mutations/approval flow |

`alice-workspace` is only a compatibility alias for old scripts. New guidance
uses `alice`; it must not reappear as a current binary or Skill owner. The live
manifest, not a copied table, owns detailed command syntax.

Use the real shim in verification. Direct tool calls do not exercise argv
parsing, PATH resolution, manifest help, or stale-syntax recovery.

`alice inbox read` returns safe absolute attachment paths when available.
`peer path` is a lower-level Workspace addressing primitive. Native Agent file,
search, and Git tools own subsequent reads; do not grow a second Workspace file
API to reproduce them.

## Snapshots and upgrades

Guidance is copied and committed at Workspace creation. It is never silently
replaced later because users and Agents may have edited durable files. Material
template contract/Skill changes bump the owning template version; managed-context
Workspaces use explicit three-way review in
[[docs/workspace-template-upgrade.md]].

Alice Harness injection releases are independent. CLI follows the running
Project; only copied Skills need explicit update. Settings → Workspace injection
owns prototypes, comparisons, preferences, and batch updates under
[[docs/alice-harness.md]]. Updating those Skills does not require Chat/AQ/AP
template version bumps. Live CLI help remains the compatibility layer for old
copies users preserve.

## Read-only capability browser

Workspace details inventories instructions, Skills, and Alice Harness CLI
manifests. `.agents/skills` is primary, `.claude/skills` its mirror, and
`.pi/skills` legacy; location or divergence does not change ownership. Project
names come from the Project catalog, not a frontend allowlist.

Comparison covers complete Skill directories. Missing, changed, unreadable, or
traversal-limited entries remain explicit; unverified never means equal. This
read-only disk snapshot is not proof of native loading or a sync service.
CLI pages consume authenticated live manifests with no invoke route; displaying
or copying a command never runs it.

## Review and verification

Choose the lowest-volume owning layer and avoid copying volatile examples.
Bump only the owning release for material changes. Verify context injection,
tool, gateway, and real shim together; cover fresh and existing Workspaces when
snapshot behavior changes. Use [[docs/development-workflow.md]] for checks.
