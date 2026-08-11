import { useState } from 'react';
import { formatRelativeTime } from '../../lib/intl';
import type { ReactElement } from 'react';
import { Bot, ChevronDown, Settings2, SquareTerminal } from 'lucide-react';

import { SessionRuntimeEditorDialog } from './SessionRuntimeEditorDialog';
import type {
  AgentInfo,
  PausedSessionRuntimeUpdate,
  SessionRecord,
} from './api';

export interface ResumeCtaProps {
  readonly record: SessionRecord;
  readonly agents?: readonly AgentInfo[];
  readonly workspaceId?: string;
  readonly onUpdateRuntime?: (update: PausedSessionRuntimeUpdate) => Promise<void>;
  readonly onResume: () => Promise<void>;
  readonly onOpenWebPi?: () => Promise<void>;
}

/**
 * Right-pane content when the pinned session record is paused.
 *
 * Two layers:
 *
 *   1. **Faux-TUI backdrop** — a sleeping, low-contrast mock of the
 *      Claude Code / Codex TUI shape: header strip, conversation
 *      bubbles, status lines, bottom prompt + status bar. It's the
 *      same placeholder content for every session — the goal is not
 *      to show what was there (we don't persist agent-CLI scrollback;
 *      the CLI re-renders its own transcript on resume), but to make
 *      the paused state visually read as a native terminal waiting to
 *      be restored rather than a disabled webpage.
 *
 *   2. **Wake strip** docked to the terminal footer — the actual CTA. Clicking it
 *      asks the server to re-spawn the PTY using the adapter's resume
 *      semantic (claude `--resume <uuid>` / `--continue`; codex
 *      `resume --last`; shell fresh + scrollback restore).
 */
