import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const resolver = "console.log(import.meta.resolve('#openalice/pty-backend', new URL('./package.json', import.meta.url)));";

function resolvePtyBackend(conditions: string[]): string {
  const result = spawnSync(
    process.execPath,
    [...conditions.flatMap((condition) => [`--conditions=${condition}`]), '--input-type=module', '-e', resolver],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim().replaceAll('\\', '/');
}

describe('PTY import conditions', () => {
  it('resolves source development to node-pty while bun keeps its own backend', () => {
    expect(resolvePtyBackend([])).toMatch(/\/src\/workspaces\/pty-node\.ts$/);
    expect(resolvePtyBackend(['openalice-source'])).toMatch(/\/src\/workspaces\/pty-node\.ts$/);
    expect(resolvePtyBackend(['bun'])).toMatch(/\/src\/workspaces\/pty-bun\.ts$/);
  });

  it('keeps the Windows source launcher on the existing Alice entrypoint', () => {
    const script = readFileSync(new URL('../../scripts/windows-source-dev.ps1', import.meta.url), 'utf8');
    const run = script.slice(script.indexOf("'Run' {"), script.indexOf("'Switch' {"));
    expect(run).toContain("$env:NODE_OPTIONS = '--conditions=openalice-source'");
    expect(run).toContain('src\\main.ts');
    expect(run).not.toMatch(/pty-runtime|pty-node|pty-bun|node-pty|bun-native-pty-smoke/);

    const matcher = script.slice(script.indexOf('function Get-SourceProcesses'), script.indexOf('function Stop-SourceProcesses'));
    expect(matcher).toContain('scripts[\\\\/]guardian[\\\\/]dev\\.ts');
    expect(matcher).toContain('src[\\\\/]main\\.ts');
    expect(matcher).not.toMatch(/pty-runtime|pty-node|pty-bun|node-pty|bun-native-pty-smoke/);
  });
});
