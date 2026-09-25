---
name: tool-audit
description: >
  Audit OpenAlice's AI tools end-to-end — call each one (using its declared
  example input as the starting point), judge whether it runs, whether its
  description / params / output are good, and write a review with concrete
  "how to change it" notes. Use when the developer wants to dogfood the tool
  surface, find tools that are broken / thin / confusing, or get an
  optimization to-do list: "audit the tools", "which tools are broken",
  "review all the MCP tools", "test the tool surface", "go use every tool and
  tell me what to fix". A half-automatic regression + tool-optimization input.
---

# Tool audit

You are auditing OpenAlice's AI tool surface from the **developer** side — not
inside a workspace. Read [[docs/workspace-agent-guidance.md]] and
[[docs/testing.md]] first. Audit the real CLI shims (`alice`, `traderhub`,
`alice-uta`) and their live manifests; MCP is an additional surface where
configured, not a prerequisite for CLI verification.

## 0. Preconditions — check first, don't skip

1. **Resolve the actual target and endpoint.** Use an isolated test home and
   inspect its startup output, CLI routing environment, and runtime status.
   Port 47332 is a historical default, not evidence of the current endpoint.
   From outside a Workspace, use `openalice exec --project <key> <cli> ...`;
   consult `--help` and the live manifest before selecting flags. For an
   explicitly requested saved remote target, use
   `openalice --machine <id-or-label> exec --project <key> <cli> ...`.
   Remote paths belong to that host. An unavailable MCP connector does not
   block source review or real CLI checks. Record unavailable surfaces instead
   of changing user configuration or starting their normal broker environment.
2. **You have the source.** This is the repo — read `src/tool/*.ts` (and
   `src/core/workspace-tool-center.ts` for workspace-scoped tools) to get the
   authoritative, complete tool list and each tool's intent, instead of relying
   only on what a toolset surfaces. Cross-check the live export registry and
   enabled capabilities before calling an absent tool a defect.

## 1. Each tool's example IS your starting fixture

When the current schema includes `examples`, use one as the starting fixture
after checking its side effects. Replace sample ids and paths with isolated
fixtures. When absent, derive the smallest valid input from live help/schema
and note the documentation gap. Do not assume every tool uses the same schema
library or that a sample is safe to run against user state.

## 2. Procedure — per tool

Go through **every** tool. For each:

1. Read its `description` and input schema (params + the declared `example`).
2. Invoke it through the real CLI shim where exported, using isolated fixtures
   and the side-effect rules below. MCP-only calls do not prove argv parsing,
   routing, flag help, or CLI output. Record which surface was actually used.
3. Record a verdict on five axes:
   - **Runs?** — did it return a result, or error / hang / throw? Capture the
     exact error.
   - **Description** — does it tell the model clearly what the tool does, when
     to use it, and what it returns? Misleading or stale wording is a bug
     (e.g. a default that doesn't match behavior).
   - **Params** — are they coherent? Any dead params (declared but ignored),
     missing required ones, confusing names, or shapes the model will fumble?
   - **Output** — is the returned JSON useful and legible to a model, or thin /
     dumping raw vendor fields / empty when it shouldn't be?
   - **Example** — is the declared example representative and runnable?

## 3. Safety — do NOT execute broker mutations

These **stage or place real broker operations**. Do NOT call them — audit them
statically (read schema + description + the staging flow in `src/tool/trading.ts`)
and review the example without invoking:

> `placeOrder`, `modifyOrder`, `closePosition`, `cancelOrder`,
> `tradingCommit`, `tradingPush`, `tradingSync`

Inspect each tool's current implementation and test lane before invocation;
the names above are examples, not a complete mutation denylist. Run local
writes such as `entity_upsert` only against isolated fixtures. External
read-only calls require the task's external-read scope; broker reads and live
paper work follow [[docs/uta-live-testing.md]]. Do not send messages, dispatch
Issues, or alter user files merely because a tool has no trading effect.

When a read-only tool errors because no broker account is configured / market
is closed / a vendor key is missing, that's an **environment** result, not a
tool bug — say so and don't count it against the tool. The bug bar is: does the
tool itself misbehave given a reasonable input?

## 4. Output — a review file

Return the review in the task; write a temporary artifact only if useful.
Concrete deferred defects follow the GitHub Issue contract in
[[docs/development-workflow.md]], not a repository TODO file. Structure:

- A one-line **summary**: N tools, X ran clean, Y errored, Z have description/
  param/output issues.
- A **table** — one row per tool: `tool | ran? | issues | how to change it`.
  Keep "how to change it" concrete and actionable (the point is a fix list,
  not vibes): e.g. "ratios: `period`/`limit` were dead until ttm:'include' —
  good now; output still dumps raw FMP fields under non-aliased names."
- A short **"top fixes"** list — the handful worth doing first.

Be a skeptic, not a cheerleader: the value is in the problems found. If a tool
is genuinely fine, one word ("clean") is enough — spend the words on what's broken.