export function ResumeCta(props: ResumeCtaProps): ReactElement {
  const [resuming, setResuming] = useState<'terminal' | 'webpi' | null>(null);
  const [runtimeEditorOpen, setRuntimeEditorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = props.record;
  const sessionTitle = r.title?.trim() || r.name;
  const runtimeFacts = sessionRuntimeFacts(r);

  const run = async (surface: 'terminal' | 'webpi'): Promise<void> => {
    if (resuming) return;
    setError(null);
    setResuming(surface);
    try {
      if (surface === 'webpi') await props.onOpenWebPi?.();
      else await props.onResume();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResuming(null);
    }
  };

  return (
    <div className={`resume-cta-frame${resuming ? ' is-resuming' : ''}`}>
      <FauxTuiBackdrop />
      <div className="resume-cta-overlay">
        <section className="resume-cta-card" aria-label="Paused Session">
          <div className="resume-cta-card-main">
            <div className="resume-cta-card-header">
              <div className="resume-cta-kicker">
                <span className="resume-cta-state-dot" aria-hidden="true" />
                <span>Session paused</span>
              </div>
              <h2 className="resume-cta-name">{sessionTitle}</h2>
              <p className="resume-cta-state">
                {agentDisplayName(r.agent)} · {formatRelativeTime(r.lastActiveAt)}
              </p>
            </div>

            <dl className="resume-cta-runtime" aria-label="Session runtime">
              {runtimeFacts.map((fact) => (
                <div className="resume-cta-runtime-fact" key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd title={fact.value}>{fact.value}</dd>
                </div>
              ))}
            </dl>

            <div className="resume-cta-actions">
              {props.agents && props.workspaceId && props.onUpdateRuntime && r.agent !== 'shell' && (
                <button
                  type="button"
                  className="resume-cta-btn is-config oa-pressable"
                  onClick={() => setRuntimeEditorOpen(true)}
                  disabled={resuming !== null}
                  aria-label="Change Session AI configuration"
                >
                  <Settings2 size={14} strokeWidth={2.1} aria-hidden="true" />
                  <span>Change AI</span>
                </button>
              )}
              <button
                type="button"
                className="resume-cta-btn oa-pressable"
                onClick={() => void run('terminal')}
                disabled={resuming !== null}
                aria-label="Resume in TUI"
              >
                <SquareTerminal size={15} strokeWidth={2.1} aria-hidden="true" />
                <span>{resuming === 'terminal' ? 'Restoring…' : 'Resume in TUI'}</span>
              </button>
              {r.agent === 'pi' && props.onOpenWebPi && (
                <button
                  type="button"
                  className="resume-cta-btn is-webpi oa-pressable"
                  onClick={() => void run('webpi')}
                  disabled={resuming !== null}
                  aria-label="Open in WebPi"
                >
                  <Bot size={14} strokeWidth={2.25} aria-hidden="true" />
                  <span>{resuming === 'webpi' ? 'Opening…' : 'Open in WebPi'}</span>
                  {resuming !== 'webpi' && <span className="resume-cta-beta">Beta</span>}
                </button>
              )}
            </div>
          </div>

          {error && (
            <p role="alert" className="resume-cta-error">
              {error}
            </p>
          )}

          {r.agent === 'shell' && (
            <p className="resume-cta-hint">
              Your previous screen will be restored above the new prompt.
            </p>
          )}

          <details className="resume-cta-details">
            <summary>
              <span>Session details</span>
              <ChevronDown size={13} strokeWidth={2} aria-hidden="true" />
            </summary>
            <div className="resume-cta-details-body oa-disclosure-enter">
              <dl className="resume-cta-meta">
                <dt>Runtime</dt>
                <dd>{agentDisplayName(r.agent)}</dd>
                <dt>Created</dt>
                <dd>{absoluteTime(r.createdAt)}</dd>
                {r.resumeId && (
                  <>
                    <dt>Transcript</dt>
                    <dd className="mono">{r.resumeId}</dd>
                  </>
                )}
              </dl>
            </div>
          </details>
        </section>
      </div>
      {props.agents && props.workspaceId && props.onUpdateRuntime && (
        <SessionRuntimeEditorDialog
          open={runtimeEditorOpen}
          onOpenChange={setRuntimeEditorOpen}
          record={r}
          agents={props.agents}
          workspaceId={props.workspaceId}
          onSave={props.onUpdateRuntime}
        />
      )}
    </div>
  );
}

/**
 * CSS-only placeholder TUI. No real session content — we use generic
 * filler so the shape remains recognizably terminal-like without claiming
 * to show the actual transcript. Structural Unicode characters (●, ›, •,
 * *, ▶▶) provide the browser-to-TUI handoff cue.
 */
function FauxTuiBackdrop(): ReactElement {
  return (
    <div className="resume-tui" aria-hidden="true">
      <div className="resume-tui-titlebar">
        <span className="resume-tui-titlebar-dot" />
        <span className="resume-tui-titlebar-title">workspace · session</span>
        <span className="resume-tui-titlebar-pid">pid ····</span>
      </div>

      <div className="resume-tui-meta">
        <div className="resume-tui-meta-strong">Agent CLI</div>
        <div className="resume-tui-meta-dim">model · usage policy</div>
        <div className="resume-tui-meta-dim">~/path/to/workspace/directory</div>
      </div>

      <div className="resume-tui-prompt">
        <span className="resume-tui-chev">{'›'}</span>
        <span className="resume-tui-prompt-text">
          ▓▓▓▓▓▓▓▓ ▓▓▓ ▓▓▓▓▓▓▓▓▓▓ ▓▓▓▓
        </span>
      </div>

      <div className="resume-tui-response">
        <span className="resume-tui-bullet">•</span>
        <div className="resume-tui-response-body">
          <div>▓▓ ▓▓ ▓▓▓▓ ▓▓▓▓▓▓▓▓ ▓▓ ▓▓▓▓▓▓ ▓▓▓ ▓▓▓▓▓▓▓▓▓</div>
          <div>▓▓ ▓▓▓▓ ▓▓▓▓▓▓ ▓▓▓ ▓▓▓▓ ▓▓ ▓▓▓▓▓▓ ▓▓▓▓▓▓ ▓▓▓ ▓▓▓▓</div>
        </div>
      </div>
      <div className="resume-tui-status">* Brewed for 4s</div>

      <div className="resume-tui-prompt">
        <span className="resume-tui-chev">{'›'}</span>
        <span className="resume-tui-prompt-text">
          ▓▓▓▓▓▓▓ ▓▓▓ ▓▓▓▓▓▓▓▓▓▓▓▓▓ ▓▓▓ ▓▓▓▓
        </span>
      </div>

      <div className="resume-tui-response">
        <span className="resume-tui-bullet">•</span>
        <div className="resume-tui-response-body">
          <div>▓▓▓▓ ▓▓ ▓▓▓▓▓▓▓ ▓▓▓ ▓▓▓▓ ▓▓▓▓▓▓ ▓▓ ▓▓▓▓▓▓▓▓▓ ▓▓▓▓▓▓</div>
          <div>▓▓▓▓ ▓▓ ▓▓▓▓▓▓ ▓▓▓ ▓▓▓▓▓▓▓▓ ▓▓ ▓▓▓▓▓▓ ▓▓▓▓ ▓▓▓▓</div>
          <div>▓▓▓▓ ▓▓▓▓▓▓▓ ▓▓▓ ▓▓▓▓ ▓▓ ▓▓</div>
        </div>
      </div>
      <div className="resume-tui-status">* Brewed for 7s</div>

      <div className="resume-tui-input">
        <span className="resume-tui-chev">{'›'}</span>
        <span className="resume-tui-input-cursor" />
      </div>

      <div className="resume-tui-statusbar">
        <span>{'▶▶'} auto mode on (shift+tab to cycle)</span>
        <span>● high · /effort</span>
      </div>
    </div>
  );
}

export function prefixOf(agent: string): string {
  if (agent === 'claude') return 'c';
  if (agent === 'codex') return 'x';
  if (agent === 'shell') return 'sh';
  return agent[0] ?? '?';
}

function agentDisplayName(agent: string): string {
  if (agent === 'claude') return 'Claude Code';
  if (agent === 'codex') return 'Codex';
  if (agent === 'opencode') return 'OpenCode';
  if (agent === 'pi') return 'Pi';
  if (agent === 'shell') return 'Shell';
  return agent;
}

function sessionRuntimeFacts(record: SessionRecord): readonly { label: string; value: string }[] {
  const runtime = record.runtime;
  return [
    { label: 'Credential', value: credentialDisplay(runtime) },
    { label: 'Model', value: runtime ? runtime.model?.trim() || 'Runtime default' : 'Unknown' },
    {
      label: 'Effort',
      value: runtime
        ? runtime.reasoningEffort ? `${runtime.reasoningEffort} reasoning` : 'Not specified'
        : 'Unknown',
    },
  ];
}

function credentialDisplay(runtime: SessionRecord['runtime']): string {
  if (!runtime) return 'Unknown';
  if (runtime.credentialSource === 'native') return 'Runtime login';
  if (runtime.credentialSource === 'workspace') return 'Workspace config';
  return runtime.credentialSlug?.trim() || 'Saved credential';
}

function absoluteTime(iso: string): string {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return iso;
  return t.toLocaleString();
}
