/**
 * Brain type definitions
 *
 * Git-like cognitive state tracking for frontal lobe and emotion changes
 */

// ==================== Commit Hash ====================

export type CommitHash = string;

// ==================== Brain State ====================

export type BrainCommitType = 'frontal_lobe' | 'emotion';

/** Brain state snapshot */
export interface BrainState {
  frontalLobe: string;
  emotion: string;
}

// ==================== Brain Commit ====================

/** Brain Commit - complete record of a cognitive state change */
export interface BrainCommit {
  hash: CommitHash;
  parentHash: CommitHash | null;
  timestamp: string;
  type: BrainCommitType;
  /** Change description (frontal lobe content / emotion change reason) */
  message: string;
  stateAfter: BrainState;
}

// ==================== Export State ====================

/** Brain export state (for persistence + recovery) */
export interface BrainExportState {
  commits: BrainCommit[];
  head: CommitHash | null;
  state: BrainState;
}
