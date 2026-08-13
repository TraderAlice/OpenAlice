# Plan: Cron missed-fire catch-up

**Status:** active
**Owner guides:** [[docs/workspace-issues-and-scheduling.md]]
**Delivery:** serial PR to `dev` (`area:collaboration`). Open for review; persisted Issue `when` + launcher markers.

## Goal

`every` and `cron` stay one dispatch channel. Cron's wall-clock due math gets an
explicit missed-fire policy: **catch up by default** (keep the occurrence due
until a run is accepted), or **calendar-only** when the operator turns that off.

## Decisions

- Field: `when.catchUp` on `kind: cron` only. Omit or `true` → retry the missed
  slot. `false` → consume the slot and wait for the next calendar time.
- Existing files omit the field, so they get the new default. This changes only
  the never-fired first-occurrence miss (after one success, cron already stayed
  due). No dual-read of the Issue file.
- Catch-up is for **admission skips** (busy, capacity, dispatch throw before a
  run exists). A registered run that later fails is still one occurrence;
  Retry now stays manual.
- First create still does not dump historical cron slots (lookback seeding).
- Marker store grows an optional `held` cursor beside last-fired. `lastFired`
  remains last successful dispatch. V1 numeric markers still mean last-fired.
- Issue inspector exposes one checkbox. CLI `issue update` still does not rewrite
  cadence; agents set `catchUp` in the file or via create `--when`.

## Checklist

- [x] Schema + Schedule type
- [x] Marker `held` + scanner miss handling
- [x] Issue detail checkbox + PATCH `catchUp`
- [x] Owner guide + self-scheduling skill
- [x] Typecheck, tests, review PR
