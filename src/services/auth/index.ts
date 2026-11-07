/**
 * Auth services — admin token + session lifecycle.
 *
 * See:
 *   - token-store.ts   — single admin token, scrypt-hashed at rest
 *   - session-store.ts — opaque session IDs, file-as-truth
 *   - The design is driven by the red-team threat model for the auth
 *     surface (the retired AGENT_BRIEF scaffold).
 */

export {
  bootstrapToken,
  generateToken,
  verifyToken,
  getTokenInfo,
  clearToken,
  type TokenInfo,
} from './token-store.js'

export {
  createSession,
  validateAndTouch,
  revokeSession,
  revokeAllSessions,
  listSessions,
  type SessionRecord,
} from './session-store.js'
