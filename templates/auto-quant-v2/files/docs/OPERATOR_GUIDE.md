# AutoQuant operator guide

Status: current standalone and hosted Workspace workflow.

Related: [[README]], [[docs/STATUS]], [[docs/CLI]],
[[docs/PROJECT_FORMAT]], [[docs/STUDIO]],
[[docs/design/agent-native-quant-workbench]], and
[[docs/design/quant-research-lifecycle]].

## Purpose

This is the end-to-end operating path for a human or coding Agent using an
AutoQuant Workspace. It connects the public commands without duplicating their
complete schemas or the quantitative invariants owned by subsystem design
documents. Use `aq capabilities --json`, `aq schema ... --json`, and
[[docs/CLI]] as the executable command authority.

AutoQuant owns quantitative research and historical simulation. It may model
target portfolios, orders, or TP/SL when a fixed research question needs them,
but it does not own authenticated positions, broker credentials, approvals,
live reconciliation, or order submission. A host such as OpenAlice retains
that authority.

## Enter the Workspace

The repository clone is already a long-lived Workspace with one ordinary
teaching Project:

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

For deeper machine discovery, use `uv run aq version --json` and
`uv run aq capabilities --json`. The former exposes exact build provenance;
the latter describes the complete current command surface.

`orient` is the primary Agent entry. It returns the current question, verified
evidence, editable and protected paths, blocker or terminal state, and at most
one primary next action. Re-read it after every state-changing command.

The checked-in `sample-research-desk` is an inspectable fixture, not a place to
put a real assignment. A separate installation can create an empty Workspace
with `aq workspace init <directory>`; see [[docs/PROJECT_FORMAT]].

### Framework developer Project location

Normal users keep durable research under the root `projects/`. A Workbench
developer with a separate research collection may add the Git-ignored
`autoquant-workspace.local.json` beside the checked-in manifest:

```json
{
  "default_project": "my-current-research",
  "name": "AutoQuant Development Desk",
  "projects_directory": "../quant-workspace/projects",
  "schema_version": 1
}
```

It is a complete strict manifest, not a partial overlay. Relative paths resolve
from the Workspace root; absolute paths are also allowed. Invalid local
configuration fails explicitly. CLI and Studio disclose the effective Projects
directory and `configurationSource` so an Agent does not guess which desk it is
operating.

## Start a real assignment

First inspect the route catalogue, then create one construction site:

```bash
uv run aq project templates --json
uv run aq project create . research-desk \
  --name "Research Desk" \
  --description "Coordinate evidence for the delegated question" \
  --template blank \
  --json
uv run aq orient . --project research-desk --json
```

Use `blank` while the research method is unclear. Choose a specialized
Factor, Portfolio, RL, Book Risk, Event, Allocation, or coordinated Research
Desk template only after the question fits its public positive and anti-fit
contract. The authoritative catalogue is `aq project templates`; current file
ownership is in [[docs/PROJECT_FORMAT]].

### Clarify before construction

Before downloading data, binding a Study, editing a candidate, or running an
evaluation:

1. Rewrite the Project-root `research.md` in English.
2. State the decision being supported, exact question, motivation, asset and
   time scope, horizon/cadence, available authority, constraints, evaluation
   meaning, expected deliverable, assumptions, and open questions.
3. Separate caller-owned intent from researcher-owned method. The Agent may
   choose features and diagnostics; it may not invent universe, direction,
   benchmark, risk appetite, hard constraints, or what counts as useful.
4. Ask the caller about every ambiguity that could materially change the
   answer. Record the answer and ask again if it exposes another ambiguity.
5. Only then derive strict request, dataset, Study, Judge, or mandate files.

The caller may converse in any language. English inside the desk gives later
Agents one stable recoverable research surface.

## Acquire and bind data

Data acquisition is demand-led. Existing bytes never limit which market,
symbol, interval, or history the Agent may research, and cross-Project
deduplication is optional storage work rather than research authority.

When a matching package is not already supplied, start with the Workspace's
`$acquire-market-ohlcv` Skill. It routes the fixed question to market-specific
provider procedures, retains raw responses and transformation audits under
Workspace staging, and requires two independently executable sources for
accepted coverage. `$package-autoquant-ohlcv` converts the selected evidence
into the strict package contract. Run bundled procedures with `aq-python`, not
an ambient Python interpreter. See
[[docs/design/agent-native-market-data-acquisition]].

Package asset paths resolve from the directory containing the dataset manifest.
If bytes live under `staging/raw-ohlcv/`, put `dataset-package.json` at
`staging/` and use paths such as `raw-ohlcv/AAPL.csv`. Parent paths, absolute
paths, and symlinks are rejected. Intake still creates an intentional
Project-local normalized and content-locked snapshot.

Discover the strict contracts and use atomic Project intake:

```bash
uv run aq schema research-request --json
uv run aq schema ohlcv-dataset-package --json
uv run aq project intake . research-desk \
  --request research-request.json \
  --dataset /path/to/dataset-package.json \
  --template ohlcv-research-desk \
  --json
```

