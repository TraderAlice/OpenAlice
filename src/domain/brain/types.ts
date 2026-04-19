/**
 * Brain type definitions
 *
 * Git-like log of frontal-lobe updates. The "emotion" dimension was removed —
 * it was write-only (nothing downstream read it) and its tool was buried under
 * tool-search so the AI never reached for it. Any emotional framing now belongs
 * inside the frontal-lobe string itself.
 */

// ==================== Commit Hash ====================

export type CommitHash = string;

// ==================== Brain State ====================

/** Retained as a single-value union so the persistence format can grow new
 *  commit kinds later without schema churn. */
export type BrainCommitType = 'frontal_lobe';

/** Brain state snapshot */
export interface BrainState {
  frontalLobe: string;
}

// ==================== Brain Commit ====================

/** Brain Commit — one recorded frontal-lobe update */
export interface BrainCommit {
  hash: CommitHash;
  parentHash: CommitHash | null;
  timestamp: string;
  type: BrainCommitType;
  /** Change description (first ~100 chars of the new frontal-lobe content) */
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
