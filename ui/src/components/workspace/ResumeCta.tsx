import { useState } from 'react';
import { formatRelativeTime } from '../../lib/intl';
import type { ReactElement } from 'react';
import { MessageSquare } from 'lucide-react';

import type { SessionRecord } from './api';

export interface ResumeCtaProps {
  readonly record: SessionRecord;
  readonly onResume: () => void;
}

/**
 * Right-pane content when the pinned session record is paused.
 *
 * Two layers:
 *
 *   1. **Faux-TUI backdrop** — a blurred, heavily-dimmed mock of the
 *      Claude Code / Codex TUI shape: header strip, conversation
 *      bubbles, status lines, bottom prompt + status bar. It's the
 *      same placeholder content for every session — the goal is not
 *      to show what was there (we don't persist agent-CLI scrollback;
 *      the CLI re-renders its own transcript on resume), but to make
 *      the paused state visually read as "a paused chat" rather than
 *      a bare button. Anyone who isn't a developer should be able to
 *      look at this and understand "I clicked the agent, here's the
 *      conversation, click to continue".
 *
 *   2. **Resume card** centered on top — the actual CTA. Clicking it
 *      asks the server to re-spawn the PTY using the adapter's resume
 *      semantic (claude `--resume <uuid>` / `--continue`; codex
 *      `resume --last`; shell fresh + scrollback restore).
 */
export function ResumeCta(props: ResumeCtaProps): ReactElement {
  const [resuming, setResuming] = useState(false);
  const r = props.record;

  const onClick = (): void => {
    if (resuming) return;
    setResuming(true);
    props.onResume();
    // No setResuming(false) — the parent re-renders once state flips to
    // 'running' which unmounts this component entirely.
  };

  return (
    <div className="resume-cta-frame">
      <FauxTuiBackdrop />
      <div className="resume-cta-overlay">
        <div className="resume-cta-card">
          <div className="resume-cta-card-header">
            <span className="resume-cta-badge">
              {prefixOf(r.agent)}
            </span>
            <div className="resume-cta-card-title">
              <span className="resume-cta-name">{r.name}</span>
              <span className="resume-cta-state">paused · {formatRelativeTime(r.lastActiveAt)}</span>
            </div>
          </div>

          <button
            type="button"
            className="resume-cta-btn"
            onClick={onClick}
            disabled={resuming}
            aria-label={resuming ? 'Resuming conversation…' : 'Continue conversation'}
          >
            <MessageSquare size={14} strokeWidth={2.25} aria-hidden="true" />
            <span>{resuming ? 'Resuming…' : 'Continue conversation'}</span>
          </button>

          <dl className="resume-cta-meta">
            <dt>Agent</dt>
            <dd>{r.agent}</dd>
            <dt>Created</dt>
            <dd>{absoluteTime(r.createdAt)}</dd>
            {r.agentSessionId && (
              <>
                <dt>Transcript</dt>
                <dd className="mono">{r.agentSessionId.slice(0, 8)}</dd>
              </>
            )}
          </dl>

          {r.agent === 'shell' && (
            <p className="resume-cta-hint">
              Your previous screen will be restored above the new prompt.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * CSS-only placeholder TUI. No real session content — we use generic
 * filler so heavy backdrop blur turns each line into a soft horizontal
 * band, conveying "text exchange" without claiming to show anything
 * specific. Structural Unicode characters (●, ›, •, *, ▶▶) survive
 * the blur partially and give the "this is a terminal" tell.
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

function absoluteTime(iso: string): string {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return iso;
  return t.toLocaleString();
}

