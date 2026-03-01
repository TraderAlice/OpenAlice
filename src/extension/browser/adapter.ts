/**
 * Browser extension adapter
 *
 * Bridges the OpenClaw browser tool (pi-agent-core format) into the Vercel AI
 * SDK tool format used by Little-Pony. This is the only new code — everything
 * underneath is the original OpenClaw browser subsystem, copied verbatim.
 *
 * The OpenClaw browser tool returns:
 *   { content: [{type:"text", text: "..."}, {type:"image", data, mimeType}], details: {...} }
 *
 * The Vercel AI SDK expects the execute() to return an arbitrary value that
 * gets JSON-serialized into the tool result. We pass through the content array
 * so the LLM sees both text and image results.
 */
import { tool, type Tool } from "ai";
import { z } from "zod";
import { createBrowserTool } from "../../openclaw/agents/tools/browser-tool.js";

// ── Zod schema mirroring BrowserToolSchema (TypeBox) ──────────────────
// Kept in sync with openclaw/agents/tools/browser-tool.schema.ts.
// Flat object (no unions/anyOf) — same design choice as upstream,
// because Claude API on Vertex AI rejects nested anyOf.

const browserActKinds = [
  "click", "type", "press", "hover", "drag",
  "select", "fill", "resize", "wait", "evaluate", "close",
] as const;

const BrowserActSchema = z.object({
  kind:        z.enum(browserActKinds),
  // common
  targetId:    z.string().optional(),
  ref:         z.string().optional(),
  // click
  doubleClick: z.boolean().optional(),
  button:      z.string().optional(),
  modifiers:   z.array(z.string()).optional(),
  // type
  text:        z.string().optional(),
  submit:      z.boolean().optional(),
  slowly:      z.boolean().optional(),
  // press
  key:         z.string().optional(),
  // drag
  startRef:    z.string().optional(),
  endRef:      z.string().optional(),
  // select
  values:      z.array(z.string()).optional(),
  // fill
  fields:      z.array(z.record(z.string(), z.unknown())).optional(),
  // resize
  width:       z.number().optional(),
  height:      z.number().optional(),
  // wait
  timeMs:      z.number().optional(),
  textGone:    z.string().optional(),
  // evaluate
  fn:          z.string().optional(),
});

const browserToolActions = [
  "status", "start", "stop", "profiles", "tabs", "open", "focus",
  "close", "snapshot", "screenshot", "navigate", "console",
  "pdf", "upload", "dialog", "act",
] as const;

const browserTargets = ["sandbox", "host", "node"] as const;
const browserSnapshotFormats = ["aria", "ai"] as const;
const browserSnapshotModes = ["efficient"] as const;
const browserSnapshotRefs = ["role", "aria"] as const;
const browserImageTypes = ["png", "jpeg"] as const;

const BrowserToolParameters = z.object({
  action:         z.enum(browserToolActions),
  target:         z.enum(browserTargets).optional(),
  node:           z.string().optional(),
  profile:        z.string().optional(),
  targetUrl:      z.string().optional(),
  targetId:       z.string().optional(),
  limit:          z.number().optional(),
  maxChars:       z.number().optional(),
  mode:           z.enum(browserSnapshotModes).optional(),
  snapshotFormat: z.enum(browserSnapshotFormats).optional(),
  refs:           z.enum(browserSnapshotRefs).optional(),
  interactive:    z.boolean().optional(),
  compact:        z.boolean().optional(),
  depth:          z.number().optional(),
  selector:       z.string().optional(),
  frame:          z.string().optional(),
  labels:         z.boolean().optional(),
  fullPage:       z.boolean().optional(),
  ref:            z.string().optional(),
  element:        z.string().optional(),
  type:           z.enum(browserImageTypes).optional(),
  level:          z.string().optional(),
  paths:          z.array(z.string()).optional(),
  inputRef:       z.string().optional(),
  timeoutMs:      z.number().optional(),
  accept:         z.boolean().optional(),
  promptText:     z.string().optional(),
  request:        BrowserActSchema.optional(),
});

// ── Public API ────────────────────────────────────────────────────────

export type BrowserToolOptions = {
  /** URL for the sandbox browser bridge (Docker mode). */
  sandboxBridgeUrl?: string;
  /** Whether host-level browser control is allowed. Defaults to true. */
  allowHostControl?: boolean;
};

/**
 * Create browser tools for the Little-Pony agent engine.
 *
 * Returns a record with a single `browser` tool that wraps the full OpenClaw
 * browser subsystem: 16 actions, 11 act sub-actions, 3 snapshot formats,
 * Chrome Extension relay, sandbox Docker, and remote node proxy.
 *
 * Uses a Zod schema that mirrors the upstream TypeBox BrowserToolSchema so
 * that both `tool()` type inference and MCP `.shape` extraction work correctly.
 */
export function createBrowserTools(options?: BrowserToolOptions): Record<string, Tool> {
  const piTool = createBrowserTool({
    sandboxBridgeUrl: options?.sandboxBridgeUrl,
    allowHostControl: options?.allowHostControl ?? true,
  });

  const descriptionPrefix =
    "IMPORTANT: Before first use, ask the user whether they have the OpenClaw Browser Relay Chrome extension installed. " +
    'If YES → use profile="chrome" (operates on existing Chrome tabs; user must click the relay toolbar icon to attach a tab). ' +
    'If NO → call action="start" first to launch a standalone Playwright browser (isolated, no existing cookies/sessions). ' +
    "Do NOT attempt browser actions without clarifying this first.\n\n";

  const browserTool = tool({
    description: descriptionPrefix + piTool.description,
    inputSchema: BrowserToolParameters,
    execute: async (input, { toolCallId, abortSignal }) => {
      const result = await piTool.execute(toolCallId, input, abortSignal);
      return result;
    },
  });

  return { browser: browserTool };
}