The request can bind asset roles, horizons, benchmark, decision cadence,
market clock, portfolio caps, risk/cost assumptions, outcome semantics, and
fixed-study policies. Those are immutable research assumptions, never live
position or execution authority. Exact intake and snapshot semantics live in
[[docs/design/research-intake-and-dataset-snapshots]].

## Work with Factors, Portfolios, and governed RL

Factor candidates use an ordinary long-form pandas panel rather than a private
DSL:

```python
def compute_factor(panel: pd.DataFrame) -> pd.Series:
    momentum = panel.groupby("asset")["close"].pct_change(20)
    return momentum.groupby(panel["timestamp"]).rank(pct=True)
```

The complete Study universe is available at the same or an earlier completed
timestamp. Missing asynchronous observations remain missing unless candidate
code performs an explicit causal backward as-of operation. Core never inserts
an implicit cross-market fill. See [[docs/design/panel-native-factor-api]].

A fresh editable Study preflights its canonical candidate before publishing a
complete baseline or opening a disposable Session worktree:

```bash
uv run aq session start . --project research-desk \
  --study factor-quality --json

# Edit only the returned Session worktree closure.
uv run aq session check . --session session-... --json

uv run aq experiment evaluate . --session session-... \
  --hypothesis "Add volatility normalization" --json

uv run aq session promote . --session session-... --json
```

The fixed Judge alone publishes metrics and KEEP, REVERT, or CRASH evidence.
Promotion is a separate guarded operation. Session writability is not an
instruction to tune forever: re-read `aq orient` and follow the verified
research stage, evidence disposition, and exact next action.

An explicit external coding-Agent command can drive the same bounded loop:

```bash
uv run aq research run . --session session-... \
  --agent-command 'my-coding-agent --autoquant-research' \
  --max-turns 5 \
  --max-wall-seconds 900 \
  --turn-timeout-seconds 300 \
  --json
```

AutoQuant protects fixed authority and retains every turn and evaluation. The
scientific lifecycle, selection discipline, and downstream evidence gates are
defined in [[docs/design/quant-research-lifecycle]].

## Read and publish evidence

Runs are immutable measurements. Factor, Portfolio, governed RL, and fixed
research routes publish method-specific metrics and artifacts through the same
RunResult boundary. Reports bind analysis to one exact Run or completed
Session; coordinated programs may compose lane Reports into one Project
Dossier.

```bash
uv run aq inspect . --project research-desk --json
uv run aq report draft . --project research-desk \
  --study factor-quality --run run-... \
  --output report-analysis.json --json
# Edit the scaffold, replace its reserved finding, and set authoringState=final.
uv run aq report publish . --project research-desk \
  --study factor-quality --run run-... \
  --analysis report-analysis.json --json
uv run aq dossier status . --project research-desk --json
uv run aq dossier publish . --project research-desk \
  --analysis dossier-analysis.json --json
```

`report draft` is optional, refuses overwrite, and only pre-fills verified
identity and artifact references. The Agent still owns every conclusion; a
draft or reserved placeholder cannot be published. Use the command and schema
discovery output for the exact lineage required by the current route. A Report
or Dossier is a durable Project artifact, not a mandatory RPC response. It can
be reviewed locally, handed to another Agent, or delivered through a host.
OpenAlice may attach authenticated collaboration provenance; AutoQuant does
not impersonate it.

## Observe with Studio

Studio is a read-only projection over the same verified loaders used by CLI:

```bash
uv run aq studio snapshot . --json
uv run aq studio serve .
```

It shows effective Workspace configuration, Projects, requests, Agent work
briefs, Studies, Sessions, Runs, experiments, evidence explorers, Reports,
Reviews, Dossiers, diagnostics, and copyable next commands. It does not create
private orchestration or alternative research truth. See [[docs/STUDIO]].
A compatible supervisor may discover this same server through the
repository-root `harness.json`, assign its loopback port, and probe the existing
health route. Exact `HARNESS_CAPABILITY=studio` launch keeps the command in the
foreground, uses only the injected endpoint, suppresses browser opening, and
permits only the restricted Harness embedding origins. AutoQuant still owns
the HTTP process and read model; the host owns public routing and product
chrome. Standalone launch and its strict anti-frame policy remain unchanged.
The source Workspace must first be prepared by AutoQuant's ordinary
`uv sync --frozen` setup. The manifest then enters that prepared environment
with `uv run --frozen --no-sync`; a supervisor neither activates `.venv` nor
installs dependencies during capability launch.

## Where to continue

- Current tested capability and honest boundary: [[docs/STATUS]]
- Command syntax and JSON envelopes: [[docs/CLI]]
- Workspace and Project files: [[docs/PROJECT_FORMAT]]
- Core ownership and system architecture: [[docs/ARCHITECTURE]]
- Version increments, release audits, tags, and host pins:
  [[docs/design/versioning-and-release]]
- Framework contributor rules and active work: [[AGENTS]] and `PLANS`
