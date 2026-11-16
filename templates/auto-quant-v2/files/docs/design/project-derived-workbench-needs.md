# Project-derived Workbench needs

Status: implemented.

Related: [[docs/design/agent-native-quant-workbench]],
[[docs/design/agent-operator-experience]],
[[docs/design/documentation-system]], and [[docs/PROJECT_FORMAT]].

## Purpose

AutoQuant development has two connected work streams:

```text
Project research
→ Quant Agent attempts a real assignment
→ evidence, result, or concrete missing capability

Workbench development
→ inspect Project-derived need
→ reproduce and generalize the gap
→ design, plan, implement, and verify a Core improvement
→ return to Project research
```

Research briefs must describe investment questions, not become framework issue
trackers. Repository plans must describe accepted framework work, not invent
needs without evidence. A Project-root `framework-needs.md` connects the two.

## Project surface

Every new Project contains English Agent-maintained Markdown:

```text
framework-needs.md
```

It is intentionally not a strict schema. A useful need records:

- the research context and attempted hypothesis;
- the missing or misleading Workbench capability;
- concrete evidence, failure, or blocked expression;
- the smallest useful Core improvement the Agent can currently see;
- any temporary Project workaround and its scientific cost;
- whether the need is open, promoted to a repository plan, resolved, or no
  longer relevant.

The Agent records only needs encountered during actual work. It does not stop
research for cosmetic preferences, turn every local implementation choice into
a framework request, or edit Harness authority to bypass a fixed Judge.

## Promotion boundary

A Workbench developer reviews the Project note and decides whether the need is:

- Project-specific research code;
- missing documentation or orientation;
- a reusable template improvement;
- a Core contract or runtime gap;
- unsupported because it violates evidence or authority boundaries.

Reusable accepted work receives a repository design document and indexed plan.
The original Project note remains durable provenance and can later link the
fix, version, and result of retrying the research.

No parser automatically files issues, mutates Core, or treats Markdown status
as machine authority. Agent communication or an optional host may carry the
note between desks; files remain sufficient in standalone use.

## Session boundary

The canonical Project owns the writable note. A governed Session worktree
receives a protected copy for orientation because candidate operations may
modify only the Study-declared editable closure. The Quant Agent records a
Workbench need in the canonical Project before starting that operation or
after returning from it; the note never becomes part of an Experiment diff,
candidate hash, or scientific promotion decision.

This preserves the one-writable-root rule while keeping the feedback surface
available to standalone and hosted Agents.

## Working-language boundary

`framework-needs.md` is internal AutoQuant material and uses English. Caller
conversation can use any language. The user-facing Agent may translate the
research problem or delivered result without forcing localized framework
files.

## Invariants

1. `research.md` owns the quantitative assignment.
2. `framework-needs.md` owns Project-observed Workbench gaps.
3. `plans/` coordinates accepted repository implementation.
4. `docs/design/` owns durable Core intent and invariants.
5. A Project need is evidence, not automatic implementation authority.
6. Fixing Core never rewrites immutable historical Run evidence.
7. Session worktrees expose `framework-needs.md` as protected orientation,
   never as candidate source.
