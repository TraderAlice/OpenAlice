import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import { listFiles, type DirListing, type FileEntry } from './api';

const POLL_MS = 5000;

interface FilesPanelProps {
  readonly wsId: string;
}

export function FilesPanel(props: FilesPanelProps): ReactElement {
  const [path, setPath] = useState('');
  const [listing, setListing] = useState<DirListing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setListing(null);
    setError(null);

    const refresh = async (): Promise<void> => {
      try {
        const data = await listFiles(props.wsId, path);
        if (!alive) return;
        setListing(data);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError((err as Error).message);
      }
    };

    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [props.wsId, path]);

  // Reset path when switching workspaces.
  useEffect(() => {
    setPath('');
  }, [props.wsId]);

  const enter = (entry: FileEntry): void => {
    if (entry.kind === 'dir' || entry.kind === 'symlink') {
      setPath(path ? `${path}/${entry.name}` : entry.name);
    }
  };

  const breadcrumb = path.split('/').filter(Boolean);

  return (
    <section className="panel files-panel">
      <header className="panel-header">
        <span className="panel-title">files</span>
        <nav className="files-breadcrumb">
          <button
            type="button"
            className="files-crumb"
            onClick={() => setPath('')}
            disabled={path === ''}
          >
            ~
          </button>
          {breadcrumb.map((seg, i) => (
            <span key={i} className="files-crumb-seg">
              <span className="files-crumb-sep">/</span>
              <button
                type="button"
                className="files-crumb"
                onClick={() => setPath(breadcrumb.slice(0, i + 1).join('/'))}
                disabled={i === breadcrumb.length - 1}
              >
                {seg}
              </button>
            </span>
          ))}
        </nav>
      </header>

      {error && <div className="panel-error">{error}</div>}

      <ul className="files-list">
        {listing?.entries.length === 0 && !error && (
          <li className="panel-empty">empty</li>
        )}
        {listing?.entries.map((e) => (
          <li
            key={e.name}
            className={`files-row files-${e.kind}`}
            onClick={() => enter(e)}
          >
            <span className="files-icon">{iconFor(e)}</span>
            <span className="files-name">{e.name}</span>
            <span className="files-meta">{formatMeta(e)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function iconFor(e: FileEntry): string {
  if (e.kind === 'dir') return '📁';
  if (e.kind === 'symlink') return '🔗';
  if (e.kind === 'other') return '◦';
  return '·';
}

function formatMeta(e: FileEntry): string {
  if (e.kind !== 'file' || e.sizeBytes === null) return relTime(e.mtime);
  return `${formatSize(e.sizeBytes)} · ${relTime(e.mtime)}`;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}M`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const dMs = Date.now() - t;
  if (dMs < 60_000) return 'now';
  if (dMs < 3_600_000) return `${Math.floor(dMs / 60_000)}m`;
  if (dMs < 86_400_000) return `${Math.floor(dMs / 3_600_000)}h`;
  return `${Math.floor(dMs / 86_400_000)}d`;
}
