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
