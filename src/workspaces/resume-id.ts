import { generatePetnameId, type RandomInt } from './petname-id.js'

const RESUME_SUFFIX_LENGTH = 6

export interface ResumeIdOptions {
  readonly isTaken?: (id: string) => boolean
  readonly randomInt?: RandomInt
}

/**
 * Allocate the single, product-owned identity for a resumable conversation.
 *
 * The petname keeps URLs and logs recognizable; the fixed base36 suffix adds
 * enough entropy for the global, long-lived resume namespace. Existing UUID
 * resume ids remain valid and are never rewritten.
 */
export function generateResumeId(opts: ResumeIdOptions = {}): string {
  return generatePetnameId('resume', {
    randomSuffixLength: RESUME_SUFFIX_LENGTH,
    ...(opts.isTaken ? { isTaken: opts.isTaken } : {}),
    ...(opts.randomInt ? { randomInt: opts.randomInt } : {}),
  })
}
