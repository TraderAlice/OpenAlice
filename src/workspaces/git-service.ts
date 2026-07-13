import { exec, type IGitStringExecutionOptions } from 'dugite';

export interface GitLogEntry {
  readonly hash: string;
  readonly subject: string;
  readonly relTime: string;
  readonly authorTime: string;
}

export interface GitStatusFile {
  readonly path: string;
  /** Two-char porcelain code, e.g. ` M`, `A `, `??`. */
  readonly status: string;
}

export interface GitStatus {
  readonly branch: string | null;
  readonly clean: boolean;
  readonly files: readonly GitStatusFile[];
}

const LOG_FORMAT = '%h%x09%ar%x09%aI%x09%s';
const GIT_TIMEOUT_MS = 5_000;
const MAX_BUFFER = 4 * 1024 * 1024;

// Read-only panel git, routed through the bundled git (dugite) so the panel
// renders without a system git. dugite resolves with an exitCode rather than
// throwing (it rejects only when git fails to launch, or when the abort signal
// fires), so callers check exitCode. The old execFile `timeout` option becomes
// an AbortSignal — a slow git is killed and surfaces as a rejection/non-zero.
function gitOpts(): IGitStringExecutionOptions {
  return { maxBuffer: MAX_BUFFER, signal: AbortSignal.timeout(GIT_TIMEOUT_MS) };
}

/**
 * Wrap `git log --pretty=...` so the panel can render hash + subject + time.
 * Tab-separated to avoid quoting headaches inside commit subjects.
 */
export async function gitLog(cwd: string, limit: number): Promise<GitLogEntry[]> {
  const n = Math.max(1, Math.min(limit, 500));
  const { stdout, exitCode, stderr } = await exec(
    ['log', `--pretty=format:${LOG_FORMAT}`, `-n`, String(n)],
    cwd,
    gitOpts(),
  );
  if (exitCode !== 0) {
    throw new Error(`git log exited ${exitCode}: ${stderr.slice(0, 200)}`);
  }
  const lines = stdout.split('\n').filter((l) => l.length > 0);
  return lines.map((line) => {
    const parts = line.split('\t');
    return {
      hash: parts[0] ?? '',
      relTime: parts[1] ?? '',
      authorTime: parts[2] ?? '',
      subject: parts.slice(3).join('\t'),
    };
  });
}

/**
 * Best-effort branch + working-tree status. `branch --show-current` returns
 * empty when in detached-HEAD; status files use porcelain v1 (XY path).
 */
export async function gitStatus(cwd: string): Promise<GitStatus> {
  const [branchRes, statusRes] = await Promise.all([
    exec(['branch', '--show-current'], cwd, gitOpts()).catch(() => null),
    exec(['status', '--porcelain=v1'], cwd, gitOpts()),
  ]);
  if (statusRes.exitCode !== 0) {
    throw new Error(`git status exited ${statusRes.exitCode}: ${statusRes.stderr.slice(0, 200)}`);
  }
  const branchRaw = branchRes && branchRes.exitCode === 0 ? branchRes.stdout.trim() : '';
  const branch = branchRaw.length > 0 ? branchRaw : null;
  const files: GitStatusFile[] = statusRes.stdout
    .split('\n')
    .filter((l) => l.length > 0)
    .map((line) => ({
      status: line.slice(0, 2),
      // Porcelain emits 3-byte prefix `XY ` then the path. Rename rows have a
      // `->` separator; for v1's simple panel we keep the original line as-is
      // after the prefix.
      path: line.slice(3),
    }));
  return { branch, clean: files.length === 0, files };
}
