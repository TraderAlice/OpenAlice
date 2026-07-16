# Theme color audit

The static inventory is the source boundary for the automated theme-color
audit. It parses every CSS, TypeScript, and TSX file under `ui/src` and writes a
deterministically ordered manifest to:

```text
.artifacts/theme-color-audit/static-manifest.json
```

The artifact is intentionally not tracked. It records the checked-out commit,
exact byte offsets, reviewer-friendly 1-based line/column projections, original
source text, syntax kind, and a stable occurrence ID. Downstream audit stages
must regenerate it for their current commit rather than treating old line
numbers as current evidence.

```bash
pnpm audit:theme-colors:scan
pnpm audit:theme-colors:check-static
pnpm audit:theme-colors:validate-manifest
pnpm test:theme-color-static-inventory
```

`check-static` scans twice and compares the complete result. Validation reads
every source span back from disk and fails if it no longer equals the recorded
text. Parser failures are fatal; the scanner never converts them into ignored
files.

The evidence bundle keeps the 30 scenario/theme screenshots as navigation
context, but occurrence evidence is not inferred from those shared images.
Every runtime occurrence has its own record. A visual record contains the
source span, runtime binding, locator, channel, actual value, viewport target
bounds, a labeled context JPEG, and an annotated crop JPEG. A non-visual record
explicitly states whether the occurrence is an active typed value probe, has no
positive-area target, or was inactive in the scenario catalog.

```bash
pnpm audit:theme-colors:capture
pnpm audit:theme-colors:check-evidence
pnpm audit:theme-colors:check-annotations
pnpm test:theme-color-annotations
```

`check-annotations` verifies source/binding identity, target and crop geometry,
JPEG hashes and dimensions, and decodes every visual image in Chromium to
confirm that the annotation color is actually present. The production build
remains free of audit attributes and globals.
