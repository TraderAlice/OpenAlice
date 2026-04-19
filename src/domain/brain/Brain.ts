/**
 * Brain - Git-like log of frontal-lobe updates
 *
 * Single-purpose now (emotion dimension was removed — see types.ts). Each
 * `updateFrontalLobe` creates a commit so we can surface "when was this
 * written" context when injecting the note back into the system prompt.
 */

import { createHash } from 'crypto';
import type {
  CommitHash,
  BrainCommit,
  BrainCommitType,
  BrainState,
  BrainExportState,
} from './types';

export interface BrainConfig {
  /** Called after each commit for persistence */
  onCommit?: (state: BrainExportState) => void | Promise<void>;
}

function generateCommitHash(content: object): CommitHash {
  return createHash('sha256')
    .update(JSON.stringify(content))
    .digest('hex')
    .slice(0, 8);
}

export class Brain {
  private state: BrainState;
  private commits: BrainCommit[] = [];
  private head: CommitHash | null = null;

  constructor(
    private config: BrainConfig,
    initialState?: Partial<BrainState>,
  ) {
    this.state = {
      frontalLobe: initialState?.frontalLobe ?? '',
    };
  }

  // ==================== Queries ====================

  getFrontalLobe(): string {
    return this.state.frontalLobe;
  }

  /** Current content + timestamp of the most recent write.
   *  Used by the system-prompt injector to render "written Nh ago". */
  getFrontalLobeMeta(): { content: string; updatedAt: string | null } {
    const last = this.commits.at(-1);
    return {
      content: this.state.frontalLobe,
      updatedAt: last?.timestamp ?? null,
    };
  }

  log(limit = 10): BrainCommit[] {
    return this.commits.slice(-limit).reverse();
  }

  // ==================== Mutations ====================

  updateFrontalLobe(content: string): { success: boolean; message: string } {
    this.state.frontalLobe = content;
    this.createCommit('frontal_lobe', content.slice(0, 100));
    return { success: true, message: 'Frontal lobe updated successfully' };
  }

  // ==================== Serialization ====================

  exportState(): BrainExportState {
    return {
      commits: [...this.commits],
      head: this.head,
      state: { ...this.state },
    };
  }

  static restore(state: BrainExportState, config: BrainConfig): Brain {
    const brain = new Brain(config, {
      frontalLobe: state.state?.frontalLobe ?? '',
    });
    // Legacy data may contain emotion-type commits — strip them so downstream
    // code (log viewer, timestamp queries) sees a uniform shape.
    brain.commits = (state.commits ?? []).filter((c) => c.type === 'frontal_lobe');
    const lastSurviving = brain.commits.at(-1);
    brain.head = lastSurviving?.hash ?? null;
    return brain;
  }

  // ==================== Internal ====================

  private createCommit(type: BrainCommitType, message: string): void {
    const hash = generateCommitHash({
      type,
      message,
      state: this.state,
      parentHash: this.head,
      timestamp: Date.now(),
    });

    const commit: BrainCommit = {
      hash,
      parentHash: this.head,
      timestamp: new Date().toISOString(),
      type,
      message,
      stateAfter: { ...this.state },
    };

    this.commits.push(commit);
    this.head = hash;

    this.config.onCommit?.(this.exportState());
  }
}
