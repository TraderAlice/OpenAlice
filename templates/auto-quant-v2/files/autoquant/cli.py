"""Crisp command-line interface (`aq`) for AutoQuant v1.0.0."""

from __future__ import annotations

import argparse
from collections.abc import Sequence
import importlib
import inspect
import json
import sys
from pathlib import Path
from typing import Any

from .data import fetch_alice_bars, ingest_ohlcv, list_datasets
from .ledger import RUN_ID_PATTERN, VALID_RUN_KINDS, VALID_SPLITS, compare_runs, list_runs, load_run
from .version import current_build_identity, current_version
from .workspace import (
    PROJECT_MANIFEST,
    WORKSPACE_MANIFEST,
    AutoQuantError,
    ProjectContext,
    create_project,
    initialize_workspace,
    list_projects,
    load_project,
    load_workspace,
    resolve_project,
    sanitize_json_value,
    set_project_splits,
)


def _add_json(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--json", action="store_true", dest="as_json", help="emit structured JSON to stdout")


def _emit(payload: dict[str, Any], human_text: str, *, as_json: bool) -> int:
    if as_json:
        sys.stdout.write(json.dumps(sanitize_json_value(payload), indent=2, allow_nan=False) + "\n")
    else:
        sys.stdout.write(human_text if human_text.endswith("\n") else human_text + "\n")
    return 0


def _project_summary(ctx: ProjectContext) -> dict[str, Any]:
    datasets = list_datasets(ctx)
    runs = list_runs(ctx)
    val_sharpes = [
        float(r["metrics"]["sharpe"])
        for r in runs
        if r.get("split") in {"val", "in_sample"} and isinstance((r.get("metrics") or {}).get("sharpe"), (int, float))
    ]
    latest = (
        {k: runs[0].get(k) for k in ("id", "name", "kind", "split", "created_at", "metrics")}
        if runs
        else None
    )
    return {
        "id": ctx.id,
        "name": ctx.name,
        "description": ctx.manifest.description,
        "root_dir": str(ctx.root_dir),
        "created_at": ctx.manifest.created_at,
        "splits": dict(ctx.splits),
        "holdout_audit": dict(ctx.holdout_audit),
        "dataset_count": len(datasets),
        "datasets": datasets,
        "run_count": len(runs),
        "best_val_sharpe": max(val_sharpes) if val_sharpes else None,
        "latest_run": latest,
        "research_path": str(ctx.research_path),
    }


def build_status(path: str | Path = ".", *, project_id: str | None = None) -> dict[str, Any]:
    target = Path(path).expanduser().absolute()
    if (target / PROJECT_MANIFEST).is_file():
        proj = load_project(target)
        if project_id is not None and proj.id != project_id:
            raise AutoQuantError(f"Directory {target} is project {proj.id!r}, not {project_id!r}")
        summary = _project_summary(proj)
        return {
            "version": current_version(),
            "scope": "project",
            "workspace": None,
            "active_project": summary,
            "projects": [summary],
        }

    ws = load_workspace(target)
    summaries = [_project_summary(p) for p in list_projects(ws)]
    active = None
    if project_id is not None:
        active = next((s for s in summaries if s["id"] == project_id), None)
        if active is None:
            raise AutoQuantError(f"Project {project_id!r} not found in workspace {ws.root_dir}")
    elif ws.manifest.default_project is not None:
        active = next((s for s in summaries if s["id"] == ws.manifest.default_project), None)
    elif len(summaries) == 1:
        active = summaries[0]

    return {
        "version": current_version(),
        "scope": "workspace",
        "workspace": {"root_dir": str(ws.root_dir), "projects_dir": str(ws.projects_dir), **ws.manifest.to_dict()},
        "active_project": active,
        "projects": summaries,
    }


def _cmd_version(args: argparse.Namespace) -> int:
    ver = current_version()
    b = current_build_identity()
    return _emit(
        {"name": "auto-quant", "version": ver, "git_commit": b["commit"], "git_dirty": b["dirty"], "provenance": b["provenance"]},
        f"aq {ver}",
        as_json=args.as_json,
    )


def _cmd_status(args: argparse.Namespace) -> int:
    payload = build_status(args.path, project_id=args.project)
    lines = [f"AutoQuant v{payload['version']} ({payload['scope']})"]
    if payload["workspace"]:
        lines.append(f"Workspace: {payload['workspace']['name']} ({payload['workspace']['root_dir']})")
    if not payload["projects"]:
        lines.append("Projects: 0 (create one with `aq project create <project-id>`)")
    else:
        lines.append(f"Projects ({len(payload['projects'])}):")
        for p in payload["projects"]:
            sp = p["splits"]
            lines.append(
                f"  - {p['id']} ({p['name']}): datasets={p['dataset_count']} runs={p['run_count']} "
                f"holdout_unlocks={p['holdout_audit']['unlock_count']} "
                f"[train<={sp['train_end'] or '-'} val<={sp['val_end'] or '-'} holdout<={sp['holdout_end'] or '-'}]"
            )
    return _emit(payload, "\n".join(lines), as_json=args.as_json)


def _cmd_workspace_init(args: argparse.Namespace) -> int:
    ws = initialize_workspace(args.directory, name=args.name, adopt_existing=args.adopt_existing)
    payload = {
        "workspace_dir": str(ws.root_dir),
        "projects_dir": str(ws.projects_dir),
        "manifest": ws.manifest.to_dict(),
        "adopted_existing": bool(args.adopt_existing),
    }
    return _emit(payload, f"Initialized AutoQuant Workspace '{ws.manifest.name}' at {ws.root_dir}", as_json=args.as_json)


def _cmd_project_create(args: argparse.Namespace) -> int:
    ws_path, proj_id = (args.target, args.project_id) if args.project_id is not None else (args.workspace or ".", args.target)
    proj = create_project(
        ws_path,
        proj_id,
        name=args.name,
        description=args.description or "",
        train_end=args.train_end,
        val_end=args.val_end,
        holdout_end=args.holdout_end,
        set_default=args.set_default,
    )
    return _emit(proj.to_dict(), f"Created project '{proj.id}' at {proj.root_dir}", as_json=args.as_json)


def _cmd_project_list(args: argparse.Namespace) -> int:
    ws = load_workspace(args.path)
    projects = [_project_summary(p) for p in list_projects(ws)]
    payload = {"workspace_dir": str(ws.root_dir), "default_project": ws.manifest.default_project, "count": len(projects), "projects": projects}
    human = (
        f"No projects in {ws.root_dir}"
        if not projects
        else "\n".join(
            f"{p['id']}\t{p['name']}\tdatasets={p['dataset_count']}\truns={p['run_count']}\tholdout_unlocks={p['holdout_audit']['unlock_count']}"
            for p in projects
        )
    )
    return _emit(payload, human, as_json=args.as_json)


def _cmd_project_show(args: argparse.Namespace) -> int:
    proj = resolve_project(args.path, project_id=args.project)
    payload = _project_summary(proj)
    human = (
        f"Project: {proj.name} ({proj.id})\nPath: {proj.root_dir}\n"
        f"Splits: train_end={proj.splits['train_end']} val_end={proj.splits['val_end']} holdout_end={proj.splits['holdout_end']}\n"
        f"Holdout unlocks: {proj.holdout_audit['unlock_count']}  Datasets: {payload['dataset_count']}  Runs: {payload['run_count']}"
    )
    return _emit(payload, human, as_json=args.as_json)


def _cmd_project_set_splits(args: argparse.Namespace) -> int:
    proj_id = args.project or args.positional_project
    updated = set_project_splits(
        args.path,
        project_id=proj_id,
        train_end=args.train_end,
        val_end=args.val_end,
        holdout_end=args.holdout_end,
        force=args.force,
    )
    return _emit(updated.to_dict(), f"Updated splits for '{updated.id}': {updated.splits}", as_json=args.as_json)


def _is_ws_or_proj(value: str) -> bool:
    p = Path(value).expanduser()
    return p.is_dir() and ((p / WORKSPACE_MANIFEST).is_file() or (p / PROJECT_MANIFEST).is_file())


def _cmd_data_ingest(args: argparse.Namespace) -> int:
    if args.second_arg is None:
        target_path, source_path = ".", args.first_arg
    elif _is_ws_or_proj(args.first_arg) and not _is_ws_or_proj(args.second_arg):
        target_path, source_path = args.first_arg, args.second_arg
    else:
        source_path, target_path = args.first_arg, args.second_arg

    entry = ingest_ohlcv(
        target_path,
        source_path,
        project_id=args.project,
        dataset_id=args.dataset_id,
        interval=args.interval,
        source=args.source,
        format=args.format,
        symbol=args.symbol,
        calendar=args.calendar,
    )
    return _emit(
        entry,
        f"Ingested '{entry['id']}' ({entry['rows']} rows, symbols={','.join(entry['symbols'])}) -> {entry['path']}",
        as_json=args.as_json,
    )


def _cmd_data_fetch(args: argparse.Namespace) -> int:
    raw_ids = [part.strip() for item in (args.bar_ids or []) for part in item.split(",") if part.strip()]
    if not raw_ids:
        raise AutoQuantError("Pass at least one --bar-id (e.g. --bar-id 'yfinance|AAPL')")
    panel = fetch_alice_bars(
        raw_ids, interval=args.interval, count=args.count, start=args.start, end=args.end, asset_class=args.asset_class
    )
    if args.no_ingest:
        syms = sorted(panel["asset"].unique().tolist())
        return _emit(
            {"fetched": True, "ingested": False, "rows": int(len(panel)), "symbols": syms, "interval": args.interval},
            f"Fetched {len(panel)} bars for {syms}",
            as_json=args.as_json,
        )
    entry = ingest_ohlcv(
        args.path, panel, project_id=args.project, dataset_id=args.dataset_id, interval=args.interval, source="alice-market", format=args.format
    )
    return _emit(entry, f"Fetched and ingested '{entry['id']}' ({entry['rows']} rows)", as_json=args.as_json)


def _cmd_data_list(args: argparse.Namespace) -> int:
    proj = resolve_project(args.path, project_id=args.project)
    datasets = list_datasets(proj)
    human = (
        f"No datasets in project '{proj.id}'"
        if not datasets
        else "\n".join(f"{d['id']}\t{d['format']}\trows={d['rows']}\tsymbols={len(d['symbols'])}\t{d['start']}..{d['end']}" for d in datasets)
    )
    return _emit({"project_id": proj.id, "count": len(datasets), "datasets": datasets}, human, as_json=args.as_json)


def _cmd_run_list(args: argparse.Namespace) -> int:
    proj = resolve_project(args.path, project_id=args.project)
    runs = list_runs(proj, split=args.split, kind=args.kind)
    if not runs:
        human = f"No runs recorded in project '{proj.id}'"
    else:
        rows = []
        for r in runs:
            sh = (r.get("metrics") or {}).get("sharpe")
            sh_txt = f"{sh:.3f}" if isinstance(sh, (int, float)) else "-"
            rows.append(f"{r['id']}\t{r['split']}\t{r['kind']}\tsharpe={sh_txt}\t{r['name']}")
        human = "\n".join(rows)
    return _emit({"project_id": proj.id, "count": len(runs), "runs": runs}, human, as_json=args.as_json)


def _cmd_run_show(args: argparse.Namespace) -> int:
    run_id = args.run
    target_path = "."
    if args.first is not None and args.second is not None:
        target_path, run_id = args.first, args.second
    elif args.first is not None:
        if RUN_ID_PATTERN.fullmatch(args.first) and run_id is None:
            run_id = args.first
        else:
            target_path = args.first
    if not run_id:
        raise AutoQuantError("Specify a run_id (e.g. `aq run show <run_id>`)")

    proj = resolve_project(target_path, project_id=args.project)
    data = load_run(proj, run_id, include_series=args.series)
    m_str = ", ".join(f"{k}={v:.4f}" if isinstance(v, float) else f"{k}={v}" for k, v in (data.get("metrics") or {}).items())
    human = f"Run: {data['id']} ({data['name']})\nProject: {data['project_id']}  Kind: {data['kind']}  Split: {data['split']}\nMetrics: {m_str or '-'}"
    return _emit(data, human, as_json=args.as_json)


def _cmd_run_compare(args: argparse.Namespace) -> int:
    proj = resolve_project(args.path, project_id=args.project)
    report = compare_runs(proj, run_ids=list(args.runs) if args.runs else None, split=args.split, kind=args.kind, sort_by=args.sort_by)
    if not report["runs"]:
        human = f"No matching runs to compare in project '{proj.id}'"
    else:
        lines = [f"Comparison for '{proj.id}' (sort={report['sort_by']}, holdout_unlocks={report['holdout_audit']['unlock_count']}):"]
        for row in report["runs"]:
            m = row["metrics"]
            sh = f"{m['sharpe']:.3f}" if isinstance(m.get("sharpe"), (int, float)) else "-"
            ret = f"{m['annual_return']:.2%}" if isinstance(m.get("annual_return"), (int, float)) else "-"
            dd = f"{m['max_drawdown']:.2%}" if isinstance(m.get("max_drawdown"), (int, float)) else "-"
            lines.append(f"  {row['id']}  [{row['split']}/{row['kind']}]  sharpe={sh}  cagr={ret}  max_dd={dd}  {row['name']}")
        human = "\n".join(lines)
    return _emit(report, human, as_json=args.as_json)


def _cmd_studio_snapshot(args: argparse.Namespace) -> int:
    from .studio import build_studio_snapshot

    snap = build_studio_snapshot(args.path, project_id=args.project)
    return _emit(snap, f"AutoQuant Studio snapshot ({len(snap.get('projects', []))} project(s))", as_json=args.as_json)


def _cmd_studio_serve(args: argparse.Namespace) -> int:
    studio_mod = importlib.import_module(f"{__package__}.studio")

    serve_fn = studio_mod.serve_studio
    params = inspect.signature(serve_fn).parameters
    accepts_kw = any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values())
    kwargs: dict[str, Any] = {}
    if "project_id" in params or (accepts_kw and args.project is not None):
        kwargs["project_id"] = args.project

    if "explicit_host" in params or "explicit_port" in params:
        if args.host is not None:
            kwargs["host"] = args.host
        if args.port is not None:
            kwargs["port"] = args.port
        kwargs["open_browser"] = not args.no_open
        if "explicit_host" in params:
            kwargs["explicit_host"] = args.host is not None
        if "explicit_port" in params:
            kwargs["explicit_port"] = args.port is not None
    elif hasattr(studio_mod, "resolve_studio_launch"):
        launch = studio_mod.resolve_studio_launch(host=args.host, port=args.port, no_open=args.no_open)
        kwargs.update({"host": launch.host, "port": launch.port, "open_browser": launch.open_browser})
        if "managed" in params or accepts_kw:
            kwargs["managed"] = launch.managed
    else:
        if args.host is not None:
            kwargs["host"] = args.host
        if args.port is not None:
            kwargs["port"] = args.port
        kwargs["open_browser"] = not args.no_open

    serve_fn(args.path, **kwargs)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="aq", description="AutoQuant v1.0.0 quantitative research CLI.")
    parser.add_argument("--version", "-V", action="version", version=f"aq {current_version()}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_ver = sub.add_parser("version", help="show AutoQuant version and build provenance")
    _add_json(p_ver)
    p_ver.set_defaults(handler=_cmd_version)

    for cmd_name, help_txt in (("status", "inspect Workspace, Projects, splits, and Holdout audit"), ("orient", "alias for `aq status`")):
        p_st = sub.add_parser(cmd_name, help=help_txt)
        p_st.add_argument("path", nargs="?", default=".")
        p_st.add_argument("--project")
        _add_json(p_st)
        p_st.set_defaults(handler=_cmd_status)

    p_ws = sub.add_parser("workspace", help="initialize an AutoQuant Workspace")
    p_wsi = p_ws.add_subparsers(dest="workspace_action", required=True).add_parser("init", help="initialize Workspace")
    p_wsi.add_argument("directory")
    p_wsi.add_argument("--name")
    p_wsi.add_argument("--adopt-existing", action="store_true")
    _add_json(p_wsi)
    p_wsi.set_defaults(handler=_cmd_workspace_init)

    p_proj = sub.add_parser("project", help="create and manage Projects")
    proj_sub = p_proj.add_subparsers(dest="project_action", required=True)
    p_pc = proj_sub.add_parser("create", help="create a Project")
    p_pc.add_argument("target")
    p_pc.add_argument("project_id", nargs="?")
    p_pc.add_argument("--workspace")
    p_pc.add_argument("--name")
    p_pc.add_argument("--description", default="")
    p_pc.add_argument("--train-end")
    p_pc.add_argument("--val-end")
    p_pc.add_argument("--holdout-end")
    p_pc.add_argument("--default", action="store_true", dest="set_default")
    _add_json(p_pc)
    p_pc.set_defaults(handler=_cmd_project_create)

    p_pl = proj_sub.add_parser("list", help="list Projects")
    p_pl.add_argument("path", nargs="?", default=".")
    _add_json(p_pl)
    p_pl.set_defaults(handler=_cmd_project_list)

    p_ps = proj_sub.add_parser("show", help="show Project metadata and Holdout audit")
    p_ps.add_argument("path", nargs="?", default=".")
    p_ps.add_argument("--project")
    _add_json(p_ps)
    p_ps.set_defaults(handler=_cmd_project_show)

    p_psp = proj_sub.add_parser("set-splits", help="set Train/Val/Holdout split dates")
    p_psp.add_argument("path", nargs="?", default=".")
    p_psp.add_argument("positional_project", nargs="?")
    p_psp.add_argument("--project")
    p_psp.add_argument("--train-end")
    p_psp.add_argument("--val-end")
    p_psp.add_argument("--holdout-end")
    p_psp.add_argument("--force", action="store_true")
    _add_json(p_psp)
    p_psp.set_defaults(handler=_cmd_project_set_splits)

    p_data = sub.add_parser("data", help="ingest, fetch, and list OHLCV datasets")
    data_sub = p_data.add_subparsers(dest="data_action", required=True)
    p_di = data_sub.add_parser("ingest", help="validate and ingest CSV/Parquet OHLCV")
    p_di.add_argument("first_arg")
    p_di.add_argument("second_arg", nargs="?")
    p_di.add_argument("--project")
    p_di.add_argument("--dataset-id", default="ohlcv")
    p_di.add_argument("--interval", default="1d")
    p_di.add_argument("--source", default="local")
    p_di.add_argument("--format", choices=["csv", "parquet"], default="csv")
    p_di.add_argument("--symbol")
    p_di.add_argument("--calendar")
    _add_json(p_di)
    p_di.set_defaults(handler=_cmd_data_ingest)

    p_df = data_sub.add_parser("fetch", help="fetch bars via `alice market bars`")
    p_df.add_argument("path", nargs="?", default=".")
    p_df.add_argument("--bar-id", action="append", dest="bar_ids", required=True)
    p_df.add_argument("--project")
    p_df.add_argument("--dataset-id", default="ohlcv")
    p_df.add_argument("--interval", default="1d")
    p_df.add_argument("--count", type=int, default=1000)
    p_df.add_argument("--start")
    p_df.add_argument("--end")
    p_df.add_argument("--asset-class")
    p_df.add_argument("--format", choices=["csv", "parquet"], default="csv")
    p_df.add_argument("--no-ingest", action="store_true")
    _add_json(p_df)
    p_df.set_defaults(handler=_cmd_data_fetch)

    p_dl = data_sub.add_parser("list", help="list Project datasets")
    p_dl.add_argument("path", nargs="?", default=".")
    p_dl.add_argument("--project")
    _add_json(p_dl)
    p_dl.set_defaults(handler=_cmd_data_list)

    p_run = sub.add_parser("run", help="inspect and compare immutable Runs")
    run_sub = p_run.add_subparsers(dest="run_action", required=True)
    p_rl = run_sub.add_parser("list", help="list Runs newest-first")
    p_rl.add_argument("path", nargs="?", default=".")
    p_rl.add_argument("--project")
    p_rl.add_argument("--split", choices=sorted(VALID_SPLITS))
    p_rl.add_argument("--kind", choices=sorted(VALID_RUN_KINDS))
    _add_json(p_rl)
    p_rl.set_defaults(handler=_cmd_run_list)

    p_rs = run_sub.add_parser("show", help="show Run details")
    p_rs.add_argument("first", nargs="?")
    p_rs.add_argument("second", nargs="?")
    p_rs.add_argument("--run")
    p_rs.add_argument("--project")
    p_rs.add_argument("--series", action="store_true")
    _add_json(p_rs)
    p_rs.set_defaults(handler=_cmd_run_show)

    p_rc = run_sub.add_parser("compare", help="compare Runs side-by-side")
    p_rc.add_argument("path", nargs="?", default=".")
    p_rc.add_argument("--project")
    p_rc.add_argument("--runs", nargs="+")
    p_rc.add_argument("--split", choices=sorted(VALID_SPLITS))
    p_rc.add_argument("--kind", choices=sorted(VALID_RUN_KINDS))
    p_rc.add_argument("--sort-by", default="sharpe")
    _add_json(p_rc)
    p_rc.set_defaults(handler=_cmd_run_compare)

    p_studio = sub.add_parser("studio", help="launch local Quant Studio or emit JSON snapshot")
    st_sub = p_studio.add_subparsers(dest="studio_action", required=True)
    p_ssnap = st_sub.add_parser("snapshot", help="emit Studio JSON snapshot")
    p_ssnap.add_argument("path", nargs="?", default=".")
    p_ssnap.add_argument("--project")
    _add_json(p_ssnap)
    p_ssnap.set_defaults(handler=_cmd_studio_snapshot)

    p_sserve = st_sub.add_parser("serve", help="serve local AutoQuant Studio")
    p_sserve.add_argument("path", nargs="?", default=".")
    p_sserve.add_argument("--project")
    p_sserve.add_argument("--host")
    p_sserve.add_argument("--port", type=int)
    p_sserve.add_argument("--no-open", action="store_true")
    p_sserve.set_defaults(handler=_cmd_studio_serve)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv if argv is not None else sys.argv[1:]))
    as_json = bool(getattr(args, "as_json", False))
    try:
        return int(args.handler(args))
    except Exception as exc:
        if as_json:
            sys.stdout.write(json.dumps({"ok": False, "error": str(exc), "error_type": type(exc).__name__}, indent=2) + "\n")
        else:
            sys.stderr.write(f"error: {exc}\n")
        return 1
