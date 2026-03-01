import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const CANDIDATE_BINS = ["python3", "python"] as const;

async function main(): Promise<void> {
  const [scriptPathRaw, ...scriptArgsRaw] = process.argv.slice(2);
  if (!scriptPathRaw) {
    console.error(
      "python_fallback: missing script path. Usage: node --import tsx scripts/python_fallback.ts <script.py> [...args]"
    );
    process.exit(3);
    return;
  }

  // `pnpm run <script> -- --arg value` may forward a separator `--`.
  // Strip it so Python argparse receives only real flags.
  const scriptArgs =
    scriptArgsRaw.length > 0 && scriptArgsRaw[0] === "--"
      ? scriptArgsRaw.slice(1)
      : scriptArgsRaw;

  const scriptPath = resolve(process.cwd(), scriptPathRaw);
  const envPython = process.env.OPENALICE_PYTHON_BIN?.trim();
  const localVenv = resolve(process.cwd(), ".venv/bin/python");

  const orderedCandidates = [
    ...(envPython ? [envPython] : []),
    localVenv,
    ...CANDIDATE_BINS,
  ];

  for (const bin of orderedCandidates) {
    const isPath = bin.includes("/");
    if (isPath) {
      try {
        await access(bin, constants.X_OK);
      } catch {
        continue;
      }
    }

    const child = spawnSync(bin, [scriptPath, ...scriptArgs], {
      stdio: "inherit",
      env: process.env,
    });

    if (child.error) {
      const errno = (child.error as NodeJS.ErrnoException).code;
      if (errno === "ENOENT" || errno === "EACCES") {
        continue;
      }
      console.error(
        `python_fallback: failed to execute interpreter "${bin}": ${child.error.message}`
      );
      process.exit(3);
      return;
    }

    if (child.signal) {
      console.error(
        `python_fallback: interpreter "${bin}" exited via signal ${child.signal}`
      );
      process.exit(3);
      return;
    }

    console.error(`python_fallback: using interpreter ${bin}`);
    process.exit(child.status ?? 3);
    return;
  }

  console.error(
    "python_fallback: no usable Python interpreter found (checked OPENALICE_PYTHON_BIN, .venv/bin/python, python3, python)."
  );
  process.exit(127);
}

void main();
