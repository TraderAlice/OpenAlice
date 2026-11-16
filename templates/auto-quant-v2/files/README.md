---
version: 0.9.34
---

# AutoQuant V2

AutoQuant turns quantitative research into a versioned, testable,
Agent-operable engineering workflow.

It is an AI-native quantitative workbench, not only a backtest library,
strategy generator, or integration backend. A coding Agent can enter the
filesystem, understand the current question and evidence, take one bounded
action, evaluate through fixed contracts, resume after interruption, and
leave durable work for another Agent or human reviewer.

```text
long-lived Workspace
└── Project
    ├── research question and content-locked inputs
    ├── fixed Studies and bounded Research Sessions
    ├── factors, portfolios, ML/RL policies, and simulations
    └── immutable Runs, Reports, Reviews, and Dossiers
```

One Workspace may hold many self-contained Projects. A Project is one evolving
body of research; a Study locks one evaluation question; a Research Session is
a bounded editable investigation; a Run is an immutable measurement.

## Current release: `0.9.34`

[Current status](docs/STATUS.md) states what this checkout can honestly do.
[Release history](docs/CHANGELOG.md) indexes bounded outcomes, and
[versioning and release](docs/design/versioning-and-release.md) owns version
increments, checkout behavior, audits, tags, compatibility, and host pins.

## Standalone or an OpenAlice desk

AutoQuant has one product shape in both environments:

```text
standalone clone                    OpenAlice Trading Harness
└── AutoQuant Workspace             └── AutoQuant Workspace desk
    └── Quant Agent                     └── Quant coworker
        └── Projects                        └── Projects
```

Standalone, a human or Agent operates the workbench directly. Inside
OpenAlice, the unchanged repository becomes a specialized Workspace desk that
can receive a quantitative assignment from another coworker and return an
evidence-bound report. AutoQuant owns research and historical simulation;
brokers, authenticated accounts, approvals, and live order submission remain
outside it.

## Quick start

AutoQuant requires Python 3.11 and [uv](https://docs.astral.sh/uv/).

```bash
git clone git@github.com:TraderAlice/Auto-Quant-V2.git
cd Auto-Quant-V2
uv sync --frozen

uv run aq --version
uv run aq project list .
uv run aq validate .
uv run aq orient . --json
uv run aq studio serve .
```

The repository root is already a Workspace. Its checked-in
`projects/sample-research-desk` is a deterministic teaching Project with
inspectable historical evidence, not a real assignment.

Start genuinely new work as a sibling Project:

```bash
uv run aq project templates --json
uv run aq project create . research-desk \
  --name "Research Desk" \
  --description "Bound and investigate the delegated question" \
  --template blank \
  --json
uv run aq orient . --project research-desk --json
```

Before quantitative work, the Agent rewrites the new Project's `research.md`
in English and asks about every caller-owned ambiguity that could materially
change the answer. Template choice, data acquisition, strict intake, governed
iteration, evidence publication, and Studio review are covered by the
[operator guide](docs/OPERATOR_GUIDE.md).

## What lives where

- Workspace: Project discovery and the standardized AutoQuant Harness.
- Project: the question, source authority, strategies/models, Studies, Runs,
  Sessions, and durable deliverables for one evolving body of research.
- Factor: causal predictive evidence over a caller-bound outcome.
- Portfolio: target-weight construction, risk, cost, and implementation
  evidence from qualified return research.
- Governed RL: bounded adaptive value beyond fixed factor sleeves; never a
  shortcut around the same portfolio and evidence contracts.
- Fixed research routes: descriptive Book Risk, price Event, path Stress, and
  strategic Allocation questions that do not pretend to need editable models.

Ordinary factor code receives one long-form pandas panel rather than a
proprietary DSL. CSV works in the base environment; Parquet and Feather use
`uv sync --extra columnar`.

## Documentation map

| Need | Canonical document |
| --- | --- |
| Operate a Workspace end to end | [Operator guide](docs/OPERATOR_GUIDE.md) |
| See current tested capability and limits | [Status](docs/STATUS.md) |
| Discover commands and JSON contracts | [CLI](docs/CLI.md) |
| Understand Workspace and Project files | [Project format](docs/PROJECT_FORMAT.md) |
| Understand Core ownership and boundaries | [Architecture](docs/ARCHITECTURE.md) |
| Change versions or publish a release | [Versioning and release](docs/design/versioning-and-release.md) |
| Scan published outcomes | [Changelog](docs/CHANGELOG.md) |
| Contribute framework changes | [AGENTS.md](AGENTS.md) and [PLANS.md](PLANS.md) |

## Repository structure

```text
Auto-Quant-V2/
├── autoquant-workspace.json  # checked-in root Workspace
├── autoquant/                # Core, CLI, templates, Skills, and Studio
├── projects/                 # sample plus ordinary research Projects
├── docs/                     # operator references and design invariants
├── plans/                    # bounded engineering execution records
├── scripts/                  # repository checks
├── tests/                    # deterministic bounded verification
├── AGENTS.md                 # contributor and Agent routing guide
└── PLANS.md                  # active/completed plan index
```

Auto-Quant Classic and its flat Freqtrade arena are retired from the current
tree; Git history remains their archive.

## Development

Read [AGENTS.md](AGENTS.md), [PLANS.md](PLANS.md), and the active plan before
non-trivial changes. Do not launch an unbounded autonomous loop or use a long
multi-year backtest as routine validation.

```bash
uv run python scripts/check_doc_links.py
uv run python -m unittest discover -s tests -v
uv build
```

## License

MIT.
