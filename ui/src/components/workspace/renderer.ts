import { WebglAddon } from '@xterm/addon-webgl';
import type { Terminal } from '@xterm/xterm';

/**
 * Renderer escape hatch for the workspace terminal (and the demo replay).
 *
 * The WebGL renderer's glyph rasterization is plain Canvas2D (shared with the
 * DOM renderer), but the rasterized glyphs then ride a GPU pipeline — texture
 * upload, WebGL context, driver compositing — and that pipeline has a known
 * family of environment-specific corruption bugs (black boxes over CJK,
 * garbled cells; see e.g. microsoft/vscode#137047, #163936, #288682 — same
 * xterm atlas). None of them throw, so they can't be auto-detected; VS Code's
 * answer is the `terminal.integrated.gpuAcceleration` escape hatch.
 *
 * Ours is this localStorage flag:
 *
 *   localStorage.setItem('openalice.terminal.renderer', 'dom'); // + reload
 *
 * Anything other than 'dom' (including unset) keeps the WebGL default. On top
 * of the flag, the loader degrades to the DOM renderer automatically when the
 * addon throws at construction/load or the WebGL context is lost.
 */
const RENDERER_STORAGE_KEY = 'openalice.terminal.renderer';

function webglDisabled(): boolean {
  try {
    return localStorage.getItem(RENDERER_STORAGE_KEY) === 'dom';
  } catch {
    return false; // storage unavailable → default renderer path
  }
}

/**
 * Try to attach the WebGL renderer to `term`. Returns the addon (caller owns
 * disposal on unmount) or null when the flag forces DOM / the addon failed —
 * xterm keeps/reverts to its built-in DOM renderer in both cases, which is
 * also what happens automatically on a later context loss.
 */
export function attachWebglRenderer(term: Terminal, forceDom = false): WebglAddon | null {
  if (forceDom || webglDisabled()) return null;
  let webgl: WebglAddon | null = null;
  try {
    webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl?.dispose());
    term.loadAddon(webgl);
    return webgl;
  } catch {
    try {
      webgl?.dispose();
    } catch {
      /* ignore */
    }
    return null;
  }
}
