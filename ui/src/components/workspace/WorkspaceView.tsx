import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactElement, ReactNode } from 'react';

import type { AgentInfo, PausedSessionRuntimeUpdate, SessionRecord } from './api';
import { sessionCoworkerLabel } from './display';
import { useHarnessWorkbenchContext } from '../harness/context';
import { FilesPanel } from './FilesPanel';
import { SessionActivation } from './SessionActivation';
import { TerminalView } from './Terminal';
import { WebSessionView } from './WebSessionView';
import { useIsDesktop } from '../../live/use-is-desktop';
import { useWorkspaceSidePanels } from '../../live/workspace-side-panels';
import type { WorkspaceSource } from '../../tabs/types';

export interface WorkspaceViewProps {
  readonly wsId: string;
  readonly visible?: boolean;
  /** Pinned record id, or null = no session pinned (empty pane). */
  readonly sessionId: string | null;
  /** Product area that owns this Workspace view (for provenance-aware drill-ins). */
  readonly source?: WorkspaceSource;
  /** Resolved record matching `sessionId`. null if `sessionId` is null OR the record was just deleted. */
  readonly activeRecord: SessionRecord | null;
  readonly agents?: readonly AgentInfo[];
  readonly label?: string;
  /** Actions promoted into the live terminal or Web conversation shared titlebar. */
  readonly terminalHeaderActions?: ReactNode;
  readonly onResume: (sessionId: string) => Promise<void>;
  readonly onUpdateSessionRuntime?: (
    sessionId: string,
    update: PausedSessionRuntimeUpdate,
  ) => Promise<void>;
  readonly onSaveSessionDisplayName?: (
    resumeId: string,
    displayName: string | null,
  ) => Promise<void>;
  readonly onOpenWeb: (sessionId: string) => Promise<void>;
  readonly onSessionLost: () => void;
}

export function WorkspaceView(props: WorkspaceViewProps): ReactElement {
  const { t } = useTranslation();
  const connected = useRef(false);
  if (props.activeRecord?.state === 'running') connected.current = true;
  // Mount ONLY this tab's own pinned session. Each session is its own tab with
  // its own WorkspaceView, and TabHost keeps every tab mounted (display:none
  // when inactive) — so a session's terminal already persists across tab
  // switches without a WS reconnect. Mounting *every* running session here (the
  // old single-shared-view design) duplicates each session's <TerminalView>
  // into every open tab: a session open in N tabs then gets N WebSockets
  // fighting over its single-attach PTY → kick/reconnect war that wedges the
  // session (ANG-120 — e.g. claude froze whenever an opencode tab was also open).
  //
  // WorkspacePage owns the no-session composer. A missing pinned record may
  // briefly occur before the post-spawn poll supplies it.
  const runningSlots = useMemo<readonly SessionRecord[]>(
    () =>
      props.activeRecord !== null && props.activeRecord.state === 'running' && props.activeRecord.surface !== 'headless'
        ? [props.activeRecord]
        : [],
    [props.activeRecord],
  );

  const showPausedCta =
    props.sessionId !== null &&
    props.activeRecord !== null &&
    props.activeRecord.state === 'paused';

  // Files panel visibility. Desktop uses runtime-only disclosure state so each
  // UI load starts collapsed; auto-hidden mobile layouts get their own
  // transient overlay state. This keeps the first view clear without turning
  // the Files button into a dead control.
  const isDesktop = useIsDesktop();
  const sidePrefs = useWorkspaceSidePanels();
  const usesMobileOverlay = !isDesktop && sidePrefs.autoHideMobile;
  const showFiles = usesMobileOverlay ? sidePrefs.mobileFilesOpen : sidePrefs.files;
  const workbench = useHarnessWorkbenchContext();
  const showAside = !workbench && showFiles;
  const viewClass = `workspace-view${showAside ? '' : ' has-no-side'}`;

  return (
    <div className={viewClass}>
      <div className="workspace-terminal">
        {props.activeRecord?.state === 'running' && props.activeRecord.surface === 'headless' && (
          <div role="alert" className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            {t('workspace.interactiveOwnership.background')}
          </div>
        )}
        {showPausedCta && props.activeRecord && (
          <SessionActivation
            key={props.activeRecord.id}
            record={props.activeRecord}
            workspaceId={props.wsId}
            enabled={props.visible !== false}
            automatic={!connected.current}
            onResume={() => props.onResume(props.activeRecord!.id)}
            onOpenWeb={() => props.onOpenWeb(props.activeRecord!.id)}
          />
        )}
        {!showPausedCta &&
          runningSlots.map((s) => {
            const isActive = s.id === props.sessionId;
            return (
              <div
                key={s.id}
                className={`workspace-terminal-slot ${isActive ? 'is-active' : 'is-hidden'}`}
              >
                {(s.surface ?? 'terminal') === 'webpi' ? (
                  <WebSessionView
                    wsId={props.wsId}
                    sessionId={s.id}
                    agent={s.agent}
                    {...(props.agents ? { agents: props.agents } : {})}
                    label={s.displayName?.trim() || s.title?.trim()
                      ? sessionCoworkerLabel(s)
                      : props.label ? `${props.label} · ${s.name}` : s.name}
                    onSessionLost={props.onSessionLost}
                    headerActions={props.terminalHeaderActions}
                  />
                ) : (
                  <TerminalView
                    wsId={props.wsId}
                    sessionId={s.id}
                    renderer={s.agent === 'opencode' ? 'dom' : 'auto'}
                    {...(props.label !== undefined ? { label: props.label } : {})}
                    sessionLabel={sessionCoworkerLabel(s)}
                    headerActions={props.terminalHeaderActions}
                    onSessionLost={props.onSessionLost}
                  />
                )}
              </div>
            );
          })}
      </div>
      {showAside && (
        <aside className="workspace-side">
          {showFiles && (
            <FilesPanel
              wsId={props.wsId}
              sessionId={props.sessionId}
              {...(props.source ? { source: props.source } : {})}
            />
          )}
        </aside>
      )}
    </div>
  );
}
