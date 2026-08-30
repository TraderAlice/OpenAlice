import { pathToFileURL } from 'node:url';

import { exec as bundledGitExec } from 'dugite';

export const INTERNAL_BOOTSTRAP_ROLE = '--openalice-internal-bootstrap';

export interface BootstrapInvocation {
  readonly command: string;
  readonly args: string[];
}

/**
 * A Bun-compiled executable cannot interpret an external `.mjs` file merely
 * by re-executing `process.execPath`: that path is Alice itself. Re-enter the
 * same executable through a private role so the embedded Bun runtime imports
 * the bootstrap without requiring a system Node or Bun installation.
 */
export function resolveMjsBootstrapInvocation(
  script: string,
  args: readonly string[],
): BootstrapInvocation {
  const standalone = (
    globalThis as { __OPENALICE_BUN_STANDALONE__?: boolean }
  ).__OPENALICE_BUN_STANDALONE__ === true;
  return {
    command: process.execPath,
    args: standalone
      ? [INTERNAL_BOOTSTRAP_ROLE, script, ...args]
      : [script, ...args],
  };
}

/** Execute one external bootstrap in the Bun standalone's child process. */
export async function runInternalBootstrapRole(
  argv: readonly string[] = process.argv,
): Promise<boolean> {
  const roleIndex = argv.indexOf(INTERNAL_BOOTSTRAP_ROLE);
  if (roleIndex < 0) return false;

  const script = argv[roleIndex + 1];
  if (!script?.endsWith('.mjs')) {
    throw new Error(`${INTERNAL_BOOTSTRAP_ROLE} requires an .mjs script path`);
  }
  const scriptArgs = argv.slice(roleIndex + 2);
  process.argv = [process.execPath, script, ...scriptArgs];
  const runtimeGlobal = globalThis as typeof globalThis & {
    __OPENALICE_BOOTSTRAP_GIT_EXEC__?: typeof bundledGitExec;
  };
  runtimeGlobal.__OPENALICE_BOOTSTRAP_GIT_EXEC__ = bundledGitExec;
  try {
    await import(pathToFileURL(script).href);
  } finally {
    delete runtimeGlobal.__OPENALICE_BOOTSTRAP_GIT_EXEC__;
  }
  return true;
}
